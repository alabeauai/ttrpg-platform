require("dotenv").config();

const express = require("express");
const session = require("express-session");
const passport = require("passport");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");

// ── MongoDB User Model ──
const userSchema = new mongoose.Schema({
  email:      { type: String, unique: true, sparse: true },
  role:       { type: String, enum: ['gm', 'player', 'unknown'], default: 'unknown', index: true },
  provider:   String,
  providerId: { type: String, unique: true, sparse: true },
  firstName:  String,
  lastName:   String,
  avatarUrl:  String,
  campaigns:  [{ campaignId: mongoose.Schema.Types.ObjectId, joinedAt: Date, status: String }],
  lastLoginAt:{ type: Date, default: Date.now },
  createdAt:  { type: Date, default: Date.now },
});
const User = mongoose.models.User || mongoose.model("User", userSchema);

// ── Connect to MongoDB ──
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ MongoDB connected"))
    .catch(err => console.error("❌ MongoDB error:", err.message));
} else {
  console.warn("⚠️  MONGODB_URI not set — users will not be persisted");
}

const app = express();
const PORT = process.env.PORT || 3001;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const SESSION_DURATION_DEFAULT = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_DURATION_REMEMBER = 30 * 24 * 60 * 60 * 1000; // 30 days

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function providerConfigured(provider) {
  switch (provider) {
    case "google":
      return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    case "github":
      return !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
    case "apple": {
      if (!(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID)) return false;
      const keyPath = process.env.APPLE_PRIVATE_KEY_PATH;
      if (!keyPath) return false;
      try { fs.accessSync(keyPath, fs.constants.R_OK); return true; } catch { return false; }
    }
    default:
      return false;
  }
}

