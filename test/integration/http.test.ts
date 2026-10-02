import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { AiUnavailableError, UsageLimitError } from '../../src/domain/errors.ts';
import { buildApp } from '../../src/http/app.ts';
import { buildTestContainer, identity, sampleRecipe, TINY_JPEG_DATA_URL } from '../fakes/fixtures.ts';

let ctx: ReturnType<typeof buildTestContainer>;
let app: FastifyInstance;

beforeEach(async () => {
  ctx = buildTestContainer(Date.now);
  app = await buildApp(ctx.container);
});

const cookieFrom = (response: LightMyRequestResponse, name: string) =>
  response.cookies.find((cookie) => cookie.name === name)?.value;

/** Runs "Continue with ChatGPT" end to end and returns the session cookie. */
async function signIn(subject = 'user-a', via: 'loopback' | 'paste' = 'loopback'): Promise<string> {
  ctx.openai.nextIdentity = identity(subject);
  const start = await app.inject({ method: 'GET', url: '/auth/chatgpt/start' });
  assert.equal(start.statusCode, 302);
  const signInCookie = cookieFrom(start, 'ps_signin')!;
  const query = ctx.openai.callbackParams().toString();

  const done =
    via === 'loopback'
      ? await app.inject({ method: 'GET', url: `/auth/callback?${query}`, cookies: { ps_signin: signInCookie } })
      : await app.inject({
          method: 'POST',
          url: '/api/auth/complete',
          cookies: { ps_signin: signInCookie },
          payload: { callbackUrl: `http://127.0.0.1:3210/auth/callback?${query}` },
        });
  assert.ok(done.statusCode === 302 || done.statusCode === 200, done.body);
  return cookieFrom(done, 'ps_session')!;
}

function api(session: string | undefined) {
  return async (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
    const response = await app.inject({
      method,
      url,
      cookies: session ? { ps_session: session } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : undefined };
  };
}

type Call = ReturnType<typeof api>;

/** Polls a background job until it finishes. */
async function finished(call: Call, jobId: number) {
  for (let i = 0; i < 50; i++) {
    const { body } = await call('GET', `/api/jobs/${jobId}`);
    if (body.job.status !== 'running') return body.job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('job did not finish');
}

describe('authentication', () => {
  it('requires a session for the API', async () => {
    const response = await api(undefined)('GET', '/api/ingredients');
    assert.equal(response.status, 401);
    assert.equal(response.body.code, 'auth-required');
    assert.equal((await api('forged')('GET', '/api/account')).status, 401);
  });

  it('redirects to OpenAI and sets a short-lived, HttpOnly binding cookie', async () => {
    const start = await app.inject({ method: 'GET', url: '/auth/chatgpt/start' });
    assert.match(start.headers.location as string, /^https:\/\/auth\.example\/authorize\?state=/);
    const cookie = start.cookies.find((c) => c.name === 'ps_signin')!;
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, 'Lax');
    assert.equal(cookie.maxAge, 600);
  });

  it('signs in through the loopback callback and remembers the registration', async () => {
    const session = await signIn();
    const me = await api(session)('GET', '/api/account');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, 'user-a@example.com');
    assert.equal(me.body.planUsageEnabled, true);
    assert.equal(me.body.showPlanWelcome, true);
    assert.equal(me.body.manageUsageUrl, 'https://chatgpt.com/settings/usage');

    await api(session)('POST', '/api/account/plan-welcome/dismiss');
    assert.equal((await api(session)('GET', '/api/account')).body.showPlanWelcome, false);
  });

  it('signs in by pasting the callback address (phones and other devices)', async () => {
    const session = await signIn('user-a', 'paste');
    assert.equal((await api(session)('GET', '/api/account')).status, 200);
  });

  it('shows a readable page when the callback fails', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/callback?state=unknown&code=x' });
    assert.equal(response.statusCode, 400);
    assert.match(response.body, /Sign-in didn’t finish/);
    assert.match(response.body, /expired or was already used/);
  });

  it('accepts the first attempt’s address after the user tapped Continue twice', async () => {
    const first = await app.inject({ method: 'GET', url: '/auth/chatgpt/start' });
    const cookie = cookieFrom(first, 'ps_signin')!;
    const firstQuery = ctx.openai.callbackParams().toString();
    const second = await app.inject({ method: 'GET', url: '/auth/chatgpt/start', cookies: { ps_signin: cookie } });
    assert.equal(cookieFrom(second, 'ps_signin'), cookie);
    const done = await app.inject({
      method: 'POST',
      url: '/api/auth/complete',
      cookies: { ps_signin: cookie },
      payload: { callbackUrl: `http://127.0.0.1:3210/auth/callback?${firstQuery}` },
    });
    assert.equal(done.statusCode, 200, done.body);
  });

  it('rejects a pasted address without the starting browser’s cookie', async () => {
    await app.inject({ method: 'GET', url: '/auth/chatgpt/start' });
    const response = await api(undefined)('POST', '/api/auth/complete', {
      callbackUrl: `http://127.0.0.1:3210/auth/callback?${ctx.openai.callbackParams()}`,
    });
    assert.equal(response.status, 401);
  });

  it('signs out', async () => {
    const session = await signIn();
    const out = await api(session)('POST', '/api/auth/sign-out');
    assert.deepEqual(out.body, { ok: true, revoked: true });
    assert.equal((await api(session)('GET', '/api/account')).status, 401);
  });
});

