import express from 'express';
import { activeSubscription, getEntitlements, monthlyUsage, publicUser } from '../entitlements.js';
import { TOOL_IDS, providerStatus } from '../providers.js';

const CURRENCY_SCALE = { LYD: 1000, USD: 100 };

function parseMoneyMinor(value, currency, allowZero = true) {
  const scale = CURRENCY_SCALE[currency];
  if (!scale) return null;
  const decimals = currency === 'LYD' ? 3 : 2;
  const raw = String(value ?? '').trim();
  const pattern = new RegExp('^(?:0|[1-9]\\d*)(?:\\.\\d{1,' + decimals + '})?$');
  if (!pattern.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  const minor = Number(whole) * scale + Number((fraction + '0'.repeat(decimals)).slice(0, decimals) || 0);
  return Number.isSafeInteger(minor) && (allowZero ? minor >= 0 : minor > 0) ? minor : null;
}

function serializePayment(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    currency: row.currency,
    amount: row.amount_minor / CURRENCY_SCALE[row.currency],
    paymentReference: row.payment_reference,
    customerNote: row.customer_note,
    status: row.status,
    adminNote: row.admin_note,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

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
    prices: {
      LYD: row.price_lyd_minor === null ? null : row.price_lyd_minor / 1000,
      USD: row.price_usd_minor === null ? null : row.price_usd_minor / 100,
    },
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
    const revenue = db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN currency = 'LYD' THEN amount_minor ELSE 0 END), 0) AS lyd_minor,
         COALESCE(SUM(CASE WHEN currency = 'USD' THEN amount_minor ELSE 0 END), 0) AS usd_minor
       FROM subscriptions WHERE status = 'active' AND expires_at > ?`
    ).get(new Date().toISOString());

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
        activeSubscriptionValue: { LYD: revenue.lyd_minor / 1000, USD: revenue.usd_minor / 100 },
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

    if (req.user.role !== 'owner') return res.status(403).json({ error: 'OWNER_REQUIRED' });
    const { planCode, months = 1, paymentRef, currency, amount, paymentVerified, verificationNote } = req.body || {};
    const plan = db.prepare('SELECT * FROM plans WHERE code = ? AND is_active = 1').get(String(planCode || ''));
    if (!plan) return res.status(400).json({ error: 'INVALID_PLAN', messageAr: 'الخطة غير موجودة.' });
    if (plan.code === 'free') {
      return res.status(400).json({ error: 'FREE_PLAN_NOT_ASSIGNABLE', messageAr: 'الخطة المجانية لا تُمنح كاشتراك مدفوع.' });
    }
    const durationMonths = Number(months);
    const cleanReference = String(paymentRef || '').trim().toUpperCase().slice(0, 100);
    const cleanNote = String(verificationNote || '').trim().slice(0, 500);
    const amountMinor = parseMoneyMinor(amount, currency, false);
    const expectedMinor = currency === 'LYD' ? plan.price_lyd_minor : currency === 'USD' ? plan.price_usd_minor : null;
    if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 36 ||
        !cleanReference || cleanReference.length < 4 || paymentVerified !== true || cleanNote.length < 8 ||
        amountMinor === null || expectedMinor === null || amountMinor !== expectedMinor * durationMonths) {
      return res.status(400).json({
        error: expectedMinor === null ? 'PLAN_PRICE_NOT_CONFIGURED' : 'MANUAL_PAYMENT_VERIFICATION_REQUIRED',
        messageAr: expectedMinor === null
          ? 'يجب ضبط سعر الخطة بالعملة المختارة أولاً.'
          : 'يلزم مرجع الحوالة والمبلغ المطابق للخطة وتأكيد تحقق المالك وملاحظة المراجعة قبل التفعيل.',
      });
    }
    if (db.prepare('SELECT payment_reference FROM payment_reference_registry WHERE payment_reference = ?').get(cleanReference)) {
      return res.status(409).json({ error: 'PAYMENT_REFERENCE_USED', messageAr: 'مرجع الحوالة مستخدم مسبقًا.' });
    }
    const now = new Date();
    const expires = new Date(now.getTime() + durationMonths * 30 * 24 * 60 * 60 * 1000);

    const tx = db.transaction(() => {
      db.prepare("UPDATE subscriptions SET status = 'canceled' WHERE user_id = ? AND status = 'active'").run(target.id);
      const result = db.prepare(
        `INSERT INTO subscriptions (user_id, plan_code, status, started_at, expires_at, payment_ref, currency, amount_minor, created_by, created_at)
         VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`
      ).run(target.id, plan.code, now.toISOString(), expires.toISOString(), cleanReference, currency, amountMinor, req.user.id, now.toISOString());
      db.prepare(
        `INSERT INTO payment_reference_registry (payment_reference, source_type, source_id, user_id, created_at)
         VALUES (?, 'subscription', ?, ?, ?)`
      ).run(cleanReference, Number(result.lastInsertRowid), target.id, now.toISOString());
    });
    try {
      tx();
    } catch (error) {
      if (String(error?.code || '').includes('CONSTRAINT')) {
        return res.status(409).json({ error: 'PAYMENT_REFERENCE_USED', messageAr: 'مرجع الحوالة مسجل في عملية مالية أخرى.' });
      }
      throw error;
    }

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

    const { nameAr, taglineAr, limits, features, isActive } = req.body || {};
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'priceSar')) {
      return res.status(400).json({ error: 'UNSUPPORTED_CURRENCY', messageAr: 'العملات المدعومة هي الدينار الليبي والدولار الأمريكي فقط.' });
    }
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
    if (req.body?.priceLyd !== undefined) {
      const price = req.body.priceLyd === null || req.body.priceLyd === '' ? null : parseMoneyMinor(req.body.priceLyd, 'LYD');
      if (price !== null && price > 1000000000 || price === null && req.body.priceLyd !== null && req.body.priceLyd !== '') {
        return res.status(400).json({ error: 'INVALID_LYD_PRICE' });
      }
      updates.push('price_lyd_minor = ?');
      params.push(price);
    }
    if (req.body?.priceUsd !== undefined) {
      const price = req.body.priceUsd === null || req.body.priceUsd === '' ? null : parseMoneyMinor(req.body.priceUsd, 'USD');
      if (price !== null && price > 1000000000 || price === null && req.body.priceUsd !== null && req.body.priceUsd !== '') {
        return res.status(400).json({ error: 'INVALID_USD_PRICE' });
      }
      updates.push('price_usd_minor = ?');
      params.push(price);
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

  // Manual activation is owner-only until a verified payment provider is integrated.
  router.post('/client-content/subscriptions/:id', (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'OWNER_REQUIRED' });
    const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(Number(req.params.id));
    if (!target) return res.status(404).json({ error: 'NOT_FOUND' });
    if (target.role === 'owner') return res.status(400).json({ error: 'OWNER_UNLIMITED' });
    const planCode = String(req.body?.planCode || '').trim().slice(0, 40);
    const paymentRef = String(req.body?.paymentRef || '').trim().toUpperCase().slice(0, 100);
    const months = Number(req.body?.months || 1);
    const paymentVerified = req.body?.paymentVerified === true;
    const verificationNote = String(req.body?.verificationNote || '').trim().slice(0, 500);
    if (!planCode || !paymentRef || paymentRef.length < 3 || !Number.isInteger(months) || months < 1 || months > 12 ||
        !paymentVerified || verificationNote.length < 8) {
      return res.status(400).json({ error: 'VERIFICATION_REQUIRED', messageAr: 'يلزم تأكيد المالك أنه تحقق يدوياً من وصول الدفعة وإضافة ملاحظة تحقق قبل التفعيل.' });
    }
    if (db.prepare('SELECT payment_reference FROM payment_reference_registry WHERE payment_reference = ?').get(paymentRef)) {
      return res.status(409).json({ error: 'PAYMENT_REFERENCE_USED', messageAr: 'مرجع الدفع مستخدم مسبقاً.' });
    }
    const now = new Date();
    const expires = new Date(now.getTime() + months * 30 * 24 * 60 * 60 * 1000);
    const tx = db.transaction(() => {
      db.prepare("UPDATE client_content_subscriptions SET status='canceled',updated_at=? WHERE user_id=? AND status='active'").run(now.toISOString(), target.id);
      const result = db.prepare(`INSERT INTO client_content_subscriptions(user_id,status,plan_code,starts_at,expires_at,payment_ref,activated_by,created_at,updated_at)
        VALUES(?,'active',?,?,?,?,?,?,?)`).run(target.id, planCode, now.toISOString(), expires.toISOString(), paymentRef, req.user.id, now.toISOString(), now.toISOString());
      db.prepare(
        `INSERT INTO payment_reference_registry (payment_reference, source_type, source_id, user_id, created_at)
         VALUES (?, 'client_content_subscription', ?, ?, ?)`
      ).run(paymentRef, Number(result.lastInsertRowid), target.id, now.toISOString());
      db.prepare('INSERT INTO client_content_audit(user_id,actor_user_id,action,details_json,created_at) VALUES(?,?,?,?,?)')
        .run(target.id, req.user.id, 'subscription_manually_activated', JSON.stringify({ subscriptionId: Number(result.lastInsertRowid), planCode, paymentRef, verificationNote }), now.toISOString());
      return Number(result.lastInsertRowid);
    });
    let subscriptionId;
    try {
      subscriptionId = tx();
    } catch (error) {
      if (String(error?.code || '').includes('CONSTRAINT')) {
        return res.status(409).json({ error: 'PAYMENT_REFERENCE_USED', messageAr: 'مرجع الحوالة مسجل في عملية مالية أخرى.' });
      }
      throw error;
    }
    res.status(201).json({ subscription: { id: subscriptionId, userId: target.id, status: 'active', planCode, startsAt: now.toISOString(), expiresAt: expires.toISOString() },
      messageAr: 'تم تسجيل التفعيل الإداري بناءً على تأكيد تحقق المالك يدوياً. لم يتم تنفيذ تحصيل مالي آلي.' });
  });

  router.delete('/client-content/subscriptions/:id', (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'OWNER_REQUIRED' });
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(Number(req.params.id));
    if (!target) return res.status(404).json({ error: 'NOT_FOUND' });
    const now = new Date().toISOString();
    const changed = db.prepare("UPDATE client_content_subscriptions SET status='canceled',updated_at=? WHERE user_id=? AND status='active'")
      .run(now, target.id);
    if (changed.changes) {
      db.prepare('INSERT INTO client_content_audit(user_id,actor_user_id,action,details_json,created_at) VALUES(?,?,?,?,?)')
        .run(target.id, req.user.id, 'subscription_manually_canceled', '{}', now);
    }
    res.json({ messageAr: 'تم إلغاء اشتراك إدارة ونشر المحتوى.' });
  });

  router.get('/payments', (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'OWNER_REQUIRED' });
    const status = ['pending', 'approved', 'rejected'].includes(String(req.query.status || ''))
      ? String(req.query.status) : null;
    const rows = status
      ? db.prepare(`SELECT p.*, u.name AS user_name, u.email AS user_email FROM wallet_payment_requests p
          JOIN users u ON u.id = p.user_id WHERE p.status = ? ORDER BY p.id DESC LIMIT 200`).all(status)
      : db.prepare(`SELECT p.*, u.name AS user_name, u.email AS user_email FROM wallet_payment_requests p
          JOIN users u ON u.id = p.user_id ORDER BY p.id DESC LIMIT 200`).all();
    res.json({ payments: rows.map(serializePayment) });
  });

  router.post('/payments/:id/approve', (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'OWNER_REQUIRED' });
    const id = Number(req.params.id);
    const credits = Number(req.body?.credits);
    const note = String(req.body?.verificationNote || '').trim().slice(0, 500);
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(credits) || credits < 1 || credits > 1000000000 || note.length < 8) {
      return res.status(400).json({ error: 'INVALID_PAYMENT_APPROVAL', messageAr: 'أدخل عدد نقاط صحيحًا وملاحظة تحقق لا تقل عن 8 أحرف.' });
    }
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      const changed = db.prepare(
        `UPDATE wallet_payment_requests SET status='approved', admin_note=?, reviewed_by=?, reviewed_at=?
         WHERE id=? AND status='pending'`
      ).run(note, req.user.id, now, id);
      if (!changed.changes) return false;
      const payment = db.prepare('SELECT user_id, payment_reference FROM wallet_payment_requests WHERE id=?').get(id);
      db.prepare(
        `INSERT INTO wallet_ledger (user_id, entry_type, credits_delta, payment_request_id, note, created_by, created_at)
         VALUES (?, 'topup', ?, ?, ?, ?, ?)`
      ).run(payment.user_id, credits, id, `اعتماد حوالة ${payment.payment_reference}`, req.user.id, now);
      return true;
    });
    if (!tx()) return res.status(409).json({ error: 'PAYMENT_NOT_PENDING', messageAr: 'تمت مراجعة هذا الطلب مسبقًا أو لم يعد قيد الانتظار.' });
    res.json({ ok: true, messageAr: 'تم اعتماد الحوالة وإضافة نقاط الاستخدام إلى المحفظة.' });
  });

  router.post('/payments/:id/reject', (req, res) => {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'OWNER_REQUIRED' });
    const id = Number(req.params.id);
    const note = String(req.body?.reviewNote || '').trim().slice(0, 500);
    if (!Number.isSafeInteger(id) || id < 1 || note.length < 8) {
      return res.status(400).json({ error: 'INVALID_PAYMENT_REJECTION', messageAr: 'أدخل سبب رفض واضحًا لا يقل عن 8 أحرف.' });
    }
    const changed = db.prepare(
      `UPDATE wallet_payment_requests SET status='rejected', admin_note=?, reviewed_by=?, reviewed_at=?
       WHERE id=? AND status='pending'`
    ).run(note, req.user.id, new Date().toISOString(), id);
    if (!changed.changes) return res.status(409).json({ error: 'PAYMENT_NOT_PENDING' });
    res.json({ ok: true, messageAr: 'تم رفض طلب الحوالة مع حفظ سبب الرفض.' });
  });

  router.get('/providers', (req, res) => {
    res.json({ providers: providerStatus() });
  });

  return router;
}

export { serializePlan };
