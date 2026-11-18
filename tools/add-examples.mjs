// Adds clearly-marked EXAMPLE reports (is_example = 1) with real, licensed photos from Wikimedia Commons.
// Usage: DB_PATH=... node tools/add-examples.mjs tools/example-picks.json
// Re-running first removes previous examples. Admins can remove all examples from /admin.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.join(DIR, '..');
const { db } = await import('../db.js');
const { wardsGeojson, lookupWard, lookupSeat } = await import('../wards.js');
const UPLOADS = process.env.UPLOADS_DIR || path.join(ROOT, 'uploads');
const picks = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cands = JSON.parse(fs.readFileSync(path.join(DIR, 'sources', 'commons-candidates.json'), 'utf8'));
const afters = JSON.parse(fs.readFileSync(path.join(DIR, 'sources', 'commons-after.json'), 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Seeded random so re-runs place reports in the same spots.
let seed = 20261118; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = a => a[Math.floor(rnd() * a.length)];

// Hotspots (ward numbers, repeated = more reports there) give the heat map its shape.
const WARD_PLAN = ['25', '25', '25', '25', '27', '27', '27', '31', '31', '29', '28', '30', '15', '15', '16', '16', '21', '21', '21', '9', '9', '10', '3', '35',
  '2', '2', '18', '18', '12', '12', '13', '24', '22', '23', '14', '26', '32', '33', '34', '36', '1', '4', '5', '6', '7', '8', '11', '17', '19', '20'];
const PHRASES = ['Near the main road divider', 'Behind the market', 'Opposite the bus stop', 'Corner of the service lane', 'Next to the transformer', 'Outside the community centre',
  'Along the green belt', 'Near the school gate', 'At the vacant plot entrance', 'Beside the drain culvert', 'Near the auto stand', 'Under the flyover pillar', 'At the park boundary wall',
  'Near the temple turn', 'Opposite the petrol pump', 'Behind the sabzi mandi stalls', 'Near the metro pillar', 'At the colony gate'];
const TAGS = { // tag picked visually → problem, waste
  b: ['garbage_burning', 'mixed'], c: ['cnd_waste', 'construction'], p: ['empty_plot', 'mixed'], r: ['public_place', 'mixed'], h: ['door_to_door', 'household'],
  s: ['street_cleaning', 'household'], t: ['fallen_tree', 'garden'], e: ['public_place', 'ewaste'] };

function spotIn(wardNo) {
  const f = wardsGeojson.features.find(x => String(x.properties.ward_no) === wardNo);
  const pts = f.geometry.coordinates.flat(2);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  for (let k = 0; k < 500; k++) {
    const lng = Math.min(...xs) + rnd() * (Math.max(...xs) - Math.min(...xs)), lat = Math.min(...ys) + rnd() * (Math.max(...ys) - Math.min(...ys));
    if (lookupWard(lat, lng)?.ward_no === wardNo) return { lat, lng };
  }
  throw new Error(`no point found in ward ${wardNo}`);
}
async function download(url, prefix) {
  for (let a = 0; a < 4; a++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'CIVIQ-example-builder/1.0' } });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      const name = `${prefix}-${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}.jpg`;
      fs.writeFileSync(path.join(UPLOADS, name), buf);
      await sleep(1200); return { file: `/uploads/${name}`, hash: name };
    }
    await sleep(r.status === 429 ? 20000 : 4000);
  }
  throw new Error(`download failed ${url}`);
}

fs.mkdirSync(UPLOADS, { recursive: true });
const old = db.prepare('UPDATE reports SET removed = 1 WHERE is_example = 1 AND removed = 0').run().changes;
if (old) console.log(`removed ${old} previous examples`);
const ins = db.prepare(`INSERT INTO reports (id, lat, lng, severity, complaint_type, waste_type, landmark, locality, ward_no, zone, constituency, photo, status, created_at, resolved_at, resolved_photo,
  seen_count, device, resolution_days, verified_by, is_example, photo_credit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`);
const seenFiles = new Set();
const resolvedIdx = new Set(picks.solvedAt || [3, 8, 12, 17, 21, 26, 30, 35, 41, 46]);
let ai = 0;
for (let n = 0; n < picks.before.length; n++) {
  const { i, tag, sev } = picks.before[n];
  const c = cands[i];
  const img = await download(c.thumb, 'ex');
  if (seenFiles.has(img.hash)) throw new Error(`duplicate photo at pick ${n}`);
  seenFiles.add(img.hash);
  const wardNo = WARD_PLAN[n % WARD_PLAN.length], { lat, lng } = spotIn(wardNo), w = lookupWard(lat, lng), seat = lookupSeat(lat, lng);
  const f = wardsGeojson.features.find(x => String(x.properties.ward_no) === wardNo);
  const locality = pick(f.properties.localities.split(',').map(s => s.trim()));
  const [problem, waste] = TAGS[tag] || TAGS.r;
  const severity = sev || pick(['minor', 'moderate', 'moderate', 'severe', 'severe', 'critical']);
  const created = Date.now() - Math.round((1 + rnd() * 70) * 864e5) - Math.round(rnd() * 864e5);
  const credit = { author: c.author, license: c.license, page: c.page, title: c.title };
  let status = 'open', resolvedAt = null, after = null, days = null;
  if (resolvedIdx.has(n) && picks.after[ai] != null) {
    const a = afters[picks.after[ai++]];
    after = await download(a.thumb, 'ex-after');
    if (seenFiles.has(after.hash)) throw new Error('duplicate after photo');
    seenFiles.add(after.hash);
    days = 1 + Math.floor(rnd() * 9); resolvedAt = Math.min(Date.now() - 3600_000, created + days * 864e5); status = 'resolved';
    credit.after = { author: a.author, license: a.license, page: a.page };
  }
  ins.run(crypto.randomUUID(), lat, lng, severity, problem, waste, `${pick(PHRASES)}, ${locality}`, locality, w.ward_no, w.zone, seat, img.file, status, created, resolvedAt,
    after?.file ?? null, Math.floor(rnd() ** 2 * 14), 'example-seed', days, after ? 'citizen' : null, JSON.stringify(credit));
  console.log(`${n + 1}/${picks.before.length} ward ${wardNo} ${problem} ${severity} ${status}`);
}
console.log(`added ${picks.before.length} example reports (${ai} cleaned), ${seenFiles.size} unique photos`);
