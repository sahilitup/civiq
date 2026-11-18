// Step 1b: for localities Nominatim could not find, fetch every named place / neighbourhood /
// residential area inside the MCG box from OpenStreetMap (one Overpass query) and match names loosely.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const src = JSON.parse(fs.readFileSync(path.join(DIR, 'wards-2025-localities.json'), 'utf8'));
const cacheFile = path.join(DIR, 'geocode-cache.json');
const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
const placesFile = path.join(DIR, 'sources', 'osm-places.json');

if (!fs.existsSync(placesFile)) {
  const q = `[out:json][timeout:120];(
    nwr["place"]["name"](28.36,76.90,28.56,77.16);
    nwr["landuse"="residential"]["name"](28.36,76.90,28.56,77.16);
    nwr["landuse"="industrial"]["name"](28.36,76.90,28.56,77.16);
  );out center tags;`;
  const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q),
    headers: { 'User-Agent': 'ApnaKachra-ward-builder/1.0', 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!r.ok) throw new Error(`Overpass ${r.status}`);
  const j = await r.json();
  const places = j.elements.map(e => ({ names: [e.tags.name, e.tags['name:en'], e.tags.alt_name, e.tags.old_name].filter(Boolean),
    lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon, kind: e.tags.place || e.tags.landuse })).filter(p => p.lat);
  fs.writeFileSync(placesFile, JSON.stringify(places));
}
const places = JSON.parse(fs.readFileSync(placesFile, 'utf8'));

// Loose name key: lowercase, drop filler words, collapse spelling variants common in Gurugram names.
const key = s => s.toLowerCase()
  .replace(/\b(village|vill|gaon|colony|enclave|nagar|phase|ph|sector|sec|area|road|industrial|block|gurgaon|gurugram)\b/g, ' ')
  .replace(/[^a-z0-9]/g, '').replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/aa/g, 'a').replace(/w/g, 'v').replace(/h/g, '').replace(/(.)\1/g, '$1');

const BAD_TYPES = new Set(['school', 'place_of_worship', 'yes', 'park', 'pond', 'mall', 'shop', 'restaurant', 'bus_stop', 'company', 'office', 'commercial', 'retail']);
const bad = g => !g || /manesar/i.test(g.osm) || BAD_TYPES.has(g.type);
let fixed = 0;
for (const names of Object.values(src.wards)) for (const name of names) {
  if (!bad(cache[name])) continue;
  const k = key(name); if (k.length < 3) continue;
  // Keep the descriptive word (colony/nagar/enclave) when it exists in both, to avoid "Krishna Nagar" → "Krishna Colony".
  const word = (name.match(/\b(colony|enclave|nagar|vihar|puri|park|garden|industrial)\b/i) || [])[1]?.toLowerCase();
  const hits = places.filter(p => p.names.some(n => key(n) === k && (!word || n.toLowerCase().includes(word) || !/(colony|enclave|nagar|vihar|puri|park|garden)/i.test(n))));
  if (hits.length) {
    const h = hits[0];
    cache[name] = { lat: h.lat, lng: h.lng, osm: `${h.names[0]} (OSM ${h.kind})`, type: h.kind, via: 'overpass' };
    fixed++; console.log(`${name} -> ${h.names[0]} [${h.kind}]${hits.length > 1 ? ` (+${hits.length - 1} more)` : ''}`);
  } else console.log(`${name} -> still not found`);
}
fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
const all = Object.values(src.wards).flat();
console.log(`filled ${fixed}; now ${all.filter(x => !bad(cache[x])).length}/${all.length} usable`);
