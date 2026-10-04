import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { StartedSignIn } from '../../src/application/auth-service.ts';
import { AuthService, SignInRetryError } from '../../src/application/auth-service.ts';
import { AuthRequiredError, ValidationError } from '../../src/domain/errors.ts';
import { SqliteIngredientRepository } from '../../src/infrastructure/db/sqlite-ingredient-repository.ts';
import { buildTestContainer, identity } from '../fakes/fixtures.ts';

let ctx: ReturnType<typeof buildTestContainer>;
let clock: number;
beforeEach(() => {
  clock = Date.parse('2026-10-02T10:00:00Z');
  ctx = buildTestContainer(() => clock);
});

const complete = (started: StartedSignIn, overrides: Record<string, string> = {}, bindingToken: string | undefined = started.bindingToken) =>
  ctx.auth.completeSignIn({ params: ctx.openai.callbackParams(overrides), bindingToken, trustedWithoutBinding: false });

describe('AuthService sign-in', () => {
  it('registers a new client with PKCE, the host ID and the app name', () => {
    ctx.auth.startSignIn();
    const call = ctx.openai.authorizeCalls[0]!;
    assert.equal(call.clientId, 'dynamic_agent_client');
    assert.equal(call.agentNameHint, 'Pantry Scoop');
    assert.equal(call.hostId, 'urn:uuid:00000000-0000-4000-8000-000000000000');
    assert.equal(call.redirectUri, 'http://127.0.0.1:3210/auth/callback');
    assert.ok(call.state.length >= 32 && call.nonce.length >= 32 && call.codeChallenge.length >= 32);
  });

  it('creates the user, a session and the connection on the issued client', async () => {
    const done = await complete(ctx.auth.startSignIn());

    assert.equal(done.user.email, 'user-a@example.com');
    assert.equal(done.planUsageEnabled, true);
    assert.equal(done.accountHint, 'oaiapp_1');
    assert.equal(ctx.openai.exchanges[0]!.clientId, 'oaiapp_1');
    assert.equal(ctx.repos.connections.find(done.user.id)?.refreshToken, 'refresh-1');
    assert.equal(ctx.auth.userForSession(done.sessionToken)?.id, done.user.id);
  });

  it('gives pre-account data to the first user only', async () => {
    ctx.db.exec(`INSERT INTO ingredients (user_id, name, normalized_name, category, notes, source, created_at)
                 VALUES (NULL, 'Natas', 'natas', 'dairy', '', 'photo', 'x')`);
    const first = await complete(ctx.auth.startSignIn());
    ctx.openai.nextIdentity = identity('user-b');
    const second = await complete(ctx.auth.startSignIn());

    assert.deepEqual(new SqliteIngredientRepository(ctx.db, first.user.id).list().map((i) => i.name), ['Natas']);
    assert.deepEqual(new SqliteIngredientRepository(ctx.db, second.user.id).list(), []);
  });

  it('reuses the saved registration for a returning browser and revokes the old token', async () => {
    const first = await complete(ctx.auth.startSignIn());
    await complete(ctx.auth.startSignIn({ accountHint: first.accountHint }));

    const call = ctx.openai.authorizeCalls[1]!;
    assert.equal(call.clientId, 'oaiapp_1');
    assert.equal(call.agentNameHint, undefined);
    assert.equal(call.loginHint, 'user-a@example.com');
    assert.equal(call.idTokenHint, 'id-1');
    assert.deepEqual(ctx.openai.revoked, [{ clientId: 'oaiapp_1', refreshToken: 'refresh-1' }]);
  });

  it('refuses a returning sign-in that comes back as a different account', async () => {
    const first = await complete(ctx.auth.startSignIn());
    ctx.openai.nextIdentity = identity('someone-else');
    await assert.rejects(complete(ctx.auth.startSignIn({ accountHint: first.accountHint })), /different ChatGPT account/);
  });

  it('marks plan usage disabled when the permission was not granted', async () => {
    ctx.openai.nextScopes = ['openid', 'profile', 'email', 'offline_access'];
    const done = await complete(ctx.auth.startSignIn());
    assert.equal(done.planUsageEnabled, false);
  });

  it('after a failed exchange, retries on the issued client instead of registering again', async () => {
    ctx.openai.exchangeError = new AuthRequiredError('ChatGPT sign-in failed (invalid_grant). Start again.');
    const failed = await complete(ctx.auth.startSignIn()).then(
      () => assert.fail('expected the exchange to fail'),
      (error: unknown) => error,
    );
    assert.ok(failed instanceof SignInRetryError);
    assert.equal(failed.issuedClientId, 'oaiapp_1');

    const done = await complete(ctx.auth.startSignIn({ retainedClientId: failed.issuedClientId }));
    const retry = ctx.openai.authorizeCalls[1]!;
    assert.equal(retry.clientId, 'oaiapp_1');
    assert.equal(retry.agentNameHint, undefined);
    assert.equal(ctx.openai.exchanges[1]!.clientId, 'oaiapp_1');
    assert.equal(done.accountHint, 'oaiapp_1');
  });

  it('ignores a retained client ID that is not an issued one', () => {
    ctx.auth.startSignIn({ retainedClientId: 'dynamic_agent_client' });
    ctx.auth.startSignIn({ retainedClientId: 'bad value&x=1' });
    assert.deepEqual(ctx.openai.authorizeCalls.map((c) => c.clientId), ['dynamic_agent_client', 'dynamic_agent_client']);
  });

  it('can ask OpenAI to show the permission screen again', () => {
    ctx.auth.startSignIn({ forceConsent: true });
    assert.equal(ctx.openai.authorizeCalls[0]!.forceConsent, true);
  });
});

