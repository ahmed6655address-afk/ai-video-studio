import express from 'express';

const TELEGRAM_API = 'https://api.telegram.org';

export function telegramConfig(env = process.env) {
  const token = String(env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(env.TELEGRAM_OWNER_CHAT_ID || '').trim();
  if (!token || token.length < 20 || !/^-?\d{1,20}$/.test(chatId)) return null;
  return { token, chatId };
}

/**
 * Sends plain text only to the configured owner chat. The destination is never
 * accepted from request data, and the Telegram host is fixed to prevent SSRF.
 */
export async function sendTelegramMessage(text, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
} = {}) {
  const config = telegramConfig(env);
  if (!config) {
    const error = new Error('Telegram is not configured');
    error.code = 'TELEGRAM_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }
  if (typeof text !== 'string' || !text.trim() || text.length > 4000) {
    const error = new Error('Invalid Telegram message');
    error.code = 'TELEGRAM_INVALID_MESSAGE';
    error.status = 400;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${TELEGRAM_API}/bot${config.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chatId, text: text.trim(), disable_web_page_preview: true }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true || !payload?.result?.message_id) {
      const error = new Error('Telegram rejected the message');
      error.code = 'TELEGRAM_SEND_FAILED';
      error.status = 502;
      throw error;
    }
    return { messageId: payload.result.message_id };
  } finally {
    clearTimeout(timeout);
  }
}

export function notificationsRouter() {
  const router = express.Router();

  // This is deliberately owner-only. Admins and all other roles are denied.
  router.post('/telegram/test', async (req, res) => {
    if (!req.user || req.user.role !== 'owner') {
      return res.status(req.user ? 403 : 401).json({ error: req.user ? 'OWNER_ONLY' : 'UNAUTHENTICATED' });
    }
    try {
      const result = await sendTelegramMessage(
        '✅ اختبار اتصال AI VIDEO STUDIO\nتم استلام هذه الرسالة من خادم المنصة. هذه رسالة اختبار فقط.'
      );
      return res.json({ ok: true, messageAr: 'تم إرسال رسالة الاختبار إلى محادثة المالك.', messageId: result.messageId });
    } catch (error) {
      const status = error.status || 502;
      return res.status(status).json({
        error: error.code || 'TELEGRAM_SEND_FAILED',
        messageAr: status === 503
          ? 'إعدادات تيليجرام غير مكتملة على الخادم.'
          : 'تعذّر إرسال رسالة الاختبار. تحقّق من إعدادات البوت واتصال الخادم.',
      });
    }
  });

  return router;
}
