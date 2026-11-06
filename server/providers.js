/**
 * Server-only AI provider integration points.
 *
 * NOTHING in this file is a working AI integration yet. It provides:
 *   - a single registry describing every tool and the provider that will serve it
 *   - detection of server-side credentials (env vars only — never sent to clients)
 *   - a uniform adapter contract (`submit`, `fetchStatus`) so a real provider can be
 *     dropped in later without touching routes or UI
 *   - explicit `not_connected` state so the UI can honestly tell the user
 *
 * Credentials are read exclusively from `process.env` inside the server process.
 * No key, endpoint or provider secret is ever included in an API response.
 */

export const TOOL_DEFINITIONS = {
  text_video: {
    id: 'text_video',
    nameAr: 'النص إلى فيديو',
    shortAr: 'فيديو من نص',
    descriptionAr: 'حوّل وصفًا نصيًا إلى مشهد سينمائي متكامل بالحركة والإضاءة.',
    icon: 'video',
    accent: 'violet',
    limitKey: 'limit_text_video',
    providerEnvKey: 'TEXT_VIDEO_API_KEY',
    endpointEnvKey: 'TEXT_VIDEO_API_URL',
    providerLabel: 'Text-to-Video Provider',
    placeholderAr: 'مثال: مشهد سينمائي لمدينة عربية قديمة عند الغروب، أزقة حجرية، أضواء ذهبية، حركة كاميرا بطيئة للأمام…',
    promptLabelAr: 'وصف المشهد',
    options: [
      { key: 'duration', labelAr: 'مدة الفيديو', type: 'select', choices: ['4s', '8s', '12s'], default: '8s' },
      { key: 'aspect', labelAr: 'نسبة العرض', type: 'select', choices: ['16:9', '9:16', '1:1'], default: '16:9' },
      { key: 'style', labelAr: 'النمط البصري', type: 'select', choices: ['سينمائي', 'واقعي', 'رسوم متحركة', 'أنمي'], default: 'سينمائي' },
    ],
  },
  image_video: {
    id: 'image_video',
    nameAr: 'الصورة إلى فيديو',
    shortAr: 'تحريك صورة',
    descriptionAr: 'أضف الحركة إلى صورة ثابتة مع الحفاظ على هوية المشهد.',
    icon: 'image',
    accent: 'cyan',
    limitKey: 'limit_image_video',
    providerEnvKey: 'IMAGE_VIDEO_API_KEY',
    endpointEnvKey: 'IMAGE_VIDEO_API_URL',
    providerLabel: 'Image-to-Video Provider',
    placeholderAr: 'مثال: حركة كاميرا دائرية بطيئة حول المنتج مع انعكاس ضوئي ناعم…',
    promptLabelAr: 'وصف الحركة المطلوبة',
    options: [
      { key: 'duration', labelAr: 'مدة الفيديو', type: 'select', choices: ['4s', '6s'], default: '4s' },
      { key: 'motion', labelAr: 'قوة الحركة', type: 'select', choices: ['خفيفة', 'متوسطة', 'قوية'], default: 'متوسطة' },
      { key: 'aspect', labelAr: 'نسبة العرض', type: 'select', choices: ['16:9', '9:16', '1:1'], default: '16:9' },
    ],
    requiresImage: true,
  },
  voice: {
    id: 'voice',
    nameAr: 'التعليق الصوتي العربي',
    shortAr: 'صوت عربي',
    descriptionAr: 'توليد تعليق صوتي عربي فصيح بنبرات متعددة جاهزة للمونتاج.',
    icon: 'mic',
    accent: 'amber',
    limitKey: 'limit_voice',
    providerEnvKey: 'VOICE_API_KEY',
    endpointEnvKey: 'VOICE_API_URL',
    providerLabel: 'Arabic TTS Provider',
    placeholderAr: 'اكتب النص الذي تريد تحويله إلى تعليق صوتي عربي…',
    promptLabelAr: 'نص التعليق',
    options: [
      { key: 'voiceTone', labelAr: 'نبرة الصوت', type: 'select', choices: ['إخباري', 'حماسي', 'هادئ', 'وثائقي'], default: 'إخباري' },
      { key: 'speed', labelAr: 'السرعة', type: 'select', choices: ['0.9x', '1x', '1.1x'], default: '1x' },
      { key: 'dialect', labelAr: 'اللهجة', type: 'select', choices: ['فصحى', 'خليجية', 'مصرية', 'شامية'], default: 'فصحى' },
    ],
  },
  cartoon: {
    id: 'cartoon',
    nameAr: 'إنشاء كرتون بالذكاء الاصطناعي',
    shortAr: 'كرتون',
    descriptionAr: 'أنشئ شخصيات ومشاهد كرتونية متكاملة من وصف بسيط.',
    icon: 'sparkles',
    accent: 'rose',
    limitKey: 'limit_cartoon',
    providerEnvKey: 'CARTOON_API_KEY',
    endpointEnvKey: 'CARTOON_API_URL',
    providerLabel: 'Cartoon Animation Provider',
    placeholderAr: 'مثال: شخصية طفل يرتدي ثوبًا تقليديًا يركض في سوق شعبي، ألوان مبهجة، أسلوب أنمي…',
    promptLabelAr: 'وصف الشخصية أو المشهد',
    options: [
      { key: 'artStyle', labelAr: 'أسلوب الرسم', type: 'select', choices: ['أنمي', 'كرتون ثلاثي الأبعاد', 'رسم يدوي'], default: 'أنمي' },
      { key: 'duration', labelAr: 'مدة المقطع', type: 'select', choices: ['4s', '8s'], default: '4s' },
      { key: 'aspect', labelAr: 'نسبة العرض', type: 'select', choices: ['16:9', '9:16'], default: '16:9' },
    ],
  },
};