describe('AuthService callback checks', () => {
  it('rejects a callback from another browser, unless it arrived on the server machine', async () => {
    const started = ctx.auth.startSignIn();
    await assert.rejects(complete(started, {}, 'someone-elses-cookie'), /different browser/);

    ctx.auth.startSignIn();
    await assert.rejects(
      ctx.auth.completeSignIn({ params: ctx.openai.callbackParams(), bindingToken: undefined, trustedWithoutBinding: false }),
      /different browser/,
    );

    ctx.auth.startSignIn();
    const done = await ctx.auth.completeSignIn({ params: ctx.openai.callbackParams(), bindingToken: undefined, trustedWithoutBinding: true });
    assert.ok(done.sessionToken);
  });

  it('rejects replayed, expired and unknown states', async () => {
    const started = ctx.auth.startSignIn();
    const params = ctx.openai.callbackParams();
    await ctx.auth.completeSignIn({ params, bindingToken: started.bindingToken, trustedWithoutBinding: false });
    await assert.rejects(ctx.auth.completeSignIn({ params, bindingToken: started.bindingToken, trustedWithoutBinding: false }), /expired or was already used/);

    const late = ctx.auth.startSignIn();
    clock += 11 * 60 * 1000;
    await assert.rejects(complete(late), /expired/);
  });

  it('reports a cancelled consent without exchanging a code', async () => {
    const started = ctx.auth.startSignIn();
    await assert.rejects(complete(started, { error: 'access_denied' }), /cancelled/);
    assert.equal(ctx.openai.exchanges.length, 0);
  });

  it('rejects a registration callback without an issued client, or with a swapped one', async () => {
    await assert.rejects(complete(ctx.auth.startSignIn(), { client_id: 'dynamic_agent_client' }), /did not finish registering/);
    const first = await complete(ctx.auth.startSignIn());
    await assert.rejects(complete(ctx.auth.startSignIn({ accountHint: first.accountHint }), { client_id: 'oaiapp_other' }), /different app registration/);
  });

  it('keeps an earlier attempt valid when the same browser starts again', async () => {
    const first = ctx.auth.startSignIn();
    const firstCallback = ctx.openai.callbackParams();
    const second = ctx.auth.startSignIn({ bindingToken: first.bindingToken });
    assert.equal(second.bindingToken, first.bindingToken);
    const done = await ctx.auth.completeSignIn({ params: firstCallback, bindingToken: second.bindingToken, trustedWithoutBinding: false });
    assert.ok(done.sessionToken);
  });

  it('parses a pasted callback address', () => {
    assert.equal(AuthService.paramsFromPastedUrl('127.0.0.1:3210/auth/callback?code=c&state=s').get('code'), 'c');
    const params = AuthService.paramsFromPastedUrl(' http://127.0.0.1:3210/auth/callback?code=c&state=s&client_id=oaiapp_1 ');
    assert.equal(params.get('client_id'), 'oaiapp_1');
    assert.throws(() => AuthService.paramsFromPastedUrl('http://127.0.0.1:3210/other?state=s'), ValidationError);
    assert.throws(() => AuthService.paramsFromPastedUrl('not a url'), ValidationError);
    assert.throws(() => AuthService.paramsFromPastedUrl(''), ValidationError);
  });
});

