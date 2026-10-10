import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { buildApp } from '../../src/http/app.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../src/domain/errors.ts';
import { accountRepos, buildTestContainer, buildTestServices, identity, servicesFor } from '../fakes/fixtures.ts';

describe('ShoppingService', () => {
  let ctx: ReturnType<typeof buildTestServices>;
  beforeEach(() => { ctx = buildTestServices(); });
  afterEach(() => ctx.db.close());

  it('keeps hand-added items once each, and moves a bought one into the pantry', () => {
    const { shopping, stock } = ctx.services;
    const bread = shopping.add({ name: '  Pão   de forma ' });
    assert.deepEqual([bread.name, bread.emoji.length > 0], ['Pão de forma', true]);
    assert.throws(() => shopping.add({ name: 'pao de FORMA' }), ConflictError);
    assert.throws(() => shopping.add({ name: '' }), ValidationError);

    const ingredient = shopping.bought(bread.id);
    assert.deepEqual([ingredient.name, ingredient.inStock, ingredient.category], ['Pão de forma', true, 'other']);
    assert.deepEqual(shopping.list().items, []);
    assert.throws(() => shopping.bought(bread.id), NotFoundError);
    assert.equal(stock.list().length, 1);
  });

  it('restocks a run-out pantry item when its hand-added twin is bought', () => {
    const { shopping, stock } = ctx.services;
    const milk = stock.addManual({ name: 'Leite', category: 'dairy' }).ingredient;
    stock.update(milk.id, { inStock: false });
    const bought = shopping.bought(shopping.add({ name: 'leite' }).id);
    assert.deepEqual([bought.id, bought.inStock, bought.category], [milk.id, true, 'dairy']);
  });

  it('remembers what is not needed, and forgets a pantry item once it is back in stock', () => {
    const { shopping, stock } = ctx.services;
    const eggs = stock.addManual({ name: 'Ovos' }).ingredient;
    stock.update(eggs.id, { inStock: false });
    shopping.hide({ key: `pantry:${eggs.id}`, recipeIds: ['saved:3', 'saved:3', 'idea:9:0'] });
    const flour = shopping.hide({ key: 'new:farinha', recipeIds: ['idea:9:0'] });
    assert.deepEqual(shopping.list().hidden.map((entry) => [entry.key, entry.recipeIds]), [[`pantry:${eggs.id}`, ['saved:3', 'idea:9:0']], ['new:farinha', ['idea:9:0']]]);
    assert.equal(shopping.hide({ key: 'new:farinha', recipeIds: ['idea:9:0', 'saved:5'] }).id, flour.id, 'hiding again updates the entry');

    stock.update(eggs.id, { notes: 'free range' });
    assert.equal(shopping.list().hidden.length, 2, 'other edits keep it hidden');
    stock.update(eggs.id, { inStock: true });
    assert.deepEqual(shopping.list().hidden.map((entry) => entry.key), ['new:farinha']);

    shopping.unhide(flour.id);
    assert.deepEqual(shopping.list().hidden, []);
    assert.throws(() => shopping.unhide(flour.id), NotFoundError);
  });

  it('forgets a hidden pantry item when the ingredient is deleted', () => {
    const { shopping, stock } = ctx.services;
    const eggs = stock.addManual({ name: 'Ovos' }).ingredient;
    shopping.hide({ key: `pantry:${eggs.id}` });
    stock.remove(eggs.id);
    assert.deepEqual(shopping.list().hidden, []);
  });

  it('rejects malformed keys and ingredients of someone else', () => {
    const { shopping } = ctx.services;
    for (const key of ['', 'milk', 'pantry:0', 'pantry:abc', 'new: farinha', 'new:', `new:${'x'.repeat(200)}`, 7]) {
      assert.throws(() => shopping.hide({ key }), ValidationError, String(key));
    }
    for (const recipeIds of [[0], [3], ['saved:0'], ['idea:3'], ['other:3'], 'saved:3']) assert.throws(() => shopping.hide({ key: 'new:farinha', recipeIds }), ValidationError, String(recipeIds));
    const other = accountRepos(ctx.db).users.create(identity('someone-else'));
    const theirs = servicesFor(ctx.db, other.id, ctx.detector, ctx.generator).stock.addManual({ name: 'Ovos' }).ingredient;
    assert.throws(() => shopping.hide({ key: `pantry:${theirs.id}` }), NotFoundError);
  });

  it('keeps each person’s list to themselves', () => {
    const other = accountRepos(ctx.db).users.create(identity('someone-else'));
    const theirs = servicesFor(ctx.db, other.id, ctx.detector, ctx.generator).shopping;
    const item = ctx.services.shopping.add({ name: 'Arroz' });
    assert.deepEqual(theirs.list(), { items: [], hidden: [] });
    assert.throws(() => theirs.remove(item.id), NotFoundError);
    assert.throws(() => theirs.bought(item.id), NotFoundError);
    theirs.add({ name: 'Arroz' });
    assert.equal(ctx.services.shopping.list().items.length, 1);
  });
});

describe('shopping list API', () => {
  let ctx: ReturnType<typeof buildTestContainer>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let session: string;
  beforeEach(async () => {
    ctx = buildTestContainer(Date.now);
    app = await buildApp(ctx.container);
    ctx.openai.nextIdentity = identity('cook');
    const start = await app.inject({ method: 'GET', url: '/auth/chatgpt/start' });
    const done = await app.inject({ method: 'GET', url: `/auth/callback?${ctx.openai.callbackParams()}`, cookies: { ps_signin: start.cookies.find(c => c.name === 'ps_signin')!.value } });
    session = done.cookies.find(c => c.name === 'ps_session')!.value;
  });
  afterEach(async () => { await app.close(); ctx.db.close(); });
  const call = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url: `/api/shopping${url}`, cookies: { ps_session: session }, payload });

  it('adds, buys, removes, hides and shows items again', async () => {
    const added = await call('POST', '/items', { name: 'Arroz' });
    assert.equal(added.statusCode, 201, added.body);
    assert.equal((await call('POST', '/items', { name: 'arroz' })).statusCode, 409);
    const tea = (await call('POST', '/items', { name: 'Chá' })).json().item;
    assert.equal((await call('DELETE', `/items/${tea.id}`)).statusCode, 204);

    const bought = await call('POST', `/items/${added.json().item.id}/bought`);
    assert.equal(bought.statusCode, 200, bought.body);
    assert.deepEqual([bought.json().ingredient.name, bought.json().ingredient.inStock], ['Arroz', true]);

    const hidden = await call('POST', '/hidden', { key: 'new:farinha', recipeIds: ['saved:1'] });
    assert.equal(hidden.statusCode, 201, hidden.body);
    await call('POST', '/hidden', { key: 'new:acucar' });
    assert.equal((await call('DELETE', `/hidden/${hidden.json().hidden.id}`)).statusCode, 204);
    assert.deepEqual((await call('GET', '/')).json().hidden.map((entry: { key: string }) => entry.key), ['new:acucar']);
    assert.equal((await call('DELETE', '/hidden')).statusCode, 204);
    assert.deepEqual((await call('GET', '/')).json(), { items: [], hidden: [] });
    assert.equal((await call('POST', '/hidden', { key: 'nope' })).statusCode, 400);
  });

  it('needs a signed-in cook', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/shopping' })).statusCode, 401);
  });
});
