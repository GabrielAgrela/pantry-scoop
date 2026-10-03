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
    assert.equal(job.result.reviewRequired, true);
    assert.deepEqual((await call('GET', '/api/ingredients')).body.ingredients, [], 'detection does not commit stock');
    assert.deepEqual((await call('GET', '/api/jobs?kind=scan&limit=1')).body.jobs.map((j: { id: number }) => j.id), [job.id]);
  });

  it('confirms only selected ingredients, persists edits, and safely retries after stock changes', async () => {
    const call = api(await signIn());
    const eggs = (await call('POST', '/api/ingredients', { name: 'Eggs', category: 'eggs', notes: 'Bottom shelf' })).body.ingredient;
    await call('PATCH', `/api/ingredients/${eggs.id}`, { inStock: false });
    ctx.detector.answer = [{ name: 'Tomatoes', category: 'vegetables' }, { name: 'Spinach', category: 'vegetables' }, { name: 'Eggs', category: 'eggs' }];
    const started = await call('POST', '/api/scan', { images: [TINY_JPEG_DATA_URL] });
    const job = await finished(call, started.body.job.id);
    assert.equal((await call('GET', '/api/ingredients')).body.ingredients[0].inStock, false);
    const response = await call('POST', `/api/scan/${job.id}/confirm`, { ingredients: [
      { ...job.result.added[0], name: 'Cherry tomatoes', notes: 'Half a punnet' }, { ...job.result.restocked[0], notes: 'Top shelf' },
    ] });
    assert.equal(response.status, 200);
    assert.equal(response.body.job.result.reviewRequired, undefined);
    const stock = (await call('GET', '/api/ingredients')).body.ingredients;
    assert.equal(stock.length, 2, 'deselected spinach is never added');
    assert.ok(stock.some((i: { name: string; notes: string; source: string }) => i.name === 'Cherry tomatoes' && i.notes === 'Half a punnet' && i.source === 'photo'));
    const restocked = stock.find((i: { id: number }) => i.id === eggs.id);
    assert.equal(restocked.inStock, true);
    assert.equal(restocked.notes, 'Top shelf');
    await call('PATCH', `/api/ingredients/${eggs.id}`, { inStock: false });
    const again = await call('POST', `/api/scan/${job.id}/confirm`, { ingredients: job.result.restocked });
    assert.deepEqual(again.body, response.body);
    assert.equal((await call('GET', '/api/ingredients')).body.ingredients.find((i: { id: number }) => i.id === eggs.id).inStock, false, 'retry never applies a confirmation twice');
  });

  it('validates the complete review before writes and scopes confirmation to the scan owner', async () => {
    const call = api(await signIn('alice'));
    ctx.detector.answer = [{ name: 'Tomatoes', category: 'vegetables' }, { name: 'Eggs', category: 'eggs' }];
    const job = await finished(call, (await call('POST', '/api/scan', { images: [TINY_JPEG_DATA_URL] })).body.job.id);
    const bad = await call('POST', `/api/scan/${job.id}/confirm`, { ingredients: [job.result.added[0], { ...job.result.added[1], name: '' }] });
    assert.equal(bad.status, 400);
    assert.equal((await call('GET', '/api/ingredients')).body.ingredients.length, 0);
    assert.equal((await call('GET', `/api/jobs/${job.id}`)).body.job.result.reviewRequired, true);
    const forged = await call('POST', `/api/scan/${job.id}/confirm`, { ingredients: [{ candidateId: 999, name: 'Fake' }] });
    assert.equal(forged.status, 400);
    const repeated = await call('POST', `/api/scan/${job.id}/confirm`, { ingredients: [job.result.added[0], job.result.added[0]] });
    assert.equal(repeated.status, 400);
    const bob = api(await signIn('bob'));
    assert.equal((await bob('POST', `/api/scan/${job.id}/confirm`, { ingredients: job.result.added })).status, 404);
    assert.equal((await bob('POST', `/api/scan/${job.id}/photos`, { images: [TINY_JPEG_DATA_URL] })).status, 404);
    const done = await call('POST', `/api/scan/${job.id}/confirm`, { ingredients: [] });
    assert.equal(done.status, 200, 'zero selections finishes review without writing inventory');
    assert.equal((await call('GET', '/api/ingredients')).body.ingredients.length, 0);
  });

  it('rolls back stock when persisting a confirmation fails, then allows a safe retry', async () => {
    const call = api(await signIn());
    ctx.detector.answer = [{ name: 'Tomatoes', category: 'vegetables' }];
    const job = await finished(call, (await call('POST', '/api/scan', { images: [TINY_JPEG_DATA_URL] })).body.job.id);
    ctx.db.exec("CREATE TRIGGER abort_confirmation BEFORE UPDATE ON jobs BEGIN SELECT RAISE(ABORT, 'test persistence failure'); END");
    assert.equal((await call('POST', `/api/scan/${job.id}/confirm`, { ingredients: job.result.added })).status, 500);
    assert.deepEqual((await call('GET', '/api/ingredients')).body.ingredients, []);
    assert.equal((await call('GET', `/api/jobs/${job.id}`)).body.job.result.reviewRequired, true);
    ctx.db.exec('DROP TRIGGER abort_confirmation');
    assert.equal((await call('POST', `/api/scan/${job.id}/confirm`, { ingredients: job.result.added })).status, 200);
    assert.equal((await call('GET', '/api/ingredients')).body.ingredients.length, 1);
  });

  it('appends photos without losing earlier detections or duplicating candidates', async () => {
    const call = api(await signIn());
    ctx.detector.answer = [{ name: 'Tomatoes', category: 'vegetables' }];
    const first = await finished(call, (await call('POST', '/api/scan', { images: [TINY_JPEG_DATA_URL] })).body.job.id);
    ctx.detector.answer = [{ name: 'TOMATOES', category: 'vegetables' }, { name: 'Eggs', category: 'eggs' }];
    const appended = await call('POST', `/api/scan/${first.id}/photos`, { images: [TINY_JPEG_DATA_URL] });
    assert.equal(appended.status, 202);
    const second = await finished(call, appended.body.job.id);
    assert.equal(second.request.photos, 2);
    assert.deepEqual(second.result.added.map((i: { name: string }) => i.name), ['Tomatoes', 'Eggs']);
    assert.equal(new Set(second.result.added.map((i: { candidateId: number }) => i.candidateId)).size, 2);
    assert.deepEqual((await call('GET', '/api/ingredients')).body.ingredients, []);
    const tooMany = await call('POST', `/api/scan/${second.id}/photos`, { images: Array(5).fill(TINY_JPEG_DATA_URL) });
    assert.equal(tooMany.status, 400);
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
  it('updates saved and generated recipe requirements when pantry stock changes', async () => {
    const call = api(await signIn('alice'));
    const coconut = (await call('POST', '/api/ingredients', { name: 'Cóconut' })).body.ingredient;
    const recipe = sampleRecipe({ ingredients: [{ name: ' coconut ', amount: '200 g', inStock: true }, { name: 'Milk', amount: '100 ml', inStock: false }] });
    ctx.generator.answer = [recipe];
    const generated = await finished(call, (await call('POST', '/api/recipes/suggestions', { count: 1 })).body.job.id);
    const saved = (await call('POST', '/api/recipes/saved', { recipe })).body.saved;
    const readFlags = async (expected: boolean[]) => {
      const collection = (await call('GET', '/api/recipes/saved')).body.recipes.find((entry: { id: number }) => entry.id === saved.id).recipe;
      const job = (await call('GET', `/api/jobs/${generated.id}`)).body.job.result.recipes[0];
      const recent = (await call('GET', '/api/jobs?kind=recipes')).body.jobs[0].result.recipes[0];
      for (const current of [collection, job, recent]) assert.deepEqual(current.ingredients.map((i: { inStock: boolean }) => i.inStock), expected);
    };
    await readFlags([true, false]);
    await call('PATCH', `/api/ingredients/${coconut.id}`, { inStock: false });
    const bob = api(await signIn('bob')); await bob('POST', '/api/ingredients', { name: 'Coconut' });
    await readFlags([false, false]);
    await call('PATCH', `/api/ingredients/${coconut.id}`, { inStock: true });
    await call('POST', '/api/ingredients', { name: 'Milk' });
    await readFlags([true, true]);
    await call('DELETE', `/api/ingredients/${coconut.id}`);
    assert.equal((await call('GET', '/api/recipes/saved')).body.recipes[0].recipe.ingredients[0].inStock, false);
    assert.equal((await call('GET', `/api/jobs/${generated.id}`)).body.job.result.recipes[0].ingredients[0].inStock, false);
  });

  it('uses current stock when a recipe finishes or a stale recipe is saved', async () => {
    const call = api(await signIn());
    const coconut = (await call('POST', '/api/ingredients', { name: 'Coconut' })).body.ingredient;
    const recipe = sampleRecipe({ ingredients: [{ name: 'Coconut', amount: '200 g', inStock: true }] });
    let complete!: (recipes: typeof recipe[]) => void;
    ctx.generator.suggest = async () => new Promise((resolve) => { complete = resolve; });
    const started = await call('POST', '/api/recipes/suggestions', { count: 1 });
    await call('PATCH', `/api/ingredients/${coconut.id}`, { inStock: false });
    complete([recipe]);
    const job = await finished(call, started.body.job.id);
    assert.equal(job.result.recipes[0].ingredients[0].inStock, false);
    assert.equal((await call('POST', '/api/recipes/saved', { recipe })).body.saved.recipe.ingredients[0].inStock, false);
    assert.equal(recipe.ingredients[0]!.inStock, true, 'refreshing responses does not mutate recipe snapshots');
  });

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
