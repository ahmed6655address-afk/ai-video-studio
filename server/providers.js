/**
 * Server-only AI provider integrations.
 *
 * fal.ai Wan 2.7 text-to-video uses the official queue API. Generation is
 * deliberately opt-in: both FAL_KEY and FAL_ENABLE_GENERATION=true are required.
 * Credentials are read only by the server and are never returned to clients.
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
    providerEnvKey: 'FAL_KEY',
    endpointEnvKey: 'FAL_ENABLE_GENERATION',
    providerLabel: 'fal.ai — Wan 2.7',
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
const FAL_MODEL = 'fal-ai/wan/v2.7/text-to-video';
const FAL_QUEUE = 'https://queue.fal.run/fal-ai/wan/v2.7/text-to-video';

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

function falEnabled() {
  return Boolean(envValue('FAL_KEY') && process.env.FAL_ENABLE_GENERATION === 'true');
}

async function falRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Key ${envValue('FAL_KEY')}`,
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`fal.ai responded with ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`);
  }
  return response.json();
}

function falAdapter() {
  return {
    tool: 'text_video',
    get connected() {
      return falEnabled();
    },
    async submit(payload) {
      if (!falEnabled()) throw new ProviderNotConnectedError('text_video');
      const duration = Number.parseInt(String(payload.options?.duration || '8s'), 10);
      const aspect = payload.options?.aspect || '16:9';
      const input = {
        prompt: payload.prompt,
        aspect_ratio: ['16:9', '9:16', '1:1'].includes(aspect) ? aspect : '16:9',
        duration: Number.isInteger(duration) ? Math.min(15, Math.max(2, duration)) : 8,
        resolution: '720p',
        enable_prompt_expansion: true,
        enable_safety_checker: true,
      };
      if (payload.negativePrompt) input.negative_prompt = String(payload.negativePrompt).slice(0, 500);
      const data = await falRequest(FAL_QUEUE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input }),
      });
      if (!data.request_id) throw new Error('fal.ai did not return a request_id');
      return { jobId: data.request_id, raw: { status: data.status || 'IN_QUEUE' } };
    },
    async fetchStatus(jobId) {
      if (!falEnabled()) throw new ProviderNotConnectedError('text_video');
      if (!/^[0-9a-f-]{20,}$/i.test(String(jobId))) throw new Error('Invalid fal.ai request ID');
      const base = `${FAL_QUEUE}/requests/${encodeURIComponent(jobId)}`;
      const status = await falRequest(`${base}/status`, { method: 'GET' });
      if (status.status !== 'COMPLETED') return { status: status.status, outputUrl: null };
      if (status.error || status.error_type) {
        return { status: 'FAILED', error: String(status.error || status.error_type).slice(0, 300) };
      }
      const result = await falRequest(base, { method: 'GET' });
      const outputUrl = result.video?.url || result.output?.video?.url || null;
      if (!outputUrl || !/^https:\/\//i.test(outputUrl)) {
        return { status: 'FAILED', error: 'fal.ai completed without a valid video URL.' };
      }
      return { status: 'COMPLETED', outputUrl };
    },
  };
}

/** Provider adapters are server-only. Only text-to-video is implemented currently. */
export function createAdapter(tool) {
  const def = TOOL_DEFINITIONS[tool];
  if (!def) throw new Error(`Unknown tool: ${tool}`);
  if (tool === 'text_video') return falAdapter();

  const apiKey = envValue(def.providerEnvKey);
  const endpoint = envValue(def.endpointEnvKey);
  return {
    tool,
    get connected() {
      return Boolean(apiKey && endpoint);
    },
    async submit(payload) {
      if (!apiKey || !endpoint) throw new ProviderNotConnectedError(tool);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
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

/** Public-safe status; configured credentials are not proof of a successful live call. */
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
      configuredEnv: tool === 'text_video'
        ? ['FAL_KEY', 'FAL_ENABLE_GENERATION'].filter((name) => name === 'FAL_ENABLE_GENERATION'
          ? process.env.FAL_ENABLE_GENERATION === 'true'
          : Boolean(envValue(name)))
        : [def.providerEnvKey, def.endpointEnvKey].filter((name) => Boolean(envValue(name))),
      messageAr: adapter.connected
        ? 'إعدادات المزوّد مكتملة على الخادم؛ يلزم اختبار طلب فعلي لتأكيد التشغيل.'
        : 'هذه الأداة غير متصلة بمزوّد ذكاء اصطناعي بعد.',
    };
  }
  return { tools };
}

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
