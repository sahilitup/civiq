// CIVIQ — report garbage in Gurugram and track it until it is cleared.
// Zero-dependency Node server (Node >= 22.13 for node:sqlite).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, rowToReport } from './db.js';
import { lookupWard, lookupSeat, wardsGeojson, assemblyGeojson } from './wards.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = process.env.UPLOADS_DIR || path.join(ROOT, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
const PORT = Number(process.env.PORT || 5173);
const VERSION = '2.0.0';
const officials = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'officials.json'), 'utf8'));
const wardPeople = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ward-people.json'), 'utf8'));
const changelog = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'changelog.json'), 'utf8'));

// Secrets: environment first, otherwise data/secrets.local.json (created on first run, never committed).
const secretsFile = path.join(ROOT, 'data', 'secrets.local.json');
const secrets = fs.existsSync(secretsFile) ? JSON.parse(fs.readFileSync(secretsFile, 'utf8')) : {};
if (!secrets.adminPasscode || !secrets.dataPasscode || !secrets.tokenSecret) {
  secrets.adminPasscode ||= crypto.randomBytes(5).toString('hex');
  secrets.dataPasscode ||= crypto.randomBytes(5).toString('hex');
  secrets.tokenSecret ||= crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretsFile, JSON.stringify(secrets, null, 2));
  console.log(`Created ${secretsFile} with new passcodes for /admin and /downloads.`);
}
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || secrets.adminPasscode;
const DATA_PASSCODE = process.env.DATA_PASSCODE || secrets.dataPasscode;
const TOKEN_SECRET = process.env.TOKEN_SECRET || secrets.tokenSecret;

// Rules
const BBOX = { minLat: 28.30, maxLat: 28.56, minLng: 76.85, maxLng: 77.20 };
const VERIFY_RADIUS_M = 100;        // must be this close to verify a cleanup / dispute
const VERIFY_SOFT_RADIUS_M = 250;   // allowed with a "compare photos" note for reviewers
const DUPLICATE_RADIUS_M = 50;
const DAILY_LIMIT = 5;
const WARD_THRESHOLD = 10;          // open reports in a ward before the "threshold crossed" escalation shows

const SEVERITIES = ['minor', 'moderate', 'severe', 'critical'];
const WASTE_TYPES = ['household', 'construction', 'mixed', 'ewaste', 'biomedical', 'garden', 'firecracker'];
const PROBLEMS = ['fallen_tree', 'garbage_burning', 'door_to_door', 'public_place', 'empty_plot', 'cnd_waste', 'street_cleaning'];
const DISPUTE_REASONS = ['pothole', 'drainage', 'construction', 'streetlight', 'vehicle', 'other'];
const LINK_PLATFORMS = ['whatsapp', 'instagram', 'facebook', 'x', 'website', 'linkedin', 'youtube', 'telegram'];

// Migrate labels saved by the first version to keys.
{
  const wasteMap = { 'Mixed waste': 'mixed', 'Household': 'household', 'Construction debris': 'construction', 'E-waste': 'ewaste', 'Biomedical': 'biomedical', 'Tree and garden': 'garden' };
  const probMap = { 'Public place': 'public_place', 'Empty plot': 'empty_plot', 'Street cleaning': 'street_cleaning', 'Door to door collection': 'door_to_door',
    'Construction and demolition': 'cnd_waste', 'Fallen tree': 'fallen_tree', 'Garbage burning': 'garbage_burning' };
  for (const [a, b] of Object.entries(wasteMap)) db.prepare('UPDATE reports SET waste_type = ? WHERE waste_type = ?').run(b, a);
  for (const [a, b] of Object.entries(probMap)) db.prepare('UPDATE reports SET complaint_type = ? WHERE complaint_type = ?').run(b, a);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_res_report ON resolutions(report_id, status); CREATE INDEX IF NOT EXISTS idx_dis_report ON disputes(report_id, status);`);
}
// Fill in ward / zone / seat for reports filed before the boundary files existed (or after they change).
{
  const rows = db.prepare('SELECT id, lat, lng, ward_no, zone, constituency FROM reports').all();
  const upd = db.prepare('UPDATE reports SET ward_no = ?, zone = ?, constituency = ? WHERE id = ?');
  let n = 0;
  for (const r of rows) {
    const w = lookupWard(r.lat, r.lng), seat = lookupSeat(r.lat, r.lng);
    const next = [w?.ward_no ?? null, w?.zone ?? null, seat];
    if (next[0] !== r.ward_no || next[1] !== r.zone || next[2] !== r.constituency) { upd.run(...next, r.id); n++; }
  }
  if (n) console.log(`Updated ward / seat on ${n} existing reports`);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.geojson': 'application/geo+json', '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg' };

// ---------- helpers ----------
const send = (res, status, body, headers = {}) => {
  const isStr = typeof body === 'string' || Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json', ...headers });
  res.end(isStr ? body : JSON.stringify(body));
};
const readJson = (req, limit = 8_000_000) => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Payload too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(new Error('Invalid JSON')); } });
  req.on('error', reject);
});
const haversine = (a, b, c, d) => {
  const R = 6371000, toR = x => x * Math.PI / 180;
  const dLat = toR(c - a), dLng = toR(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a)) * Math.cos(toR(c)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const inBbox = (lat, lng) => lat >= BBOX.minLat && lat <= BBOX.maxLat && lng >= BBOX.minLng && lng <= BBOX.maxLng;
const validDevice = d => typeof d === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(d);
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const err = (status, message) => [status, { error: message }];

function savePhoto(dataUrl, minBytes = 2000) {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('A photo is required');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < minBytes) throw new Error('Photo looks empty');
  const name = `${crypto.randomUUID()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(UPLOADS, name), buf);
  return `/uploads/${name}`;
}