/** Normalize user profile across providers */
function normalizeProfile(provider, profile, accessToken, refreshToken) {
  let email = null;
  if (profile.emails && profile.emails.length) {
    email = profile.emails[0].value;
  } else if (profile.email) {
    email = profile.email;
  }

  let avatar = null;
  if (profile.photos && profile.photos.length) {
    avatar = profile.photos[0].value;
  } else if (profile._json && profile._json.avatar_url) {
    avatar = profile._json.avatar_url;
  }

  return {
    id: `${provider}_${profile.id}`,
    provider,
    name: profile.displayName || profile.name || email || "Unknown",
    email,
    avatar,
    accessToken: accessToken || null,
    refreshToken: refreshToken || null,
    tokenIssuedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "unsafe-default-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: SESSION_DURATION_DEFAULT,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// ── Persist user to MongoDB ──
async function upsertUser(profile) {
  if (!mongoose.connection.readyState) return profile;
  try {
    const nameParts = (profile.name || '').split(' ');
    await User.findOneAndUpdate(
      { providerId: profile.id },
      {
        provider:   profile.provider,
        providerId: profile.id,
        ...(profile.email  && { email:     profile.email }),
        ...(profile.name   && { firstName: nameParts[0] || '', lastName: nameParts.slice(1).join(' ') || '' }),
        ...(profile.avatar && { avatarUrl: profile.avatar }),
        lastLoginAt: new Date(),
        $setOnInsert: { createdAt: new Date(), role: 'unknown' }
      },
      { upsert: true, returnDocument: 'after' }
    );
    // Fetch stored doc (picks up role + stored email for Apple)
    const stored = await User.findOne({ providerId: profile.id });
    return {
      ...profile,
      email:  profile.email  || stored?.email  || null,
      name:   profile.name   || `${stored?.firstName || ''} ${stored?.lastName || ''}`.trim() || null,
      avatar: profile.avatar || stored?.avatarUrl || null,
      role:   stored?.role   || 'unknown',
    };
  } catch(err) {
    console.error("❌ upsertUser error:", err.message);
    return profile;
  }
}

// ---------------------------------------------------------------------------
// Passport Strategies
// ---------------------------------------------------------------------------

// --- Google ---
if (providerConfigured("google")) {
  const GoogleStrategy = require("passport-google-oauth20").Strategy;
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${BASE_URL}/auth/google/callback`,
        scope: ["profile", "email"],
        accessType: "offline",
        prompt: "consent",
      },
      (accessToken, refreshToken, profile, done) => {
        upsertUser(normalizeProfile("google", profile, accessToken, refreshToken)).then(u => done(null, u)).catch(() => done(null, normalizeProfile("google", profile, accessToken, refreshToken)));
      }
    )
  );
  console.log("✅ Google OAuth strategy loaded");
} else {
  console.log("⚠️  Google OAuth not configured (missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)");
}

// --- GitHub ---
if (providerConfigured("github")) {
  const GitHubStrategy = require("passport-github2").Strategy;
  passport.use(
    new GitHubStrategy(
      {
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: `${BASE_URL}/auth/github/callback`,
        scope: ["user:email"],
      },
      (accessToken, refreshToken, profile, done) => {
        // GitHub doesn't provide refresh tokens
        upsertUser(normalizeProfile("github", profile, accessToken, null)).then(u => done(null, u)).catch(() => done(null, normalizeProfile("github", profile, accessToken, null)));
      }
    )
  );
  console.log("✅ GitHub OAuth strategy loaded");
} else {
  console.log("⚠️  GitHub OAuth not configured (missing GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET)");
}

// --- Apple ---
if (providerConfigured("apple")) {
  const AppleStrategy = require("passport-apple").Strategy;
  passport.use(
    new AppleStrategy(
      {
        clientID: process.env.APPLE_CLIENT_ID,
        teamID: process.env.APPLE_TEAM_ID,
        keyID: process.env.APPLE_KEY_ID,
        privateKeyString: require("fs").readFileSync(process.env.APPLE_PRIVATE_KEY_PATH, "utf8"),
        callbackURL: `${BASE_URL}/auth/apple/callback`,
        scope: ["name", "email"],
      },
      (req, accessToken, refreshToken, idToken, profile, done) => {
        // Apple sends user info only on first auth; profile may be sparse
        const user = {
          id: `apple_${profile.id || idToken.sub}`,
          provider: "apple",
          name: profile.name
            ? `${profile.name.firstName || ""} ${profile.name.lastName || ""}`.trim()
            : "Apple User",
          email: profile.email || idToken.email || null,
          avatar: null, // Apple doesn't provide avatars
          accessToken: accessToken || null,
          refreshToken: refreshToken || null,
          tokenIssuedAt: Date.now(),
        };
        upsertUser(user).then(u => done(null, u)).catch(() => done(null, user));
      }
    )
  );
  console.log("✅ Apple OAuth strategy loaded");
} else {
  console.log("⚠️  Apple OAuth not configured (missing credentials or private key)");
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

function isAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    // Check if session cookie is still valid (express-session handles expiry,
    // but let's be explicit about user object presence)
    return next();
  }
  // For API routes, return 401 JSON
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Not authenticated", user: null });
  }
  // For page routes, redirect with reason
  return res.redirect("/?reason=session_expired");
}

function notConfiguredPage(provider) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Not Configured</title>
  <style>
    body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
           background:#0d0d0d; color:#c9b89e; font-family:'Segoe UI',sans-serif; }
    .card { background:#1a1a1a; border:1px solid #3a2f24; border-radius:12px; padding:2.5rem;
            max-width:480px; text-align:center; }
    h2 { color:#e8d5b7; margin-bottom:.5rem; }
    p { line-height:1.6; }
    a { color:#d4a853; text-decoration:none; }
    a:hover { text-decoration:underline; }
    code { background:#2a2218; padding:2px 6px; border-radius:4px; font-size:.9em; }
  </style>
</head>
<body>
  <div class="card">
    <h2>⚠️ ${provider} Sign-In Not Configured</h2>
    <p>This authentication method isn't set up yet.<br>
    Add the required credentials to your <code>.env</code> file and restart the server.</p>
    <p><a href="/">← Back to Sign In</a></p>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Auth Routes — Google
// ---------------------------------------------------------------------------

app.get("/auth/google", (req, res, next) => {
  if (!providerConfigured("google")) return res.status(501).send(notConfiguredPage("Google"));
  // Store remember-me preference before redirect
  if (req.query.remember === "true") req.session.rememberMe = true;
  passport.authenticate("google", { accessType: "offline", prompt: "consent" })(req, res, next);
});

app.get(
  "/auth/google/callback",
  (req, res, next) => {
    if (!providerConfigured("google")) return res.redirect("/");
    passport.authenticate("google", { failureRedirect: "/?reason=auth_failed" })(req, res, next);
  },
  (req, res) => {
    applyRememberMe(req);
    res.redirect("/campaigns");
  }
);

// ---------------------------------------------------------------------------
// Auth Routes — GitHub
// ---------------------------------------------------------------------------

app.get("/auth/github", (req, res, next) => {
  if (!providerConfigured("github")) return res.status(501).send(notConfiguredPage("GitHub"));
  if (req.query.remember === "true") req.session.rememberMe = true;
  passport.authenticate("github", { scope: ["user:email"] })(req, res, next);
});

app.get(
  "/auth/github/callback",
  (req, res, next) => {
    if (!providerConfigured("github")) return res.redirect("/");
    passport.authenticate("github", { failureRedirect: "/?reason=auth_failed" })(req, res, next);
  },
  (req, res) => {
    applyRememberMe(req);
    res.redirect("/campaigns");
  }
);

// ---------------------------------------------------------------------------
// Auth Routes — Apple
// ---------------------------------------------------------------------------

app.get("/auth/apple", (req, res, next) => {
  if (!providerConfigured("apple")) return res.status(501).send(notConfiguredPage("Apple"));
  if (req.query.remember === "true") req.session.rememberMe = true;
  passport.authenticate("apple")(req, res, next);
});

// Apple sends a POST callback
app.post(
  "/auth/apple/callback",
  (req, res, next) => {
    if (!providerConfigured("apple")) return res.redirect("/");
    passport.authenticate("apple", { failureRedirect: "/?reason=auth_failed" }, (err, user, info) => {
      if (err) {
        console.error("🍎 Apple auth error:", JSON.stringify(err, null, 2));
        console.error("🍎 Apple auth info:", JSON.stringify(info, null, 2));
        return res.redirect("/?reason=auth_failed");
      }
      if (!user) {
        console.error("🍎 Apple no user, info:", JSON.stringify(info, null, 2));
        return res.redirect("/?reason=auth_failed");
      }
      req.logIn(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        applyRememberMe(req);
        res.redirect("/campaigns");
      });
    })(req, res, next);
  },
  (req, res) => {
    applyRememberMe(req);
    res.redirect("/campaigns");
  }
);

// Also handle GET callback for flexibility
app.get(
  "/auth/apple/callback",
  (req, res, next) => {
    if (!providerConfigured("apple")) return res.redirect("/");
    passport.authenticate("apple", { failureRedirect: "/?reason=auth_failed" })(req, res, next);
  },
  (req, res) => {
    applyRememberMe(req);
    res.redirect("/campaigns");
  }
);

// ---------------------------------------------------------------------------
// Remember Me
// ---------------------------------------------------------------------------

function applyRememberMe(req) {
  if (req.session.rememberMe) {
    req.session.cookie.maxAge = SESSION_DURATION_REMEMBER;
    req.session.sessionExpiresAt = Date.now() + SESSION_DURATION_REMEMBER;
    delete req.session.rememberMe;
  } else {
    req.session.cookie.maxAge = SESSION_DURATION_DEFAULT;
    req.session.sessionExpiresAt = Date.now() + SESSION_DURATION_DEFAULT;
  }
}

// ---------------------------------------------------------------------------
// Token Refresh
// ---------------------------------------------------------------------------

app.get("/auth/refresh", isAuthenticated, async (req, res) => {
  const user = req.user;

  if (user.provider === "google" && user.refreshToken) {
    try {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token: user.refreshToken,
          grant_type: "refresh_token",
        }),
      });
      const data = await response.json();
      if (data.access_token) {
        user.accessToken = data.access_token;
        user.tokenIssuedAt = Date.now();
        req.login(user, (err) => {
          if (err) return res.status(500).json({ error: "Failed to update session" });
          return res.json({ success: true, message: "Google token refreshed", tokenIssuedAt: user.tokenIssuedAt });
        });
      } else {
        return res.status(400).json({ success: false, error: "Refresh failed", details: data });
      }
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  } else if (user.provider === "apple" && user.refreshToken) {
    try {
      // Apple token refresh requires client_secret (JWT) — complex for POC
      // Documenting the endpoint; full implementation needs the JWT generation
      return res.json({
        success: false,
        message: "Apple token refresh requires generating a client_secret JWT. See README for details.",
        endpoint: "https://appleid.apple.com/auth/token",
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  } else if (user.provider === "github") {
    return res.json({
      success: false,
      message: "GitHub OAuth does not support refresh tokens. Re-authenticate to get a new token.",
    });
  } else {
    return res.status(400).json({ success: false, message: "No refresh token available for this provider." });
  }
});

// ---------------------------------------------------------------------------
// Logout with Token Revocation
// ---------------------------------------------------------------------------

app.get("/logout", async (req, res) => {
  const user = req.user;

  if (user) {
    try {
      await revokeToken(user);
    } catch (err) {
      console.error("Token revocation error (non-fatal):", err.message);
    }
  }

  req.logout((err) => {
    if (err) console.error("Logout error:", err);
    req.session.destroy((err) => {
      if (err) console.error("Session destroy error:", err);
      res.clearCookie("connect.sid");
      res.redirect("/");
    });
  });
});

async function revokeToken(user) {
  if (!user || !user.accessToken) return;

  switch (user.provider) {
    case "google": {
      const resp = await fetch(
        `https://oauth2.googleapis.com/revoke?token=${user.accessToken}`,
        { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );
      if (!resp.ok) console.warn("Google token revocation returned:", resp.status);
      else console.log("🔒 Google token revoked");
      break;
    }
    case "apple": {
      // Apple revocation requires client_secret JWT — log intent for POC
      console.log("🔒 Apple token revocation would POST to https://appleid.apple.com/auth/revoke");
      break;
    }
    case "github": {
      if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) break;
      const credentials = Buffer.from(
        `${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`
      ).toString("base64");
      const resp = await fetch(
        `https://api.github.com/applications/${process.env.GITHUB_CLIENT_ID}/token`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Basic ${credentials}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ access_token: user.accessToken }),
        }
      );
      if (resp.status === 204) console.log("🔒 GitHub token revoked");
      else console.warn("GitHub token revocation returned:", resp.status);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Protected Routes
