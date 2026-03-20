# POC #1 — Interactive Fantasy Map

> **New World** campaign map built with MapLibre GL JS — demonstrating Google Earth-style zoom with progressive POI reveal.

## What This Demonstrates

| Feature | Description |
|---------|-------------|
| **Zoom-based POI reveal** | Major cities at zoom 4+, medium towns at zoom 7+, small POIs at zoom 10+ |
| **Custom fantasy markers** | 🏰 castles for major cities, 🗼 towers for towns, ⛺ camps for small locations |
| **Interactive popups** | Click any marker for lore, real-world name, and a "View Details" button |
| **Distance tool** | Click two points to see distance in miles + fantasy travel time (foot & horseback) |
| **DM coordinates** | Press `C` to toggle lat/lng display for placing new content |
| **Dark fantasy aesthetic** | Darkened base map, Cinzel/MedievalSharp fonts, game-style UI overlays |
| **Mobile responsive** | Touch-friendly on phones and tablets |

## Running It

### Option A — Just open the file
```bash
open poc-01-map/index.html
# or double-click the file in Finder / Explorer
```

### Option B — Local dev server
```bash
cd poc-01-map
npm start
# → http://localhost:3000
```

### Option C — Any static server
```bash
cd poc-01-map
python3 -m http.server 3000
# → http://localhost:3000
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `C` | Toggle coordinate display (DM tool) |
| `D` | Toggle distance measurement tool |

## Tech Stack

- **MapLibre GL JS** — open-source map rendering (via CDN)
- **OpenFreeMap** — free vector tiles, no API key needed
- **PMTiles** — protocol for efficient tile loading (loaded via CDN)
- **Vanilla HTML/CSS/JS** — zero build step, zero dependencies

## Fantasy City Data

The map uses real US coordinates mapped to fantasy names for the "New World" campaign:

- **New Haven** → Atlanta, GA (major)
- **Iron Gate** → New York, NY (major)
- **Windmere** → Chicago, IL (major)
- **Solara** → Los Angeles, CA (major)
- **Bayreach** → Houston, TX (major)
- **Silverbrook** → Alpharetta, GA (medium)
- **Cumming** → Cumming, GA (medium)
- **Brookhaven** → Brookhaven, GA (medium)
- **Buckhead** → Buckhead, GA (medium)
- **Helen's Hollow** → Helen, GA (small POI)

## What's Next (POC #2+)

- [ ] Custom map style (full dark fantasy tileset)
- [ ] Fog of war / unexplored regions
- [ ] Player tokens with real-time positions
- [ ] Quest markers and routes
- [ ] DM overlay controls
- [ ] Persistent data backend
