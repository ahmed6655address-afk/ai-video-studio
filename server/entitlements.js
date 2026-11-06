import { TOOL_DEFINITIONS, TOOL_IDS } from './providers.js';

export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function publicUser(user) {
  if (!user) return null;
  let customLimits = null;
  if (user.custom_limits) {
    try {
      customLimits = JSON.parse(user.custom_limits);
    } catch {
      customLimits = null;
    }
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    avatarColor: user.avatar_color,
    customLimits,
    mustChangePassword: Boolean(user.must_change_password),
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  };
}

export function activeSubscription(db, userId, now = new Date()) {
  return (
    db
      .prepare(
        `SELECT s.*, p.name_ar, p.price_sar
         FROM subscriptions s JOIN plans p ON p.code = s.plan_code
         WHERE s.user_id = ? AND s.status = 'active' AND s.expires_at > ?
         ORDER BY s.expires_at DESC LIMIT 1`
      )
      .get(userId, now.toISOString()) || null
  );
}

export function monthlyUsage(db, userId, now = new Date()) {
  const rows = db
    .prepare(
      `SELECT tool, COUNT(*) AS count FROM usage_events
       WHERE user_id = ? AND created_at >= ? GROUP BY tool`
    )
    .all(userId, monthStart(now));
  const usage = Object.fromEntries(TOOL_IDS.map((tool) => [tool, 0]));
  for (const row of rows) {
    if (row.tool in usage) usage[row.tool] = row.count;
  }
  return usage;
}

/**
 * Resolves what a user is allowed to do. This is the single source of truth used by
 * every generation route — never trust a client-supplied plan, role or limit.
 */
export function getEntitlements(db, user, now = new Date()) {
  const isStaff = user.role === 'owner' || user.role === 'admin';
  const subscription = activeSubscription(db, user.id, now);
  const plan = subscription
    ? db.prepare('SELECT * FROM plans WHERE code = ?').get(subscription.plan_code)
    : null;

  const customLimits = (() => {
    if (!user.custom_limits) return {};
    try {
      return JSON.parse(user.custom_limits) || {};
    } catch {
      return {};
    }
  })();

  const usage = monthlyUsage(db, user.id, now);
  const limits = {};
  const remaining = {};

  for (const tool of TOOL_IDS) {
    const key = TOOL_DEFINITIONS[tool].limitKey;
    let limit = plan ? plan[key] : 0;
    if (typeof customLimits[tool] === 'number') limit = customLimits[tool];
    if (isStaff) limit = null; // staff & owner: unlimited, free access
    limits[tool] = limit;
    remaining[tool] = limit === null ? null : Math.max(0, limit - usage[tool]);
  }

  const hasAccess = isStaff || Boolean(subscription && plan && plan.price_sar >= 0);
  let reason = null;
  if (!hasAccess) reason = subscription ? 'SUBSCRIPTION_INACTIVE' : 'SUBSCRIPTION_REQUIRED';

  return {
    isStaff,
    unlimited: isStaff,
    hasAccess,
    reason,
    plan: plan
      ? {
          code: plan.code,
          nameAr: plan.name_ar,
          priceSar: plan.price_sar,
          limits: {
            text_video: plan.limit_text_video,
            image_video: plan.limit_image_video,
            voice: plan.limit_voice,
            cartoon: plan.limit_cartoon,
          },
        }
      : null,
    subscription: subscription
      ? {
          id: subscription.id,
          planCode: subscription.plan_code,
          status: subscription.status,
          startedAt: subscription.started_at,
          expiresAt: subscription.expires_at,
        }
      : null,
    limits,
    usage,
    remaining,
    periodStart: monthStart(now),
  };
}

export function canUseTool(entitlements, tool) {
  if (!entitlements.hasAccess) {
    return { allowed: false, code: 'SUBSCRIPTION_REQUIRED', messageAr: 'يتطلب التوليد اشتراكًا نشطًا.' };
  }
  const limit = entitlements.limits[tool];
  if (limit === null) return { allowed: true };
  if (limit <= 0) {
    return { allowed: false, code: 'PLAN_NOT_INCLUDED', messageAr: 'هذه الأداة غير مشمولة في خطتك الحالية.' };
  }
  if (entitlements.usage[tool] >= limit) {
    return { allowed: false, code: 'QUOTA_EXCEEDED', messageAr: 'لقد استهلكت كامل حصتك الشهرية لهذه الأداة.' };
  }
  return { allowed: true };
}
