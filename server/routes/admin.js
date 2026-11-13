import express from 'express';
import { activeSubscription, getEntitlements, monthlyUsage, publicUser } from '../entitlements.js';
import { TOOL_IDS, providerStatus } from '../providers.js';
import { creditProviderWallet, providerWalletSummary, releaseGenerationFunds } from '../finance.js';

function serializePlan(row) {
  let features = [];
  try {
    features = JSON.parse(row.features || '[]');
  } catch {
    features = [];
  }
  return {
    code: row.code,
    nameAr: row.name_ar,
    taglineAr: row.tagline_ar,
    priceSar: row.price_sar,
    limits: {
      text_video: row.limit_text_video,
      image_video: row.limit_image_video,
      voice: row.limit_voice,
      cartoon: row.limit_cartoon,
    },
    features,
    sortOrder: row.sort_order,
    isActive: Boolean(row.is_active),
  };
}

function serializeSubscription(sub) {
  if (!sub) return null;
  return {
    id: sub.id,
    planCode: sub.plan_code,
    planNameAr: sub.name_ar,
    expiresAt: sub.expires_at,
    status: sub.status,
  };
}

export function publicPlansRouter(db) {
  const router = express.Router();
  router.get('/plans', (req, res) => {
    const rows = db.prepare('SELECT * FROM plans WHERE is_active = 1 ORDER BY sort_order ASC').all();
    res.json({ plans: rows.map(serializePlan) });
  });
  return router;
}

