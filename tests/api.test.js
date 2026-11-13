/**
 * API integration tests — run with `npm test` (node --test).
 *
 * These tests boot the real Express app against a throwaway SQLite database and
 * exercise the security-critical rules from the product requirements:
 *   - only the owner/admin can reach /api/admin/*
 *   - the owner always has free, unlimited access
 *   - regular users cannot generate without an active paid subscription
 *   - usage limits are enforced server-side
 *   - provider integrations are honestly reported as "not connected"
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.OWNER_EMAIL = 'owner@aivideo.studio';
process.env.OWNER_PASSWORD = 'Owner-Test-Passw0rd!';
process.env.SESSION_SECRET = 'test-session-secret-value';
delete process.env.OPENAI_API_KEY;
delete process.env.REPLICATE_API_TOKEN;
delete process.env.ELEVENLABS_API_KEY;

const { createApp } = await import('../server/index.js');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avs-test-'));
const dbFile = path.join(tmpDir, 'test.db');
const app = createApp({ dbFile });
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const state = {
  userCookie: '',
  user2Cookie: '',
  ownerCookie: '',
  userId: null,
};

async function api(pathname, { method = 'GET', body, cookie, headers = {}, csrf = true } = {}) {
  const finalHeaders = { ...headers };
  if (body !== undefined) finalHeaders['content-type'] = 'application/json';
  if (csrf && method !== 'GET') finalHeaders['x-requested-with'] = 'ai-video-studio';
  if (cookie) finalHeaders.cookie = cookie;

  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const sessionCookie = setCookies.map((c) => c.split(';')[0]).find((c) => c.startsWith('avs_session='));
  return { status: res.status, body: json, text, cookie: sessionCookie || '' };
}

test('health and public tool catalogue', async (t) => {
  await t.test('GET /api/health exposes only the liveness status', async () => {
    const res = await api('/api/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'ok' });
  });

  await t.test('GET /api/tools lists the four tools as not connected', async () => {
    const res = await api('/api/tools');
    assert.equal(res.status, 200);
    const ids = res.body.tools.map((tool) => tool.id).sort();
    assert.deepEqual(ids, ['cartoon', 'image_video', 'text_video', 'voice']);
    for (const tool of res.body.tools) {
      assert.equal(tool.connected, false, `${tool.id} must not claim a live integration`);
      assert.ok(tool.messageAr && tool.messageAr.length > 0);
    }
    assert.ok(res.body.providers.tools.text_video.requiredEnv.length > 0);
  });

  await t.test('GET /api/plans exposes the subscription catalogue', async () => {
    const res = await api('/api/plans');
    assert.equal(res.status, 200);
    const codes = res.body.plans.map((plan) => plan.code);
    for (const code of ['free', 'starter', 'pro', 'studio']) assert.ok(codes.includes(code));
  });
});

test('CSRF protection on mutating requests', async (t) => {
  await t.test('missing X-Requested-With is rejected', async () => {
    const res = await api('/api/auth/register', {
      method: 'POST',
      body: { name: 'x', email: 'x@y.dev', password: 'Str0ngPass!23' },
      csrf: false,
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'CSRF_REJECTED');
  });

  await t.test('non-JSON content type is rejected', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'x-requested-with': 'ai-video-studio' },
      body: 'nope',
    });
    assert.equal(res.status, 415);
  });
});

test('registration, login and session handling', async (t) => {
  await t.test('register creates an unsubscribed regular user', async () => {
    const res = await api('/api/auth/register', {
      method: 'POST',
      body: { name: 'سارة العتيبي', email: 'Sara@Test.dev', password: 'Str0ngPass!23' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.email, 'sara@test.dev');
    assert.equal(res.body.user.role, 'user');
    assert.equal(res.body.user.passwordHash, undefined);
    assert.equal(res.body.entitlements.hasAccess, false);
    assert.equal(res.body.entitlements.reason, 'SUBSCRIPTION_REQUIRED');
    assert.ok(res.cookie.startsWith('avs_session='));
    state.userCookie = res.cookie;
    state.userId = res.body.user.id;
  });

  await t.test('duplicate email is rejected', async () => {
    const res = await api('/api/auth/register', {
      method: 'POST',
      body: { name: 'مكرر', email: 'sara@test.dev', password: 'Str0ngPass!23' },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'EMAIL_TAKEN');
  });

  await t.test('weak password is rejected with a field error', async () => {
    const res = await api('/api/auth/register', {
      method: 'POST',
      body: { name: 'ضعيف', email: 'weak@test.dev', password: '123' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'VALIDATION_ERROR');
    assert.ok(res.body.fields.password);
  });

  await t.test('public registration cannot claim the owner address', async () => {
    const res = await api('/api/auth/register', {
      method: 'POST',
      body: { name: 'محتال', email: 'OWNER@aivideo.studio', password: 'Str0ngPass!23' },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'EMAIL_TAKEN');
    assert.equal(res.cookie, '', 'no session may be issued for the owner address');

    // The real owner is untouched and still owns the account.
    const login = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'owner@aivideo.studio', password: 'Owner-Test-Passw0rd!' },
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.role, 'owner');
  });

  await t.test('registration ignores any role supplied by the client', async () => {
    const res = await api('/api/auth/register', {
      method: 'POST',
      body: { name: 'طامع', email: 'climber@test.dev', password: 'Str0ngPass!23', role: 'owner', isOwner: true },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'user');
    assert.equal(res.body.entitlements.unlimited, false);
  });

  await t.test('session cookie authenticates /api/auth/me', async () => {
    const res = await api('/api/auth/me', { cookie: state.userCookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.name, 'سارة العتيبي');
  });

  await t.test('wrong password returns 401 without leaking account state', async () => {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'sara@test.dev', password: 'wrong-password' },
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'INVALID_CREDENTIALS');
  });

  await t.test('unauthenticated access to protected routes is 401', async () => {
    assert.equal((await api('/api/dashboard')).status, 401);
    assert.equal((await api('/api/projects')).status, 401);
  });
});

test('subscription gating is enforced on the server', async (t) => {
  await t.test('unsubscribed user cannot generate', async () => {
    const res = await api('/api/projects', {
      method: 'POST',
      cookie: state.userCookie,
      body: { tool: 'text_video', prompt: 'مشهد سينمائي لمدينة عربية في المستقبل' },
    });
    assert.equal(res.status, 402);
    assert.equal(res.body.error, 'SUBSCRIPTION_REQUIRED');
  });

  await t.test('invalid tool and short prompt are rejected', async () => {
    const badTool = await api('/api/projects', {
      method: 'POST',
      cookie: state.userCookie,
      body: { tool: 'not_a_tool', prompt: 'نص كافٍ للتحقق' },
    });
    assert.equal(badTool.status, 400);
    assert.equal(badTool.body.error, 'INVALID_TOOL');

    const shortPrompt = await api('/api/projects', {
      method: 'POST',
      cookie: state.userCookie,
      body: { tool: 'text_video', prompt: 'قصير' },
    });
    assert.equal(shortPrompt.status, 400);
    assert.ok(shortPrompt.body.fields.prompt);
  });

  await t.test('image tool requires an image url', async () => {
    const res = await api('/api/projects', {
      method: 'POST',
      cookie: state.userCookie,
      body: { tool: 'image_video', prompt: 'حرّك الصورة ببطء مع ضباب خفيف' },
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.fields.imageUrl);
  });

  await t.test('regular user is denied admin endpoints', async () => {
    const res = await api('/api/admin/users', { cookie: state.userCookie });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'FORBIDDEN');
  });
});

test('owner has free unlimited access and full admin rights', async (t) => {
  await t.test('owner can log in with the seeded credentials', async () => {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'owner@aivideo.studio', password: 'Owner-Test-Passw0rd!' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, 'owner');
    assert.equal(res.body.entitlements.unlimited, true);
    assert.equal(res.body.entitlements.hasAccess, true);
    state.ownerCookie = res.cookie;
  });

  await t.test('owner generates without any subscription record', async () => {
    const res = await api('/api/projects', {
      method: 'POST',
      cookie: state.ownerCookie,
      body: {
        tool: 'text_video',
        prompt: 'إعلان فاخر لمنتج عطور فاخر مع إضاءة ذهبية',
        options: { aspect: '9:16', duration: '15' },
      },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.project.status, 'pending_provider');
    assert.equal(res.body.providerConnected, false);
    assert.match(res.body.messageAr, /غير متصلة|لم يتم توليد/);
  });

  await t.test('admin API cannot grant the owner role or promote oneself', async () => {
    const users = await api('/api/admin/users', { cookie: state.ownerCookie });
    const regular = users.body.users.find((user) => user.email === 'sara@test.dev');
    assert.ok(regular);

    const toOwner = await api(`/api/admin/users/${regular.id}`, {
      method: 'PATCH',
      cookie: state.ownerCookie,
      body: { role: 'owner' },
    });
    assert.equal(toOwner.status, 400);
    assert.equal(toOwner.body.error, 'INVALID_ROLE');

    const stillUser = await api('/api/auth/me', { cookie: state.userCookie });
    assert.equal(stillUser.body.user.role, 'user');

    // Even a legitimately granted admin cannot promote themselves to owner.
    const makeAdmin = await api(`/api/admin/users/${regular.id}`, {
      method: 'PATCH',
      cookie: state.ownerCookie,
      body: { role: 'admin' },
    });
    assert.equal(makeAdmin.status, 200);
    assert.equal(makeAdmin.body.user.role, 'admin');

    const selfPromote = await api(`/api/admin/users/${regular.id}`, {
      method: 'PATCH',
      cookie: state.userCookie,
      body: { role: 'owner' },
    });
    assert.equal(selfPromote.status, 400);
    assert.equal(selfPromote.body.error, 'SELF_EDIT');

    // Restore the regular role so later assertions describe an ordinary user.
    await api(`/api/admin/users/${regular.id}`, {
      method: 'PATCH',
      cookie: state.ownerCookie,
      body: { role: 'user' },
    });
  });

  await t.test('admin overview aggregates platform stats', async () => {
    const res = await api('/api/admin/overview', { cookie: state.ownerCookie });
    assert.equal(res.status, 200);
    assert.ok(res.body.stats.users >= 2);
    assert.ok(res.body.providers.tools.text_video);
    assert.equal(res.body.providers.tools.text_video.connected, false);
  });

  await t.test('owner cannot be edited or granted a subscription', async () => {
    const users = await api('/api/admin/users?q=owner@aivideo.studio', { cookie: state.ownerCookie });
    assert.equal(users.status, 200);
    const owner = users.body.users.find((user) => user.role === 'owner');
    assert.ok(owner);

    const patch = await api(`/api/admin/users/${owner.id}`, {
      method: 'PATCH',
      cookie: state.ownerCookie,
      body: { role: 'user' },
    });
    assert.equal(patch.status, 403);
    assert.equal(patch.body.error, 'OWNER_IMMUTABLE');

    const sub = await api(`/api/admin/users/${owner.id}/subscription`, {
      method: 'POST',
      cookie: state.ownerCookie,
      body: { planCode: 'pro', months: 1 },
    });
    assert.equal(sub.status, 400);
    assert.equal(sub.body.error, 'OWNER_UNLIMITED');
  });
});

test('granting a subscription unlocks generation within plan limits', async (t) => {
  await t.test('admin grants the starter plan', async () => {
    const res = await api(`/api/admin/users/${state.userId}/subscription`, {
      method: 'POST',
      cookie: state.ownerCookie,
      body: { planCode: 'starter', months: 1, paymentRef: 'TEST-0001' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.subscription.planCode, 'starter');
    assert.equal(res.body.entitlements.hasAccess, true);
  });

  await t.test('subscribed user generates and the project is stored', async () => {
    const res = await api('/api/projects', {
      method: 'POST',
      cookie: state.userCookie,
      body: { tool: 'voice', prompt: 'تعليق صوتي عربي دافئ لفقرة تعريفية عن الشركة' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.project.tool, 'voice');
    assert.equal(res.body.project.status, 'pending_provider');
    assert.equal(res.body.providerConnected, false);

    const list = await api('/api/projects', { cookie: state.userCookie });
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 1);
    assert.equal(list.body.projects[0].tool, 'voice');

    const detail = await api(`/api/projects/${res.body.project.id}`, { cookie: state.userCookie });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.project.id, res.body.project.id);
  });

  await t.test('usage endpoint reflects the month', async () => {
    const res = await api('/api/usage', { cookie: state.userCookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.usage.voice, 1);
    assert.equal(res.body.entitlements.limits.voice, 20);
  });

  await t.test('admin can override per-tool limits and the quota is enforced', async () => {
    const patch = await api(`/api/admin/users/${state.userId}`, {
      method: 'PATCH',
      cookie: state.ownerCookie,
      body: { customLimits: { text_video: 1, image_video: 1, voice: 1, cartoon: 1 } },
    });
    assert.equal(patch.status, 200);
    assert.equal(patch.body.entitlements.limits.text_video, 1);

    const first = await api('/api/projects', {
      method: 'POST',
      cookie: state.userCookie,
      body: { tool: 'text_video', prompt: 'مقدمة برنامج وثائقي عن الصحراء العربية' },
    });
    assert.equal(first.status, 201);

    const second = await api('/api/projects', {
      method: 'POST',
      cookie: state.userCookie,
      body: { tool: 'text_video', prompt: 'مقدمة برنامج وثائقي عن البحر الأحمر' },
    });
    assert.equal(second.status, 429);
    assert.equal(second.body.error, 'QUOTA_EXCEEDED');
  });

  await t.test('users cannot read another user\'s project', async () => {
    const other = await api('/api/auth/register', {
      method: 'POST',
      body: { name: 'خالد', email: 'khaled@test.dev', password: 'Str0ngPass!23' },
    });
    assert.equal(other.status, 201);
    state.user2Cookie = other.cookie;

    const list = await api('/api/projects', { cookie: state.userCookie });
    const projectId = list.body.projects[0].id;
    const forbidden = await api(`/api/projects/${projectId}`, { cookie: state.user2Cookie });
    assert.equal(forbidden.status, 403);
  });

  await t.test('suspending a user revokes their sessions and blocks login', async () => {
    const suspend = await api(`/api/admin/users/${state.userId}`, {
      method: 'PATCH',
      cookie: state.ownerCookie,
      body: { status: 'suspended' },
    });
    assert.equal(suspend.status, 200);

    const afterSuspend = await api('/api/dashboard', { cookie: state.userCookie });
    assert.equal(afterSuspend.status, 401);

    const login = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'sara@test.dev', password: 'Str0ngPass!23' },
    });
    assert.equal(login.status, 403);
    assert.equal(login.body.error, 'ACCOUNT_SUSPENDED');
  });

  await t.test('revoking the subscription blocks generation again', async () => {
    await api(`/api/admin/users/${state.userId}`, {
      method: 'PATCH',
      cookie: state.ownerCookie,
      body: { status: 'active' },
    });
    const relogin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'sara@test.dev', password: 'Str0ngPass!23' },
    });
    assert.equal(relogin.status, 200);
    state.userCookie = relogin.cookie;

    const revoke = await api(`/api/admin/users/${state.userId}/subscription`, {
      method: 'DELETE',
      cookie: state.ownerCookie,
    });
    assert.equal(revoke.status, 200);

    const res = await api('/api/projects', {
      method: 'POST',
      cookie: state.userCookie,
      body: { tool: 'cartoon', prompt: 'شخصية كرتونية عربية لطيفة ترتدي ثوبًا تقليديًا' },
    });
    assert.equal(res.status, 402);
  });

  await t.test('logout invalidates the session', async () => {
    const res = await api('/api/auth/logout', { method: 'POST', cookie: state.ownerCookie });
    assert.equal(res.status, 200);
    const me = await api('/api/auth/me', { cookie: state.ownerCookie });
    assert.equal(me.status, 401);
  });
});

test('owner identity comes from server env, never from a registrant password', async (t) => {
  await t.test('re-provisioning an already registered address resets its password and sessions', async () => {
    const previousEmail = process.env.OWNER_EMAIL;
    const previousPassword = process.env.OWNER_PASSWORD;
    process.env.OWNER_EMAIL = 'Sara@Test.dev';
    process.env.OWNER_PASSWORD = 'Rotated-Owner-Pass!2026';

    // Boot a second instance over the same database: this simulates pointing
    // OWNER_EMAIL at an address that a regular user registered earlier.
    const app2 = createApp({ dbFile });
    const server2 = app2.listen(0);
    await new Promise((resolve) => server2.once('listening', resolve));
    const base2 = `http://127.0.0.1:${server2.address().port}`;
    const call2 = async (pathname, { method = 'GET', body } = {}) => {
      const headers = {};
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (method !== 'GET') headers['x-requested-with'] = 'ai-video-studio';
      const res = await fetch(`${base2}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    };

    try {
      // The password the registrant chose for themselves no longer opens the account.
      const oldPassword = await call2('/api/auth/login', {
        method: 'POST',
        body: { email: 'sara@test.dev', password: 'Str0ngPass!23' },
      });
      assert.equal(oldPassword.status, 401);
      assert.equal(oldPassword.body.error, 'INVALID_CREDENTIALS');

      // Only the env secret does, and it carries owner rights plus unlimited access.
      const envPassword = await call2('/api/auth/login', {
        method: 'POST',
        body: { email: 'sara@test.dev', password: 'Rotated-Owner-Pass!2026' },
      });
      assert.equal(envPassword.status, 200);
      assert.equal(envPassword.body.user.role, 'owner');
      assert.equal(envPassword.body.entitlements.unlimited, true);
      assert.equal(envPassword.body.entitlements.hasAccess, true);

      // Any session held before elevation is revoked.
      const stale = await api('/api/dashboard', { cookie: state.userCookie });
      assert.equal(stale.status, 401);

      // The address still cannot be claimed through public registration.
      const reclaim = await call2('/api/auth/register', {
        method: 'POST',
        body: { name: 'مزاحم', email: 'sara@test.dev', password: 'Str0ngPass!23' },
      });
      assert.equal(reclaim.status, 409);
      assert.equal(reclaim.body.error, 'EMAIL_TAKEN');
    } finally {
      server2.close();
      process.env.OWNER_EMAIL = previousEmail;
      process.env.OWNER_PASSWORD = previousPassword;
    }
  });
});


test('client content publishing workspace is isolated and subscription-gated', async (t) => {
  const ownerLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'owner@aivideo.studio', password: 'Owner-Test-Passw0rd!' },
  });
  assert.equal(ownerLogin.status, 200);
  state.ownerCookie = ownerLogin.cookie;

  await t.test('authenticated users can view ideas but cannot create a workspace without the separate subscription', async () => {
    const view = await api('/api/client-content', { cookie: state.user2Cookie });
    assert.equal(view.status, 200);
    assert.equal(view.body.serviceAccess, false);
    assert.ok(view.body.ideas.length >= 5);
    const create = await api('/api/client-content/projects', {
      method: 'POST',
      cookie: state.user2Cookie,
      body: { title: 'سلسلة تجريبية', creationMode: 'custom', brief: 'قصة تجريبية طويلة للاختبار', language: 'ar' },
    });
    assert.equal(create.status, 402);
    assert.equal(create.body.error, 'CLIENT_CONTENT_SUBSCRIPTION_REQUIRED');
  });

  await t.test('only the owner can activate a manually verified content subscription', async () => {
    const me = await api('/api/auth/me', { cookie: state.user2Cookie });
    const denied = await api('/api/admin/client-content/subscriptions/' + me.body.user.id, {
      method: 'POST',
      cookie: state.user2Cookie,
      body: { planCode: 'manual-test', months: 1, paymentRef: 'TEST-PAYMENT-001' },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, 'FORBIDDEN');

    const unverified = await api('/api/admin/client-content/subscriptions/' + me.body.user.id, {
      method: 'POST',
      cookie: state.ownerCookie,
      body: { planCode: 'manual-test', months: 1, paymentRef: 'TEST-PAYMENT-UNVERIFIED' },
    });
    assert.equal(unverified.status, 400);
    assert.equal(unverified.body.error, 'VERIFICATION_REQUIRED');

    const activated = await api('/api/admin/client-content/subscriptions/' + me.body.user.id, {
      method: 'POST',
      cookie: state.ownerCookie,
      body: { planCode: 'manual-test', months: 1, paymentRef: 'TEST-PAYMENT-001', paymentVerified: true, verificationNote: 'تم التحقق من كشف الدفع يدوياً' },
    });
    assert.equal(activated.status, 201);
    const access = await api('/api/client-content', { cookie: state.user2Cookie });
    assert.equal(access.body.serviceAccess, true);
  });

  await t.test('owner can create a private project and its episode', async () => {
    const create = await api('/api/client-content/projects', {
      method: 'POST',
      cookie: state.ownerCookie,
      body: { title: 'حكايات الصحراء', creationMode: 'custom', brief: 'سلسلة قصصية عن الصحراء وشخصياتها', language: 'ar', dialect: 'ليبية', musicChoice: 'none' },
    });
    assert.equal(create.status, 201);
    assert.equal(create.body.project.title, 'حكايات الصحراء');
    const projectId = create.body.project.id;
    const episode = await api('/api/client-content/projects/' + projectId + '/episodes', {
      method: 'POST',
      cookie: state.ownerCookie,
      body: { episodeNumber: 1, title: 'البداية' },
    });
    assert.equal(episode.status, 201);
    const detail = await api('/api/client-content/projects/' + projectId, { cookie: state.ownerCookie });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.episodes.length, 1);
    assert.equal(detail.body.contentPlanDays.length, 60);
    assert.equal(detail.body.contentPlanDays[0].day_number, 1);
    assert.equal(detail.body.contentPlanDays[59].day_number, 60);
  });

  await t.test('one customer cannot read another customer content project', async () => {
    const list = await api('/api/client-content', { cookie: state.ownerCookie });
    const projectId = list.body.projects[0].id;
    const denied = await api('/api/client-content/projects/' + projectId, { cookie: state.user2Cookie });
    assert.equal(denied.status, 404);
  });

  await t.test('approval records are stored without triggering external publishing', async () => {
    const list = await api('/api/client-content', { cookie: state.ownerCookie });
    const projectId = list.body.projects[0].id;
    const detail = await api('/api/client-content/projects/' + projectId, { cookie: state.ownerCookie });
    const episodeId = detail.body.episodes[0].id;
    const approval = await api('/api/client-content/projects/' + projectId + '/approvals', {
      method: 'POST',
      cookie: state.ownerCookie,
      body: { episodeId, approvalType: 'script', decision: 'approved', scope: { revision: 1 } },
    });
    assert.equal(approval.status, 201);
    assert.match(approval.body.messageAr, /لا ينفذ/);
  });
});
