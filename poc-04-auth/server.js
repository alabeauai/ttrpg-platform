require("dotenv").config();

const express = require("express");
const session = require("express-session");
const passport = require("passport");
const path = require("path");
const fs = require("fs");

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
        done(null, normalizeProfile("google", profile, accessToken, refreshToken));
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
        done(null, normalizeProfile("github", profile, accessToken, null));
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
        privateKeyPath: process.env.APPLE_PRIVATE_KEY_PATH,
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
        done(null, user);
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
    res.redirect("/dashboard");
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
    res.redirect("/dashboard");
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
    passport.authenticate("apple", { failureRedirect: "/?reason=auth_failed" })(req, res, next);
  },
  (req, res) => {
    applyRememberMe(req);
    res.redirect("/dashboard");
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
    res.redirect("/dashboard");
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
    body { min-height:100vh; background:#0d0d0d; color:#c9b89e;
           font-family:'Segoe UI',system-ui,sans-serif;
           display:flex; align-items:center; justify-content:center; }
    .card { background:#1a1a1a; border:1px solid #3a2f24; border-radius:16px;
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
      ${user.refreshToken ? `<a href="/auth/refresh" class="btn btn-refresh">🔄 Refresh Token</a>` : ""}
      <a href="/logout" class="btn btn-logout">🚪 Sign Out</a>
    </div>
  </div>
</body>
</html>`);
});

app.get("/api/me", isAuthenticated, (req, res) => {
  const user = req.user;
  res.json({
    id: user.id,
    provider: user.provider,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
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
