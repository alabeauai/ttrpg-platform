# POC 4 — Social Authentication

Proves out Google, GitHub, and Apple sign-in using Passport.js with full session/token lifecycle management.

## What this POC demonstrates

- OAuth2 social login with 3 providers
- Unified user shape (all providers normalize to same `{id, provider, name, email, avatar}`)
- Refresh token handling (Google + Apple)
- Session management with configurable expiry (24hr default, 30 days with "Remember me")
- Token revocation on logout
- Graceful handling of unconfigured providers
- Re-auth redirect when session expires

## Quick Start

```bash
cd poc-04-auth
npm install
cp .env.example .env
# Edit .env with your OAuth credentials
node server.js
# → http://localhost:3001
```

## Setting Up Each Provider

### Google (easiest)
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use existing)
3. Enable **Google+ API** → APIs & Services → Enable APIs
4. Go to **Credentials** → Create Credentials → OAuth 2.0 Client ID
5. Application type: **Web application**
6. Add Authorized redirect URI: `http://localhost:3001/auth/google/callback`
7. Copy **Client ID** and **Client Secret** → paste into `.env`

### GitHub (easiest after Google)
1. GitHub → Settings → Developer Settings → **OAuth Apps** → New OAuth App
2. Application name: anything (e.g. "New World Dev")
3. Homepage URL: `http://localhost:3001`
4. Authorization callback URL: `http://localhost:3001/auth/github/callback`
5. Register application → copy **Client ID** and **Client Secret** → paste into `.env`

### Apple (most complex — requires paid developer account)
1. Enroll in [Apple Developer Program](https://developer.apple.com/programs/) ($99/year)
2. Go to [developer.apple.com](https://developer.apple.com) → Certificates, Identifiers & Profiles
3. **Identifiers** → Register a new Services ID (type: Services IDs)
4. Enable "Sign In with Apple" → Configure → add your domain and return URL: `https://yourdomain.com/auth/apple/callback`
5. **Keys** → Create a new key → enable "Sign In with Apple" → download the `.p8` file
6. Copy your **Team ID** (top right of Apple Developer portal), **Key ID**, and **Services ID** → paste into `.env`
7. Set `APPLE_PRIVATE_KEY_PATH` to the path of your downloaded `.p8` file
8. ⚠️ Apple requires HTTPS for production. For local dev, use ngrok or similar.

## Session & Token Management

### How sessions work
- Sessions are stored in memory (for POC — use Redis/MongoDB in production)
- Default expiry: **24 hours**
- With "Remember me" checked: **30 days**
- Session cookie is `httpOnly` and `secure` in production

### Refresh tokens
- **Google**: refresh token available (requested via `access_type=offline`) — stored in session
- **Apple**: refresh token available — stored in session  
- **GitHub**: no refresh tokens — GitHub uses long-lived access tokens

### Logout
The `/logout` route:
1. Revokes the access token with the provider (Google + GitHub)
2. Destroys the server-side session
3. Redirects to the login page

### Re-authentication
If a protected route is accessed with an expired/invalid session, the user is redirected to `/?reason=session_expired` which shows a friendly message on the login page.

## Production Checklist
- [ ] Replace in-memory sessions with Redis or MongoDB
- [ ] Set `SESSION_SECRET` to a cryptographically random value
- [ ] Set `cookie.secure = true` (requires HTTPS)
- [ ] Set `BASE_URL` to your production domain
- [ ] Apple **requires** HTTPS — use a real domain or ngrok
- [ ] Add rate limiting to auth routes
- [ ] Log auth events (login, logout, failures)

## File Structure

```
poc-04-auth/
├── server.js          ← Express app, Passport config, all routes
├── public/
│   └── index.html     ← Login page with all 3 provider buttons
├── .env.example       ← Template — copy to .env and fill in credentials
├── package.json
└── README.md
```
