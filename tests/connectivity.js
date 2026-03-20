#!/usr/bin/env node
// ─────────────────────────────────────────────
//  TTRPG Platform — Connectivity Test Script
//  Usage: node tests/connectivity.js
// ─────────────────────────────────────────────

const endpoints = [
  {
    name: 'OpenFreeMap Tile Source',
    url: 'https://tiles.openfreemap.org/planet',
    critical: true,
    note: 'Vector tile source for POC 2 fantasy map',
  },
  {
    name: 'MapLibre Demo Tiles',
    url: 'https://demotiles.maplibre.org/tiles/tiles.json',
    critical: false,
    note: 'Fallback tile source if OpenFreeMap is down',
  },
  {
    name: 'MapLibre GL JS (CDN)',
    url: 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js',
    critical: true,
    note: 'Core map rendering library',
  },
  {
    name: 'PMTiles (CDN)',
    url: 'https://unpkg.com/pmtiles@3.2.0/dist/pmtiles.js',
    critical: true,
    note: 'PMTiles protocol for efficient tile loading',
  },
  {
    name: 'Google Fonts',
    url: 'https://fonts.googleapis.com/css2?family=Cinzel',
    critical: false,
    note: 'Fantasy typography (Cinzel, MedievalSharp)',
  },
  {
    name: 'MapLibre Glyphs (Font PBFs)',
    url: 'https://demotiles.maplibre.org/font/Open%20Sans%20Regular,Arial%20Unicode%20MS%20Regular/0-255.pbf',
    critical: false,
    note: 'Font glyphs for map labels in POC 2',
  },
  {
    name: 'OSM Raster Tiles (fallback)',
    url: 'https://tile.openstreetmap.org/0/0/0.png',
    critical: false,
    note: 'Raster tile fallback if vector tiles fail',
  },
];

async function checkEndpoint(endpoint) {
  const start = Date.now();
  try {
    const resp = await fetch(endpoint.url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000),
    });
    const elapsed = Date.now() - start;
    return {
      ...endpoint,
      ok: resp.ok,
      status: resp.status,
      elapsed,
    };
  } catch (e) {
    const elapsed = Date.now() - start;
    // Some servers don't support HEAD, try GET
    try {
      const resp = await fetch(endpoint.url, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      });
      const elapsed2 = Date.now() - start;
      return {
        ...endpoint,
        ok: resp.ok,
        status: resp.status,
        elapsed: elapsed2,
      };
    } catch (e2) {
      return {
        ...endpoint,
        ok: false,
        status: e2.message || 'Failed',
        elapsed: Date.now() - start,
      };
    }
  }
}

async function main() {
  console.log('');
  console.log('⚔️  TTRPG Platform — Connectivity Check');
  console.log('─'.repeat(50));
  console.log('');

  const results = await Promise.all(endpoints.map(checkEndpoint));

  let passed = 0;
  let failed = 0;

  for (const r of results) {
    const icon = r.ok ? '✅' : '❌';
    const statusText = r.ok ? `HTTP ${r.status}` : `FAILED (${r.status})`;
    const criticalTag = r.critical ? ' [CRITICAL]' : '';
    const timeText = `${r.elapsed}ms`;

    if (r.ok) passed++;
    else failed++;

    console.log(`  ${icon} ${r.name}`);
    console.log(`     ${statusText} — ${timeText}${criticalTag}`);
    if (!r.ok) {
      console.log(`     💡 ${r.note}`);
    }
    console.log('');
  }

  console.log('─'.repeat(50));

  const criticalFails = results.filter(r => !r.ok && r.critical);

  if (failed === 0) {
    console.log(`✅ All ${passed} endpoints reachable`);
  } else {
    console.log(`📊 ${passed}/${results.length} passing, ${failed} failed`);
    if (criticalFails.length > 0) {
      console.log('');
      console.log('⚠️  Critical failures:');
      criticalFails.forEach(r => {
        console.log(`   ❌ ${r.name} — ${r.note}`);
      });
      console.log('');
      console.log('   These failures will cause maps to not render.');
    }
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main();
