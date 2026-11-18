// Step 1c: retry localities that are still missing or matched to a single building, with plain-name
// searches inside the MCG box, slower, and logging HTTP errors (earlier misses may have been rate limits).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const src = JSON.parse(fs.readFileSync(path.join(DIR, 'wards-2025-localities.json'), 'utf8'));
const cacheFile = path.join(DIR, 'geocode-cache.json');
const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
const BAD_TYPES = new Set(['school', 'place_of_worship', 'yes', 'park', 'pond', 'mall', 'shop', 'restaurant', 'bus_stop', 'company', 'office', 'commercial', 'retail']);
const bad = g => !g || /manesar/i.test(g.osm) || BAD_TYPES.has(g.type);
const GOOD = new Set(['village', 'hamlet', 'suburb', 'neighbourhood', 'quarter', 'residential', 'locality', 'administrative', 'isolated_dwelling', 'industrial', 'city_block', 'allotments']);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function search(q) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&bounded=1&viewbox=76.88,28.58,77.18,28.33&q=${encodeURIComponent(q)}`,
      { headers: { 'User-Agent': 'ApnaKachra-ward-builder/1.0' } });
    await sleep(1600);
    if (r.status === 429 || r.status >= 500) { console.log(`  HTTP ${r.status}, waiting`); await sleep(10000); continue; }
    if (!r.ok) return [];
    return r.json();
  }
  return [];
}

let fixed = 0;
for (const names of Object.values(src.wards)) for (const name of names) {
  if (!bad(cache[name])) continue;
  const plain = name.replace(/\s+Phase\s+\d+$/i, '');
  let hit = null;
  for (const q of [name, plain !== name ? plain : null, `${plain} village`].filter(Boolean)) {
    const hits = (await search(q)).filter(h => GOOD.has(h.type) && !/manesar/i.test(h.display_name));
    if (hits.length) { hit = hits[0]; break; }
  }
  if (hit) { cache[name] = { lat: +hit.lat, lng: +hit.lon, osm: hit.display_name.split(',').slice(0, 3).join(','), type: hit.type, via: 'retry' }; fixed++; }
  console.log(`${name} -> ${hit ? `${cache[name].osm} [${hit.type}]` : 'still not found'}`);
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
}
const all = Object.values(src.wards).flat();
console.log(`fixed ${fixed}; now ${all.filter(x => !bad(cache[x])).length}/${all.length} usable`);
