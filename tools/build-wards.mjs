// Step 2: build APPROXIMATE 2025 ward polygons and the assembly-seat layer.
//
// Why approximate: MCG has not published a map file for its 36 wards (2023 delimitation, used in the
// March 2025 election). It has published which localities each ward contains. So we:
//   1. take the MCG outer limit from the older official 35-ward map (OpenCity / livingatlas.esri.in, CC0),
//   2. place each 2025 locality at its OpenStreetMap location (geocode-localities.mjs),
//   3. give every spot inside MCG to the ward of its nearest locality (Voronoi cells), and merge per ward.
// Edges between wards are estimates; the locality lists themselves are official.
// Assembly seats come from the 2008 delimitation map (LGD, CC0) and are exact.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Delaunay } from 'd3-delaunay';
import pc from 'polygon-clipping';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, '..', 'data');
const read = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const src = read('wards-2025-localities.json');
const cache = read('geocode-cache.json');
const oldWards = read('sources/mcg-wards-35-old.geojson');
const acs = read('sources/assembly-gurgaon-pc.geojson');

const geomToMulti = g => g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
const round = mp => mp.map(p => p.map(r => r.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)])));

// 1. MCG outer limit = union of the 35 old wards, later extended around 2025 localities just outside it
//    (MCG has grown since that map: Sectors 102–115, Bhondsi, Kadarpur, Bhandwari…).
const oldLimit = pc.union(...oldWards.features.map(f => geomToMulti(f.geometry)));
let limit = oldLimit;
const circle = (x, y, km, n = 24) => [[[...Array(n + 1)].map((_, i) => { const a = (i % n) / n * 2 * Math.PI; return [x + Math.cos(a) * km / 98, y + Math.sin(a) * km / 111]; })]];
function distToLimitKm(x, y) {
  let best = Infinity;
  for (const poly of oldLimit) for (const ring of poly) for (let i = 1; i < ring.length; i++) {
    const [ax, ay] = ring[i - 1], [bx, by] = ring[i];
    const dx = (bx - ax) * 98, dy = (by - ay) * 111, px = (x - ax) * 98, py = (y - ay) * 111;
    const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(px - t * dx, py - t * dy));
  }
  return best;
}

function inRing(x, y, ring) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
const inMulti = (x, y, mp) => mp.some(p => inRing(x, y, p[0]) && !p.slice(1).some(h => inRing(x, y, h)));

// 2. Seed points, with cleaning:
//  - a name listed under two wards (e.g. Sheetla Colony) is ambiguous → skipped
//  - matches in Manesar (it has its own "Sector 1", "Sector 15") or on a single building (school, temple, mall) → rejected
//  - a point far from the rest of its ward (a same-named colony elsewhere) → rejected as an outlier
const BAD_TYPES = new Set(['school', 'place_of_worship', 'yes', 'park', 'pond', 'mall', 'shop', 'restaurant', 'bus_stop', 'company', 'office', 'commercial', 'retail']);
const overrides = fs.existsSync(path.join(DIR, 'geocode-overrides.json')) ? read('geocode-overrides.json') : {};
const count = {}; for (const names of Object.values(src.wards)) for (const n of names) count[n] = (count[n] || 0) + 1;
const report = {}; let candidates = [];
for (const [ward, names] of Object.entries(src.wards)) {
  report[ward] = { used: [], missing: [], outside: [], rejected: [] };
  for (const n of names) {
    const g = overrides[n]?.skip ? null : overrides[n] || cache[n];
    if (!g) { report[ward].missing.push(n + (overrides[n]?.skip ? ' (skipped: wrong match)' : '')); continue; }
    if (count[n] > 1) { report[ward].rejected.push(`${n} (listed in 2 wards)`); continue; }
    if (!overrides[n] && (/manesar/i.test(g.osm) || BAD_TYPES.has(g.type))) { report[ward].rejected.push(`${n} (matched "${g.osm}")`); continue; }
    let extends_ = false;
    if (!inMulti(g.lng, g.lat, oldLimit)) {
      if (distToLimitKm(g.lng, g.lat) > 4) { report[ward].outside.push(n); continue; }
      extends_ = true;
    }
    candidates.push({ x: g.lng, y: g.lat, ward, name: n, extends_ });
  }
}
const km = (a, b) => Math.hypot((a.x - b.x) * 98, (a.y - b.y) * 111);
const median = a => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };
for (const ward of Object.keys(src.wards)) {
  const pts = candidates.filter(c => c.ward === ward); if (pts.length < 3) continue;
  const centre = { x: median(pts.map(p => p.x)), y: median(pts.map(p => p.y)) };
  const typical = median(pts.map(p => km(p, centre)));
  for (const p of pts) if (km(p, centre) > Math.max(3.5, 3 * typical)) { p.drop = true; report[ward].rejected.push(`${p.name} (${km(p, centre).toFixed(1)} km from the rest of the ward)`); }
}
const seeds = [];
for (const c of candidates.filter(c => !c.drop)) {
  if (seeds.some(s => Math.abs(s.x - c.x) < 1e-5 && Math.abs(s.y - c.y) < 1e-5)) { report[c.ward].rejected.push(`${c.name} (same point as another locality)`); continue; }
  seeds.push(c); report[c.ward].used.push(c.name + (c.extends_ ? '*' : ''));
}
// Grow the city limit by 1.2 km around localities that lie outside the old map.
const growth = seeds.filter(s => s.extends_).map(s => circle(s.x, s.y, 1.2));
if (growth.length) limit = pc.union(oldLimit, ...growth);
const noSeed = Object.entries(report).filter(([, r]) => !r.used.length).map(([w]) => w);
if (noSeed.length) console.warn('WARNING: wards with no located locality (will be missing from the map):', noSeed.join(', '));

