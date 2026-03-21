# POC 4: Social Authentication — Google, GitHub, Apple

> Proof-of-concept for social OAuth2 login using Passport.js with full session/token lifecycle management.

## What This Proves

- **Multi-provider OAuth2** with a unified user profile shape across Google, GitHub, and Apple
- **Session management** with configurable duration (24h default, 30-day "Remember me")
- **Token refresh** for providers that support it (Google, Apple)
- **Token revocation** on logout for all providers
- **Re-auth handling** with friendly session-expired messaging
- **Graceful degradation** when a provider isn't configured

## Quick Start

```bash
cd poc-04-auth
npm install
cp .env.example .env
# Edit .env with your OAuth credentials (see setup guides below)
node server.js
```

Server starts at **http://localhost:3001**

---

## Setting Up OAuth Providers

### Google OAuth2

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Navigate to **APIs & Services → Credentials**
4. Click **Create Credentials → OAuth client ID**
5. Application type: **Web application**
6. Authorized redirect URIs: `http://localhost:3001/auth/google/callback`
7. Copy the **Client ID** and **Client Secret** into `.env`

```
GOOGLE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxx
```

### GitHub OAuth

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Fill in:
   - Application name: `New World Auth (Dev)`
   - Homepage URL: `http://localhost:3001`
   - Authorization callback URL: `http://localhost:3001/auth/github/callback`
4. Copy **Client ID** and generate a **Client Secret** into `.env`

```
GITHUB_CLIENT_ID=Ov23lixxxxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Apple Sign In

Apple OAuth is the most complex — it requires an Apple Developer account ($99/year).

1. Go to [Apple Developer Portal](https://developer.apple.com/account/resources/identifiers/list)
2. Register a new **App ID** with "Sign in with Apple" capability
3. Register a new **Services ID** (this becomes your `APPLE_CLIENT_ID`)
4. Configure the Services ID:
   - Domains: `localhost` (for dev)
   - Return URLs: `http://localhost:3001/auth/apple/callback`
5. Create a **Key** with "Sign in with Apple" enabled
6. Download the `.p8` key file and place it in the project root
7. Fill in `.env`:

```
APPLE_CLIENT_ID=com.yourcompany.newworld
APPLE_TEAM_ID=XXXXXXXXXX
APPLE_KEY_ID=XXXXXXXXXX
APPLE_PRIVATE_KEY_PATH=./AuthKey_XXXXXXXXXX.p8
```

> ⚠️ **Note:** Apple requires HTTPS for production. For local dev, Apple Sign In may not work without a tunneling solution (e.g., ngrok).

---

## Session & Token Management

### Session Duration

| Mode | Duration | Trigger |
|------|----------|---------|
| Default | 24 hours | Normal sign-in |
| Remember Me | 30 days | Check "Remember me" before signing in |

Sessions use `express-session` with in-memory storage (MemoryStore). **For production, use MongoDB, Redis, or another persistent store.**

### Token Refresh

**`GET /auth/refresh`** — Refreshes the OAuth access token using the stored refresh token.

| Provider | Refresh Support | Notes |
|----------|----------------|-------|
| Google | ✅ Yes | Uses `offline` access type. Refresh token granted on first consent. |
| GitHub | ❌ No | GitHub OAuth tokens don't expire and don't have refresh tokens. Re-authenticate if revoked. |
| Apple | ⚠️ Partial | Refresh tokens exist but require generating a client_secret JWT for each request. Documented but not fully implemented in this POC. |

### Logout & Token Revocation

**`GET /logout`** performs three actions:

1. **Revokes the access token** with the provider:
   - Google: `POST https://oauth2.googleapis.com/revoke?token=ACCESS_TOKEN`
   - GitHub: `DELETE https://api.github.com/applications/{client_id}/token` (Basic auth with client credentials)
   - Apple: Documented endpoint at `https://appleid.apple.com/auth/revoke` (requires JWT — logged for POC)
2. **Destroys the Express session** (server-side)
3. **Clears the session cookie** (`connect.sid`)

### Re-Authentication

Protected routes use the `isAuthenticated` middleware. If a user hits a protected route without a valid session:

- **Page routes** (`/dashboard`): Redirect to `/?reason=session_expired`
- **API routes** (`/api/me`): Return `401 { error: "Not authenticated", user: null }`

The login page detects the `reason` query parameter and shows a friendly message.

---

## API Routes

| Route | Auth | Description |
|-------|------|-------------|
| `GET /` | Public | Login page |
| `GET /auth/google` | Public | Initiate Google OAuth |
| `GET /auth/google/callback` | Public | Google OAuth callback |
| `GET /auth/github` | Public | Initiate GitHub OAuth |
| `GET /auth/github/callback` | Public | GitHub OAuth callback |
| `GET /auth/apple` | Public | Initiate Apple OAuth |
| `POST /auth/apple/callback` | Public | Apple OAuth callback |
| `GET /dashboard` | 🔒 | User dashboard with profile info |
| `GET /api/me` | 🔒 | Current user as JSON |
| `GET /auth/refresh` | 🔒 | Refresh access token |
| `GET /logout` | Public | Logout + token revocation |

### User Shape (normalized across providers)

```json
{
  "id": "google_123456789",
  "provider": "google",
  "name": "Display Name",
  "email": "user@example.com",
  "avatar": "https://lh3.googleusercontent.com/...",
  "sessionExpiresAt": 1703361600000
}
```

---

## Production Security Notes

- **HTTPS required** — Apple Sign In mandates HTTPS. Google and GitHub strongly recommend it. Use a reverse proxy (nginx) with TLS or a service like Cloudflare.
- **Session store** — Replace in-memory `MemoryStore` with `connect-mongo`, `connect-redis`, or similar. MemoryStore leaks memory and doesn't survive restarts.
- **Session secret** — Use a strong, random secret. Generate one: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
- **CSRF protection** — Add `csurf` or similar middleware for POST-based flows (especially Apple callback).
- **Rate limiting** — Add `express-rate-limit` to auth endpoints to prevent abuse.
- **Token storage** — In production, encrypt tokens at rest. Don't store raw access/refresh tokens in session without encryption.
- **Cookie flags** — Set `secure: true`, `httpOnly: true`, `sameSite: 'strict'` in production.
- **Scope minimization** — Only request the scopes you need. Current config requests `profile` + `email` (minimal).

---

## File Structure

```
poc-04-auth/
├── package.json         # Dependencies & scripts
├── server.js            # Express app + Passport config + all routes
├── .env.example         # Template for OAuth credentials
├── public/
│   └── index.html       # Dark fantasy login page
└── README.md            # This file
```
