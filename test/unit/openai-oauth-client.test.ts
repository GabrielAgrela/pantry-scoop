import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { AiUnavailableError, AuthRequiredError } from '../../src/domain/errors.ts';
import { OpenAiOAuthClient, SIGN_IN_SCOPES } from '../../src/infrastructure/openai/openai-oauth-client.ts';

type Call = { url: string; form: URLSearchParams };

function fakeFetch(respond: (call: Call) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const call = { url, form: new URLSearchParams(String(init?.body ?? '')) };
    calls.push(call);
    const { status, body } = respond(call);
    return new Response(body === undefined ? '' : JSON.stringify(body), { status });
  };
  return { fetch, calls };
}

let jwks: JWTVerifyGetKey;
let privateKey: CryptoKey;
before(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }] });
});

const idToken = (claims: Record<string, unknown> = {}, audience = 'oaiapp_1', issuer = 'https://auth.openai.com') =>
  new SignJWT({ email: 'a@example.com', name: 'A', nonce: 'n1', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setSubject('user-a')
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);

const tokenBody = { access_token: 'at', refresh_token: 'rt', id_token: 'it', expires_in: 3600, scope: 'openid chatgpt.tokens.use.direct' };

describe('OpenAiOAuthClient.authorizeUrl', () => {
  it('builds the open-source registration request', () => {
    const client = new OpenAiOAuthClient({ jwks: async () => { throw new Error('unused'); } });
    const url = new URL(
      client.authorizeUrl({
        clientId: 'dynamic_agent_client',
        redirectUri: 'http://127.0.0.1:3210/auth/callback',
        state: 's',
        nonce: 'n',
        codeChallenge: 'c',
        hostId: 'urn:uuid:x',
        agentNameHint: 'Pantry Scoop',
      }),
    );
    assert.equal(url.origin + url.pathname, 'https://auth.openai.com/api/accounts/authorize');
    const q = Object.fromEntries(url.searchParams);
    assert.deepEqual(q, {
      client_id: 'dynamic_agent_client',
      redirect_uri: 'http://127.0.0.1:3210/auth/callback',
      response_type: 'code',
      scope: SIGN_IN_SCOPES,
      resource: 'https://api.openai.com/v1',
      state: 's',
      nonce: 'n',
      code_challenge: 'c',
      code_challenge_method: 'S256',
      ext_agent_host_id: 'urn:uuid:x',
      agent_name_hint: 'Pantry Scoop',
    });
  });

  it('adds hints and consent for a returning account', () => {
    const client = new OpenAiOAuthClient({ jwks: async () => { throw new Error('unused'); } });
    const q = new URL(
      client.authorizeUrl({
        clientId: 'oaiapp_1', redirectUri: 'r', state: 's', nonce: 'n', codeChallenge: 'c', hostId: 'h',
        loginHint: 'a@example.com', idTokenHint: 'old-id', forceConsent: true,
      }),
    ).searchParams;
    assert.equal(q.get('login_hint'), 'a@example.com');
    assert.equal(q.get('id_token_hint'), 'old-id');
    assert.equal(q.get('prompt'), 'consent');
    assert.equal(q.has('agent_name_hint'), false);
  });
});

describe('OpenAiOAuthClient token endpoint', () => {
  it('exchanges a code with PKCE and the resource, and parses scopes', async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: tokenBody }));
    const client = new OpenAiOAuthClient({ jwks, fetch });
    const tokens = await client.exchangeCode({ clientId: 'oaiapp_1', code: 'code', codeVerifier: 'v', redirectUri: 'r' });

    assert.deepEqual(tokens, { accessToken: 'at', refreshToken: 'rt', idToken: 'it', scopes: ['openid', 'chatgpt.tokens.use.direct'], expiresInSeconds: 3600 });
    assert.equal(calls[0]!.url, 'https://auth.openai.com/api/accounts/oauth/token');
    assert.deepEqual(Object.fromEntries(calls[0]!.form), {
      grant_type: 'authorization_code', client_id: 'oaiapp_1', code: 'code', code_verifier: 'v', redirect_uri: 'r', resource: 'https://api.openai.com/v1',
    });
  });

  it('turns a failed exchange into a sign-in error', async () => {
    const { fetch } = fakeFetch(() => ({ status: 400, body: { error: 'invalid_grant' } }));
    await assert.rejects(
      new OpenAiOAuthClient({ jwks, fetch }).exchangeCode({ clientId: 'c', code: 'x', codeVerifier: 'v', redirectUri: 'r' }),
      /invalid_grant/,
    );
  });

  it('refreshes with the issued client and tells dead tokens from temporary failures', async () => {
    let status = 200;
    let body: unknown = tokenBody;
    const { fetch, calls } = fakeFetch(() => ({ status, body }));
    const client = new OpenAiOAuthClient({ jwks, fetch });

    await client.refresh({ clientId: 'oaiapp_1', refreshToken: 'rt0' });
    assert.deepEqual(Object.fromEntries(calls[0]!.form), {
      grant_type: 'refresh_token', client_id: 'oaiapp_1', refresh_token: 'rt0', resource: 'https://api.openai.com/v1',
    });

    status = 400;
    body = { error: 'refresh_token_reused' };
    await assert.rejects(client.refresh({ clientId: 'c', refreshToken: 'r' }), AuthRequiredError);
    status = 503;
    body = { error: 'temporarily_unavailable' };
    await assert.rejects(client.refresh({ clientId: 'c', refreshToken: 'r' }), AiUnavailableError);
  });

  it('revokes the refresh token and reports failure without throwing', async () => {
    const ok = fakeFetch(() => ({ status: 200 }));
    assert.equal(await new OpenAiOAuthClient({ jwks, fetch: ok.fetch }).revoke({ clientId: 'c', refreshToken: 'r' }), true);
    assert.equal(ok.calls[0]!.url, 'https://auth.openai.com/api/accounts/oauth/revoke');
    assert.deepEqual(Object.fromEntries(ok.calls[0]!.form), { token: 'r', token_type_hint: 'refresh_token', client_id: 'c' });

    const denied = fakeFetch(() => ({ status: 400 }));
    assert.equal(await new OpenAiOAuthClient({ jwks, fetch: denied.fetch }).revoke({ clientId: 'c', refreshToken: 'r' }), false);
    assert.equal(denied.calls.length, 1, 'client errors are not retried');
  });
});

