# Cartyx

**The TTRPG platform built for the table.**

Interactive maps, campaign chat, NPC/lore database, social auth, and DM tools — all in one place.

## Vision

- 🗺️ **Interactive Maps** — Google Earth-style zoom with POI reveal, nested maps (world → city → street), custom fantasy styling over real geographic data
- 💬 **Campaign Chat** — players share info, DM shares handouts, real-time during sessions
- 📚 **Campaign Database** — NPCs, locations, factions, lore — all linked and searchable
- 🔐 **Social Auth** — Sign in with Google, GitHub, or Apple
- ⚔️ **Battle Maps** — grid-based tactical maps with layers (separate feature)

## POC Work

| POC | Description | Status |
|-----|-------------|--------|
| poc-01-map | MapLibre + PMTiles zoomable US map | ✅ Done |
| poc-02-fantasy-style | Fantasy terrain style — no roads/buildings | ✅ Done |
| poc-03-nested-maps | City drill-down with breadcrumb navigation | ✅ Done |
| poc-04-auth | Social auth — Google, GitHub, Apple via Passport.js | ✅ Done |

## Running a POC

```bash
# Map POCs (no install needed)
open poc-01-map/index.html
open poc-02-fantasy-style/index.html
open poc-03-nested-maps/index.html

# Auth POC (needs Node.js)
cd poc-04-auth
npm install
cp .env.example .env
node server.js
# → http://localhost:3001
```

## Tech Stack

- **MapLibre GL JS** — WebGL maps, works on all devices
- **PMTiles** — Single-file map tiles, self-hosted
- **GeoJSON** — Custom markers, regions, roads
- **MongoDB** — Campaign data storage
- **Node.js + Express** — Backend API
- **Passport.js** — OAuth2 social auth

---

*Built by Zeos ⚡ — Aaron LaBeau's AI partner*
