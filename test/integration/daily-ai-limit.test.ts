import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AiAllowance, DailyAiLimit } from '../../src/application/daily-ai-limit.ts';
import { RecipeService } from '../../src/application/recipe-service.ts';
import { DailyLimitError } from '../../src/domain/errors.ts';
import type { Recipe } from '../../src/domain/recipe.ts';
import { buildApp } from '../../src/http/app.ts';
import { LimitedModel } from '../../src/infrastructure/ai/limited-model.ts';
import { AiRecipeGenerator } from '../../src/infrastructure/ai/recipe-suggestion.ts';
import type { StructuredRequest } from '../../src/infrastructure/ai/structured-model.ts';
import { openDatabase } from '../../src/infrastructure/db/database.ts';
import { SqliteAiUsageRepository } from '../../src/infrastructure/db/sqlite-ai-usage-repository.ts';
import { SqliteUserRepository } from '../../src/infrastructure/db/sqlite-account-repositories.ts';
import { SqliteCookingLogRepository } from '../../src/infrastructure/db/sqlite-cooking-log-repository.ts';
import { SqliteJobRepository } from '../../src/infrastructure/db/sqlite-job-repository.ts';
import { SqliteSavedRecipeRepository } from '../../src/infrastructure/db/sqlite-saved-recipe-repository.ts';
import { SqliteScoopMemoryRepository } from '../../src/infrastructure/db/sqlite-scoop-memory-repository.ts';
import { buildTestContainer, FakeDetector, FakeGenerator, identity, sampleRecipe, servicesFor, TINY_JPEG_DATA_URL } from '../fakes/fixtures.ts';

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
    db, a: a.id, b: b.id, aiLimit,
    modelFor: (userId: number) => new LimitedModel(model, new AiAllowance(aiLimit, userId)),
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

/** A cook's real recipe pipeline (generation, equipment review, translation) over a fake model. */
function kitchen(limit: number) {
  const t = setup(limit);
  const calls: StructuredRequest[] = [];
  const answers: Record<string, (call: StructuredRequest) => unknown> = {
    recipe_suggestions: () => ({ recipes: ['Granita', 'Sorbet', 'Semifreddo'].map((title) => sampleRecipe({ title, equipment: [] })) }),
    recipe_equipment_review: () => ({ issues: [] }),
    recipe_translation: (call) => ({ recipes: (JSON.parse(call.prompt.slice(call.prompt.indexOf('{'))).recipes as Recipe[]).map((recipe) => ({ ...recipe, title: `${recipe.title} (pt)` })) }),
    recipe_help: () => ({ answer: 'Use the same amount.' }),
  };
  const model = { complete: async (call: StructuredRequest) => { calls.push(call); return answers[call.schemaName]!(call); } };
  const services = servicesFor(t.db, t.a, new FakeDetector(), new FakeGenerator(), undefined, 'en', t.aiLimit);
  services.stock.addManual({ name: 'Natas' });
  services.profile.update({ language: 'Português (Portugal)' });
  const recipes = new RecipeService(
    new AiRecipeGenerator(new LimitedModel(model, services.ai), 'medium'),
    services.stock, services.profile,
    new SqliteSavedRecipeRepository(t.db, t.a), new SqliteJobRepository(t.db, t.a), new SqliteScoopMemoryRepository(t.db, t.a),
    new SqliteCookingLogRepository(t.db, t.a),
  );
  const batch = () => {
    const plan = recipes.plan({});
    return services.jobs.start('recipes', plan.request, async () => ({ recipes: await recipes.generate(plan) }));
  };
  const settled = async (id: number) => {
    for (let i = 0; i < 50 && services.jobs.find(id)?.status === 'running'; i++) await new Promise((done) => setImmediate(done));
    return services.jobs.find(id)!;
  };
  return { ...t, calls, answers, services, recipes, batch, settled };
}