export function adminRouter(db) {
  const router = express.Router();

  router.get('/overview', (req, res) => {
    const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    const activeSubs = db
      .prepare("SELECT COUNT(*) AS c FROM subscriptions WHERE status = 'active' AND expires_at > ?")
      .get(new Date().toISOString()).c;
    const projects = db.prepare('SELECT COUNT(*) AS c FROM projects').get().c;
    const pending = db
      .prepare("SELECT COUNT(*) AS c FROM projects WHERE status = 'pending_provider'")
      .get().c;
    const generations = db.prepare("SELECT COUNT(*) AS c FROM usage_events WHERE kind = 'generation'").get().c;
    const byTool = db
      .prepare('SELECT tool, COUNT(*) AS c FROM projects GROUP BY tool')
      .all()
      .reduce((acc, row) => ({ ...acc, [row.tool]: row.c }), {});
    const mrr = db
      .prepare(
        `SELECT COALESCE(SUM(p.price_sar), 0) AS total FROM subscriptions s
         JOIN plans p ON p.code = s.plan_code
         WHERE s.status = 'active' AND s.expires_at > ?`
      )
      .get(new Date().toISOString()).total;

    const recentUsers = db
      .prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 5')
      .all()
      .map(publicUser);
    const recentProjects = db
      .prepare(
        `SELECT p.*, u.name AS user_name FROM projects p JOIN users u ON u.id = p.user_id
         ORDER BY p.created_at DESC LIMIT 8`
      )
      .all();

    res.json({
      stats: {
        users,
        activeSubscriptions: activeSubs,
        projects,
        pendingProviderRequests: pending,
        generations,
        monthlyRecurringSar: mrr,
        byTool,
      },
      recentUsers,
      recentProjects: recentProjects.map((p) => ({
        id: p.id,
        tool: p.tool,
        prompt: p.prompt,
        status: p.status,
        userName: p.user_name,
        createdAt: p.created_at,
      })),
      providers: providerStatus(),
    });
  });

  router.get('/users', (req, res) => {
    const q = String(req.query.q || '').trim();
    const rows = q
      ? db.prepare('SELECT * FROM users WHERE name LIKE ? OR email LIKE ? ORDER BY created_at DESC LIMIT 200').all(`%${q}%`, `%${q}%`)
      : db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 200').all();

    const users = rows.map((user) => {
      const sub = activeSubscription(db, user.id);
      return {
        ...publicUser(user),
        subscription: serializeSubscription(sub),
        usage: monthlyUsage(db, user.id),
        projects: db.prepare('SELECT COUNT(*) AS c FROM projects WHERE user_id = ?').get(user.id).c,
        entitlements: getEntitlements(db, user),
      };
    });

    res.json({ users, total: users.length });
  });

  router.patch('/users/:id', (req, res) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
    if (!target) return res.status(404).json({ error: 'NOT_FOUND' });
    if (target.role === 'owner') {
      return res.status(403).json({ error: 'OWNER_IMMUTABLE', messageAr: 'لا يمكن تعديل حساب المالك.' });
    }
    if (target.id === req.user.id) {
      return res.status(400).json({ error: 'SELF_EDIT', messageAr: 'لا يمكنك تعديل صلاحياتك بنفسك.' });
    }

    const { role, status, customLimits } = req.body || {};
    const updates = [];
    const params = [];

    if (role !== undefined) {
      if (!['user', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'INVALID_ROLE', messageAr: 'صلاحية غير مسموحة.' });
      }
      updates.push('role = ?');
      params.push(role);
    }
    if (status !== undefined) {
      if (!['active', 'suspended'].includes(status)) {
        return res.status(400).json({ error: 'INVALID_STATUS' });
      }
      updates.push('status = ?');
      params.push(status);
      if (status === 'suspended') {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      }
    }
    if (customLimits !== undefined) {
      if (customLimits === null) {
        updates.push('custom_limits = NULL');
      } else if (typeof customLimits === 'object') {
        const clean = {};
        for (const tool of TOOL_IDS) {
          const value = Number(customLimits[tool]);
          if (Number.isFinite(value) && value >= 0 && value <= 10000) clean[tool] = Math.floor(value);
        }
        updates.push('custom_limits = ?');
        params.push(Object.keys(clean).length ? JSON.stringify(clean) : null);
      } else {
        return res.status(400).json({ error: 'INVALID_LIMITS' });
      }
    }

    if (!updates.length) return res.status(400).json({ error: 'NO_CHANGES' });
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params, target.id);
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id);
    res.json({ user: publicUser(updated), entitlements: getEntitlements(db, updated) });
  });

  router.post('/users/:id/subscription', (req, res) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
    if (!target) return res.status(404).json({ error: 'NOT_FOUND' });
    if (target.role === 'owner') {
      return res.status(400).json({ error: 'OWNER_UNLIMITED', messageAr: 'حساب المالك لا يحتاج اشتراكًا.' });
    }

    const { planCode, months = 1, paymentRef = null } = req.body || {};
    const plan = db.prepare('SELECT * FROM plans WHERE code = ? AND is_active = 1').get(String(planCode || ''));
    if (!plan) return res.status(400).json({ error: 'INVALID_PLAN', messageAr: 'الخطة غير موجودة.' });
    if (plan.code === 'free') {
      return res.status(400).json({ error: 'FREE_PLAN_NOT_ASSIGNABLE', messageAr: 'الخطة المجانية لا تُمنح كاشتراك مدفوع.' });
    }
    const durationMonths = Math.min(Math.max(Number(months) || 1, 1), 36);
    const now = new Date();
    const expires = new Date(now.getTime() + durationMonths * 30 * 24 * 60 * 60 * 1000);

    const tx = db.transaction(() => {
      db.prepare("UPDATE subscriptions SET status = 'canceled' WHERE user_id = ? AND status = 'active'").run(target.id);
      db.prepare(
        `INSERT INTO subscriptions (user_id, plan_code, status, started_at, expires_at, payment_ref, created_by, created_at)
         VALUES (?, ?, 'active', ?, ?, ?, ?, ?)`
      ).run(target.id, plan.code, now.toISOString(), expires.toISOString(), paymentRef ? String(paymentRef).slice(0, 80) : null, req.user.id, now.toISOString());
    });
    tx();

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id);
    res.status(201).json({
      user: publicUser(updated),
      subscription: serializeSubscription(activeSubscription(db, target.id)),
      entitlements: getEntitlements(db, updated),
      messageAr: `تم تفعيل خطة «${plan.name_ar}» لمدة ${durationMonths} شهر.`,
    });
  });

  router.delete('/users/:id/subscription', (req, res) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
    if (!target) return res.status(404).json({ error: 'NOT_FOUND' });
    db.prepare("UPDATE subscriptions SET status = 'canceled' WHERE user_id = ? AND status = 'active'").run(target.id);
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id);
    res.json({ user: publicUser(updated), entitlements: getEntitlements(db, updated), messageAr: 'تم إلغاء الاشتراك.' });
  });

  router.get('/plans', (req, res) => {
    const rows = db.prepare('SELECT * FROM plans ORDER BY sort_order ASC').all();
    res.json({ plans: rows.map(serializePlan) });
  });

  router.patch('/plans/:code', (req, res) => {
    const plan = db.prepare('SELECT * FROM plans WHERE code = ?').get(String(req.params.code));
    if (!plan) return res.status(404).json({ error: 'NOT_FOUND' });

    const { nameAr, taglineAr, priceSar, limits, features, isActive } = req.body || {};
    const updates = [];
    const params = [];

    if (nameAr !== undefined) {
      if (String(nameAr).trim().length < 2) return res.status(400).json({ error: 'INVALID_NAME' });
      updates.push('name_ar = ?');
      params.push(String(nameAr).trim().slice(0, 40));
    }
    if (taglineAr !== undefined) {
      updates.push('tagline_ar = ?');
      params.push(String(taglineAr).trim().slice(0, 80));
    }
    if (priceSar !== undefined) {
      const price = Number(priceSar);
      if (!Number.isFinite(price) || price < 0 || price > 100000) return res.status(400).json({ error: 'INVALID_PRICE' });
      updates.push('price_sar = ?');
      params.push(Math.round(price));
    }
    if (limits !== undefined && typeof limits === 'object') {
      const map = { text_video: 'limit_text_video', image_video: 'limit_image_video', voice: 'limit_voice', cartoon: 'limit_cartoon' };
      for (const [tool, column] of Object.entries(map)) {
        if (limits[tool] === undefined) continue;
        const value = Number(limits[tool]);
        if (!Number.isFinite(value) || value < 0 || value > 100000) return res.status(400).json({ error: 'INVALID_LIMIT' });
        updates.push(`${column} = ?`);
        params.push(Math.floor(value));
      }
    }
    if (Array.isArray(features)) {
      updates.push('features = ?');
      params.push(JSON.stringify(features.map((f) => String(f).slice(0, 120)).slice(0, 12)));
    }
    if (isActive !== undefined) {
      updates.push('is_active = ?');
      params.push(isActive ? 1 : 0);
    }

    if (!updates.length) return res.status(400).json({ error: 'NO_CHANGES' });
    db.prepare(`UPDATE plans SET ${updates.join(', ')} WHERE code = ?`).run(...params, plan.code);
    res.json({ plan: serializePlan(db.prepare('SELECT * FROM plans WHERE code = ?').get(plan.code)) });
  });

  // Provider wallet is funded only after an owner verifies an actual top-up
  // in the provider dashboard. Subscription records are never treated as cash.
  router.get('/finance', (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'OWNER_ONLY' });
    res.json({ wallet: providerWalletSummary(db), pricing: { text_video_usd_per_second: 0.10, reserveBufferPercent: 20 } });
  });

  router.post('/finance/credits', (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'OWNER_ONLY' });
    const { amountCents, reference, note, providerBalanceVerified } = req.body || {};
    if (providerBalanceVerified !== true) {
      return res.status(400).json({ error: 'PROVIDER_BALANCE_CONFIRMATION_REQUIRED', messageAr: 'أكد أولاً أن الرصيد أضيف فعليًا إلى حساب المزوّد.' });
    }
    try {
      const wallet = creditProviderWallet(db, { amountCents: Number(amountCents), reference, note, userId: req.user.id });
      return res.status(201).json({ wallet, messageAr: 'تم تسجيل الرصيد التشغيلي المؤكد.' });
    } catch (err) {
      const status = err.code === 'INVALID_AMOUNT' || err.code === 'INVALID_REFERENCE' ? 400 : 409;
      return res.status(status).json({ error: err.code || 'FINANCE_ENTRY_REJECTED' });
    }
  });

  router.post('/finance/reservations/:projectId/release', (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'OWNER_ONLY' });
    const { confirmedNoProviderJob, reason } = req.body || {};
    if (confirmedNoProviderJob !== true) {
      return res.status(400).json({ error: 'PROVIDER_CHECK_REQUIRED', messageAr: 'تحقق من لوحة المزوّد وأكد عدم إنشاء المهمة قبل تحرير الحجز.' });
    }
    try {
      const released = releaseGenerationFunds(db, Number(req.params.projectId), reason, req.user.id);
      return res.json({ released, wallet: providerWalletSummary(db) });
    } catch (err) {
      return res.status(400).json({ error: err.code || 'RESERVATION_RELEASE_REJECTED' });
    }
  });

  router.get('/providers', (req, res) => {
    res.json({ providers: providerStatus() });
  });

  return router;
}

export { serializePlan };