const hits = new Map();
function rateLimited(ip, key, max, windowMs) {
  const k = `${key}:${ip}`, now = Date.now();
  const arr = (hits.get(k) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(k, arr);
  return arr.length > max;
}

const geoCache = new Map();
async function reverseGeocode(lat, lng) {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (geoCache.has(key)) return geoCache.get(key);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${lat}&lon=${lng}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'CIVIQ/2.0 (civic garbage map)' }, signal: AbortSignal.timeout(4000) });
    const a = (await r.json()).address || {};
    const locality = a.suburb || a.neighbourhood || a.quarter || a.residential || a.village || a.city_district || a.road || 'Gurugram';
    geoCache.set(key, locality);
    return locality;
  } catch { return 'Gurugram'; }
}

// Signed tokens for reviewers and data access: base64url(json).hmac
const sign = obj => { const p = Buffer.from(JSON.stringify(obj)).toString('base64url'); return `${p}.${crypto.createHmac('sha256', TOKEN_SECRET).update(p).digest('base64url')}`; };
function verifyToken(tok, kind) {
  const [p, s] = String(tok || '').split('.');
  if (!p || !s) return null;
  const good = crypto.createHmac('sha256', TOKEN_SECRET).update(p).digest('base64url');
  if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null;
  const o = JSON.parse(Buffer.from(p, 'base64url').toString());
  return o.kind === kind && o.exp > Date.now() ? o : null;
}
const bearer = req => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
const samePass = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

const visibleRows = () => db.prepare('SELECT * FROM reports WHERE removed = 0 ORDER BY created_at DESC').all();
const getRow = id => db.prepare('SELECT * FROM reports WHERE id = ? AND removed = 0').get(id);