// ---------------------------------------------------------------------------

const mockCampaigns = [
  {
    id: "1",
    name: "The Shadow Realm",
    description: "A dark journey through the cursed lands of Aethelgard where ancient evils stir.",
    status: "active",
    image: null,
    nextSession: { day: "Tuesday", time: "7:00 PM" },
    players: { current: 3, max: 5 },
    inviteCode: "SHAD-7X4K"
  },
  {
    id: "2",
    name: "Cathedral of Ash",
    description: "Investigate the mysterious fires that have consumed the holy city of Ember.",
    status: "paused",
    image: null,
    nextSession: null,
    players: { current: 4, max: 4 },
    inviteCode: "CATH-9M2P"
  }
];

function renderCampaignCard(campaign, isGm) {
  const statusColor = campaign.status === "active" ? "#2563EB" : "#475569";
  const statusBg = campaign.status === "active" ? "rgba(37,99,235,0.15)" : "rgba(71,85,105,0.2)";
  const statusLabel = campaign.status === "active" ? "ACTIVE" : "PAUSED";
  const playerPct = Math.round((campaign.players.current / campaign.players.max) * 100);
  const bannerGradient = campaign.status === "active"
    ? "linear-gradient(135deg, #0F1729 0%, #0D1B3E 50%, #0A1628 100%)"
    : "linear-gradient(135deg, #0F1117 0%, #141820 50%, #0C0E14 100%)";

  return `
    <div class="campaign-card">
      <div class="card-banner" style="background:${bannerGradient};">
        <div class="banner-shimmer"></div>
        <div class="banner-icon">${campaign.status === "active" ? "⚔️" : "🏔️"}</div>
        <div class="status-badge" style="background:${statusBg};color:${statusColor};border:1px solid ${statusColor}40;">
          ${statusLabel}
        </div>
      </div>
      <div class="card-body">
        <div class="card-name">${escapeHtml(campaign.name)}</div>
        <div class="card-desc">${escapeHtml(campaign.description)}</div>
        <div class="card-meta">
          ${campaign.nextSession ? `
          <div class="meta-row">
            <span class="meta-icon">🗓</span>
            <span class="meta-label">Next Session</span>
            <span class="meta-value">${escapeHtml(campaign.nextSession.day)} · ${escapeHtml(campaign.nextSession.time)}</span>
          </div>` : `
          <div class="meta-row">
            <span class="meta-icon">⏸</span>
            <span class="meta-label">Next Session</span>
            <span class="meta-value" style="color:#475569;">Not scheduled</span>
          </div>`}
          <div class="meta-row" style="margin-top:10px;">
            <span class="meta-icon">👥</span>
            <span class="meta-label">Players</span>
            <span class="meta-value">${campaign.players.current} / ${campaign.players.max}</span>
          </div>
          <div class="player-bar-track">
            <div class="player-bar-fill" style="width:${playerPct}%;background:${campaign.status === "active" ? "linear-gradient(90deg,#1D4ED8,#3B82F6)" : "linear-gradient(90deg,#334155,#475569)"};"></div>
          </div>
        </div>
        ${isGm ? `
        <button class="btn-invite" onclick="copyInvite('${escapeHtml(campaign.inviteCode)}', this)">
          <span>📋</span> Copy Invite Code
        </button>` : ""}
        <a href="/campaigns/${escapeHtml(campaign.id)}" class="btn-enter">Enter Campaign</a>
      </div>
    </div>`;
}

