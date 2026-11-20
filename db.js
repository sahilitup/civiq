import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'kachra.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
// A brand-new install (or a host without a disk, like Render's free plan) starts with the example reports.
const SEED_DB = path.join(ROOT, 'seed', 'examples.db');
if (!fs.existsSync(DB_PATH) && fs.existsSync(SEED_DB)) fs.copyFileSync(SEED_DB, DB_PATH);
export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    lat REAL NOT NULL, lng REAL NOT NULL,
    severity TEXT NOT NULL, complaint_type TEXT, waste_type TEXT,
    landmark TEXT, locality TEXT, ward_no TEXT, zone TEXT, constituency TEXT,
    photo TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL, resolved_at INTEGER, resolved_photo TEXT,
    seen_count INTEGER NOT NULL DEFAULT 0, flag_count INTEGER NOT NULL DEFAULT 0,
    device TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
  CREATE TABLE IF NOT EXISTS seen (report_id TEXT, device TEXT, PRIMARY KEY (report_id, device));
  CREATE TABLE IF NOT EXISTS flags (report_id TEXT, device TEXT, PRIMARY KEY (report_id, device));

  -- cleanup photos waiting for review
  CREATE TABLE IF NOT EXISTS resolutions (
    id TEXT PRIMARY KEY, report_id TEXT NOT NULL, photo TEXT NOT NULL, lat REAL, lng REAL, distance_m REAL,
    device TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL,
    reviewed_at INTEGER, reviewer TEXT
  );
  -- "not garbage" disputes waiting for review
  CREATE TABLE IF NOT EXISTS disputes (
    id TEXT PRIMARY KEY, report_id TEXT NOT NULL, photo TEXT NOT NULL, reason TEXT NOT NULL, note TEXT,
    lat REAL, lng REAL, distance_m REAL, device TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL,
    reviewed_at INTEGER, reviewer TEXT
  );
  CREATE TABLE IF NOT EXISTS communities (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, focus TEXT NOT NULL, about TEXT, all_city INTEGER NOT NULL DEFAULT 0,
    wards TEXT NOT NULL DEFAULT '[]', links TEXT NOT NULL DEFAULT '{}', logo TEXT,
    contact_name TEXT, contact_phone TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL,
    reviewed_at INTEGER, reviewer TEXT
  );
  CREATE TABLE IF NOT EXISTS subscribers (
    email TEXT PRIMARY KEY, name TEXT, created_at INTEGER NOT NULL, unsubscribed_at INTEGER
  );
`);

// Columns added after the first release.
const cols = db.prepare('PRAGMA table_info(reports)').all().map(c => c.name);
if (!cols.includes('removed')) db.exec('ALTER TABLE reports ADD COLUMN removed INTEGER NOT NULL DEFAULT 0');
if (!cols.includes('resolution_days')) db.exec('ALTER TABLE reports ADD COLUMN resolution_days INTEGER');
if (!cols.includes('verified_by')) db.exec('ALTER TABLE reports ADD COLUMN verified_by TEXT');
if (!cols.includes('is_example')) db.exec('ALTER TABLE reports ADD COLUMN is_example INTEGER NOT NULL DEFAULT 0');
if (!cols.includes('photo_credit')) db.exec('ALTER TABLE reports ADD COLUMN photo_credit TEXT');

const pending = (table, id) => !!db.prepare(`SELECT 1 FROM ${table} WHERE report_id = ? AND status = 'pending' LIMIT 1`).get(id);

// Public shape of a report. The reporter's device id is never exposed.
export const rowToReport = r => ({
  id: r.id, lat: r.lat, lng: r.lng, severity: r.severity, complaintType: r.complaint_type, wasteType: r.waste_type,
  landmark: r.landmark, locality: r.locality, wardNo: r.ward_no, zone: r.zone, constituency: r.constituency,
  photo: r.photo, status: r.status, createdAt: r.created_at, resolvedAt: r.resolved_at, resolvedPhoto: r.resolved_photo,
  seenCount: r.seen_count, verifiedBy: r.verified_by || null,
  isExample: !!r.is_example, photoCredit: r.photo_credit ? JSON.parse(r.photo_credit) : null,
  resolutionPending: r.status === 'open' && pending('resolutions', r.id),
  disputePending: r.status === 'open' && pending('disputes', r.id),
});