describe('hardening', () => {
  it('sends strict security headers and never caches API answers', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/config' });
    assert.match(response.headers['content-security-policy'] as string, /default-src 'self'.*frame-ancestors 'none'/);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['x-frame-options'], 'DENY');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
    assert.equal(response.headers['cache-control'], 'no-store');
  });

  it('refuses state-changing requests from other sites', async () => {
    const session = await signIn();
    const cross = await app.inject({
      method: 'POST', url: '/api/ingredients', cookies: { ps_session: session },
      headers: { origin: 'https://evil.example', host: 'pantry.example.com' }, payload: { name: 'x' },
    });
    assert.equal(cross.statusCode, 403);
    const same = await app.inject({
      method: 'POST', url: '/api/ingredients', cookies: { ps_session: session },
      headers: { origin: 'https://pantry.example.com', host: 'pantry.example.com' }, payload: { name: 'x' },
    });
    assert.equal(same.statusCode, 201);
  });

  it('rate-limits sign-in endpoints', async () => {
    const limited = await buildApp(ctx.container, { rateLimitPerMinute: 25 });
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await limited.inject({ method: 'GET', url: '/auth/chatgpt/start' })).statusCode);
    assert.deepEqual(statuses.slice(0, 5), [302, 302, 302, 302, 302]);
    assert.equal(statuses[6], 429);
  });

  it('lets users delete their account', async () => {
    const session = await signIn();
    assert.equal((await api(session)('DELETE', '/api/account')).status, 204);
    assert.equal((await api(session)('GET', '/api/account')).status, 401);
  });
});

describe('sign-in mode', () => {
  it('tells the front-end which sign-in flow is active', async () => {
    assert.deepEqual((await api(undefined)('GET', '/api/auth/config')).body, { mode: 'local' });
  });

  it('with a registered client, requires the browser cookie even for local (tunnel) requests', async () => {
    const registered = buildTestContainer(Date.now, { registeredClientId: 'oaiapp_site' });
    const site = await buildApp(registered.container);
    assert.deepEqual(JSON.parse((await site.inject({ method: 'GET', url: '/api/auth/config' })).body), { mode: 'registered' });

    await site.inject({ method: 'GET', url: '/auth/chatgpt/start' });
    const query = registered.openai.callbackParams().toString();
    const noCookie = await site.inject({ method: 'GET', url: `/auth/callback?${query}`, remoteAddress: '127.0.0.1' });
    assert.equal(noCookie.statusCode, 400);
  });
});

