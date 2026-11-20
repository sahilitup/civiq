// Packs the example reports (and only those) plus their photos into seed/,
// so a fresh server (e.g. Render's free plan, which has no disk) starts with them.
// Usage: node --no-warnings tools/make-seed.mjs
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..');
const SRC = process.env.DB_PATH || path.join(ROOT, 'data', 'kachra.db');
const OUT = path.join(ROOT, 'seed');
const DB = path.join(OUT, 'examples.db');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'uploads'), { recursive: true });

new DatabaseSync(SRC, { readOnly: true }).exec(`VACUUM INTO '${DB.replaceAll('\\', '/')}'`);
const d = new DatabaseSync(DB);
const keep = 'SELECT id FROM reports WHERE is_example = 1';
for (const t of ['seen', 'flags', 'resolutions', 'disputes']) {
  const cols = d.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  if (cols.includes('report_id')) d.exec(`DELETE FROM ${t} WHERE report_id NOT IN (${keep})`);
}
d.exec(`DELETE FROM reports WHERE is_example != 1; DELETE FROM communities; DELETE FROM subscribers;`);
const photos = d.prepare('SELECT photo, resolved_photo FROM reports').all().flatMap(r => [r.photo, r.resolved_photo]).filter(Boolean);
d.exec('VACUUM'); d.close();

const UP = process.env.UPLOADS_DIR || path.join(ROOT, 'uploads');
for (const p of photos) fs.copyFileSync(path.join(UP, path.basename(p)), path.join(OUT, 'uploads', path.basename(p)));
console.log(`seed: ${photos.length} photos, db ${(fs.statSync(DB).size / 1024).toFixed(0)} KB`);
