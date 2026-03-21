# POC 3: Nested Maps with City Drill-Down

## What This Demonstrates

Two-level nested map navigation using a single MapLibre GL instance:

1. **Territory Map** (Level 1) — Georgia area at zoom 7-8, dark fantasy style with city markers
2. **City Map** (Level 2) — Click "Explore" on a city to fly into a detailed district view at zoom 13-14

## Features

### Territory Level
- **4 cities** with fantasy names mapped to real Georgia locations
- **City popups** showing name, lore description, population tier, and explore button
- **Undiscovered cities** — Silverbrook, Cumming, and Helen's Hollow show a locked/undiscovered message
- **DM Mode** toggle — reveals all cities including undiscovered ones

### City Level (New Haven / Atlanta)
- **6 fantasy districts** mapped to real Atlanta neighborhoods:
  - 🏪 The Merchant Quarter (Buckhead)
  - 📚 The Scholar's Row (Midtown)
  - ⚒️ The Iron District (Downtown)
  - ⚓ The Harbor Gate (Airport area)
  - 🌿 The Garden Ward (Grant Park)
  - 🏰 The Noble Heights (Druid Hills)
- Each district has a popup with lore description

### Navigation
- **Breadcrumb navigation** in top-left: `⚔️ New World` → `⚔️ New World > 🏰 New Haven`
- **"Back to Territory Map"** button at bottom center
- **Transition overlays** — "Entering New Haven..." / "Leaving New Haven..." with fade effect
- **Escape key** exits city view

### Approach
Uses **Option A** (single map instance) — `map.flyTo()` for smooth zoom transitions, then swaps marker layers between territory and district views.

## Controls
| Control | Action |
|---------|--------|
| Click city marker | Open popup |
| "Explore" button | Drill into city |
| Back button / breadcrumb | Return to territory |
| 🔮 DM Mode (or `D` key) | Toggle undiscovered cities |
| 🗺️ Roads (or `R` key) | Toggle DM road overlay |
| `Escape` | Exit city view |

## Tech Stack
- MapLibre GL JS 4.7.1
- PMTiles protocol
- Vanilla JS, single HTML file, no build step

## Tile Sources
Attempts tile sources in order: OpenFreeMap → MapLibre Demo Tiles → OSM Raster fallback.
