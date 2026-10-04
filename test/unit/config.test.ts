import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig, redirectUriFor } from '../../src/config.ts';

describe('loadConfig access settings', () => {
  it('parses the email allowlist, owner and backups', () => {
    const config = loadConfig({ ALLOWED_EMAILS: ' A@x.com, b@y.com ,', OWNER_EMAIL: 'A@x.com', BACKUP_DAYS: '0' });
    assert.deepEqual(config.allowedEmails, ['a@x.com', 'b@y.com']);
    assert.equal(config.ownerEmail, 'a@x.com');
    assert.equal(config.backupDays, 0);
    assert.deepEqual(loadConfig({}).allowedEmails, []);
    assert.equal(loadConfig({}).backupDays, 7);
    assert.equal(loadConfig({}).dailyAiLimit, 30);
    assert.equal(loadConfig({ DAILY_AI_LIMIT: '0' }).dailyAiLimit, 0);
  });
});

describe('redirectUriFor', () => {
  it('uses the loopback callback for the open-source flow', () => {
    assert.equal(redirectUriFor(loadConfig({ PORT: '3210' })), 'http://127.0.0.1:3210/auth/callback');
  });

  it('uses PUBLIC_URL for a registered website client and insists on HTTPS', () => {
    assert.equal(
      redirectUriFor(loadConfig({ OPENAI_CLIENT_ID: 'oaiapp_x', PUBLIC_URL: 'https://pantry.example.com/' })),
      'https://pantry.example.com/auth/callback',
    );
    assert.throws(() => redirectUriFor(loadConfig({ OPENAI_CLIENT_ID: 'oaiapp_x' })), /needs PUBLIC_URL/);
    assert.throws(() => redirectUriFor(loadConfig({ OPENAI_CLIENT_ID: 'oaiapp_x', PUBLIC_URL: 'http://192.168.1.2:3210' })), /https/);
    assert.equal(redirectUriFor(loadConfig({ OPENAI_CLIENT_ID: 'oaiapp_x', PUBLIC_URL: 'http://localhost:3210' })), 'http://localhost:3210/auth/callback');
  });

  it('reads proxy and client settings', () => {
    const config = loadConfig({ TRUST_PROXY: '1', OPENAI_CLIENT_ID: 'oaiapp_x', OPENAI_CLIENT_SECRET: 's' });
    assert.equal(config.trustProxy, 1);
    assert.deepEqual(config.openai, { clientId: 'oaiapp_x', clientSecret: 's', scopes: undefined });
  });
});