export const TOOL_IDS = Object.keys(TOOL_DEFINITIONS);

export class ProviderNotConnectedError extends Error {
  constructor(tool) {
    super(`لا يوجد مزوّد ذكاء اصطناعي متصل لأداة «${TOOL_DEFINITIONS[tool]?.nameAr || tool}» بعد.`);
    this.code = 'PROVIDER_NOT_CONNECTED';
    this.status = 503;
  }
}

function envValue(name) {
  const raw = process.env[name];
  if (!raw) return null;
  const trimmed = String(raw).trim();
  return trimmed.length >= 8 ? trimmed : null;
}

/**
 * A provider adapter is intentionally NOT implemented here.
 * When real credentials exist, `createAdapter` returns an adapter whose `submit`
 * performs a server-side request to the configured endpoint. Until then the tool
 * reports `connected: false` and every generation request is stored as
 * `pending_provider` instead of pretending a video was produced.
 */
export function createAdapter(tool) {
  const def = TOOL_DEFINITIONS[tool];
  if (!def) throw new Error(`Unknown tool: ${tool}`);
  const apiKey = envValue(def.providerEnvKey);
  const endpoint = envValue(def.endpointEnvKey);

  return {
    tool,
    get connected() {
      return Boolean(apiKey && endpoint);
    },
    async submit(payload) {
      if (!apiKey || !endpoint) throw new ProviderNotConnectedError(tool);
      // Scaffold for a future provider: server-side call only, key never leaves the server.
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ tool, ...payload }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Provider responded with ${res.status}`);
      const data = await res.json().catch(() => ({}));
      return { jobId: data.id || data.jobId || null, raw: data };
    },
    async fetchStatus(jobId) {
      if (!apiKey || !endpoint) throw new ProviderNotConnectedError(tool);
      const res = await fetch(`${endpoint.replace(/\/$/, '')}/${encodeURIComponent(jobId)}`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Provider responded with ${res.status}`);
      return res.json();
    },
  };
}

/** Public-safe status payload: booleans and display names only, never env values. */
export function providerStatus() {
  const tools = {};
  for (const tool of TOOL_IDS) {
    const def = TOOL_DEFINITIONS[tool];
    const adapter = createAdapter(tool);
    tools[tool] = {
      tool,
      connected: adapter.connected,
      providerLabel: def.providerLabel,
      requiredEnv: [def.providerEnvKey, def.endpointEnvKey],
      configuredEnv: [def.providerEnvKey, def.endpointEnvKey].filter((name) => Boolean(envValue(name))),
      messageAr: adapter.connected
        ? 'المزوّد مُهيّأ على الخادم — التنفيذ الفعلي غير مُتحقَّق منه في هذه النسخة.'
        : 'هذه الأداة غير متصلة بمزوّد ذكاء اصطناعي بعد. الواجهة جاهزة، والطلبات تُحفظ للمراجعة.',
    };
  }
  return { tools };
}

/** Tool catalogue safe to send to the browser (no env names, no secrets). */
export function publicTools(status = providerStatus()) {
  return TOOL_IDS.map((tool) => {
    const def = TOOL_DEFINITIONS[tool];
    return {
      id: def.id,
      nameAr: def.nameAr,
      shortAr: def.shortAr,
      descriptionAr: def.descriptionAr,
      icon: def.icon,
      accent: def.accent,
      promptLabelAr: def.promptLabelAr,
      placeholderAr: def.placeholderAr,
      options: def.options,
      requiresImage: Boolean(def.requiresImage),
      connected: status.tools[tool].connected,
      providerLabel: def.providerLabel,
      messageAr: status.tools[tool].messageAr,
    };
  });
}
