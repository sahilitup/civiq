// DEMO DATA ONLY — fills a separate database (data/demo.db) with made-up reports so you can see
// every screen working locally. Never point production at demo.db.
//   npm run seed  →  then:  DB_PATH=data/demo.db npm start
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
process.env.DB_PATH = path.join(ROOT, 'data', 'demo.db');
const { db } = await import('./db.js');
const { wardsGeojson, lookupWard, lookupSeat } = await import('./wards.js');
fs.mkdirSync(path.join(ROOT, 'uploads'), { recursive: true });

const landmarks = ['Near main market gate', 'Opposite the bus stop', 'Behind community centre', 'Corner of the green belt', 'Next to transformer', 'Outside temple', 'Empty plot by the school'];
const SEV = ['minor', 'moderate', 'severe', 'critical'], PROB = ['public_place', 'empty_plot', 'street_cleaning', 'door_to_door', 'cnd_waste', 'garbage_burning', 'fallen_tree'];
const WASTE = ['mixed', 'household', 'construction', 'ewaste', 'garden', 'biomedical', 'firecracker'];
const pick = a => a[Math.floor(Math.random() * a.length)];
const photo = (label, color) => {
  const name = `demo-${crypto.randomUUID()}.svg`;
  fs.writeFileSync(path.join(ROOT, 'uploads', name), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="${color}"/><text x="200" y="210" font-size="28" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text></svg>`);
  return `/uploads/${name}`;
};
if (!wardsGeojson) throw new Error('Build data/wards.geojson first (tools/build-wards.mjs)');
function randomSpot() {
  for (;;) {
    const lat = 28.38 + Math.random() * 0.16, lng = 76.92 + Math.random() * 0.2;
    const w = lookupWard(lat, lng);
    if (w) return { lat, lng, w, seat: lookupSeat(lat, lng) };
  }
}
db.exec('DELETE FROM reports; DELETE FROM seen; DELETE FROM flags; DELETE FROM resolutions; DELETE FROM disputes; DELETE FROM communities;');
const ins = db.prepare(`INSERT INTO reports (id, lat, lng, severity, complaint_type, waste_type, landmark, locality, ward_no, zone, constituency, photo, status, created_at, resolved_at, resolved_photo, seen_count, device, resolution_days, verified_by)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const ids = [];
for (let i = 0; i < 180; i++) {
  const s = randomSpot(), prob = pick(PROB);
  const created = Date.now() - Math.random() * 80 * 864e5;
  const resolved = Math.random() < 0.18 ? Math.min(Date.now(), created + Math.random() * 12 * 864e5) : null;
  const id = crypto.randomUUID(); ids.push({ id, ...s, resolved });
  ins.run(id, s.lat, s.lng, pick(SEV), prob, prob === 'fallen_tree' ? 'garden' : pick(WASTE), pick(landmarks), 'Demo locality', s.w.ward_no, s.w.zone, s.seat,
    photo('DEMO photo', '#8a6d3b'), resolved ? 'resolved' : 'open', Math.round(created), resolved && Math.round(resolved), resolved ? photo('DEMO cleared', '#2f9e44') : null,
    Math.floor(Math.random() ** 3 * 12), 'demo-seed-device', resolved ? Math.round((resolved - created) / 864e5) : null, resolved ? 'citizen' : null);
}
// One pending cleanup review, one pending dispute and one pending community, to test the review console.
const open = ids.filter(x => !x.resolved);
db.prepare(`INSERT INTO resolutions (id, report_id, photo, lat, lng, distance_m, created_at) VALUES (?,?,?,?,?,?,?)`).run(crypto.randomUUID(), open[0].id, photo('DEMO after', '#2f9e44'), open[0].lat, open[0].lng, 12, Date.now());
db.prepare(`INSERT INTO disputes (id, report_id, photo, reason, lat, lng, distance_m, created_at) VALUES (?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), open[1].id, photo('DEMO pothole', '#555'), 'pothole', open[1].lat, open[1].lng, 40, Date.now());
db.prepare(`INSERT INTO communities (id, name, focus, about, all_city, wards, links, logo, contact_name, contact_phone, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(crypto.randomUUID(), 'Demo Green Warriors', 'Weekend plogging drives', 'A demo community listing.', 0, JSON.stringify(['12', '25']), JSON.stringify({ instagram: 'instagram.com/example' }), photo('DEMO', '#0e3b2e'), 'Demo Person', '9999999999', 'approved', Date.now());
console.log('Seeded 180 demo reports, 1 pending cleanup, 1 pending dispute and 1 community into data/demo.db');