describe('AuthService sign-out', () => {
  it('revokes the ChatGPT tokens only when the last session ends', async () => {
    const phone = await complete(ctx.auth.startSignIn());
    const laptop = await complete(ctx.auth.startSignIn({ accountHint: phone.accountHint }));
    ctx.openai.revoked = [];

    assert.equal(await ctx.auth.signOut(phone.sessionToken), true);
    assert.equal(ctx.auth.userForSession(phone.sessionToken), undefined);
    assert.deepEqual(ctx.openai.revoked, []);

    ctx.openai.revokeSucceeds = false;
    assert.equal(await ctx.auth.signOut(laptop.sessionToken), false, 'unconfirmed revocation is reported');
    assert.deepEqual(ctx.openai.revoked, [{ clientId: 'oaiapp_1', refreshToken: 'refresh-2' }]);
    const connection = ctx.repos.connections.find(laptop.user.id)!;
    assert.equal(connection.accessToken, '');
    assert.equal(connection.clientId, 'oaiapp_1', 'registration kept for next time');
  });

  it('treats unknown sessions as already signed out', async () => {
    assert.equal(await ctx.auth.signOut('nope'), true);
    assert.equal(await ctx.auth.signOut(undefined), true);
    assert.equal(ctx.auth.userForSession('nope'), undefined);
  });

  it('expires sessions', async () => {
    const done = await complete(ctx.auth.startSignIn());
    clock += 31 * 24 * 60 * 60 * 1000;
    assert.equal(ctx.auth.userForSession(done.sessionToken), undefined);
  });
});

describe('AuthService: one person, several registrations', () => {
  it('links a new registration (new subject) to the account with the same verified email', async () => {
    const phone = await complete(ctx.auth.startSignIn());
    ctx.openai.nextIdentity = { ...identity('user-a'), subject: 'pairwise-subject-for-pc' };
    const pc = await complete(ctx.auth.startSignIn()); // no account hint: new registration
    assert.equal(pc.user.id, phone.user.id);
    assert.equal(ctx.repos.users.findBySubject('https://auth.openai.com', 'pairwise-subject-for-pc')?.id, phone.user.id);
  });

  it('does not link on an unverified email', async () => {
    const first = await complete(ctx.auth.startSignIn());
    ctx.openai.nextIdentity = { ...identity('user-a'), subject: 'other', emailVerified: false };
    const second = await complete(ctx.auth.startSignIn());
    assert.notEqual(second.user.id, first.user.id);
  });
});

describe('AuthService access policy', () => {
  it('lets only allowlisted, verified emails in, and revokes the refused sign-in', async () => {
    ctx = buildTestContainer(() => clock, { allowedEmails: ['user-a@example.com'] });
    assert.ok((await complete(ctx.auth.startSignIn())).sessionToken);

    ctx.openai.nextIdentity = identity('stranger');
    await assert.rejects(complete(ctx.auth.startSignIn()), /private.*stranger@example.com/);
    assert.equal(ctx.openai.revoked.length, 1);

    ctx.openai.nextIdentity = { ...identity('user-a'), subject: 'other', emailVerified: false };
    await assert.rejects(complete(ctx.auth.startSignIn()), /private/, 'unverified email does not count');
  });

  it('gives pre-account data only to the configured owner', async () => {
    ctx = buildTestContainer(() => clock, { ownerEmail: 'owner@example.com' });
    ctx.db.exec(`INSERT INTO ingredients (user_id, name, normalized_name, category, notes, source, created_at)
                 VALUES (NULL, 'Natas', 'natas', 'dairy', '', 'photo', 'x')`);
    const stranger = await complete(ctx.auth.startSignIn());
    ctx.openai.nextIdentity = identity('owner');
    const owner = await complete(ctx.auth.startSignIn());
    assert.deepEqual(new SqliteIngredientRepository(ctx.db, stranger.user.id).list(), []);
    assert.deepEqual(new SqliteIngredientRepository(ctx.db, owner.user.id).list().map((i) => i.name), ['Natas']);
  });

  it('deletes an account with all its data and disconnects ChatGPT', async () => {
    const done = await complete(ctx.auth.startSignIn());
    new SqliteIngredientRepository(ctx.db, done.user.id).insert({ name: 'Natas', category: 'dairy', notes: '', source: 'manual' });
    await ctx.auth.deleteAccount(done.user.id);
    assert.equal(ctx.repos.users.findById(done.user.id), undefined);
    assert.equal(ctx.auth.userForSession(done.sessionToken), undefined);
    assert.equal((ctx.db.prepare('SELECT COUNT(*) AS n FROM ingredients').get() as { n: number }).n, 0);
    assert.deepEqual(ctx.openai.revoked.at(-1), { clientId: 'oaiapp_1', refreshToken: 'refresh-1' });
  });
});

