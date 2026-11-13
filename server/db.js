import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { CLIENT_CONTENT_SCHEMA, seedClientContentIdeas } from './client-content/schema.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('owner', 'admin', 'user')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  avatar_color TEXT NOT NULL DEFAULT 'violet',
  custom_limits TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS plans (
  code TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL,
  tagline_ar TEXT NOT NULL DEFAULT '',
  price_sar INTEGER NOT NULL DEFAULT 0,
  price_lyd_minor INTEGER,
  price_usd_minor INTEGER,
  limit_text_video INTEGER NOT NULL DEFAULT 0,
  limit_image_video INTEGER NOT NULL DEFAULT 0,
  limit_voice INTEGER NOT NULL DEFAULT 0,
  limit_cartoon INTEGER NOT NULL DEFAULT 0,
  features TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES plans(code),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'canceled')),
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  payment_ref TEXT,
  currency TEXT CHECK (currency IS NULL OR currency IN ('LYD', 'USD')),
  amount_minor INTEGER CHECK (amount_minor IS NULL OR amount_minor >= 0),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id, status);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  prompt TEXT NOT NULL,
  negative_prompt TEXT,
  options TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending_provider',
  provider TEXT,
  provider_job_id TEXT,
  output_url TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_tool ON projects(tool, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  project_id INTEGER,
  kind TEXT NOT NULL DEFAULT 'generation',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_events(user_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_payment_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency TEXT NOT NULL CHECK (currency IN ('LYD', 'USD')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  payment_reference TEXT NOT NULL UNIQUE,
  customer_note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_payment_user ON wallet_payment_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_payment_status ON wallet_payment_requests(status, created_at);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('topup', 'usage', 'refund', 'adjustment')),
  credits_delta INTEGER NOT NULL CHECK (credits_delta != 0),
  payment_request_id INTEGER UNIQUE REFERENCES wallet_payment_requests(id),
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user ON wallet_ledger(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_reference_registry (
  payment_reference TEXT PRIMARY KEY COLLATE NOCASE,
  source_type TEXT NOT NULL CHECK (source_type IN ('wallet_topup', 'subscription', 'client_content_subscription')),
  source_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_reference_user ON payment_reference_registry(user_id, created_at DESC);
`;

export const DEFAULT_PLANS = [
  {
    code: 'free',
    name_ar: 'المجانية',
    tagline_ar: 'استكشاف المنصة',
    price_sar: 0,
    price_lyd_minor: 0,
    price_usd_minor: 0,
    limits: [0, 0, 0, 0],
    features: ['تصفح لوحة التحكم', 'حفظ المسودات', 'بدون توليد فيديو'],
    sort_order: 0,
  },
  {
    code: 'starter',
    name_ar: 'البداية',
    tagline_ar: 'للمبدعين الأفراد',
    price_sar: 0,
    price_lyd_minor: null,
    price_usd_minor: null,
    limits: [10, 5, 20, 5],
    features: ['١٠ فيديو نصي شهريًا', '٥ فيديوهات من صورة', '٢٠ تعليقًا صوتيًا', 'دقة 720p'],
    sort_order: 1,
  },
  {
    code: 'pro',
    name_ar: 'الاحترافية',
    tagline_ar: 'للصناع والمؤثرين',
    price_sar: 0,
    price_lyd_minor: null,
    price_usd_minor: null,
    limits: [40, 25, 80, 25],
    features: ['٤٠ فيديو نصي شهريًا', '٢٥ فيديو من صورة', '٨٠ تعليقًا صوتيًا', 'دقة 1080p', 'أولوية في المعالجة'],
    sort_order: 2,
  },
  {
    code: 'studio',
    name_ar: 'الاستوديو',
    tagline_ar: 'للفرق والوكالات',
    price_sar: 0,
    price_lyd_minor: null,
    price_usd_minor: null,
    limits: [150, 100, 300, 100],
    features: ['١٥٠ فيديو نصي شهريًا', '١٠٠ فيديو من صورة', '٣٠٠ تعليق صوتي', 'دقة 4K', 'دعم مخصص'],
    sort_order: 3,
  },
];

export function createDb(file) {
  const dir = path.dirname(file);
  if (file !== ':memory:') fs.mkdirSync(dir, { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrateWalletAndCurrencySchema(db);
  db.exec(CLIENT_CONTENT_SCHEMA);
  migratePaymentReferenceRegistry(db);
  seedPlans(db);
  seedClientContentIdeas(db);
  return db;
}

export function migrateWalletAndCurrencySchema(db) {
  const ensureColumn = (table, column, definition) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((item) => item.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };

  // Keep historical SAR values untouched; never infer LYD/USD prices from SAR.
  ensureColumn('plans', 'price_lyd_minor', 'INTEGER');
  ensureColumn('plans', 'price_usd_minor', 'INTEGER');
  ensureColumn('subscriptions', 'currency', "TEXT CHECK (currency IS NULL OR currency IN ('LYD', 'USD'))");
  ensureColumn('subscriptions', 'amount_minor', 'INTEGER CHECK (amount_minor IS NULL OR amount_minor >= 0)');
}

export function migratePaymentReferenceRegistry(db) {
  const register = db.prepare(
    `INSERT OR IGNORE INTO payment_reference_registry (payment_reference, source_type, source_id, user_id, created_at)
     SELECT UPPER(TRIM(payment_ref)), 'subscription', id, user_id, created_at
     FROM subscriptions WHERE payment_ref IS NOT NULL AND TRIM(payment_ref) <> ''`
  );
  register.run();
  db.prepare(
    `INSERT OR IGNORE INTO payment_reference_registry (payment_reference, source_type, source_id, user_id, created_at)
     SELECT UPPER(TRIM(payment_reference)), 'wallet_topup', id, user_id, created_at
     FROM wallet_payment_requests WHERE payment_reference IS NOT NULL AND TRIM(payment_reference) <> ''`
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO payment_reference_registry (payment_reference, source_type, source_id, user_id, created_at)
     SELECT UPPER(TRIM(payment_ref)), 'client_content_subscription', id, user_id, created_at
     FROM client_content_subscriptions WHERE payment_ref IS NOT NULL AND TRIM(payment_ref) <> ''`
  ).run();
}

export function seedPlans(db) {
  const insert = db.prepare(`
    INSERT INTO plans (code, name_ar, tagline_ar, price_sar, price_lyd_minor, price_usd_minor, limit_text_video, limit_image_video, limit_voice, limit_cartoon, features, sort_order)
    VALUES (@code, @name_ar, @tagline_ar, @price_sar, @price_lyd_minor, @price_usd_minor, @ltv, @liv, @lv, @lc, @features, @sort_order)
    ON CONFLICT(code) DO NOTHING
  `);
  const tx = db.transaction(() => {
    for (const plan of DEFAULT_PLANS) {
      insert.run({
        code: plan.code,
        name_ar: plan.name_ar,
        tagline_ar: plan.tagline_ar,
        price_sar: plan.price_sar,
        price_lyd_minor: plan.price_lyd_minor,
        price_usd_minor: plan.price_usd_minor,
        ltv: plan.limits[0],
        liv: plan.limits[1],
        lv: plan.limits[2],
        lc: plan.limits[3],
        features: JSON.stringify(plan.features),
        sort_order: plan.sort_order,
      });
    }
  });
  tx();
}

export function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
