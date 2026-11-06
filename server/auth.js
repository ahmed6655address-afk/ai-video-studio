import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';

const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEYLEN = 64;
export const SESSION_COOKIE = 'avs_session';
export const SESSION_TTL_DAYS = 30;

/* ---------------------------------- passwords --------------------------------- */

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(stored, password) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltHex, hashHex] = parts;
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ---------------------------------- sessions ---------------------------------- */

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function createSession(db, userId, userAgent = '') {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)'
  ).run(sha256(token), userId, now.toISOString(), expires.toISOString(), String(userAgent).slice(0, 200));
  return { token, expires };
}

export function destroySession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function userFromToken(db, token) {
  if (!token || typeof token !== 'string') return null;
  const row = db
    .prepare(
      `SELECT u.*, s.expires_at FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(sha256(token));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    return null;
  }
  if (row.status !== 'active') return null;
  return row;
}

export function parseCookies(header = '') {
  const out = {};
  for (const chunk of String(header).split(';')) {
    const idx = chunk.indexOf('=');
    if (idx < 0) continue;
    const key = chunk.slice(0, idx).trim();
    const value = chunk.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(value);
  }
  return out;
}

export function sessionCookie(token, expires, secure) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expires.toUTCString()}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(secure) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/* ----------------------------------- owner ------------------------------------ */

export function ownerEmailFromEnv() {
  return (process.env.OWNER_EMAIL || 'owner@aivideo.studio').trim().toLowerCase();
}

/**
 * Provisions the single secure owner account from environment variables.
 * The owner is the only account that always has unlimited, free access.
 */
export function ensureOwner(db, { log = () => {} } = {}) {
  const email = ownerEmailFromEnv();
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (existing) {
    if (existing.role !== 'owner') {
      db.prepare("UPDATE users SET role = 'owner', status = 'active' WHERE id = ?").run(existing.id);
      log(`[owner] elevated ${email} to owner`);
    }
    return { id: existing.id, email, created: false, password: null };
  }

  let password = process.env.OWNER_PASSWORD;
  let generated = false;
  if (!password || password.length < 10) {
    password = crypto.randomBytes(18).toString('base64url');
    generated = true;
  }

  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO users (name, email, password_hash, role, status, avatar_color, must_change_password, created_at)
       VALUES (?, ?, ?, 'owner', 'active', 'gold', ?, ?)`
    )
    .run('مالك الاستوديو', email, hashPassword(password), generated ? 1 : 0, now);

  log(`[owner] created owner account for ${email}`);
  if (generated) {
    log('[owner] OWNER_PASSWORD was not provided — a random password was generated.');
  }
  return { id: info.lastInsertRowid, email, created: true, password: generated ? password : null };
}

export function sessionSecretPresent() {
  return Boolean(process.env.SESSION_SECRET);
}

export function ensureSessionSecret(db) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  let secret = getSetting(db, 'session_secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    setSetting(db, 'session_secret', secret);
  }
  return secret;
}

/* --------------------------------- validation --------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

export function validateRegistration({ name, email, password }) {
  const errors = {};
  if (!name || String(name).trim().length < 2) errors.name = 'الاسم يجب أن يكون حرفين على الأقل';
  if (!email || !EMAIL_RE.test(String(email).trim())) errors.email = 'البريد الإلكتروني غير صحيح';
  if (!password || String(password).length < 8) errors.password = 'كلمة المرور يجب أن تكون ٨ أحرف على الأقل';
  else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    errors.password = 'كلمة المرور يجب أن تحتوي على حروف وأرقام';
  }
  return errors;
}

export function passwordProblem(password) {
  if (!password || String(password).length < 8) return 'كلمة المرور يجب أن تكون ٨ أحرف على الأقل';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'كلمة المرور يجب أن تحتوي على حروف وأرقام';
  return null;
}

/* -------------------------------- rate limiting -------------------------------- */

const buckets = new Map();

export function rateLimit({ key, limit = 12, windowMs = 10 * 60 * 1000 }) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, remaining: limit - bucket.count };
}

export function resetRateLimits() {
  buckets.clear();
}
