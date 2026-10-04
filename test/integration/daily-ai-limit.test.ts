import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DailyAiLimit } from '../../src/application/daily-ai-limit.ts';
import { DailyLimitError } from '../../src/domain/errors.ts';
import { LimitedModel } from '../../src/infrastructure/ai/limited-model.ts';
import { openDatabase } from '../../src/infrastructure/db/database.ts';
import { SqliteAiUsageRepository } from '../../src/infrastructure/db/sqlite-ai-usage-repository.ts';
import { SqliteUserRepository } from '../../src/infrastructure/db/sqlite-account-repositories.ts';
import { identity } from '../fakes/fixtures.ts';

const request = { prompt: 'p', schemaName: 's', schema: {}, effort: 'low' as const };

function setup(limit: number) {
  const db = openDatabase(':memory:');
  const users = new SqliteUserRepository(db);
  const a = users.create(identity('a'));
  const b = users.create(identity('b'));
  let now = Date.parse('2026-10-04T23:00:00Z');
  const aiLimit = new DailyAiLimit(new SqliteAiUsageRepository(db), limit, () => now);
  let fail = false;
  const model = { complete: async () => { if (fail) throw new Error('down'); return { ok: true }; } };
  return {
    a: a.id, b: b.id, aiLimit,
    modelFor: (userId: number) => new LimitedModel(model, aiLimit, userId),
    advance: (ms: number) => { now += ms; },
    failNext: (value: boolean) => { fail = value; },
  };
}

describe('daily AI limit', () => {
  it('counts each request per person and refuses past the limit until the next UTC day', async () => {
    const t = setup(2);
    await t.modelFor(t.a).complete(request);
    await t.modelFor(t.a).complete(request);
    await assert.rejects(t.modelFor(t.a).complete(request), DailyLimitError);
    assert.deepEqual(t.aiLimit.view(t.a), { used: 2, limit: 2, resetsAt: '2026-10-05T00:00:00.000Z' });
    assert.equal(t.aiLimit.view(t.b).used, 0);
    await t.modelFor(t.b).complete(request);

    t.advance(60 * 60 * 1000);
    assert.equal(t.aiLimit.view(t.a).used, 0);
    await t.modelFor(t.a).complete(request);
  });

  it('gives a failed request back', async () => {
    const t = setup(1);
    t.failNext(true);
    await assert.rejects(t.modelFor(t.a).complete(request), /down/);
    assert.equal(t.aiLimit.view(t.a).used, 0);
    t.failNext(false);
    await t.modelFor(t.a).complete(request);
    assert.equal(t.aiLimit.view(t.a).used, 1);
  });

  it('is unlimited at 0', async () => {
    const t = setup(0);
    for (let i = 0; i < 5; i++) await t.modelFor(t.a).complete(request);
    assert.equal(t.aiLimit.view(t.a).used, 0);
  });
});
