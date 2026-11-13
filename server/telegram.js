import { timingSafeEqual } from 'node:crypto';

const TELEGRAM_API = 'https://api.telegram.org';
const MAX_MESSAGE_LENGTH = 3900;

function readConfig(env = process.env) {
  return {
    token: String(env.TELEGRAM_BOT_TOKEN || '').trim(),
    webhookSecret: String(env.TELEGRAM_WEBHOOK_SECRET || '').trim(),
    ownerChatId: String(env.TELEGRAM_OWNER_CHAT_ID || '').trim(),
    pairingSecret: String(env.TELEGRAM_PAIRING_SECRET || '').trim(),
  };
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function parseCommand(text) {
  if (typeof text !== 'string' || text.length > 4096) return null;
  const match = text.trim().match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
  return match ? { name: match[1].toLowerCase(), argument: (match[2] || '').trim() } : null;
}

function splitMessage(text, limit = MAX_MESSAGE_LENGTH) {
  const chars = Array.from(String(text || ''));
  const parts = [];
  while (chars.length) parts.push(chars.splice(0, limit).join(''));
  return parts.length ? parts : [''];
}

async function telegramRequest(token, method, payload, fetchImpl = fetch) {
  const response = await fetchImpl(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Telegram API request failed');
  const result = await response.json();
  if (!result.ok) throw new Error('Telegram API rejected the request');
  return result.result;
}

export async function sendTelegramMessage(text, env = process.env, fetchImpl = fetch) {
  const config = readConfig(env);
  if (!config.token || !config.ownerChatId) {
    return { sent: false, reason: 'TELEGRAM_NOT_CONFIGURED' };
  }
  const parts = splitMessage(text);
  for (const part of parts) {
    await telegramRequest(config.token, 'sendMessage', {
      chat_id: config.ownerChatId,
      text: part,
      disable_web_page_preview: true,
    }, fetchImpl);
  }
  return { sent: true, parts: parts.length };
}

function commandReply(command, config) {
  switch (command.name) {
    case 'start':
      return 'مرحباً بك في المدير العام لمنصة AI VIDEO STUDIO. أرسل /help لعرض الأوامر.';
    case 'help':
      return [
        'أوامر AI VIDEO STUDIO:',
        '/start — تشغيل البوت',
        '/help — المساعدة',
        '/status — حالة إعداد الاتصال',
        '/report — حالة التقارير',
        '/bots — حالة فريق البوتات',
        '/performance — الأداء',
        '/levels — مستويات الخبرة',
        '/alerts — التنبيهات',
        '/production — حالة الإنتاج',
        '/quota — حصص التوليد',
        '',
        'هذه النسخة تستقبل أوامر الاستعلام فقط؛ لا تنفذ عمليات مالية أو تغييرات إدارية.',
      ].join('\n');
    case 'status':
      return [
        'حالة اتصال Telegram:',
        `رمز البوت: ${config.token ? 'مضبوط' : 'غير مضبوط'}`,
        `سر Webhook: ${config.webhookSecret ? 'مضبوط' : 'غير مضبوط'}`,
        `معرّف المالك: ${config.ownerChatId ? 'مضبوط' : 'بانتظار الربط'}`,
        'حالة الخادم: استقبل الخادم هذا الطلب بنجاح.',
      ].join('\n');
    case 'report':
      return 'نظام التقارير اليومية والأسبوعية لم يُربط بمصادر بيانات فعلية بعد؛ لن نعرض أرقاماً أو إنجازات غير متحققة.';
    case 'bots':
    case 'performance':
    case 'levels':
      return 'بيانات فريق البوتات ومؤشرات الأداء ومستويات الخبرة غير متاحة من النظام الحالي بعد.';
    case 'alerts':
      return 'قناة التنبيهات قيد التجهيز. لا توجد تنبيهات مسجلة من خلال هذا التكامل حتى الآن.';
    case 'production':
      return 'حالة الإنتاج التفصيلية غير موصولة بهذا البوت بعد. تحقق من لوحة AI VIDEO STUDIO.';
    case 'quota':
      return 'قراءة حصص التوليد من مزودي الذكاء الاصطناعي غير موصولة بهذا البوت بعد.';
    case 'admin':
      return 'الأوامر الإدارية الحساسة غير متاحة عبر Telegram في هذه المرحلة حفاظاً على أمان المنصة.';
    default:
      return 'أمر غير معروف. أرسل /help لعرض الأوامر المتاحة.';
  }
}

async function handleUpdate(update, fetchImpl = fetch, env = process.env) {
  const message = update?.message;
  const chat = message?.chat;
  if (!chat || chat.type !== 'private' || !Number.isSafeInteger(Number(chat.id))) return;

  const config = readConfig(env);
  const command = parseCommand(message.text);
  if (!command) return;

  // First-time pairing is explicitly opt-in and requires a secret placed in
  // Render by the owner. The chat ID is returned only to the claimant holding it.
  if (!config.ownerChatId) {
    if (command.name === 'link' && config.pairingSecret && safeEqual(command.argument, config.pairingSecret)) {
      await telegramRequest(config.token, 'sendMessage', {
        chat_id: chat.id,
        text: `تم التحقق من رمز الربط. أضف TELEGRAM_OWNER_CHAT_ID=${chat.id} إلى Render Environment ثم أزل TELEGRAM_PAIRING_SECRET وأعد النشر. بعدها أرسل /start.`,
      }, fetchImpl);
    }
    return;
  }

  if (String(chat.id) !== config.ownerChatId) return;
  if (command.name === 'link') {
    await telegramRequest(config.token, 'sendMessage', {
      chat_id: chat.id,
      text: 'تم ربط حساب المالك مسبقاً. لا حاجة لإعادة الربط.',
    }, fetchImpl);
    return;
  }

  await telegramRequest(config.token, 'sendMessage', {
    chat_id: chat.id,
    text: commandReply(command, config),
    disable_web_page_preview: true,
  }, fetchImpl);
}

export function telegramWebhookHandler({ fetchImpl = fetch, env = process.env } = {}) {
  return (req, res) => {
    const config = readConfig(env);
    const suppliedSecret = req.get('x-telegram-bot-api-secret-token') || '';
    if (!config.token || !config.webhookSecret || !safeEqual(suppliedSecret, config.webhookSecret)) {
      return res.sendStatus(403);
    }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.sendStatus(400);
    }
    res.sendStatus(200);
    void handleUpdate(req.body, fetchImpl, env).catch(() => {
      // Never log message contents, chat IDs, bot tokens, or Telegram responses.
      console.warn('[telegram] update processing failed');
    });
  };
}

export async function configureTelegramWebhook(env = process.env, fetchImpl = fetch) {
  const config = readConfig(env);
  const baseUrl = String(env.PUBLIC_BASE_URL || env.RENDER_EXTERNAL_URL || '').trim();
  if (!config.token || !config.webhookSecret || !baseUrl) {
    return { configured: false, reason: 'TELEGRAM_ENV_INCOMPLETE' };
  }
  const webhookUrl = new URL('/webhooks/telegram', baseUrl).toString();
  await telegramRequest(config.token, 'setWebhook', {
    url: webhookUrl,
    secret_token: config.webhookSecret,
    allowed_updates: ['message'],
    drop_pending_updates: false,
  }, fetchImpl);
  return { configured: true };
}

export const telegramInternals = Object.freeze({ parseCommand, safeEqual, splitMessage, readConfig });