describe('daily AI limit per action', () => {
  it('counts a recipe batch once, including its equipment review and translation', async () => {
    const k = kitchen(5);
    const job = await k.settled(k.batch().id);
    assert.equal(job.status, 'succeeded');
    assert.deepEqual(k.calls.map((call) => call.schemaName), ['recipe_suggestions', 'recipe_equipment_review', 'recipe_translation']);
    assert.equal(k.aiLimit.view(k.a).used, 1);
  });

  it('gives a failed batch back', async () => {
    const k = kitchen(5);
    k.answers.recipe_equipment_review = () => ({ issues: 'not a list' });
    const job = await k.settled(k.batch().id);
    assert.equal(job.status, 'failed');
    assert.equal(k.calls.length, 2);
    assert.equal(k.aiLimit.view(k.a).used, 0);
  });

  it('counts a chat question once', async () => {
    const k = kitchen(5);
    const answer = await k.services.ai.act(() => k.recipes.ask({ recipe: sampleRecipe(), question: 'Can I use cream?' }));
    assert.equal(answer, 'Use the same amount.');
    assert.equal(k.aiLimit.view(k.a).used, 1);
  });

  it('refuses at the limit before calling the model, and a batch before it is even started', async () => {
    const k = kitchen(1);
    await k.services.ai.act(() => k.recipes.ask({ recipe: sampleRecipe(), question: 'Can I use cream?' }));
    k.calls.length = 0;
    await assert.rejects(k.services.ai.act(() => k.recipes.ask({ recipe: sampleRecipe(), question: 'And milk?' })), DailyLimitError);
    assert.throws(() => k.batch(), DailyLimitError);
    assert.equal(k.calls.length, 0);
    assert.deepEqual(k.services.jobs.recent(undefined), []);
  });

  it('counts a translation pass once, however many requests it takes', async () => {
    const k = kitchen(5);
    for (const title of ['Granita', 'Sorbet', 'Semifreddo', 'Parfait']) k.recipes.save(sampleRecipe({ title }));
    const outcome = await k.services.ai.act(() => k.recipes.translate([]));
    assert.deepEqual(outcome, { saved: 4, batches: [], failed: 0 });
    assert.equal(k.calls.filter((call) => call.schemaName === 'recipe_translation').length, 2);
    assert.equal(k.aiLimit.view(k.a).used, 1);
  });

  it('takes nothing from the allowance when an action needs no AI', async () => {
    const k = kitchen(5);
    assert.deepEqual(await k.services.ai.act(() => k.recipes.translate([])), { saved: 0, batches: [], failed: 0 });
    assert.equal(k.calls.length, 0);
    assert.equal(k.aiLimit.view(k.a).used, 0);
  });

  it('gives back an action that delivered nothing without failing', async () => {
    const k = kitchen(5);
    const outcome = await k.services.ai.act(async () => {
      await new LimitedModel({ complete: async () => ({}) }, k.services.ai).complete(request);
      return { failed: 2 };
    }, ({ failed }) => failed === 0);
    assert.deepEqual(outcome, { failed: 2 });
    assert.equal(k.aiLimit.view(k.a).used, 0);
  });
});

describe('daily AI limit over HTTP', () => {
  it('refuses a scan or recipe batch at submission once the allowance is used up', async () => {
    const ctx = buildTestContainer();
    const app = await buildApp(ctx.container);
    const start = await app.inject({ method: 'GET', url: '/auth/chatgpt/start' });
    const signInCookie = start.cookies.find((cookie) => cookie.name === 'ps_signin')!.value;
    const done = await app.inject({ method: 'GET', url: `/auth/callback?${ctx.openai.callbackParams()}`, cookies: { ps_signin: signInCookie } });
    const session = done.cookies.find((cookie) => cookie.name === 'ps_session')!.value;
    const userId = ctx.auth.userForSession(session)!.id;
    ctx.container.forUser(userId).stock.addManual({ name: 'Natas' });
    for (let i = 0; i < 30; i++) ctx.container.aiLimit.consume(userId);

    for (const [url, payload] of [['/api/recipes/suggestions', {}], ['/api/scan', { images: [TINY_JPEG_DATA_URL] }]] as const) {
      const response = await app.inject({ method: 'POST', url, cookies: { ps_session: session }, payload });
      assert.equal(response.statusCode, 429, response.body);
    }
    assert.deepEqual(ctx.container.forUser(userId).jobs.recent(undefined), []);
    assert.equal(ctx.generator.calls.length + ctx.detector.calls.length, 0);
  });
});
