import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ChatGptCredentials } from '../../src/application/chatgpt-credentials.ts';
import { AiUnavailableError, AuthRequiredError, PlanUsageRequiredError } from '../../src/domain/errors.ts';
import { openDatabase } from '../../src/infrastructure/db/database.ts';
import { accountRepos, FakeOpenAiAuth, identity, PLAN_SCOPES } from '../fakes/fixtures.ts';

let clock: number;
let openai: FakeOpenAiAuth;
let repos: ReturnType<typeof accountRepos>;
let credentials: ChatGptCredentials;
let userId: number;

beforeEach(() => {
  clock = 1_000_000;
  const db = openDatabase(':memory:');
  repos = accountRepos(db);
  openai = new FakeOpenAiAuth();
  credentials = new ChatGptCredentials(repos.connections, openai, () => clock);
  userId = repos.users.create(identity()).id;
  repos.connections.save({
    userId,
    clientId: 'oaiapp_1',
    idToken: 'id',
    accessToken: 'access-0',
    refreshToken: 'refresh-0',
    scopes: PLAN_SCOPES,
    expiresAt: clock + 60 * 60 * 1000,
  });
});

describe('ChatGptCredentials', () => {
  it('returns the stored token while it is fresh', async () => {
    assert.equal(await credentials.accessToken(userId), 'access-0');
    assert.equal(openai.refreshes.length, 0);
  });

  it('refreshes near expiry, once, even for concurrent requests, and saves the rotated token', async () => {
    clock += 59 * 60 * 1000;
    const tokens = await Promise.all([credentials.accessToken(userId), credentials.accessToken(userId)]);
    assert.deepEqual(tokens, ['refreshed-access-1', 'refreshed-access-1']);
    assert.deepEqual(openai.refreshes, [{ clientId: 'oaiapp_1', refreshToken: 'refresh-0' }]);
    assert.equal(repos.connections.find(userId)?.refreshToken, 'refreshed-refresh-1');
  });

  it('forgets dead tokens so the user is asked to sign in again', async () => {
    clock += 2 * 60 * 60 * 1000;
    openai.refreshResult = new AuthRequiredError('dead');
    await assert.rejects(credentials.accessToken(userId), AuthRequiredError);
    assert.equal(repos.connections.find(userId)?.refreshToken, '');
    await assert.rejects(credentials.accessToken(userId), /Sign in with ChatGPT again/);
  });

  it('keeps tokens through a temporary refresh failure', async () => {
    clock += 2 * 60 * 60 * 1000;
    openai.refreshResult = new AiUnavailableError('network');
    await assert.rejects(credentials.accessToken(userId), AiUnavailableError);
    assert.equal(repos.connections.find(userId)?.refreshToken, 'refresh-0');
  });

  it('requires the plan-usage permission', async () => {
    const current = repos.connections.find(userId)!;
    repos.connections.save({ ...current, scopes: ['openid', 'email'] });
    await assert.rejects(credentials.accessToken(userId), PlanUsageRequiredError);
  });

  it('invalidate() drops the tokens', async () => {
    credentials.invalidate(userId);
    await assert.rejects(credentials.accessToken(userId), AuthRequiredError);
  });
});