describe('AuthService with a registered website client', () => {
  beforeEach(() => {
    ctx = buildTestContainer(() => clock, { registeredClientId: 'oaiapp_site' });
  });

  it('always uses the registered client and its HTTPS callback, with no OSS registration hints', async () => {
    assert.equal(ctx.auth.mode, 'registered');
    const started = ctx.auth.startSignIn({ accountHint: 'oaiapp_site' });
    const call = ctx.openai.authorizeCalls[0]!;
    assert.deepEqual(
      [call.clientId, call.redirectUri, call.hostId, call.agentNameHint, call.loginHint],
      ['oaiapp_site', 'https://pantry.example.com/auth/callback', undefined, undefined, undefined],
    );

    const done = await complete(started);
    assert.equal(ctx.openai.exchanges[0]!.clientId, 'oaiapp_site');
    assert.equal(ctx.repos.connections.find(done.user.id)?.clientId, 'oaiapp_site');
  });

  it('lets different people sign in on the same registered client', async () => {
    const a = await complete(ctx.auth.startSignIn());
    ctx.openai.nextIdentity = identity('user-b');
    const b = await complete(ctx.auth.startSignIn({ accountHint: a.accountHint }));
    assert.notEqual(a.user.id, b.user.id);
  });

  it('rejects a callback naming another client', async () => {
    await assert.rejects(complete(ctx.auth.startSignIn(), { client_id: 'oaiapp_other' }), /different app registration/);
  });
});

describe('AuthService phone sign-in (QR link)', () => {
  it('signs another device in as the same user, once', async () => {
    const computer = await complete(ctx.auth.startSignIn());
    const { token } = ctx.auth.createDeviceLink(computer.user.id);

    const phone = ctx.auth.signInWithDeviceLink(token);
    assert.equal(phone.user.id, computer.user.id);
    assert.equal(ctx.auth.userForSession(phone.sessionToken)?.id, computer.user.id);
    assert.throws(() => ctx.auth.signInWithDeviceLink(token), /expired or was already used/);
  });

  it('rejects expired and made-up links', async () => {
    const computer = await complete(ctx.auth.startSignIn());
    const { token } = ctx.auth.createDeviceLink(computer.user.id);
    clock += 11 * 60 * 1000;
    assert.throws(() => ctx.auth.signInWithDeviceLink(token), AuthRequiredError);
    assert.throws(() => ctx.auth.signInWithDeviceLink('guess'), AuthRequiredError);
    assert.throws(() => ctx.auth.signInWithDeviceLink(undefined), AuthRequiredError);
  });

  it('keeps sessions alive while they are used', async () => {
    const done = await complete(ctx.auth.startSignIn());
    for (let day = 0; day < 3; day++) {
      clock += 20 * 24 * 60 * 60 * 1000;
      assert.ok(ctx.auth.userForSession(done.sessionToken), `still signed in after ${(day + 1) * 20} days of use`);
    }
  });
});

describe('AuthRequiredError', () => {
  it('is what an unusable callback raises', async () => {
    await assert.rejects(ctx.auth.completeSignIn({ params: new URLSearchParams(), bindingToken: 'x', trustedWithoutBinding: false }), AuthRequiredError);
  });
});
