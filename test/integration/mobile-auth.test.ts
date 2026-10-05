import assert from 'node:assert/strict';
import { beforeEach, afterEach, describe, it } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { randomToken, sha256 } from '../../src/application/crypto.ts';
import { MobileSignIns } from '../../src/application/mobile-sign-ins.ts';
import { buildApp } from '../../src/http/app.ts';
import { buildTestContainer, identity } from '../fakes/fixtures.ts';
import { AuthRequiredError } from '../../src/domain/errors.ts';

let ctx: ReturnType<typeof buildTestContainer>;
let app: FastifyInstance;
const cookie = (r: LightMyRequestResponse, name: string) => r.cookies.find(c => c.name === name)?.value;

beforeEach(async () => {
  ctx = buildTestContainer(Date.now, { registeredClientId: 'oaiapp_test' });
  app = await buildApp(ctx.container);
});
afterEach(async () => { await app.close(); ctx.db.close(); });

async function mobileStart(provider = 'chatgpt', session?: string) {
  const verifier = randomToken();
  const start = await app.inject({ method: 'POST', url: '/api/auth/mobile/start',
    cookies: session ? { ps_session: session } : {}, payload: { challenge: sha256(verifier), provider } });
  assert.equal(start.statusCode, 200, start.body);
  const { flow, browserPath } = start.json();
  const browser = await app.inject({ url: browserPath });
  assert.equal(browser.statusCode, 302, browser.body);
  assert.equal(cookie(browser, 'ps_mobile'), flow);
  return { flow, verifier };
}

async function finishOAuth(flow: string, provider: 'chatgpt' | 'google' = 'chatgpt', browserSession?: string) {
  const started = await app.inject({ url: `/auth/${provider}/start`, cookies: { ps_mobile: flow, ...(browserSession ? { ps_session: browserSession } : {}) } });
  assert.equal(started.statusCode, 302, started.body);
  const params = provider === 'google' ? ctx.google.callbackParams() : ctx.openai.callbackParams();
  const done = await app.inject({ url: `/auth/${provider === 'google' ? 'google/callback' : 'callback'}?${params}`,
    cookies: { ps_signin: cookie(started, 'ps_signin')!, ps_mobile: flow } });
  assert.equal(done.statusCode, 302, done.body);
  assert.equal(done.headers.location, '/auth/mobile/finish');
  return cookie(done, 'ps_session')!;
}

async function approve(flow: string, session: string) {
  const result = await app.inject({ method: 'POST', url: '/api/auth/mobile/approve', cookies: { ps_mobile: flow, ps_session: session }, payload: {} });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(cookie(result, 'ps_mobile'), '');
  const url = new URL(result.json().url);
  assert.equal(url.origin, 'null');
  assert.equal(url.protocol, 'pantryscoop:');
  assert.equal(url.hostname, 'sign-in');
  return url.searchParams.get('code')!;
}

async function nativeGoogleStart(session?: string) {
  const verifier = randomToken();
  const start = await app.inject({ method: 'POST', url: '/api/auth/mobile/start',
    cookies: session ? { ps_session: session } : {}, payload: { challenge: sha256(verifier), provider: 'google' } });
  assert.equal(start.statusCode, 200, start.body);
  assert.equal(start.json().serverClientId, ctx.google.clientId);
  return { ...start.json(), verifier };
}