app.get("/campaigns", isAuthenticated, (req, res) => {
  const user = req.user;
  const isGm = user.role === "gm";
  const hasCampaigns = mockCampaigns.length > 0;

  const cardsHtml = hasCampaigns
    ? mockCampaigns.map(c => renderCampaignCard(c, isGm)).join("")
    : "";

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Campaigns — Cartyx</title>
  <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      min-height: 100vh;
      background: #080A12;
      color: #E2E8F0;
      font-family: 'Inter', sans-serif;
      display: flex;
      flex-direction: column;
    }

    /* ── Topbar ── */
    .topbar {
      position: sticky;
      top: 0;
      z-index: 100;
      width: 100%;
      background: rgba(8,10,18,0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid rgba(255,255,255,0.06);
      padding: 0 32px;
      height: 60px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .topbar-brand {
      font-family: 'Press Start 2P', monospace;
      font-size: 11px;
      color: #fff;
      letter-spacing: 3px;
      text-decoration: none;
    }
    .topbar-right {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .topbar-avatar {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      border: 2px solid rgba(59,130,246,0.4);
      object-fit: cover;
    }
    .topbar-avatar-placeholder {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      border: 2px solid rgba(59,130,246,0.4);
      background: rgba(37,99,235,0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
    }
    .topbar-name {
      font-size: 13px;
      color: #94A3B8;
      font-weight: 500;
    }
    .topbar-divider {
      width: 1px;
      height: 20px;
      background: rgba(255,255,255,0.1);
    }
    .topbar-signout {
      font-size: 12px;
      color: #475569;
      text-decoration: none;
      transition: color 0.2s;
      font-weight: 500;
    }
    .topbar-signout:hover { color: #94A3B8; }

    /* ── Main ── */
    .main {
      flex: 1;
      width: 100%;
      max-width: 1160px;
      margin: 0 auto;
      padding: 48px 32px 80px;
    }

    /* ── Page header ── */
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 40px;
    }
    .page-title {
      font-family: 'Press Start 2P', monospace;
      font-size: 15px;
      color: #fff;
      letter-spacing: 2px;
    }
    .btn-create {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 22px;
      border-radius: 12px;
      border: none;
      background: linear-gradient(135deg, #1D4ED8 0%, #2563EB 60%, #3B82F6 100%);
      color: #fff;
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s;
      box-shadow: 0 2px 12px rgba(37,99,235,0.3);
    }
    .btn-create:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 24px rgba(37,99,235,0.5);
    }

    /* ── Campaign grid ── */
    .campaigns-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 24px;
    }

    /* ── Campaign card ── */
    .campaign-card {
      background: #0D1117;
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 16px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
    }
    .campaign-card:hover {
      border-color: rgba(59,130,246,0.25);
      transform: translateY(-3px);
      box-shadow: 0 12px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(59,130,246,0.1);
    }

    /* Banner */
    .card-banner {
      position: relative;
      height: 160px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .banner-shimmer {
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse at 30% 40%, rgba(37,99,235,0.08) 0%, transparent 60%),
                  radial-gradient(ellipse at 70% 60%, rgba(99,102,241,0.05) 0%, transparent 60%);
      pointer-events: none;
    }
    .banner-icon {
      font-size: 48px;
      opacity: 0.35;
      filter: drop-shadow(0 0 20px rgba(59,130,246,0.3));
    }
    .status-badge {
      position: absolute;
      top: 14px;
      right: 14px;
      font-family: 'Press Start 2P', monospace;
      font-size: 7px;
      letter-spacing: 1px;
      padding: 5px 10px;
      border-radius: 6px;
    }

    /* Card body */
    .card-body {
      padding: 20px 20px 20px;
      display: flex;
      flex-direction: column;
      gap: 0;
      flex: 1;
    }
    .card-name {
      font-family: 'Press Start 2P', monospace;
      font-size: 11px;
      color: #F1F5F9;
      line-height: 1.6;
      margin-bottom: 10px;
    }
    .card-desc {
      font-size: 13px;
      color: #64748B;
      line-height: 1.6;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin-bottom: 18px;
    }
    .card-meta {
      margin-bottom: 16px;
    }
    .meta-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .meta-icon { font-size: 13px; }
    .meta-label {
      font-size: 11px;
      color: #475569;
      font-weight: 500;
      flex: 1;
    }
    .meta-value {
      font-size: 12px;
      color: #94A3B8;
      font-weight: 500;
    }
    .player-bar-track {
      margin-top: 7px;
      height: 4px;
      background: rgba(255,255,255,0.06);
      border-radius: 999px;
      overflow: hidden;
    }
    .player-bar-fill {
      height: 100%;
      border-radius: 999px;
      transition: width 0.4s ease;
    }

    /* Buttons */
    .btn-invite {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
      padding: 9px 16px;
      margin-bottom: 10px;
      border-radius: 10px;
      border: 1px solid rgba(59,130,246,0.2);
      background: rgba(37,99,235,0.08);
      color: #60A5FA;
      font-family: 'Inter', sans-serif;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-invite:hover {
      background: rgba(37,99,235,0.15);
      border-color: rgba(59,130,246,0.4);
    }
    .btn-enter {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      padding: 12px 16px;
      border-radius: 12px;
      border: none;
      background: linear-gradient(135deg, #1D4ED8 0%, #2563EB 60%, #3B82F6 100%);
      color: #fff;
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s;
      box-shadow: 0 2px 10px rgba(37,99,235,0.25);
      margin-top: auto;
    }
    .btn-enter:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(37,99,235,0.45);
    }

    /* ── Empty state ── */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 100px 20px;
    }
    .empty-icon { font-size: 56px; margin-bottom: 20px; opacity: 0.6; }
    .empty-title {
      font-family: 'Press Start 2P', monospace;
      font-size: 12px;
      color: #334155;
      letter-spacing: 2px;
      margin-bottom: 14px;
      line-height: 1.8;
    }
    .empty-desc {
      font-size: 14px;
      color: #475569;
      margin-bottom: 32px;
      max-width: 320px;
      line-height: 1.6;
    }

    /* ── Toast ── */
    .toast {
      position: fixed;
      bottom: 28px;
      left: 50%;
      transform: translateX(-50%) translateY(80px);
      background: #1E293B;
      border: 1px solid rgba(59,130,246,0.3);
      border-radius: 10px;
      padding: 12px 20px;
      font-size: 13px;
      color: #93C5FD;
      font-weight: 500;
      transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1);
      z-index: 999;
      white-space: nowrap;
    }
    .toast.show { transform: translateX(-50%) translateY(0); }

    @media (max-width: 640px) {
      .main { padding: 32px 16px 60px; }
      .topbar { padding: 0 16px; }
      .page-title { font-size: 11px; }
      .campaigns-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <nav class="topbar">
    <a href="/campaigns" class="topbar-brand">CARTYX</a>
    <div class="topbar-right">
      ${user.avatar
        ? `<img src="${escapeHtml(user.avatar)}" class="topbar-avatar" alt="">`
        : `<div class="topbar-avatar-placeholder">🧙</div>`}
      <span class="topbar-name">${escapeHtml(user.name || "")}</span>
      <div class="topbar-divider"></div>
      <a href="/logout" class="topbar-signout">Sign Out</a>
    </div>
  </nav>

  <main class="main">
    <div class="page-header">
      <h1 class="page-title">MY CAMPAIGNS</h1>
      ${isGm ? `<a href="/campaigns/new" class="btn-create">⚔️ Create Campaign</a>` : ""}
    </div>

    ${hasCampaigns ? `
    <div class="campaigns-grid">
      ${cardsHtml}
    </div>` : `
    <div class="empty-state">
      <div class="empty-icon">🗺️</div>
      <div class="empty-title">NO CAMPAIGNS YET</div>
      <div class="empty-desc">${isGm
        ? "Create your first campaign to get started."
        : "Ask your GM for an invite code to join a campaign."}</div>
      ${isGm ? `<a href="/campaigns/new" class="btn-create">⚔️ Create Your First Campaign</a>` : ""}
    </div>`}
  </main>

  <div class="toast" id="toast"></div>

  <script>
    function copyInvite(code, btn) {
      navigator.clipboard.writeText(code).then(() => {
        const toast = document.getElementById('toast');
        toast.textContent = '✓ Invite code copied: ' + code;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2400);
      });
    }
  </script>
</body>
</html>`);
});

// Keep /dashboard as alias
app.get("/dashboard", isAuthenticated, (req, res) => {
  const user = req.user;
  const expiresAt = req.session.sessionExpiresAt
    ? new Date(req.session.sessionExpiresAt).toISOString()
    : "unknown";
  const expiresIn = req.session.sessionExpiresAt
    ? Math.max(0, Math.round((req.session.sessionExpiresAt - Date.now()) / 1000 / 60))
    : null;

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard — New World</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&display=swap');
    body { min-height:100vh; background:linear-gradient(135deg, #0E101C 0%, #10121E 100%); color:#c9b89e;
           font-family:'Cinzel','Segoe UI',system-ui,sans-serif;
           display:flex; flex-direction:column; align-items:center; justify-content:center; gap:24px; }
    .logo { width:100px; height:100px; object-fit:contain; }
    .card { background:linear-gradient(135deg, #0E101C 0%, #10121E 100%); border:1px solid rgba(100,160,220,0.15); border-radius:16px;
            padding:2.5rem; max-width:520px; width:90%; text-align:center; }
    h1 { color:#e8d5b7; font-size:1.6rem; margin-bottom:.25rem; }
    .subtitle { color:#8a7a6a; font-size:.85rem; margin-bottom:1.5rem; }
    .avatar { width:80px; height:80px; border-radius:50%; border:3px solid #d4a853;
              margin:0 auto 1rem; display:block; object-fit:cover; }
    .no-avatar { width:80px; height:80px; border-radius:50%; border:3px solid #d4a853;
                 margin:0 auto 1rem; display:flex; align-items:center; justify-content:center;
                 background:#2a2218; font-size:2rem; }
    .info { text-align:left; background:#13100c; border-radius:8px; padding:1rem 1.25rem;
            margin:1rem 0; font-size:.9rem; line-height:1.8; }
    .info .label { color:#8a7a6a; }
    .info .value { color:#e8d5b7; }
    .badge { display:inline-block; padding:.15rem .5rem; border-radius:4px;
             font-size:.75rem; font-weight:600; text-transform:uppercase; }
    .badge.google { background:#4285f422; color:#8ab4f8; border:1px solid #4285f444; }
    .badge.github { background:#f0f6fc11; color:#c9d1d9; border:1px solid #30363d; }
    .badge.apple  { background:#ffffff11; color:#f5f5f7; border:1px solid #48484a; }
    .session-info { background:#1e1a14; border:1px solid #332b20; border-radius:8px;
                    padding:.75rem 1rem; margin:1rem 0; font-size:.8rem; color:#8a7a6a; }
    .session-info strong { color:#c9b89e; }
    .actions { display:flex; gap:.75rem; justify-content:center; margin-top:1.5rem; }
    .btn { padding:.6rem 1.5rem; border-radius:8px; border:none; cursor:pointer;
           font-size:.9rem; font-weight:500; text-decoration:none; transition:all .2s; }
    .btn-refresh { background:#2a4a2a; color:#7ec87e; border:1px solid #3a6a3a; }
    .btn-refresh:hover { background:#3a5a3a; }
    .btn-logout { background:#4a2a2a; color:#e87e7e; border:1px solid #6a3a3a; }
    .btn-logout:hover { background:#5a3a3a; }
  </style>
</head>
<body>
  <img src="/logo.png" alt="Cartyx" class="logo">
  <div class="card">
    <h1>⚔️ Welcome, Adventurer</h1>
    <p class="subtitle">You have entered the realm</p>
    ${user.avatar
      ? `<img src="${user.avatar}" alt="avatar" class="avatar">`
      : `<div class="no-avatar">🧙</div>`}
    <div class="info">
      <div><span class="label">Name: </span><span class="value">${escapeHtml(user.name)}</span></div>
      <div><span class="label">Email: </span><span class="value">${escapeHtml(user.email || "Not provided")}</span></div>
      <div><span class="label">Provider: </span><span class="badge ${user.provider}">${user.provider}</span></div>
      <div><span class="label">User ID: </span><span class="value" style="font-size:.8em;opacity:.7">${escapeHtml(user.id)}</span></div>
    </div>
    <div class="session-info">
      🕐 Session expires: <strong>${expiresAt}</strong><br>
      ${expiresIn !== null ? `⏳ Time remaining: <strong>${expiresIn} minutes</strong>` : ""}
    </div>
    <div class="actions">

      <a href="/logout" class="btn btn-logout">🚪 Sign Out</a>
    </div>
  </div>
</body>
</html>`);
});

