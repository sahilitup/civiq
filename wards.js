// Ward and assembly-seat lookup.
//  data/wards.geojson    — 36 MCG wards (2025). Built by tools/build-wards.mjs; edges are approximate.
//  data/assembly.geojson — assembly constituencies (2008 delimitation, exact).
// Features need properties: wards → ward_no, name, zone; assembly → constituency.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const load = f => fs.existsSync(path.join(DATA, f)) ? JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')) : null;
export const wardsGeojson = load('wards.geojson');
export const assemblyGeojson = load('assembly.geojson');

function inRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolygon = (lng, lat, rings) => inRing(lng, lat, rings[0]) && !rings.slice(1).some(h => inRing(lng, lat, h));
function findFeature(fc, lat, lng) {
  if (!fc) return null;
  for (const f of fc.features) {
    const g = f.geometry; if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    if (polys.some(p => inPolygon(lng, lat, p))) return f.properties || {};
  }
  return null;
}

export function lookupWard(lat, lng) {
  const p = findFeature(wardsGeojson, lat, lng);
  return p ? { ward_no: String(p.ward_no), name: p.name || `Ward ${p.ward_no}`, zone: p.zone || null } : null;
}
export function lookupSeat(lat, lng) {
  return findFeature(assemblyGeojson, lat, lng)?.constituency || null;
}