// ---------- API ----------
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern}$`), fn });

route('GET', '/api/config', () => ({
  version: VERSION, officials, wardPeople, bbox: BBOX, hasWards: !!wardsGeojson,
  severities: SEVERITIES, wasteTypes: WASTE_TYPES, problems: PROBLEMS, disputeReasons: DISPUTE_REASONS, linkPlatforms: LINK_PLATFORMS,
  verifyRadius: VERIFY_RADIUS_M, verifySoftRadius: VERIFY_SOFT_RADIUS_M, dailyLimit: DAILY_LIMIT, wardThreshold: WARD_THRESHOLD,
  subscribers: db.prepare('SELECT COUNT(*) n FROM subscribers WHERE unsubscribed_at IS NULL').get().n,
}));
route('GET', '/api/changelog', () => changelog);

route('GET', '/api/reports', () => visibleRows().map(rowToReport));
route('GET', '/api/reports/([a-f0-9-]{36})', (req, url, [id]) => { const r = getRow(id); return r ? rowToReport(r) : err(404, 'This report couldn’t be found.'); });

route('POST', '/api/reports', async (req, url, _, ip) => {
  if (rateLimited(ip, 'report', 30, 3600_000)) return err(429, 'A lot of reports are coming in right now. Try again in a few minutes.');
  const b = await readJson(req);
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return err(400, 'Location is needed to report');
  if (!inBbox(lat, lng)) return err(400, 'You’re outside Gurugram');
  if (!SEVERITIES.includes(b.severity)) return err(400, 'Pick how bad it is');
  if (!WASTE_TYPES.includes(b.wasteType)) return err(400, 'Please pick the type of waste so the right team can be notified.');
  if (!PROBLEMS.includes(b.complaintType)) return err(400, 'Please pick the type of complaint so it gets routed to the right team.');
  if (!validDevice(b.device)) return err(400, 'Missing device id');
  const landmark = clean(b.landmark, 140);
  const today = db.prepare('SELECT COUNT(*) n FROM reports WHERE device = ? AND created_at > ?').get(b.device, Date.now() - 86400_000).n;
  if (today >= DAILY_LIMIT) return err(429, `Daily limit of ${DAILY_LIMIT} reports reached. Try again tomorrow.`);

  // Duplicate within 50 m of an open report → count as "seen" instead.
  const near = db.prepare(`SELECT * FROM reports WHERE status='open' AND removed = 0`).all()
    .find(r => haversine(lat, lng, r.lat, r.lng) < DUPLICATE_RADIUS_M);
  if (near) {
    if (near.device !== b.device) {
      db.prepare('INSERT OR IGNORE INTO seen (report_id, device) VALUES (?, ?)').run(near.id, b.device);
      db.prepare('UPDATE reports SET seen_count = (SELECT COUNT(*) FROM seen WHERE report_id = ?) WHERE id = ?').run(near.id, near.id);
    }
    return [200, { duplicate: true, report: rowToReport(getRow(near.id)) }];
  }
  const photo = savePhoto(b.photo);
  const ward = lookupWard(lat, lng), seat = lookupSeat(lat, lng);
  const locality = await reverseGeocode(lat, lng);
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO reports (id, lat, lng, severity, complaint_type, waste_type, landmark, locality, ward_no, zone, constituency,
      photo, status, created_at, device) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'open', ?, ?)`)
    .run(id, lat, lng, b.severity, b.complaintType, b.wasteType, landmark, locality, ward?.ward_no ?? null, ward?.zone ?? null, seat, photo, Date.now(), b.device);
  return [201, rowToReport(getRow(id))];
});

route('POST', '/api/reports/([a-f0-9-]{36})/seen', async (req, url, [id]) => {
  const b = await readJson(req);
  if (!validDevice(b.device)) return err(400, 'Missing device id');
  const row = getRow(id);
  if (!row) return err(404, 'This report couldn’t be found.');
  if (row.device === b.device) return err(400, 'You reported this one');
  db.prepare('INSERT OR IGNORE INTO seen (report_id, device) VALUES (?, ?)').run(id, b.device);
  db.prepare('UPDATE reports SET seen_count = (SELECT COUNT(*) FROM seen WHERE report_id = ?) WHERE id = ?').run(id, id);
  return rowToReport(getRow(id));
});

function checkSpot(row, b) {
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: 'We need your location to check you’re at the spot.' };
  const d = haversine(lat, lng, row.lat, row.lng);
  if (d > VERIFY_SOFT_RADIUS_M) return { error: `You’re ${Math.round(d)} m from the spot. Walk to within ${VERIFY_RADIUS_M} m of it to take the photo.` };
  return { lat, lng, d };
}

