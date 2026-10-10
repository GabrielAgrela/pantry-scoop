import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { buildApp } from '../../src/http/app.ts';
import { SqliteCookingLogRepository } from '../../src/infrastructure/db/sqlite-cooking-log-repository.ts';
import { buildTestContainer, FIXED_NOW, identity, sampleRecipe } from '../fakes/fixtures.ts';

describe('I cooked this', () => {
  let ctx: ReturnType<typeof buildTestContainer>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let session: string;
  beforeEach(async () => {
    ctx = buildTestContainer();
    app = await buildApp(ctx.container);
    ctx.openai.nextIdentity = identity('cook');
    const start = await app.inject({ method: 'GET', url: '/auth/chatgpt/start' });
    const done = await app.inject({ method: 'GET', url: `/auth/callback?${ctx.openai.callbackParams()}`, cookies: { ps_signin: start.cookies.find(c => c.name === 'ps_signin')!.value } });
    session = done.cookies.find(c => c.name === 'ps_session')!.value;
  });
  afterEach(async () => { await app.close(); ctx.db.close(); });
  const cookId = () => ctx.repos.users.findBySubject('https://auth.openai.com', 'cook')!.id;
  const cooked = (payload: object) => app.inject({ method: 'POST', url: '/api/recipes/cooked', cookies: { ps_session: session }, payload });
  const log = () => new SqliteCookingLogRepository(ctx.db, cookId()).list(10);

  it('logs the meal and marks only the ticked pantry items as run out', async () => {
    const { stock } = ctx.container.forUser(cookId());
    const milk = stock.addManual({ name: 'Leite magro', category: 'dairy' }).ingredient;
    const cream = stock.addManual({ name: 'Natas', category: 'dairy' }).ingredient;

    const response = await cooked({ recipe: sampleRecipe(), ranOut: [cream.id, cream.id] });
    assert.equal(response.statusCode, 201, response.body);
    assert.deepEqual(response.json().ranOut.map((item: { name: string; inStock: boolean }) => [item.name, item.inStock]), [['Natas', false]]);
    assert.equal(response.json().meal.cookedAt, FIXED_NOW().toISOString());
    assert.deepEqual(stock.list().map((item) => [item.name, item.inStock]), [['Leite magro', true], ['Natas', false]]);
    assert.equal(milk.inStock, true);

    assert.equal((await cooked({ recipe: sampleRecipe({ title: 'Second go' }) })).statusCode, 201, 'nothing has to run out');
    assert.deepEqual(log().map((meal) => meal.recipe.title), ['Second go', 'Ferrero-style hazelnut']);
  });

  it('refuses pantry items the recipe does not use, and then logs nothing', async () => {
    const { stock } = ctx.container.forUser(cookId());
    stock.addManual({ name: 'Natas', category: 'dairy' });
    const basil = stock.addManual({ name: 'Basil', category: 'herbs-spices' }).ingredient;

    for (const ranOut of [[basil.id], ['1'], [0], 'all']) {
      assert.equal((await cooked({ recipe: sampleRecipe(), ranOut })).statusCode, 400, JSON.stringify(ranOut));
    }
    assert.equal((await cooked({ recipe: { title: 'Not a recipe' } })).statusCode, 400);
    assert.deepEqual(log(), []);
    assert.equal(stock.list().find((item) => item.id === basil.id)!.inStock, true);
  });
});