describe('phone sign-in by QR code', () => {
  it('makes a QR link with the address the computer is using, and the phone can use it once', async () => {
    const computer = await signIn();
    const created = await app.inject({
      method: 'POST',
      url: '/api/account/device-links',
      cookies: { ps_session: computer },
      headers: { host: '192.168.1.20:3210' },
    });
    const { url, qrDataUrl } = JSON.parse(created.body);
    assert.match(url, /^http:\/\/192\.168\.1\.20:3210\/#link=[\w-]{40,}$/);
    assert.match(qrDataUrl, /^data:image\/svg\+xml;base64,/);

    const token = url.split('#link=')[1];
    const phone = await app.inject({ method: 'POST', url: '/api/auth/device-link', payload: { token } });
    assert.equal(phone.statusCode, 200);
    const phoneSession = cookieFrom(phone, 'ps_session')!;
    assert.equal((await api(phoneSession)('GET', '/api/account')).body.user.email, 'user-a@example.com');

    const reused = await app.inject({ method: 'POST', url: '/api/auth/device-link', payload: { token } });
    assert.equal(reused.statusCode, 401);
  });

  it('needs a signed-in computer to create links', async () => {
    assert.equal((await api(undefined)('POST', '/api/account/device-links')).status, 401);
  });
});

describe('account', () => {
  it('lists models and validates the chosen one', async () => {
    const call = api(await signIn());
    assert.deepEqual((await call('GET', '/api/account/models')).body.models.map((m: { slug: string }) => m.slug), ['gpt-fast', 'gpt-smart']);
    assert.equal((await call('PUT', '/api/account/model', { model: 'gpt-smart' })).body.user.model, 'gpt-smart');
    assert.equal((await call('PUT', '/api/account/model', { model: 'gpt-nope' })).status, 400);
  });
});

describe('ingredients API', () => {
  it('supports the full CRUD cycle', async () => {
    const call = api(await signIn());
    const created = await call('POST', '/api/ingredients', { name: 'Natas', category: 'dairy' });
    assert.equal(created.status, 201);
    const id = created.body.ingredient.id;

    const listed = await call('GET', '/api/ingredients');
    assert.deepEqual(listed.body.ingredients.map((i: { name: string }) => i.name), ['Natas']);
    assert.ok(listed.body.categories.includes('dairy'));

    const patched = await call('PATCH', `/api/ingredients/${id}`, { notes: 'half left' });
    assert.equal(patched.body.ingredient.notes, 'half left');
    const ranOut = await call('PATCH', `/api/ingredients/${id}`, { inStock: false });
    assert.equal(ranOut.body.ingredient.inStock, false);
    const readded = await call('POST', '/api/ingredients', { name: 'natas' });
    assert.equal(readded.status, 200);
    assert.equal(readded.body.status, 'restocked');

    assert.equal((await call('DELETE', `/api/ingredients/${id}`)).status, 204);
    assert.equal((await call('DELETE', `/api/ingredients/${id}`)).status, 404);
  });

  it('keeps users’ pantries separate', async () => {
    const alice = api(await signIn('alice'));
    const bob = api(await signIn('bob'));
    const { body } = await alice('POST', '/api/ingredients', { name: 'Natas' });

    assert.deepEqual((await bob('GET', '/api/ingredients')).body.ingredients, []);
    assert.equal((await bob('PATCH', `/api/ingredients/${body.ingredient.id}`, { notes: 'mine now' })).status, 404);
    assert.equal((await bob('DELETE', `/api/ingredients/${body.ingredient.id}`)).status, 404);
    assert.equal((await bob('POST', '/api/ingredients', { name: 'Natas' })).status, 201);
  });

  it('maps domain errors to HTTP statuses', async () => {
    const call = api(await signIn());
    await call('POST', '/api/ingredients', { name: 'Natas' });
    assert.equal((await call('POST', '/api/ingredients', { name: 'natas' })).status, 409);
    const bad = await call('POST', '/api/ingredients', { name: '' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'validation');
    assert.equal((await call('PATCH', '/api/ingredients/abc', { name: 'x' })).status, 400);
    assert.equal((await call('POST', '/api/ingredients', [1, 2])).status, 400);
  });
});

describe('scan API', () => {
  it('scans in the background and keeps the result for later visits', async () => {
    const call = api(await signIn());
    ctx.detector.answer = [{ name: 'Manga', category: 'fruit' }];
    const started = await call('POST', '/api/scan', { images: [TINY_JPEG_DATA_URL] });
    assert.equal(started.status, 202);
    assert.equal(started.body.job.status, 'running');
    assert.deepEqual(started.body.job.request, { photos: 1 });

    const job = await finished(call, started.body.job.id);
    assert.equal(job.status, 'succeeded');
    assert.deepEqual(job.result.added.map((i: { name: string }) => i.name), ['Manga']);
    assert.deepEqual((await call('GET', '/api/jobs?kind=scan&limit=1')).body.jobs.map((j: { id: number }) => j.id), [job.id]);
  });

  it('rejects bad images up front and records AI problems with a code', async () => {
    const call = api(await signIn());
    assert.equal((await call('POST', '/api/scan', { images: ['nope'] })).status, 400);

    ctx.detector.answer = new UsageLimitError('limit');
    const started = await call('POST', '/api/scan', { images: [TINY_JPEG_DATA_URL] });
    const job = await finished(call, started.body.job.id);
    assert.deepEqual([job.status, job.error.code], ['failed', 'usage-limit']);

    ctx.detector.answer = new AiUnavailableError('ChatGPT failed');
    const outage = await finished(call, (await call('POST', '/api/scan', { images: [TINY_JPEG_DATA_URL] })).body.job.id);
    assert.deepEqual(outage.error, { message: 'ChatGPT failed', code: 'ai-unavailable' });
  });

  it('limits how many jobs run at once and hides other users’ jobs', async () => {
    const call = api(await signIn('alice'));
    ctx.detector.detect = () => new Promise(() => {});
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await call('POST', '/api/scan', { images: [TINY_JPEG_DATA_URL] })).body.job.id);
    assert.equal((await call('POST', '/api/scan', { images: [TINY_JPEG_DATA_URL] })).status, 409);

    const bob = api(await signIn('bob'));
    assert.equal((await bob('GET', `/api/jobs/${ids[0]}`)).status, 404);
    assert.deepEqual((await bob('GET', '/api/jobs')).body.jobs, []);
  });
});

