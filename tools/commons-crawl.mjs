// Collect candidate photos of garbage in India from Wikimedia Commons, with licence and author.
// Polite: one request every 3 s. Output: tools/sources/commons-candidates.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, 'sources', 'commons-candidates.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = { 'User-Agent': 'CIVIQ-example-builder/1.0 (civic garbage map; contact via project)' };
const OK_LICENSE = /^(cc0|cc by(-sa)? [234]\.0|cc by(-sa)? [234]\.0 in|public domain|pd)/i;
const strip = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const queue = [['Waste in India', 0], ['Litter in India', 0], ['Garbage dumps in India', 0], ['Burning waste in India', 0], ['Waste in India by state or territory', 0], ['Waste in Delhi', 0], ['Garbage', 2]];
const seen = new Set(), files = new Map();
async function get(url) {
  for (let a = 0; a < 4; a++) {
    await sleep(3000);
    const r = await fetch(url, { headers: UA });
    const t = await r.text();
    if (t.startsWith('{')) return JSON.parse(t);
    await sleep(15000);
  }
  return {};
}
while (queue.length && seen.size < 40) {
  const [cat, depth] = queue.shift();
  if (seen.has(cat)) continue; seen.add(cat);
  let cont = '';
  do {
    const j = await get(`https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=categorymembers&gcmtitle=${encodeURIComponent('Category:' + cat)}&gcmtype=file|subcat&gcmlimit=100&prop=imageinfo&iiprop=url|size|extmetadata|mime&iiurlwidth=1280${cont}`);
    for (const p of Object.values(j.query?.pages || {})) {
      if (p.ns === 14 && depth < 2 && /waste|garbage|litter|dump|rubbish|trash|landfill|burning/i.test(p.title) && !/beach|electronic|vehicle|warriors|landfill/i.test(p.title)) queue.push([p.title.replace('Category:', ''), depth + 1]);
      const ii = p.imageinfo?.[0]; if (p.ns !== 6 || !ii || !/jpeg/.test(ii.mime)) continue;
      const m = ii.extmetadata || {}, lic = strip(m.LicenseShortName?.value);
      if (!OK_LICENSE.test(lic) || ii.width < 900 || ii.width < ii.height) continue;
      files.set(p.title, { title: p.title, cat, thumb: ii.thumburl, page: ii.descriptionurl, width: ii.width, height: ii.height, license: lic,
        licenseUrl: m.LicenseUrl?.value || '', author: strip(m.Artist?.value).slice(0, 120), desc: strip(m.ImageDescription?.value).slice(0, 200) });
    }
    cont = j.continue?.gcmcontinue ? `&gcmcontinue=${encodeURIComponent(j.continue.gcmcontinue)}` : '';
  } while (cont);
  console.log(`${cat}: total candidates ${files.size}`);
  fs.writeFileSync(OUT, JSON.stringify([...files.values()], null, 1));
}
console.log(`done: ${files.size} candidates from ${seen.size} categories`);
