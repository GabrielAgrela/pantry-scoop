import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { AuthRequiredError } from '../../src/domain/errors.ts';
import { GoogleOAuthClient } from '../../src/infrastructure/google/google-oauth-client.ts';

let jwks: JWTVerifyGetKey;
let privateKey: CryptoKey;
before(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'g1', alg: 'RS256' }] });
});

const idToken = (claims: Record<string, unknown> = {}, audience = 'client-1', issuer = 'https://accounts.google.com') =>
  new SignJWT({ email: 'a@gmail.com', email_verified: true, name: 'A', picture: 'p', nonce: 'n1', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'g1' })
    .setSubject('1234')
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);

function client(respond: () => Response = () => Response.json({})) {
  const calls: { url: string; form: URLSearchParams }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, form: new URLSearchParams(String(init?.body ?? '')) });
    return respond();
  };
  return { calls, google: new GoogleOAuthClient({ clientId: 'client-1', clientSecret: 'secret-1', jwks, fetch }) };
}

describe('GoogleOAuthClient', () => {
  it('builds an OpenID authorize URL with PKCE and account choice', () => {
    const url = new URL(client().google.authorizeUrl({ redirectUri: 'https://p.example/auth/google/callback', state: 's', nonce: 'n', codeChallenge: 'c' }));
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    const q = Object.fromEntries(url.searchParams);
    assert.deepEqual(q, {
      client_id: 'client-1',
      redirect_uri: 'https://p.example/auth/google/callback',
      response_type: 'code',
      scope: 'openid email profile',
      state: 's',
      nonce: 'n',
      code_challenge: 'c',
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
  });

  it('exchanges the code with the client secret and returns the ID token', async () => {
    const { calls, google } = client(() => Response.json({ id_token: 'tok', access_token: 'at' }));
    assert.equal(await google.exchangeCode({ code: 'code', codeVerifier: 'v', redirectUri: 'r' }), 'tok');
    assert.equal(calls[0]!.url, 'https://oauth2.googleapis.com/token');
    assert.deepEqual(Object.fromEntries(calls[0]!.form), {
      grant_type: 'authorization_code',
      code: 'code',
      code_verifier: 'v',
      redirect_uri: 'r',
      client_id: 'client-1',
      client_secret: 'secret-1',
    });
  });

  it('turns a refused exchange into a sign-in error with Google’s reason', async () => {
    const { google } = client(() => Response.json({ error: 'redirect_uri_mismatch', error_description: 'Bad redirect' }, { status: 400 }));
    await assert.rejects(google.exchangeCode({ code: 'c', codeVerifier: 'v', redirectUri: 'r' }), (error: unknown) =>
      error instanceof AuthRequiredError && /redirect_uri_mismatch: Bad redirect/.test(error.message),
    );
  });

  it('verifies the ID token and maps it to an identity (either issuer spelling)', async () => {
    const { google } = client();
    for (const issuer of ['https://accounts.google.com', 'accounts.google.com']) {
      const identity = await google.verifyIdToken(await idToken({}, 'client-1', issuer), 'n1');
      assert.deepEqual(identity, {
        issuer: 'https://accounts.google.com',
        subject: '1234',
        email: 'a@gmail.com',
        emailVerified: true,
        name: 'A',
        picture: 'p',
      });
    }
  });

  it('rejects another app’s token, a wrong nonce and a foreign issuer', async () => {
    const { google } = client();
    for (const token of [await idToken({}, 'other-client'), await idToken({ nonce: 'x' }), await idToken({}, 'client-1', 'https://evil.example')]) {
      await assert.rejects(google.verifyIdToken(token, 'n1'), AuthRequiredError);
    }
  });
});
