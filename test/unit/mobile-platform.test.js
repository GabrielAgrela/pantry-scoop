import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createNativeRequest } from '../../mobile/transport.js';
import { platform } from '../../public/js/platform.js';
import { createHandoffReceiver, PENDING_SIGN_IN, reloadSignedInApp, signInWithNativeGoogle } from '../../mobile/auth.js';
import { createHash } from 'node:crypto';

describe('shared browser and Android API transport', () => {
  it('keeps browser requests on the existing same-origin fetch path', async () => {
    const original = globalThis.fetch;
    let requested;
    globalThis.fetch = async (...args) => { requested = args; return { status: 204 }; };
    try {
      assert.equal(platform.native, false);
      const response = await platform.request('/api/profile', { method: 'PUT', body: '{}' });
      assert.equal(response.status, 204);
      assert.deepEqual(requested, ['/api/profile', { method: 'PUT', body: '{}' }]);
    } finally { globalThis.fetch = original; }
  });

  it('uses the configured backend for native requests and preserves API errors', async () => {
    let requested;
    const request = createNativeRequest('https://pantry.example', { request: async (options) => {
      requested = options;
      return { status: 401, data: { code: 'auth-required', error: 'Please sign in.' } };
    } });
    const response = await request('/api/ingredients', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"Milk"}' });
    assert.equal(requested.url, 'https://pantry.example/api/ingredients');
    assert.deepEqual(requested.data, { name: 'Milk' });
    assert.equal(requested.disableRedirects, true);
    assert.equal(requested.headers.Origin, 'https://pantry.example');
    assert.equal(response.ok, false);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'auth-required');
  });

  it('refuses external URLs so native session requests cannot be redirected to another service', async () => {
    const request = createNativeRequest('https://pantry.example', { request: async () => { assert.fail('HTTP must not run'); } });
    for (const url of ['https://attacker.example/api/account', '//attacker.example/api/account', '/auth/callback']) {
      await assert.rejects(request(url), /must use/);
    }
  });
});

describe('native sign-in completion', () => {
  it('activates a returned session once, including duplicate events and cold-start intent redelivery', async () => {
    const values = new Map([[PENDING_SIGN_IN, JSON.stringify({ flow: 'flow-1', verifier: 'proof-1', expiresAt: Date.now() + 10000 })]]);
    const preferences = {
      get: async ({ key }) => ({ value: values.get(key) }),
      set: async ({ key, value }) => { values.set(key, value); },
      remove: async ({ key }) => { values.delete(key); },
    };
    let exchanges = 0;
    let reloads = 0;
    const options = { preferences, request: async (path, init) => {
      exchanges++;
      assert.equal(path, '/api/auth/mobile/exchange');
      assert.deepEqual(JSON.parse(init.body), { flow: 'flow-1', verifier: 'proof-1', code: 'code-1' });
      return { ok: true, json: async () => ({ ok: true }) };
    }, finish: () => { reloads++; } };
    const receive = createHandoffReceiver(options);
    const callback = 'pantryscoop://sign-in?flow=flow-1&code=code-1';
    await Promise.all([receive(callback), receive(callback)]);
    // A reloaded WebView receives the Android launch intent again.
    await createHandoffReceiver(options)(callback);
    assert.equal(exchanges, 1);
    assert.equal(reloads, 1);
    assert.equal(values.has(PENDING_SIGN_IN), false);
    // Persist only the completed flow identifier, never the code or app verifier.
    assert.deepEqual([...values.values()], ['flow-1']);
  });

  it('reloads the app after a session is issued, even when stock is already the URL hash', () => {
    for (const initial of ['', '#stock']) {
      let reloads = 0;
      const location = { hash: initial, reload: () => { reloads++; } };
      reloadSignedInApp(location);
      assert.equal(reloads, 1);
      assert.equal(location.hash, 'stock');
    }
  });

  it('passes the server nonce to the native picker and exchanges its token before reloading', async () => {
    const calls = [];
    let challenge;
    let reloads = 0;
    const request = async (path, options) => {
      calls.push(path);
      const body = JSON.parse(options.body);
      if (path.endsWith('/start')) {
        assert.equal(body.provider, 'google');
        challenge = body.challenge;
        return { ok: true, json: async () => ({ flow: 'flow-1', serverClientId: 'web-client', nonce: 'nonce-1' }) };
      }
      assert.equal(body.flow, 'flow-1');
      assert.equal(body.idToken, 'google-token');
      assert.equal(createHash('sha256').update(body.verifier).digest('base64url'), challenge);
      assert.equal(reloads, 0);
      return { ok: true, json: async () => ({ ok: true }) };
    };
    const google = { signIn: async (options) => {
      assert.deepEqual(options, { serverClientId: 'web-client', nonce: 'nonce-1' });
      calls.push('native-picker');
      return { idToken: 'google-token' };
    } };
    await signInWithNativeGoogle({ request, google, finish: () => { reloads++; } });
    assert.deepEqual(calls, ['/api/auth/mobile/start', 'native-picker', '/api/auth/mobile/google']);
    assert.equal(reloads, 1);
  });

  it('does not reload or exchange credentials when the picker is cancelled', async () => {
    let requests = 0;
    await assert.rejects(signInWithNativeGoogle({
      request: async () => { requests++; return { ok: true, json: async () => ({}) }; },
      google: { signIn: async () => { throw new Error('cancelled'); } },
      finish: () => assert.fail('Do not reload a failed sign-in'),
    }), /cancelled/);
    assert.equal(requests, 1);
  });

  it('shows a refused token exchange without switching to the signed-in app', async () => {
    await assert.rejects(signInWithNativeGoogle({
      request: async (path) => path.endsWith('/start')
        ? { ok: true, json: async () => ({}) }
        : { ok: false, json: async () => ({ error: 'Wrong Google account' }) },
      google: { signIn: async () => ({ idToken: 'token' }) },
      finish: () => assert.fail('Do not reload a failed sign-in'),
    }), /Wrong Google account/);
  });
});