describe('native Google sign-in', () => {
  it('verifies the server nonce, establishes a session and reads the same pantry as the web account', async () => {
    const first = await mobileStart('google');
    const webSession = await finishOAuth(first.flow, 'google');
    const user = ctx.auth.userForSession(webSession)!;
    ctx.container.forUser(user.id).stock.addManual({ name: 'Milk' });
    const started = await nativeGoogleStart();
    const response = await app.inject({ method: 'POST', url: '/api/auth/mobile/google',
      payload: { flow: started.flow, verifier: started.verifier, idToken: 'native-token' } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(ctx.google.verifiedNonces.at(-1), started.nonce);
    const session = cookie(response, 'ps_session')!;
    assert.equal(ctx.auth.userForSession(session)?.id, user.id);
    const stock = await app.inject({ url: '/api/ingredients', cookies: { ps_session: session } });
    assert.match(stock.body, /Milk/);
    const replay = await app.inject({ method: 'POST', url: '/api/auth/mobile/google',
      payload: { flow: started.flow, verifier: started.verifier, idToken: 'native-token' } });
    assert.equal(replay.statusCode, 401);
  });

  it('rejects a stolen flow without the initiating app proof before verifying a token', async () => {
    const started = await nativeGoogleStart();
    const response = await app.inject({ method: 'POST', url: '/api/auth/mobile/google',
      payload: { flow: started.flow, verifier: randomToken(), idToken: 'native-token' } });
    assert.equal(response.statusCode, 401);
    assert.equal(ctx.google.verifiedNonces.length, 0);
    assert.equal(cookie(response, 'ps_session'), undefined);
  });

  it('refuses an unverified Google token and consumes the request once', async () => {
    const started = await nativeGoogleStart();
    let verifies = 0;
    ctx.google.verifyIdToken = async () => { verifies++; throw new AuthRequiredError('Invalid token'); };
    for (let i = 0; i < 2; i++) {
      const response = await app.inject({ method: 'POST', url: '/api/auth/mobile/google',
        payload: { flow: started.flow, verifier: started.verifier, idToken: 'forged-token' } });
      assert.equal(response.statusCode, 401);
      assert.equal(cookie(response, 'ps_session'), undefined);
    }
    assert.equal(verifies, 1);
  });

  it('links Google to the existing native account without starting a browser OAuth exchange', async () => {
    const first = await mobileStart();
    const session = await finishOAuth(first.flow);
    const started = await nativeGoogleStart(session);
    const result = await app.inject({ method: 'POST', url: '/api/auth/mobile/google',
      payload: { flow: started.flow, verifier: started.verifier, idToken: 'native-token' } });
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(ctx.auth.userForSession(cookie(result, 'ps_session'))?.id, ctx.auth.userForSession(session)?.id);
    assert.equal(ctx.google.authorizeCalls.length, 0);
    assert.equal(ctx.google.exchanges.length, 0);
  });

  it('does not accept a ChatGPT flow as Google sign-in', async () => {
    const started = await mobileStart();
    const result = await app.inject({ method: 'POST', url: '/api/auth/mobile/google',
      payload: { flow: started.flow, verifier: started.verifier, idToken: 'native-token' } });
    assert.equal(result.statusCode, 401);
  });
});

describe('Android browser sign-in handoff', () => {
  for (const provider of ['chatgpt', 'google'] as const) it(`signs in with ${provider} and shares the existing account data`, async () => {
    const { flow, verifier } = await mobileStart(provider);
    const session = await finishOAuth(flow, provider);
    const user = ctx.auth.userForSession(session)!;
    ctx.container.forUser(user.id).stock.addManual({ name: 'Milk' });
    const page = await app.inject({ url: '/auth/mobile/finish', cookies: { ps_mobile: flow, ps_session: session } });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /Continue in Android/);
    assert.equal(page.headers['cache-control'], 'no-store');
    const code = await approve(flow, session);
    const exchange = await app.inject({ method: 'POST', url: '/api/auth/mobile/exchange', payload: { flow, verifier, code } });
    assert.equal(exchange.statusCode, 200, exchange.body);
    const nativeSession = cookie(exchange, 'ps_session')!;
    assert.notEqual(nativeSession, session);
    assert.equal(ctx.auth.userForSession(nativeSession)?.id, user.id);
    const stock = await app.inject({ url: '/api/ingredients', cookies: { ps_session: nativeSession } });
    assert.match(stock.body, /Milk/);
    const replay = await app.inject({ method: 'POST', url: '/api/auth/mobile/exchange', payload: { flow, verifier, code } });
    assert.equal(replay.statusCode, 401);
  });

  it('rejects a stolen deep-link code without the app verifier', async () => {
    const { flow, verifier } = await mobileStart();
    const session = await finishOAuth(flow);
    const code = await approve(flow, session);
    const stolen = await app.inject({ method: 'POST', url: '/api/auth/mobile/exchange', payload: { flow, verifier: randomToken(), code } });
    assert.equal(stolen.statusCode, 401);
    assert.equal(cookie(stolen, 'ps_session'), undefined);
    const valid = await app.inject({ method: 'POST', url: '/api/auth/mobile/exchange', payload: { flow, verifier, code } });
    assert.equal(valid.statusCode, 200);
  });

  it('requires a signed-in browser and retains cross-site request protection', async () => {
    const { flow } = await mobileStart();
    const anonymous = await app.inject({ method: 'POST', url: '/api/auth/mobile/approve', cookies: { ps_mobile: flow }, payload: {} });
    assert.equal(anonymous.statusCode, 401);
    const session = await finishOAuth(flow);
    const crossSite = await app.inject({ method: 'POST', url: '/api/auth/mobile/approve', headers: { origin: 'https://attacker.example' }, cookies: { ps_mobile: flow, ps_session: session }, payload: {} });
    assert.equal(crossSite.statusCode, 403);
  });

  it('does not approve an existing browser session before the requested provider finishes', async () => {
    const first = await mobileStart();
    const session = await finishOAuth(first.flow);
    const second = await mobileStart();
    const premature = await app.inject({ method: 'POST', url: '/api/auth/mobile/approve', cookies: { ps_mobile: second.flow, ps_session: session }, payload: {} });
    assert.equal(premature.statusCode, 401);
    const page = await app.inject({ url: '/auth/mobile/finish', cookies: { ps_mobile: second.flow, ps_session: session } });
    assert.equal(page.headers.location, '/');
    const config = await app.inject({ url: '/api/auth/config', cookies: { ps_mobile: second.flow, ps_session: session } });
    assert.equal(config.json().mobileAuthenticated, false);
  });

  it('links Google to the Android account even when the system browser has another account', async () => {
    const first = await mobileStart();
    const androidOwner = await finishOAuth(first.flow);
    ctx.openai.nextIdentity = identity('someone-else');
    const second = await mobileStart();
    const browserOwner = await finishOAuth(second.flow);
    const linked = await mobileStart('google', androidOwner);
    const linkedSession = await finishOAuth(linked.flow, 'google', browserOwner);
    assert.equal(ctx.auth.userForSession(linkedSession)?.id, ctx.auth.userForSession(androidOwner)?.id);
    assert.notEqual(ctx.auth.userForSession(linkedSession)?.id, ctx.auth.userForSession(browserOwner)?.id);
  });

  it('routes loopback-only ChatGPT sign-in through the existing phone flow', async () => {
    await app.close(); ctx.db.close();
    ctx = buildTestContainer(Date.now);
    app = await buildApp(ctx.container);
    const { flow } = await mobileStart();
    const landing = await app.inject({ url: `/auth/mobile?flow=${flow}` });
    assert.equal(landing.headers.location, '/');
    const config = await app.inject({ url: '/api/auth/config', cookies: { ps_mobile: flow } });
    assert.equal(config.json().mobilePending, true);
    const started = await app.inject({ url: '/auth/chatgpt/start', cookies: { ps_mobile: flow } });
    const done = await app.inject({ method: 'POST', url: '/api/auth/complete', cookies: { ps_mobile: flow, ps_signin: cookie(started, 'ps_signin')! },
      payload: { callbackUrl: `http://127.0.0.1:3210/auth/callback?${ctx.openai.callbackParams()}` } });
    assert.equal(done.statusCode, 200, done.body);
    const code = await approve(flow, cookie(done, 'ps_session')!);
    assert.ok(code);
  });
});

describe('mobile transaction expiry and proof', () => {
  it('rejects expiry, unapproved exchanges and a different linking account', () => {
    let now = 1000;
    const store = new MobileSignIns(() => now);
    const verifier = randomToken();
    const flow = store.start(sha256(verifier), 'google', false, 1);
    assert.throws(() => store.exchange(flow.id, randomToken(), verifier), /does not belong/);
    assert.throws(() => store.authenticated(flow.id, 2, 'google'), /different account/);
    assert.throws(() => store.authenticated(flow.id, 1, 'chatgpt'), /requested sign-in provider/);
    now += 10 * 60 * 1000;
    assert.throws(() => store.get(flow.id), /expired/);
  });
});
