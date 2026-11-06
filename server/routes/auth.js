import crypto from 'node:crypto';
import express from 'express';
import {
  clearCookie,
  createSession,
  destroySession,
  hashPassword,
  parseCookies,
  passwordProblem,
  rateLimit,
  sessionCookie,
  SESSION_COOKIE,
  validateRegistration,
  verifyPassword,
} from '../auth.js';
import { getEntitlements, publicUser } from '../entitlements.js';
import { providerStatus, publicTools } from '../providers.js';

export function authRouter(db) {
  const router = express.Router();

  const cookieSecure = (req) =>
    req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');

  const sessionPayload = (user) => ({
    user: publicUser(user),
    entitlements: getEntitlements(db, user),
    tools: publicTools(),
    providers: providerStatus(),
  });

  router.post('/register', (req, res) => {
    const ip = req.ip || 'unknown';
    const limit = rateLimit({ key: `register:${ip}`, limit: 8, windowMs: 10 * 60 * 1000 });
    if (!limit.allowed) {
      return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', messageAr: 'محاولات كثيرة، حاول بعد قليل.' });
    }

    const { name, email, password } = req.body || {};
    const errors = validateRegistration({ name, email, password });
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', fields: errors, messageAr: 'تحقق من البيانات المدخلة.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: 'EMAIL_TAKEN', messageAr: 'هذا البريد الإلكتروني مستخدم بالفعل.' });
    }

    const now = new Date().toISOString();
    const colors = ['violet', 'cyan', 'amber', 'rose', 'emerald'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const info = db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role, status, avatar_color, created_at, last_login_at)
         VALUES (?, ?, ?, 'user', 'active', ?, ?, ?)`
      )
      .run(String(name).trim().slice(0, 60), normalizedEmail, hashPassword(password), color, now, now);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    const { token, expires } = createSession(db, user.id, req.headers['user-agent']);
    res.setHeader('Set-Cookie', sessionCookie(token, expires, cookieSecure(req)));
    return res.status(201).json(sessionPayload(user));
  });

  router.post('/login', (req, res) => {
    const { email, password } = req.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const ip = req.ip || 'unknown';
    const limit = rateLimit({ key: `login:${ip}:${normalizedEmail}`, limit: 10, windowMs: 10 * 60 * 1000 });
    if (!limit.allowed) {
      return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', messageAr: 'محاولات دخول كثيرة، حاول بعد قليل.' });
    }

    const user = normalizedEmail
      ? db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail)
      : null;

    if (!user || !verifyPassword(user.password_hash, password || '')) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', messageAr: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'ACCOUNT_SUSPENDED', messageAr: 'تم إيقاف هذا الحساب. تواصل مع الإدارة.' });
    }

    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), user.id);
    const { token, expires } = createSession(db, user.id, req.headers['user-agent']);
    res.setHeader('Set-Cookie', sessionCookie(token, expires, cookieSecure(req)));
    return res.json(sessionPayload(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)));
  });

  router.post('/logout', (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    destroySession(db, cookies[SESSION_COOKIE]);
    res.setHeader('Set-Cookie', clearCookie(cookieSecure(req)));
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    return res.json(sessionPayload(req.user));
  });

  router.patch('/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    const { name, avatarColor } = req.body || {};
    const nextName = name === undefined ? req.user.name : String(name).trim();
    if (nextName.length < 2 || nextName.length > 60) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', fields: { name: 'الاسم يجب أن يكون بين حرفين و٦٠ حرفًا' } });
    }
    const allowedColors = ['violet', 'cyan', 'amber', 'rose', 'emerald', 'gold'];
    const nextColor = allowedColors.includes(avatarColor) ? avatarColor : req.user.avatar_color;
    db.prepare('UPDATE users SET name = ?, avatar_color = ? WHERE id = ?').run(nextName, nextColor, req.user.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json(sessionPayload(user));
  });

  router.post('/me/password', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    const { currentPassword, newPassword } = req.body || {};
    if (!verifyPassword(req.user.password_hash, currentPassword || '')) {
      return res.status(400).json({ error: 'INVALID_PASSWORD', fields: { currentPassword: 'كلمة المرور الحالية غير صحيحة' } });
    }
    const problem = passwordProblem(newPassword);
    if (problem) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', fields: { newPassword: problem } });
    }
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(
      hashPassword(newPassword),
      req.user.id
    );
    // Invalidate every other session after a password change.
    const cookies = parseCookies(req.headers.cookie);
    const currentHash = crypto
      .createHash('sha256')
      .update(cookies[SESSION_COOKIE] || '')
      .digest('hex');
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, currentHash);
    res.json({ ok: true, messageAr: 'تم تحديث كلمة المرور بنجاح.' });
  });

  return router;
}