describe('recipes API', () => {
  it('suggests in the background, saves and deletes recipes', async () => {
    const call = api(await signIn());
    assert.equal((await call('POST', '/api/recipes/suggestions', { count: 1 })).status, 400, 'empty stock is reported at once');
    await call('POST', '/api/ingredients', { name: 'Natas' });
    const started = await call('POST', '/api/recipes/suggestions', { count: 1 });
    assert.equal(started.status, 202);
    assert.equal(started.body.job.request.count, 1);
    const job = await finished(call, started.body.job.id);
    assert.equal(job.result.recipes[0].title, sampleRecipe().title);

    const saved = await call('POST', '/api/recipes/saved', { recipe: sampleRecipe() });
    assert.equal(saved.status, 201);
    assert.equal((await call('GET', '/api/recipes/saved')).body.recipes.length, 1);
    assert.equal((await call('DELETE', `/api/recipes/saved/${saved.body.saved.id}`)).status, 204);
  });
});

describe('profile API', () => {
  it('reads, updates and resets the kitchen profile', async () => {
    const call = api(await signIn());
    assert.equal((await call('GET', '/api/profile')).body.profile.appliances.length, 5);
    const updated = await call('PUT', '/api/profile', { appliances: [{ name: 'Air fryer', details: '4 L basket' }] });
    assert.deepEqual(updated.body.profile.appliances, [{ name: 'Air fryer', details: '4 L basket' }]);
    assert.equal((await call('PUT', '/api/profile', { servings: 0 })).status, 400);
    assert.equal((await call('POST', '/api/profile/reset')).body.profile.appliances.length, 5);
  });
});

describe('static files', () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'pantry-public-'));
    writeFileSync(join(dir, 'index.html'), '<h1>hi</h1>');
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('serves the front-end without a session', async () => {
    const withStatic = await buildApp(ctx.container, { publicDir: dir });
    const response = await withStatic.inject({ method: 'GET', url: '/' });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /hi/);
  });
});