app.get("/api/me", isAuthenticated, async (req, res) => {
  const user = req.user;

  // Refresh role from DB on each call (in case it was updated)
  let role = user.role || "unknown";
  if (mongoose.connection.readyState) {
    const stored = await User.findOne({
      $or: [
        { providerId: user.id },
        ...(user.email ? [{ email: user.email }] : [])
      ]
    });
    if (stored) {
      role = stored.role;
      // Backfill providerId if missing
      if (!stored.providerId && user.id) {
        await User.updateOne({ _id: stored._id }, { providerId: user.id, lastLoginAt: new Date() });
      } else {
        await User.updateOne({ _id: stored._id }, { lastLoginAt: new Date() });
      }
    }
  }

  res.json({
    id:               user.id,
    provider:         user.provider,
    name:             user.name,
    email:            user.email,
    avatar:           user.avatar,
    role,
    sessionExpiresAt: req.session.sessionExpiresAt || null,
  });
});

// ---------------------------------------------------------------------------
// Static & Home
// ---------------------------------------------------------------------------

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`\n🏰 New World Auth Server running at ${BASE_URL}\n`);
  console.log("Configured providers:");
  console.log(`  Google: ${providerConfigured("google") ? "✅" : "❌ (add credentials to .env)"}`);
  console.log(`  GitHub: ${providerConfigured("github") ? "✅" : "❌ (add credentials to .env)"}`);
  console.log(`  Apple:  ${providerConfigured("apple") ? "✅" : "❌ (add credentials to .env)"}`);
  console.log("");
});
