import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IngredientClassificationService } from '../../src/application/ingredient-classification-service.ts';
import { AiUnavailableError } from '../../src/domain/errors.ts';
import { AiIngredientClassifier } from '../../src/infrastructure/ai/ingredient-classification.ts';
import { buildApp } from '../../src/http/app.ts';
import { buildTestServices, buildTestContainer, identity, servicesFor } from '../fakes/fixtures.ts';

describe('ingredient classification', () => {
  it('sorts existing and new shelves atomically, preserving ingredient details and stock state', async () => {
    const ctx = buildTestServices();
    try {
      const milk = ctx.services.stock.addManual({ name: 'Leite', notes: 'Half left' }).ingredient;
      ctx.services.stock.update(milk.id, { inStock: false });
      const soup = ctx.services.stock.addManual({ name: 'Miso soup' }).ingredient;
      const broth = ctx.services.stock.addManual({ name: 'Vegetable broth' }).ingredient;
      const mystery = ctx.services.stock.addManual({ name: 'Mystery jar' }).ingredient;
      const existing = ctx.services.stock.addManual({ name: 'Basil', category: 'herbs-spices' }).ingredient;
      ctx.classifier.answer = [{ id: milk.id, category: 'dairy' }, { id: soup.id, category: 'custom:Soups & broths' }, { id: broth.id, category: 'custom:soups & broths' }, { id: mystery.id, category: 'other' }];
      const result = await ctx.services.classification.classifyOther();
      assert.equal(result.classified.length, 3);
      assert.equal(result.remaining, 1);
      assert.deepEqual(result.newCategories, ['custom:Soups & broths']);
      assert.deepEqual(result.classified.find((item) => item.id === milk.id), { ...milk, category: 'dairy', inStock: false });
      assert.equal(ctx.services.stock.list().find((item) => item.id === existing.id)?.category, 'herbs-spices');
      assert.ok(ctx.services.stock.categories().includes('custom:Soups & broths'));
      // A new per-request graph over the same database retains the custom category.
      assert.ok(servicesFor(ctx.db, ctx.user.id, ctx.detector, ctx.generator).stock.categories().includes('custom:Soups & broths'));
    } finally { ctx.db.close(); }
  });

  it('does not call ChatGPT for an empty Other shelf', async () => {
    const ctx = buildTestServices();
    try { assert.deepEqual(await ctx.services.classification.classifyOther(), { classified: [], remaining: 0, newCategories: [] }); assert.equal(ctx.classifier.calls, 0); }
    finally { ctx.db.close(); }
  });

  it('rejects incomplete, duplicate, foreign and invalid assignments without partial writes', async () => {
    const ctx = buildTestServices();
    try {
      const a = ctx.services.stock.addManual({ name: 'Milk' }).ingredient;
      const b = ctx.services.stock.addManual({ name: 'Soup' }).ingredient;
      for (const answer of [[], [{ id: a.id, category: 'dairy' as const }], [{ id: a.id, category: 'dairy' as const }, { id: a.id, category: 'grains' as const }], [{ id: a.id, category: 'dairy' as const }, { id: 9999, category: 'grains' as const }]]) {
        ctx.classifier.answer = answer;
        await assert.rejects(ctx.services.classification.classifyOther(), AiUnavailableError);
        assert.deepEqual(ctx.services.stock.list().map((item) => item.category), ['other', 'other']);
      }
      const invalid = new AiIngredientClassifier({ complete: async () => ({ ingredients: [{ id: a.id, category: 'dairy' }, { id: b.id, category: 'custom:<script>' }] }) }, 'low');
      await assert.rejects(new IngredientClassificationService(invalid, ctx.services.stock).classifyOther(), AiUnavailableError);
      assert.equal(ctx.services.stock.list().every((item) => item.category === 'other'), true);
      ctx.classifier.answer = new AiUnavailableError('ChatGPT unavailable');
      await assert.rejects(ctx.services.classification.classifyOther(), /ChatGPT unavailable/);
    } finally { ctx.db.close(); }
  });

  it('does not overwrite edits or deleted ingredients while ChatGPT is thinking', async () => {
    const ctx = buildTestServices();
    try {
      const a = ctx.services.stock.addManual({ name: 'Milk' }).ingredient;
      const b = ctx.services.stock.addManual({ name: 'Soup' }).ingredient;
      const c = ctx.services.stock.addManual({ name: 'Rice' }).ingredient;
      const service = new IngredientClassificationService({ classify: async () => {
        ctx.services.stock.update(a.id, { category: 'drinks' });
        ctx.services.stock.remove(b.id);
        ctx.services.stock.update(c.id, { notes: 'Edited during request' });
        return [{ id: a.id, category: 'dairy' }, { id: b.id, category: 'custom:Soups' }, { id: c.id, category: 'grains' }];
      } }, ctx.services.stock);
      assert.equal((await service.classifyOther()).classified.length, 0);
      assert.equal(ctx.services.stock.list().find((item) => item.id === a.id)?.category, 'drinks');
      assert.equal(ctx.services.stock.list().find((item) => item.id === c.id)?.notes, 'Edited during request');
    } finally { ctx.db.close(); }
  });

  it('serves the authenticated endpoint and keeps user pantries isolated', async () => {
    const ctx = buildTestContainer(Date.now);
    const app = await buildApp(ctx.container);
    try {
      assert.equal((await app.inject({ method: 'POST', url: '/api/ingredients/classify-other', payload: {} })).statusCode, 401);
      const start = await app.inject({ url: '/auth/chatgpt/start' });
      const done = await app.inject({ url: '/auth/callback?' + ctx.openai.callbackParams(), cookies: { ps_signin: start.cookies.find((cookie) => cookie.name === 'ps_signin')!.value } });
      const cookie = done.cookies.find((cookie) => cookie.name === 'ps_session')!.value;
      const user = ctx.auth.userForSession(cookie)!;
      const stock = ctx.container.forUser(user.id).stock;
      const milk = stock.addManual({ name: 'Milk' }).ingredient;
      const other = ctx.repos.users.create(identity('user-b'));
      const privateItem = ctx.container.forUser(other.id).stock.addManual({ name: 'Private soup' }).ingredient;
      ctx.classifier.answer = [{ id: milk.id, category: 'dairy' }];
      const result = await app.inject({ method: 'POST', url: '/api/ingredients/classify-other', cookies: { ps_session: cookie }, payload: {} });
      assert.equal(result.statusCode, 200, result.body);
      assert.equal(result.json().classified[0].category, 'dairy');
      assert.equal(ctx.container.forUser(other.id).stock.list()[0]?.id, privateItem.id);
      assert.equal(ctx.container.forUser(other.id).stock.list()[0]?.category, 'other');
    } finally { await app.close(); ctx.db.close(); }
  });
});
