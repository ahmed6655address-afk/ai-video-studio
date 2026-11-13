import express from 'express';

const CURRENCY_SCALE = { LYD: 1000, USD: 100 };

function parseAmountMinor(value, currency) {
  const scale = CURRENCY_SCALE[currency];
  if (!scale) return null;
  const raw = String(value ?? '').trim();
  const decimals = currency === 'LYD' ? 3 : 2;
  const pattern = new RegExp('^(?:0|[1-9]\\d*)(?:\\.\\d{1,' + decimals + '})?$');
  if (!pattern.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  const minor = Number(whole) * scale + Number((fraction + '0'.repeat(decimals)).slice(0, decimals) || 0);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

function serializePayment(row) {
  return {
    id: row.id,
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

export function walletRouter(db) {
  const router = express.Router();
  const requireUser = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    if (req.user.status !== 'active') return res.status(403).json({ error: 'ACCOUNT_SUSPENDED' });
    next();
  };

  router.use(requireUser);

  router.get('/', (req, res) => {
    const balance = db.prepare('SELECT COALESCE(SUM(credits_delta), 0) AS balance FROM wallet_ledger WHERE user_id = ?')
      .get(req.user.id).balance;
    const entries = db.prepare(
      'SELECT id, entry_type, credits_delta, note, created_at FROM wallet_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 50'
    ).all(req.user.id);
    const paymentRequests = db.prepare(
      'SELECT * FROM wallet_payment_requests WHERE user_id = ? ORDER BY id DESC LIMIT 30'
    ).all(req.user.id).map(serializePayment);
    res.json({ wallet: { currency: 'CREDITS', balance, entries }, paymentRequests });
  });

  router.post('/payment-requests', (req, res) => {
    const currency = String(req.body?.currency || '').toUpperCase();
    const amountMinor = parseAmountMinor(req.body?.amount, currency);
    const paymentReference = String(req.body?.paymentReference || '').trim().toUpperCase().slice(0, 100);
    const customerNote = String(req.body?.note || '').trim().slice(0, 500) || null;

    if (!amountMinor || paymentReference.length < 4) {
      return res.status(400).json({
        error: 'INVALID_PAYMENT_REQUEST',
        messageAr: 'أدخل مبلغًا صحيحًا بالدينار الليبي أو الدولار، ومرجع حوالة لا يقل عن 4 أحرف.',
      });
    }

    try {
      const now = new Date().toISOString();
      const tx = db.transaction(() => {
        const result = db.prepare(
          `INSERT INTO wallet_payment_requests (user_id, currency, amount_minor, payment_reference, customer_note, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(req.user.id, currency, amountMinor, paymentReference, customerNote, now);
        db.prepare(
          `INSERT INTO payment_reference_registry (payment_reference, source_type, source_id, user_id, created_at)
           VALUES (?, 'wallet_topup', ?, ?, ?)`
        ).run(paymentReference, Number(result.lastInsertRowid), req.user.id, now);
        return Number(result.lastInsertRowid);
      });
      const requestId = tx();
      const row = db.prepare('SELECT * FROM wallet_payment_requests WHERE id = ?').get(requestId);
      return res.status(201).json({
        paymentRequest: serializePayment(row),
        messageAr: 'تم تسجيل طلب مراجعة الحوالة. لن يُضاف أي رصيد قبل تحقق الإدارة واعتماد عدد نقاط الاستخدام.',
      });
    } catch (error) {
      if (String(error?.code || '').includes('CONSTRAINT')) {
        return res.status(409).json({ error: 'PAYMENT_REFERENCE_USED', messageAr: 'مرجع الحوالة مسجل مسبقًا ولا يمكن استخدامه في عملية أخرى.' });
      }
      throw error;
    }
  });

  return router;
}

export const walletInternals = { parseAmountMinor, serializePayment };