route('POST', '/api/reports/([a-f0-9-]{36})/resolve', async (req, url, [id], ip) => {
  if (rateLimited(ip, 'verify', 30, 3600_000)) return err(429, 'Too many attempts. Try again later.');
  const b = await readJson(req);
  const row = getRow(id);
  if (!row) return err(404, 'This report couldn’t be found.');
  if (row.status === 'resolved') return err(400, 'This report is already marked as cleaned.');
  if (db.prepare(`SELECT 1 FROM resolutions WHERE report_id=? AND status='pending'`).get(id)) return err(400, 'A cleanup photo for this report is already under review.');
  const spot = checkSpot(row, b); if (spot.error) return err(400, spot.error);
  const photo = savePhoto(b.photo);
  db.prepare(`INSERT INTO resolutions (id, report_id, photo, lat, lng, distance_m, device, created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(crypto.randomUUID(), id, photo, spot.lat, spot.lng, Math.round(spot.d), validDevice(b.device) ? b.device : null, Date.now());
  return rowToReport(getRow(id));
});

route('POST', '/api/reports/([a-f0-9-]{36})/dispute', async (req, url, [id], ip) => {
  if (rateLimited(ip, 'dispute', 30, 3600_000)) return err(429, 'Too many attempts. Try again later.');
  const b = await readJson(req);
  const row = getRow(id);
  if (!row) return err(404, 'This report couldn’t be found.');
  if (row.status === 'resolved') return err(400, 'This report is already marked as cleaned, so it can’t be flagged.');
  if (db.prepare(`SELECT 1 FROM resolutions WHERE report_id=? AND status='pending'`).get(id)) return err(400, 'A cleanup photo for this report is under review. Wait for that decision first.');
  if (db.prepare(`SELECT 1 FROM disputes WHERE report_id=? AND status='pending'`).get(id)) return err(400, 'This report is already under review.');
  if (!DISPUTE_REASONS.includes(b.reason)) return err(400, 'Choose what it is instead');
  const spot = checkSpot(row, b); if (spot.error) return err(400, spot.error);
  const photo = savePhoto(b.photo);
  db.prepare(`INSERT INTO disputes (id, report_id, photo, reason, note, lat, lng, distance_m, device, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(crypto.randomUUID(), id, photo, b.reason, clean(b.note, 200), spot.lat, spot.lng, Math.round(spot.d), validDevice(b.device) ? b.device : null, Date.now());
  return rowToReport(getRow(id));
});

route('GET', '/api/wards', () => wardsGeojson || { type: 'FeatureCollection', features: [] });
route('GET', '/api/assembly', () => assemblyGeojson || { type: 'FeatureCollection', features: [] });

route('GET', '/api/locate', (req, url) => {
  const lat = Number(url.searchParams.get('lat')), lng = Number(url.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return err(400, 'lat and lng required');
  const ward = lookupWard(lat, lng), seat = lookupSeat(lat, lng), z = ward && wardPeople.zones[ward.zone];
  return {
    inGurugram: inBbox(lat, lng), ward: ward?.ward_no || null, zone: ward?.zone || null, seat,
    councillor: ward ? wardPeople.councillors[ward.ward_no] || null : null,
    sanitaryInspector: z?.ssi || null, jointCommissioner: z?.jc || null,
    mla: seat ? { ...officials.mlas[seat], seat } : null,
  };
});

// ----- communities -----
const commOut = (c, priv = false) => ({ id: c.id, name: c.name, focus: c.focus, about: c.about, allCity: !!c.all_city,
  wards: JSON.parse(c.wards), links: JSON.parse(c.links), logo: c.logo, createdAt: c.created_at,
  ...(priv ? { contactName: c.contact_name, contactPhone: c.contact_phone, status: c.status } : {}) });
route('GET', '/api/communities', () => db.prepare(`SELECT * FROM communities WHERE status='approved' ORDER BY created_at`).all().map(c => commOut(c)));
route('POST', '/api/communities', async (req, url, _, ip) => {
  if (rateLimited(ip, 'community', 5, 3600_000)) return err(429, 'Too many submissions. Try again later.');
  const b = await readJson(req);
  const name = clean(b.name, 80), focus = clean(b.focus, 120), about = clean(b.about, 600);
  if (!name || !focus) return err(400, 'Please add a community name and what you do.');
  const links = {};
  for (const [k, v] of Object.entries(b.links || {})) if (LINK_PLATFORMS.includes(k) && clean(v, 300)) links[k] = clean(v, 300);
  if (!Object.keys(links).length) return err(400, 'Add at least one link so people can find you.');
  const wards = (Array.isArray(b.wards) ? b.wards : []).map(String).filter(w => wardPeople.councillors[w]).slice(0, 36);
  if (!b.allCity && !wards.length) return err(400, 'Pick at least one ward, or mark that you work across Gurugram.');
  const contactName = clean(b.contactName, 80), contactPhone = clean(b.contactPhone, 20);
  if (!contactName || !/^[+\d\s-]{8,}$/.test(contactPhone)) return err(400, 'Please add your name and phone so we can verify your listing.');
  let logo;
  try { logo = savePhoto(b.logo, 200); } catch { return err(400, 'Please add a logo for your community.'); }
  db.prepare(`INSERT INTO communities (id, name, focus, about, all_city, wards, links, logo, contact_name, contact_phone, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(crypto.randomUUID(), name, focus, about, b.allCity ? 1 : 0, JSON.stringify(wards), JSON.stringify(links), logo, contactName, contactPhone, Date.now());
  return [201, { ok: true }];
});

// ----- weekly digest -----
route('POST', '/api/subscribe', async (req, url, _, ip) => {
  if (rateLimited(ip, 'sub', 10, 3600_000)) return err(429, 'Something went wrong. Try again?');
  const b = await readJson(req);
  const email = clean(b.email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return err(400, 'That doesn’t look like a valid email');
  const row = db.prepare('SELECT * FROM subscribers WHERE email = ?').get(email);
  if (row && !row.unsubscribed_at) return { status: 'already' };
  if (row) { db.prepare('UPDATE subscribers SET unsubscribed_at = NULL, name = ? WHERE email = ?').run(clean(b.name, 80), email); return { status: 'resubscribed' }; }
  db.prepare('INSERT INTO subscribers (email, name, created_at) VALUES (?,?,?)').run(email, clean(b.name, 80), Date.now());
  return { status: 'new' };
});

// ----- reviewer console -----
route('POST', '/api/admin/login', async (req, url, _, ip) => {
  if (rateLimited(ip, 'login', 10, 900_000)) return err(429, 'Too many attempts. Try again in 15 minutes.');
  const b = await readJson(req);
  if (!samePass(b.passcode, ADMIN_PASSCODE)) return err(401, 'Incorrect passcode.');
  const name = clean(b.name, 80);
  if (name.split(/\s+/).length < 2) return err(400, 'Please enter your full name.');
  const role = ['supervisor', 'admin'].includes(b.role) ? b.role : 'supervisor';
  const zone = Object.keys(wardPeople.zones).includes(b.zone) ? b.zone : null;
  return { token: sign({ kind: 'admin', name, role, zone, exp: Date.now() + 12 * 3600_000 }), name, role, zone };
});
route('GET', '/api/admin/queue', req => {
  const who = verifyToken(bearer(req), 'admin'); if (!who) return err(401, 'Sign in again.');
  const zoneOk = r => who.role === 'admin' || !who.zone || r.zone === who.zone;
  const withReport = (x) => { const r = getRow(x.report_id); return r && zoneOk(r) ? { ...x, report: rowToReport(r) } : null; };
  return {
    resolutions: db.prepare(`SELECT * FROM resolutions WHERE status='pending' ORDER BY created_at`).all().map(withReport).filter(Boolean),
    disputes: db.prepare(`SELECT * FROM disputes WHERE status='pending' ORDER BY created_at`).all().map(withReport).filter(Boolean),
    communities: who.role === 'admin' ? db.prepare(`SELECT * FROM communities WHERE status='pending' ORDER BY created_at`).all().map(c => commOut(c, true)) : [],
    subscribers: who.role === 'admin' ? db.prepare('SELECT COUNT(*) n FROM subscribers WHERE unsubscribed_at IS NULL').get().n : null,
  };
});
route('POST', '/api/admin/review', async req => {
  const who = verifyToken(bearer(req), 'admin'); if (!who) return err(401, 'Sign in again.');
  const b = await readJson(req), now = Date.now(), by = `${who.name} (${who.role})`;
  if (b.kind === 'resolution') {
    const x = db.prepare(`SELECT * FROM resolutions WHERE id=? AND status='pending'`).get(b.id); if (!x) return err(404, 'Already reviewed');
    if (b.decision === 'approve') {
      const r = getRow(x.report_id);
      db.prepare(`UPDATE reports SET status='resolved', resolved_at=?, resolved_photo=?, resolution_days=?, verified_by='citizen' WHERE id=?`)
        .run(x.created_at, x.photo, Math.round((x.created_at - r.created_at) / 864e5), x.report_id);
    }
    db.prepare('UPDATE resolutions SET status=?, reviewed_at=?, reviewer=? WHERE id=?').run(b.decision === 'approve' ? 'approved' : 'rejected', now, by, b.id);
  } else if (b.kind === 'dispute') {
    const x = db.prepare(`SELECT * FROM disputes WHERE id=? AND status='pending'`).get(b.id); if (!x) return err(404, 'Already reviewed');
    if (b.decision === 'remove') db.prepare('UPDATE reports SET removed=1 WHERE id=?').run(x.report_id);
    db.prepare('UPDATE disputes SET status=?, reviewed_at=?, reviewer=? WHERE id=?').run(b.decision === 'remove' ? 'upheld' : 'rejected', now, by, b.id);
  } else if (b.kind === 'community') {
    if (who.role !== 'admin') return err(403, 'Only admins review communities');
    db.prepare(`UPDATE communities SET status=?, reviewed_at=?, reviewer=? WHERE id=? AND status='pending'`).run(b.decision === 'approve' ? 'approved' : 'rejected', now, by, b.id);
  } else return err(400, 'Unknown review');
  return { ok: true };
});
// Remove every example report in one go (admins only).
route('POST', '/api/admin/remove-examples', req => {
  const who = verifyToken(bearer(req), 'admin'); if (!who || who.role !== 'admin') return err(403, 'Only admins can do this');
  const n = db.prepare('UPDATE reports SET removed = 1 WHERE is_example = 1 AND removed = 0').run().changes;
  return { removed: n };
});

// ----- data downloads (passcode) -----
route('POST', '/api/data/unlock', async (req, url, _, ip) => {
  if (rateLimited(ip, 'unlock', 10, 900_000)) return err(429, 'Too many attempts. Try again in 15 minutes.');
  const b = await readJson(req);
  if (!samePass(b.passcode, DATA_PASSCODE)) return err(401, 'Incorrect passcode.');
  return { token: sign({ kind: 'data', exp: Date.now() + 3600_000 }) };
});
const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
route('GET', '/api/export.csv', (req, url, _, ip, res) => {
  if (!verifyToken(url.searchParams.get('token'), 'data')) return err(401, 'Data access is restricted.');
  const rows = visibleRows().map(rowToReport).reverse();
  const cols = ['id', 'createdAt', 'status', 'resolvedAt', 'severity', 'complaintType', 'wasteType', 'lat', 'lng', 'locality', 'wardNo', 'zone', 'constituency', 'landmark', 'seenCount', 'isExample'];
  const body = [cols.join(','), ...rows.map(r => cols.map(c => csvCell(c.endsWith('At') && r[c] ? new Date(r[c]).toISOString() : r[c])).join(','))].join('\n');
  send(res, 200, body, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="civiq-gurugram-reports.csv"' });
});
route('GET', '/api/export.geojson', (req, url, _, ip, res) => {
  if (!verifyToken(url.searchParams.get('token'), 'data')) return err(401, 'Data access is restricted.');
  const fc = { type: 'FeatureCollection', features: visibleRows().map(rowToReport).map(({ lat, lng, ...p }) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: p })) };
  send(res, 200, JSON.stringify(fc), { 'Content-Type': 'application/geo+json', 'Content-Disposition': 'attachment; filename="civiq-gurugram-reports.geojson"' });
});

// ----- status -----
route('GET', '/api/status', () => {
  const t0 = performance.now();
  const last = db.prepare('SELECT MAX(created_at) t FROM reports').get().t;
  const dbMs = Math.round(performance.now() - t0);
  let photos = true; try { fs.accessSync(UPLOADS, fs.constants.W_OK); } catch { photos = false; }
  return { ok: true, version: VERSION, checkedAt: Date.now(), dbMs, photos, lastReport: last, wards: wardsGeojson?.features.length || 0,
    pendingReviews: db.prepare(`SELECT (SELECT COUNT(*) FROM resolutions WHERE status='pending') + (SELECT COUNT(*) FROM disputes WHERE status='pending') n`).get().n };
});

// ----- analytics -----
route('GET', '/api/stats', () => {
  const rows = visibleRows();
  const total = rows.length, resolved = rows.filter(r => r.status === 'resolved'), open = rows.filter(r => r.status === 'open');
  const day = 864e5, now = Date.now();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const series = [];
  for (let i = 89; i >= 0; i--) {
    const start = today.getTime() - i * day, end = start + day;
    series.push({ date: start, filed: rows.filter(r => r.created_at >= start && r.created_at < end).length,
      resolved: resolved.filter(r => r.resolved_at >= start && r.resolved_at < end).length });
  }
  const durations = resolved.map(r => r.resolved_at - r.created_at);
  const buckets = [
    { label: 'Within 24h', n: durations.filter(d => d <= day).length },
    { label: '1–3 days', n: durations.filter(d => d > day && d <= 3 * day).length },
    { label: '3–7 days', n: durations.filter(d => d > 3 * day && d <= 7 * day).length },
    { label: 'Over 7 days', n: durations.filter(d => d > 7 * day).length },
  ];
  const countBy = key => Object.entries(rows.reduce((m, r) => (m[r[key] || 'unknown'] = (m[r[key] || 'unknown'] || 0) + 1, m), {}))
    .map(([k, n]) => ({ k, n, open: open.filter(r => (r[key] || 'unknown') === k).length })).sort((a, b) => b.open - a.open || b.n - a.n);
  const areas = {};
  for (const r of rows) {
    const k = r.ward_no || 'outside';
    const a = areas[k] ||= { wardNo: r.ward_no, area: r.ward_no ? `Ward ${r.ward_no}` : 'Outside MCG wards', councillor: wardPeople.councillors[r.ward_no]?.name || null,
      zone: r.zone, constituency: r.constituency, total: 0, open: 0, resolved: 0, durations: [], open7: 0, open14: 0 };
    a.total++;
    if (r.status === 'open') { a.open++; if (now - r.created_at > 7 * day) a.open7++; if (now - r.created_at > 14 * day) a.open14++; }
    else { a.resolved++; a.durations.push(r.resolved_at - r.created_at); }
  }
  const median = arr => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const areaList = Object.values(areas).map(a => ({ ...a, medianMs: median(a.durations), durations: undefined }));
  let streak = 0, best = 0, run = 0;
  for (const s of series) { run = s.resolved ? run + 1 : 0; best = Math.max(best, run); }
  for (let i = series.length - 1; i >= 0 && series[i].resolved > 0; i--) streak++;
  // Repeat hot spots: open reports with other reports within 50 m.
  const hotspots = [];
  const used = new Set();
  for (const r of rows) {
    if (used.has(r.id)) continue;
    const near = rows.filter(x => x.id !== r.id && haversine(r.lat, r.lng, x.lat, x.lng) < DUPLICATE_RADIUS_M);
    if (near.length) { near.forEach(x => used.add(x.id)); used.add(r.id);
      const first = Math.min(r.created_at, ...near.map(x => x.created_at));
      hotspots.push({ id: r.id, landmark: r.landmark, wardNo: r.ward_no, count: near.length + 1, firstDays: Math.floor((now - first) / day), photo: r.photo }); }
  }
  hotspots.sort((a, b) => b.count - a.count);
  const weekAgo = now - 7 * day;
  const fastestFix = resolved.filter(r => r.resolved_at > weekAgo).sort((a, b) => (a.resolved_at - a.created_at) - (b.resolved_at - b.created_at))[0];
  return {
    total, open: open.length, resolved: resolved.length, resolutionRate: total ? resolved.length / total : 0,
    firstReport: rows.length ? Math.min(...rows.map(r => r.created_at)) : null, areasCount: Object.keys(areas).length,
    series, buckets, streak, bestStreak: best,
    byComplaint: countBy('complaint_type'), byWaste: countBy('waste_type'), bySeverity: countBy('severity'), byZone: countBy('zone'), byConstituency: countBy('constituency'),
    mostOpen: [...areaList].sort((a, b) => b.open - a.open).slice(0, 10),
    mostResolved: areaList.filter(a => a.resolved).sort((a, b) => b.resolved - a.resolved).slice(0, 10),
    fastest: areaList.filter(a => a.resolved >= 3).sort((a, b) => a.medianMs - b.medianMs).slice(0, 10),
    stale: areaList.filter(a => a.open14).sort((a, b) => b.open14 - a.open14).slice(0, 10),
    mostReported: [...areaList].sort((a, b) => b.total - a.total).slice(0, 10),
    hotspots: hotspots.slice(0, 8),
    fastestFix: fastestFix ? { ...rowToReport(fastestFix), hours: Math.round((fastestFix.resolved_at - fastestFix.created_at) / 3600_000) } : null,
  };
});

// ---------- pages ----------
const SPA_ROUTES = /^\/(report\/[a-f0-9-]{36}|ward\/[\w-]+|mla\/[\w%-]+|mp\/[\w%-]+|zone\/[\w%-]+|wards|communities(\/register)?|leaderboard)?\/?$/;
const PAGES = { '/analytics': 'analytics.html', '/downloads': 'downloads.html', '/admin': 'admin.html', '/status': 'status.html',
  '/about': 'about.html', '/contact': 'contact.html', '/privacy': 'privacy.html', '/terms': 'terms.html', '/methodology': 'methodology.html' };
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Page titles / link previews for shareable links.
function metaFor(p) {
  let title = 'CIVIQ · Report garbage in Gurugram', desc = 'Photograph a garbage spot in Gurugram. It is pinned to your ward and the officials responsible, and stays on a public map until it is cleaned.';
  let m;
  if ((m = p.match(/^\/report\/([a-f0-9-]{36})/))) {
    const r = getRow(m[1]);
    if (r) { const d = Math.floor((Date.now() - r.created_at) / 864e5);
      title = `${r.status === 'open' ? `Open ${d} days` : 'Cleaned'}: garbage at ${r.landmark || r.locality}${r.ward_no ? `, Ward ${r.ward_no}` : ''} | CIVIQ`;
      desc = `Reported on CIVIQ${r.ward_no ? `. Ward ${r.ward_no} councillor: ${wardPeople.councillors[r.ward_no]?.name}` : ''}. Seen by ${r.seen_count + 1}.`; }
  } else if ((m = p.match(/^\/ward\/(\d+)/)) && wardPeople.councillors[m[1]]) {
    const n = db.prepare(`SELECT COUNT(*) n FROM reports WHERE ward_no=? AND status='open' AND removed=0`).get(m[1]).n;
    title = `Ward ${m[1]}, Gurugram: ${n} open garbage reports | CIVIQ`; desc = `Councillor ${wardPeople.councillors[m[1]].name}. See every report and who is responsible.`;
  } else if ((m = p.match(/^\/mla\/([\w%-]+)/))) { const seat = decodeURIComponent(m[1]); if (officials.mlas[seat]) title = `${officials.mlas[seat].name}, MLA ${seat} - garbage accountability | CIVIQ`; }
  else if (p.startsWith('/mp/')) title = `${officials.mp.name}, MP ${officials.mp.seat} - garbage accountability | CIVIQ`;
  else if (p.startsWith('/communities')) title = 'Volunteer communities cleaning up Gurugram | CIVIQ';
  else if (p.startsWith('/wards') || p.startsWith('/leaderboard')) title = 'All 36 wards of Gurugram - garbage reports by ward | CIVIQ';
  return { title, desc };
}

function serveStatic(req, res, pathname) {
  if (SPA_ROUTES.test(pathname)) {
    const { title, desc } = metaFor(pathname);
    const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
      .replace(/<title>[^<]*<\/title>/, `<title>${escHtml(title)}</title>`)
      .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escHtml(desc)}">
  <meta property="og:title" content="${escHtml(title)}"><meta property="og:description" content="${escHtml(desc)}"><meta property="og:type" content="website"><meta name="twitter:card" content="summary">`);
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' }); return res.end(html);
  }
  let file;
  if (pathname.startsWith('/uploads/')) file = path.join(UPLOADS, path.basename(pathname));
  else if (PAGES[pathname.replace(/\.html$/, '')]) file = path.join(PUBLIC, PAGES[pathname.replace(/\.html$/, '')]);
  else file = path.join(PUBLIC, path.normalize(pathname).replace(/^([/\\])+/, ''));
  if (!file.startsWith(PUBLIC) && !file.startsWith(UPLOADS)) return send(res, 403, 'Forbidden');
  // Video: stream with byte ranges so players can seek (Safari requires it).
  if (path.extname(file) === '.mp4') {
    return fs.stat(file, (e, st) => {
      if (e) return send(res, 404, 'Not found');
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      const head = { 'Content-Type': MIME['.mp4'], 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' };
      if (!m) { res.writeHead(200, { ...head, 'Content-Length': st.size }); return req.method === 'HEAD' ? res.end() : fs.createReadStream(file).pipe(res); }
      let start = m[1] ? +m[1] : Math.max(0, st.size - +m[2]), end = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
      if (start >= st.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      return req.method === 'HEAD' ? res.end() : fs.createReadStream(file, { start, end }).pipe(res);
    });
  }
  fs.readFile(file, (e, data) => {
    if (e) { // unknown page → app's not-found screen
      if (!path.extname(pathname)) { res.writeHead(404, { 'Content-Type': MIME['.html'] }); return res.end(fs.readFileSync(path.join(PUBLIC, 'index.html'))); }
      return send(res, 404, 'Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': pathname.startsWith('/uploads/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  if (url.pathname.startsWith('/api/')) {
    const r = routes.find(r => r.method === req.method && r.re.test(url.pathname));
    if (!r) return send(res, 404, { error: 'Not found' });
    try {
      const out = await r.fn(req, url, url.pathname.match(r.re).slice(1), ip, res);
      if (res.writableEnded || out === undefined) return;
      const isTuple = Array.isArray(out) && out.length === 2 && typeof out[0] === 'number';
      isTuple ? send(res, out[0], out[1]) : send(res, 200, out);
    } catch (e) { send(res, 400, { error: e.message }); }
    return;
  }
  serveStatic(req, res, decodeURIComponent(url.pathname));
}).listen(PORT, () => console.log(`CIVIQ running at http://localhost:${PORT}`));
