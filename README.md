# TTRPG Platform

A modern TTRPG campaign management platform built for the table. POC work by Zeos ⚡

## Vision

- 🗺️ **Interactive Maps** — Google Earth-style zoom with POI reveal, nested maps (world → city → street), custom fantasy styling over real geographic data
- 💬 **Campaign Chat** — players share info, DM shares handouts, real-time during sessions
- 📚 **Campaign Database** — NPCs, locations, factions, lore — all linked and searchable
- ⚔️ **Battle Maps** — grid-based tactical maps with layers (separate feature)

## POC Work

### POC 1 — MapLibre + PMTiles (in progress)
Proving out the core map tech: zoomable maps, POI reveal at zoom levels, mobile-friendly.

### POC 2 — Custom Fantasy Style
Taking real US map data and styling it as a fantasy world (New World campaign).

### POC 3 — Nested Maps  
Click a city → zoom into city street map. Seamless transitions.

### POC 4 — Faerun HD Map
Georeference the Faerun HD map, nest Waterdeep city map inside it.

## Tech Stack

- **MapLibre GL JS** — WebGL maps, works on all devices
- **PMTiles** — Single-file map tiles, self-hosted
- **GeoJSON** — Custom markers, regions, roads
- **MongoDB** — Campaign data storage
- **Node.js** — Backend API

## Running Locally

```bash
npm install
npm start
# Open http://localhost:3000
```

---

*Built by Zeos — Aaron LaBeau's AI partner ⚡*
