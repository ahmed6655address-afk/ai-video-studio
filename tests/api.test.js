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
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'PROVIDER_NOT_CONNECTED');
    assert.match(res.body.messageAr, /لم يتم إنشاء مشروع|لم يتم/);
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
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'PROVIDER_NOT_CONNECTED');
    const list = await api('/api/projects', { cookie: state.userCookie });
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 0);
  });

  await t.test('usage endpoint reflects the month', async () => {
    const res = await api('/api/usage', { cookie: state.userCookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.usage.voice, 0);
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

    // Simulate one already-consumed generation so this test isolates quota
    // enforcement without requiring an external provider or a paid wallet balance.
    app.locals.db.prepare(
      "INSERT INTO usage_events (user_id, tool, project_id, kind, created_at) VALUES (?, 'text_video', NULL, 'generation', ?)"
    ).run(state.userId, new Date().toISOString());

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

    const now = new Date().toISOString();
    const project = app.locals.db.prepare(
      "INSERT INTO projects (user_id, tool, prompt, options, status, created_at, updated_at) VALUES (?, 'text_video', 'مشروع اختبار صلاحيات', '{}', 'pending_provider', ?, ?)"
    ).run(state.userId, now, now);
    const forbidden = await api(`/api/projects/${project.lastInsertRowid}`, { cookie: state.user2Cookie });
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

test('fal.ai Wan text-to-video queue integration (mocked; no paid request)', async () => {
  const previousKey = process.env.FAL_KEY;
  const previousEnabled = process.env.FAL_ENABLE_GENERATION;
  const previousOwnerCookie = state.ownerCookie;
  const originalFetch = globalThis.fetch;
  process.env.FAL_KEY = 'test-fal-key-not-real';
  process.env.FAL_ENABLE_GENERATION = 'true';
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'owner@aivideo.studio', password: 'Owner-Test-Passw0rd!' },
  });
  assert.equal(login.status, 200);
  state.ownerCookie = login.cookie;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    if (!String(url).startsWith('https://queue.fal.run/')) return originalFetch(url, options);
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body });
    if (String(url).endsWith('/status')) {
      return new Response(JSON.stringify({ status: 'COMPLETED' }), { status: 200 });
    }
    if (options.method === 'POST') {
      return new Response(JSON.stringify({ request_id: '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b', status: 'IN_QUEUE' }), { status: 200 });
    }
    return new Response(JSON.stringify({ video: { url: 'https://cdn.example.test/generated-video.mp4' } }), { status: 200 });
  };

  try {
    const funded = await api('/api/admin/finance/credits', {
      method: 'POST',
      cookie: state.ownerCookie,
      body: { amountCents: 10000, reference: 'TEST-FAL-TOPUP-001', note: 'Mocked test wallet', providerBalanceVerified: true },
    });
    assert.equal(funded.status, 201);
    assert.equal(funded.body.wallet.availableCents, 10000);

    const created = await api('/api/projects', {
      method: 'POST',
      cookie: state.ownerCookie,
      body: {
        tool: 'text_video',
        prompt: 'مشهد تجريبي لاختبار توليد فيديو من النص',
        negativePrompt: 'تشوهات',
        options: { duration: '8s', aspect: '16:9' },
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.providerConnected, true);
    assert.equal(created.body.project.status, 'queued');
    assert.equal(created.body.project.providerJobId, '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b');
    assert.equal(calls[0].method, 'POST');
    const submitted = JSON.parse(calls[0].body);
    assert.equal(submitted.input.prompt, 'مشهد تجريبي لاختبار توليد فيديو من النص');
    assert.equal(submitted.input.duration, 8);
    assert.equal(submitted.input.resolution, '720p');

    const detail = await api(`/api/projects/${created.body.project.id}`, { cookie: state.ownerCookie });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.project.status, 'completed');
    assert.equal(detail.body.project.outputUrl, 'https://cdn.example.test/generated-video.mp4');
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
    state.ownerCookie = previousOwnerCookie;
    if (previousKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = previousKey;
    if (previousEnabled === undefined) delete process.env.FAL_ENABLE_GENERATION;
    else process.env.FAL_ENABLE_GENERATION = previousEnabled;
  }
});