// 3a. Reuse official old-ward shapes. If ≥75% of an old ward's localities (and at least 2) belong to one
//     new ward, that whole old polygon goes to the new ward. This covers the old city, where OpenStreetMap
//     has few named colonies.
const oldList = read('wards-old-localities.json').wards;
const newWardsOf = name => Object.entries(src.wards).filter(([, ns]) => ns.includes(name)).map(([w]) => w);
const fixed = {}; const anchorNotes = [];
for (const f of oldWards.features) {
  const no = String(f.properties.sourcewardcode), names = oldList[no] || [];
  const tally = {}; let mapped = 0;
  for (const n of names) { const ws = newWardsOf(n); if (ws.length === 1) { tally[ws[0]] = (tally[ws[0]] || 0) + 1; mapped++; } }
  const [best, hits] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0] || [];
  if (best && hits >= 2 && hits / mapped >= 0.75) {
    (fixed[best] ||= []).push(geomToMulti(f.geometry));
    anchorNotes.push(`old ward ${no} → new ward ${best} (${hits}/${mapped} localities)`);
  }
}
const fixedAll = Object.values(fixed).length ? pc.union(...Object.values(fixed).flat()) : [];
const free = fixedAll.length ? pc.difference(limit, fixedAll) : limit;

// 3b. Everywhere else: Voronoi cells of located localities → clip to the free area → merge per ward.
const [minX, minY, maxX, maxY] = [76.85, 28.30, 77.20, 28.60];
const freeSeeds = seeds.filter(s => !(fixedAll.length && inMulti(s.x, s.y, fixedAll)));
const vor = Delaunay.from(freeSeeds, s => s.x, s => s.y).voronoi([minX, minY, maxX, maxY]);
const pieces = {};
freeSeeds.forEach((s, i) => { const cell = vor.cellPolygon(i); if (cell) (pieces[s.ward] ||= []).push([[cell]]); });

const zoneOf = {}; for (const [z, { wards }] of Object.entries(src.zones)) for (const w of wards) zoneOf[w] = z;
const features = [];
for (const ward of Object.keys(src.wards)) {
  const parts = [];
  if (pieces[ward]) parts.push(pc.intersection(pc.union(...pieces[ward]), free));
  if (fixed[ward]) parts.push(pc.union(...fixed[ward]));
  const merged = parts.length ? pc.union(...parts) : [];
  if (!merged.length) { console.warn(`WARNING: ward ${ward} has no area`); continue; }
  features.push({ type: 'Feature', properties: { ward_no: ward, name: `Ward ${ward}`, zone: zoneOf[ward] || null,
    localities: src.wards[ward].join(', '), approximate: true }, geometry: { type: 'MultiPolygon', coordinates: round(merged) } });
}
fs.writeFileSync(path.join(OUT, 'wards.geojson'), JSON.stringify({ type: 'FeatureCollection',
  _about: 'Approximate 2025 MCG wards built from official locality lists + OpenStreetMap; outer limit from OpenCity (CC0). See tools/build-wards.mjs.',
  features }));

// 4. Assembly seats (exact): keep the 4 seats that touch MCG, clipped lightly to a box around the city.
const box = [[[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]]];
const seatName = n => n.replace(/\s*\(SC\)\s*/i, '').trim();
const acFeatures = acs.features.filter(f => ['Gurgaon', 'Badshahpur', 'Sohna', 'Pataudi'].includes(seatName(f.properties.ac_name)))
  .map(f => ({ type: 'Feature', properties: { constituency: seatName(f.properties.ac_name), ac_no: f.properties.ac_no },
    geometry: { type: 'MultiPolygon', coordinates: round(pc.intersection(geomToMulti(f.geometry), box)) } }))
  .filter(f => f.geometry.coordinates.length);
fs.writeFileSync(path.join(OUT, 'assembly.geojson'), JSON.stringify({ type: 'FeatureCollection',
  _about: 'Haryana assembly constituencies, 2008 delimitation (LGD via bharatlas.com, CC0).', features: acFeatures }));

const lines = Object.entries(report).map(([w, r]) => `Ward ${w}: ${r.used.length} placed (${r.used.join(', ')})${r.missing.length ? ` | not found: ${r.missing.join('; ')}` : ''}${r.outside.length ? ` | outside MCG: ${r.outside.join('; ')}` : ''}${r.rejected.length ? ` | rejected: ${r.rejected.join('; ')}` : ''}`);
fs.writeFileSync(path.join(DIR, 'build-report.txt'), [...anchorNotes, '', ...lines].join('\n') + '\n');
console.log([...anchorNotes, '', ...lines].join('\n'));
console.log(`\nwrote ${features.length} wards and ${acFeatures.length} assembly seats`);