describe('OpenAiOAuthClient for a registered website client', () => {
  it('omits the host ID and can use custom scopes', () => {
    const client = new OpenAiOAuthClient({ jwks, scopes: 'openid profile email' });
    const q = new URL(client.authorizeUrl({ clientId: 'oaiapp_site', redirectUri: 'https://x/auth/callback', state: 's', nonce: 'n', codeChallenge: 'c' })).searchParams;
    assert.equal(q.get('scope'), 'openid profile email');
    assert.equal(q.has('ext_agent_host_id'), false);
  });

  it('authenticates a confidential client with HTTP Basic, never in the body', async () => {
    const seen: { headers: Record<string, string>; body: string }[] = [];
    const fetch = async (_url: string, init?: RequestInit) => {
      seen.push({ headers: init?.headers as Record<string, string>, body: String(init?.body) });
      return new Response(JSON.stringify(tokenBody), { status: 200 });
    };
    const client = new OpenAiOAuthClient({ jwks, fetch, confidential: { clientId: 'oaiapp_site', clientSecret: 's3cr3t' } });
    await client.exchangeCode({ clientId: 'oaiapp_site', code: 'c', codeVerifier: 'v', redirectUri: 'r' });
    await client.refresh({ clientId: 'oaiapp_other', refreshToken: 'r' });

    assert.equal(seen[0]!.headers.authorization, `Basic ${Buffer.from('oaiapp_site:s3cr3t').toString('base64')}`);
    assert.doesNotMatch(seen[0]!.body, /s3cr3t/);
    assert.equal(seen[1]!.headers.authorization, undefined, 'other clients stay public');
  });
});

describe('OpenAiOAuthClient.verifyIdToken', () => {
  it('accepts a correctly signed token for this client and nonce', async () => {
    const client = new OpenAiOAuthClient({ jwks });
    assert.deepEqual(await client.verifyIdToken(await idToken(), { clientId: 'oaiapp_1', nonce: 'n1' }), {
      issuer: 'https://auth.openai.com', subject: 'user-a', email: 'a@example.com', emailVerified: false, name: 'A', picture: '',
    });
    const verified = await client.verifyIdToken(await idToken({ email_verified: true }), { clientId: 'oaiapp_1', nonce: 'n1' });
    assert.equal(verified.emailVerified, true);
  });

  it('rejects wrong audience, issuer, nonce or signature', async () => {
    const client = new OpenAiOAuthClient({ jwks });
    const expected = { clientId: 'oaiapp_1', nonce: 'n1' };
    await assert.rejects(client.verifyIdToken(await idToken({}, 'oaiapp_other'), expected), AuthRequiredError);
    await assert.rejects(client.verifyIdToken(await idToken({}, 'oaiapp_1', 'https://evil.example'), expected), AuthRequiredError);
    await assert.rejects(client.verifyIdToken(await idToken({ nonce: 'other' }), expected), AuthRequiredError);
    const forged = (await idToken()).replace(/\.[^.]+$/, '.AAAA');
    await assert.rejects(client.verifyIdToken(forged, expected), AuthRequiredError);
  });
});
