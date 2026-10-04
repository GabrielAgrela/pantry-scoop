import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { StartedSignIn } from '../../src/application/auth-service.ts';
import { ConflictError, ValidationError } from '../../src/domain/errors.ts';
import { SqliteIngredientRepository } from '../../src/infrastructure/db/sqlite-ingredient-repository.ts';
import { buildTestContainer, googleIdentity, identity } from '../fakes/fixtures.ts';

let ctx: ReturnType<typeof buildTestContainer>;
beforeEach(() => {
  ctx = buildTestContainer();
});

const googleIn = (started: StartedSignIn = ctx.auth.startGoogleSignIn(), overrides: Record<string, string> = {}) =>
  ctx.auth.completeGoogleSignIn({ params: ctx.google.callbackParams(overrides), bindingToken: started.bindingToken });
const chatgptIn = (started: StartedSignIn = ctx.auth.startSignIn()) =>
  ctx.auth.completeSignIn({ params: ctx.openai.callbackParams(), bindingToken: started.bindingToken, trustedWithoutBinding: false });

describe('Sign in with Google', () => {
  it('creates an account with a session, using PKCE and a nonce', async () => {
    const started = ctx.auth.startGoogleSignIn();
    const done = await googleIn(started);

    assert.equal(done.user.email, 'user-a@example.com');
    assert.equal(ctx.auth.userForSession(done.sessionToken)?.id, done.user.id);
    const call = ctx.google.authorizeCalls[0]!;
    assert.equal(call.redirectUri, 'https://pantry.example.com/auth/google/callback');
    assert.ok(call.codeChallenge.length >= 32 && call.nonce.length >= 32);
    assert.deepEqual(ctx.google.verifiedNonces, [call.nonce]);
    assert.deepEqual(ctx.connections.view(done.user.id), {
      chatgpt: false,
      google: true,
      googleAvailable: true,
      chatgptPlan: false,
      deepseekAvailable: true,
      aiChoice: '',
      aiProvider: 'deepseek',
    });
  });

  it('signs the same person back in, and joins a ChatGPT account with the same verified email', async () => {
    const viaChatgpt = await chatgptIn();
    const viaGoogle = await googleIn();
    const again = await googleIn();

    assert.equal(viaGoogle.user.id, viaChatgpt.user.id);
    assert.equal(again.user.id, viaChatgpt.user.id);
    assert.equal(ctx.connections.view(viaChatgpt.user.id).google, true);
    assert.equal(ctx.connections.view(viaChatgpt.user.id).chatgpt, true);
  });

  it('does not join accounts on an unverified Google email', async () => {
    const viaChatgpt = await chatgptIn();
    ctx.google.nextIdentity = { ...googleIdentity(), emailVerified: false };
    const viaGoogle = await googleIn();
    assert.notEqual(viaGoogle.user.id, viaChatgpt.user.id);
  });

  it('applies the allowlist', async () => {
    ctx = buildTestContainer(undefined, { allowedEmails: ['owner@example.com'] });
    ctx.google.nextIdentity = googleIdentity('g-x', 'stranger@example.com');
    await assert.rejects(googleIn(), /private.*stranger@example.com/);
    ctx.google.nextIdentity = googleIdentity('g-o', 'owner@example.com');
    assert.equal((await googleIn()).user.email, 'owner@example.com');
  });

  it('needs the starting browser’s cookie, a Google state and an unused state', async () => {
    const started = ctx.auth.startGoogleSignIn();
    await assert.rejects(
      ctx.auth.completeGoogleSignIn({ params: ctx.google.callbackParams(), bindingToken: 'other-browser' }),
      /different browser/,
    );
    await assert.rejects(googleIn(started), /expired or was already used/);

    const chatgptStarted = ctx.auth.startSignIn();
    const chatgptState = ctx.openai.authorizeCalls.at(-1)!.state;
    await assert.rejects(
      ctx.auth.completeGoogleSignIn({ params: new URLSearchParams({ code: 'c', state: chatgptState }), bindingToken: chatgptStarted.bindingToken }),
      /expired or was already used/,
    );
  });

  it('reports a cancelled consent screen', async () => {
    await assert.rejects(googleIn(undefined, { error: 'access_denied' }), /cancelled/);
  });

  it('gives pre-account data to the first account, whichever provider made it', async () => {
    ctx.db.exec(`INSERT INTO ingredients (user_id, name, normalized_name, category, notes, source, created_at)
                 VALUES (NULL, 'Natas', 'natas', 'dairy', '', 'photo', 'x')`);
    const first = await googleIn();
    assert.deepEqual(new SqliteIngredientRepository(ctx.db, first.user.id).list().map((i) => i.name), ['Natas']);
  });

  it('is off when not configured', () => {
    ctx = buildTestContainer(undefined, { google: false });
    assert.equal(ctx.auth.googleEnabled, false);
    assert.throws(() => ctx.auth.startGoogleSignIn(), ValidationError);
  });
});

