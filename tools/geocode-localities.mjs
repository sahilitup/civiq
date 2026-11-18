// Step 1 of building data/wards.geojson: look up every 2025 ward locality on OpenStreetMap (Nominatim).
// Respects Nominatim's 1 request/second policy and caches results in tools/geocode-cache.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const src = JSON.parse(fs.readFileSync(path.join(DIR, 'wards-2025-localities.json'), 'utf8'));
const cacheFile = path.join(DIR, 'geocode-cache.json');
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
const VIEWBOX = '76.90,28.56,77.16,28.36'; // left,top,right,bottom around MCG
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function lookup(name) {
  for (const q of [`${name}, Gurugram, Haryana`, `${name}, Gurgaon`]) {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&bounded=1&viewbox=${VIEWBOX}&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'ApnaKachra-ward-builder/1.0' } });
    await sleep(1100);
    if (!r.ok) continue;
    const hits = await r.json();
    if (hits.length) { const h = hits[0]; return { lat: +h.lat, lng: +h.lon, osm: h.display_name.split(',').slice(0, 3).join(','), type: h.type }; }
  }
  return null;
}

let n = 0;
for (const [ward, names] of Object.entries(src.wards)) {
  for (const name of names) {
    if (name in cache) continue;
    cache[name] = await lookup(name);
    n++;
    console.log(`ward ${ward}: ${name} -> ${cache[name] ? cache[name].osm : 'NOT FOUND'}`);
    if (n % 10 === 0) fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
  }
}
fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
const all = Object.values(src.wards).flat();
console.log(`done: ${all.filter(x => cache[x]).length}/${all.length} localities found`);
