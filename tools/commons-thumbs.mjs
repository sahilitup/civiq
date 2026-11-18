// Download small previews (330px, a standard Wikimedia size) of every candidate, slowly, for visual picking.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const c = JSON.parse(fs.readFileSync(path.join(DIR, 'sources', 'commons-candidates.json'), 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ok = 0;
for (let i = 0; i < c.length; i++) {
  const f = path.join(OUT, `${i}.jpg`);
  if (fs.existsSync(f)) { ok++; continue; }
  const url = c[i].thumb.replace(/\/\d+px-/, '/330px-');
  for (let a = 0; a < 3; a++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'CIVIQ-example-builder/1.0' } });
    if (r.ok) { fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); ok++; break; }
    await sleep(r.status === 429 ? 20000 : 3000);
  }
  await sleep(700);
}
console.log(`downloaded ${ok}/${c.length}`);