describe('Linking accounts', () => {
  it('connects Google to a ChatGPT account, whatever email Google has', async () => {
    const owner = await chatgptIn();
    ctx.google.nextIdentity = googleIdentity('g-2', 'other-address@example.com');
    const linked = await googleIn(ctx.auth.startGoogleSignIn({ linkUserId: owner.user.id }));

    assert.equal(linked.user.id, owner.user.id);
    assert.equal(ctx.connections.view(owner.user.id).google, true);
    // Signing in with that Google account later lands in the same pantry.
    assert.equal((await googleIn()).user.id, owner.user.id);
  });

  it('connects ChatGPT (with its plan) to a Google account', async () => {
    const owner = await googleIn();
    ctx.openai.nextIdentity = identity('chatgpt-sub', 'different@example.com');
    const linked = await chatgptIn(ctx.auth.startSignIn({ linkUserId: owner.user.id }));

    assert.equal(linked.user.id, owner.user.id);
    assert.equal(linked.planUsageEnabled, true);
    const view = ctx.connections.view(owner.user.id);
    assert.equal(view.chatgpt, true);
    assert.equal(view.chatgptPlan, true);
    assert.equal(view.aiProvider, 'chatgpt');
  });

  it('refuses to link an identity that belongs to another account, and revokes its ChatGPT tokens', async () => {
    const a = await chatgptIn();
    ctx.google.nextIdentity = googleIdentity('g-b', 'b@example.com');
    const b = await googleIn();

    await assert.rejects(googleIn(ctx.auth.startGoogleSignIn({ linkUserId: a.user.id })), ConflictError);
    await assert.rejects(chatgptIn(ctx.auth.startSignIn({ linkUserId: b.user.id })), ConflictError);
    assert.deepEqual(ctx.openai.revoked.at(-1), { clientId: 'oaiapp_2', refreshToken: 'refresh-2' });
    assert.equal(ctx.connections.view(b.user.id).chatgpt, false);
  });
});

describe('ConnectionsService', () => {
  it('disconnects ChatGPT (revoking its tokens) but never the last way to sign in', async () => {
    const done = await chatgptIn();
    await assert.rejects(ctx.connections.disconnect(done.user.id, 'chatgpt'), /Connect another way/);

    await googleIn(ctx.auth.startGoogleSignIn({ linkUserId: done.user.id }));
    const view = await ctx.connections.disconnect(done.user.id, 'chatgpt');
    assert.equal(view.chatgpt, false);
    assert.equal(view.chatgptPlan, false);
    assert.equal(view.aiProvider, 'deepseek');
    assert.deepEqual(ctx.openai.revoked.at(-1), { clientId: 'oaiapp_1', refreshToken: 'refresh-1' });
    assert.equal(ctx.repos.connections.find(done.user.id), undefined);
    await assert.rejects(ctx.connections.disconnect(done.user.id, 'google'), /Connect another way/);
  });

  it('disconnects Google', async () => {
    const done = await chatgptIn();
    await googleIn(ctx.auth.startGoogleSignIn({ linkUserId: done.user.id }));
    assert.equal((await ctx.connections.disconnect(done.user.id, 'google')).google, false);
    // That Google account no longer reaches this pantry by its own identity.
    ctx.google.nextIdentity = { ...googleIdentity(), emailVerified: false };
    assert.notEqual((await googleIn()).user.id, done.user.id);
  });

  it('remembers the chosen intelligence and validates it', async () => {
    const done = await chatgptIn();
    assert.equal(ctx.connections.view(done.user.id).aiProvider, 'chatgpt');
    assert.equal(ctx.connections.setAiChoice(done.user.id, 'deepseek').aiProvider, 'deepseek');
    assert.equal(ctx.connections.setAiChoice(done.user.id, 'chatgpt').aiProvider, 'chatgpt');
    assert.equal(ctx.connections.setAiChoice(done.user.id, '').aiChoice, '');
    assert.throws(() => ctx.connections.setAiChoice(done.user.id, 'grok'), ValidationError);
    await assert.rejects(ctx.connections.disconnect(done.user.id, 'facebook'), ValidationError);
  });

  it('cannot choose DeepSeek when it is not set up, and then falls back to ChatGPT', async () => {
    ctx = buildTestContainer(undefined, { deepseek: false });
    const done = await googleIn();
    assert.equal(ctx.connections.view(done.user.id).aiProvider, 'chatgpt');
    assert.throws(() => ctx.connections.setAiChoice(done.user.id, 'deepseek'), /not set up/);
  });
});

describe('ChatGPT sign-in after Google', () => {
  it('joins the Google account with the same verified email instead of making a second one', async () => {
    const viaGoogle = await googleIn();
    const viaChatgpt = await chatgptIn();
    assert.equal(viaChatgpt.user.id, viaGoogle.user.id);
  });
});
