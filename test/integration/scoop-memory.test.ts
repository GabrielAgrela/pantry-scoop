import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { buildApp } from '../../src/http/app.ts';
import { AiUnavailableError } from '../../src/domain/errors.ts';
import { MAX_MEMORIES } from '../../src/domain/scoop-memory.ts';
import { buildTestContainer, identity, sampleRecipe } from '../fakes/fixtures.ts';

describe('Scoop’s memory', () => {
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
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url: `/api/recipes${url}`, cookies: { ps_session: session }, payload });
  const cook = () => ctx.container.forUser(ctx.repos.users.findBySubject('https://auth.openai.com', 'cook')!.id);

  it('proposes notes from feedback, remembers only what the cook confirms, and uses them for new ideas', async () => {
    ctx.generator.reflection = { reply: 'Noted!', notes: ['Finds desserts too sweet', 'Owns a stand mixer'] };
    cook().recipes.remember({ notes: ['Owns a stand mixer'], recipeTitle: 'Bolo' });
    const proposed = await call('POST', '/feedback', { recipe: sampleRecipe(), feedback: '  Way too sweet!  ' });
    assert.equal(proposed.statusCode, 200, proposed.body);
    assert.deepEqual(proposed.json(), { reply: 'Noted!', notes: ['Finds desserts too sweet'] }, 'already-remembered notes are not proposed again');
    assert.equal(ctx.generator.reflectCalls[0]!.feedback, 'Way too sweet!');
    assert.deepEqual(ctx.generator.reflectCalls[0]!.memories, ['Owns a stand mixer']);
    assert.equal((await call('GET', '/memories')).json().memories.length, 1, 'feedback alone remembers nothing');

    const saved = await call('POST', '/memories', { notes: [' Finds desserts  too sweet ', 'finds desserts too sweet', 'owns a STAND mixer'], recipeTitle: 'Gelado' });
    assert.equal(saved.statusCode, 201, saved.body);
    assert.deepEqual(saved.json().memories.map((m: { note: string; recipeTitle: string }) => [m.note, m.recipeTitle]), [['Finds desserts too sweet', 'Gelado']]);

    const services = cook();
    services.stock.addManual({ name: 'Natas', category: 'dairy' });
    await services.recipes.suggest({ count: 1 });
    assert.deepEqual(ctx.generator.calls.at(-1)!.memories, ['Owns a stand mixer', 'Finds desserts too sweet']);
  });

  it('lets the cook steer the proposed notes before keeping them', async () => {
    const history = [{ role: 'user', content: 'Erythritol is not sweet enough' }, { role: 'assistant', content: 'Noted!' }];
    ctx.generator.reflection = { reply: 'Changed it to 30%.', notes: ['Use about 30% more erythritol than sugar'] };
    const steered = await call('POST', '/feedback', { recipe: sampleRecipe(), feedback: '50% is too much, make it 30%', history, proposed: ['Use about 50% more erythritol than sugar'] });
    assert.equal(steered.statusCode, 200, steered.body);
    assert.deepEqual(steered.json().notes, ['Use about 30% more erythritol than sugar']);
    assert.deepEqual(ctx.generator.reflectCalls[0]!.steering, { history, proposed: ['Use about 50% more erythritol than sugar'] });
    assert.equal((await call('POST', '/feedback', { recipe: sampleRecipe(), feedback: 'Great' })).statusCode, 200);
    assert.equal(ctx.generator.reflectCalls[1]!.steering, undefined, 'first feedback is not steering');
    const rounds = (n: number) => Array.from({ length: n * 2 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' }));
    assert.equal((await call('POST', '/feedback', { recipe: sampleRecipe(), feedback: 'again', history: rounds(3), proposed: [] })).statusCode, 200);
    for (const changes of [{ history: rounds(4) }, { history: [history[0]] }, { proposed: undefined }, { proposed: ['x'.repeat(241)] }, { proposed: Array(7).fill('n') }]) {
      assert.equal((await call('POST', '/feedback', { recipe: sampleRecipe(), feedback: 'more', history, proposed: ['n'], ...changes })).statusCode, 400, JSON.stringify(changes).slice(0, 80));
    }
    assert.equal(ctx.generator.reflectCalls.length, 3);
  });

  it('forgets one note or everything, only for the signed-in cook', async () => {
    const other = ctx.container.forUser(ctx.repos.users.create(identity('other')).id);
    const [theirs] = other.recipes.remember({ notes: ['Private note'] });
    const [first] = cook().recipes.remember({ notes: ['A', 'B'] });
    assert.equal((await call('DELETE', `/memories/${theirs!.id}`)).statusCode, 404);
    assert.equal((await call('DELETE', `/memories/${first!.id}`)).statusCode, 204);
    assert.deepEqual((await call('GET', '/memories')).json().memories.map((m: { note: string }) => m.note), ['B']);
    assert.equal((await call('DELETE', '/memories')).statusCode, 204);
    assert.deepEqual((await call('GET', '/memories')).json().memories, []);
    assert.equal(other.recipes.listMemories().length, 1);
  });

  it('lets the cook rewrite a note, keeping it distinct and their own', async () => {
    const [sweet, oven] = cook().recipes.remember({ notes: ['Finds erythritol less sweet', 'Oven runs hot'], recipeTitle: 'Sorbet' });
    const edited = await call('PATCH', `/memories/${sweet!.id}`, { note: '  Use 20% more   erythritol than sugar ' });
    assert.equal(edited.statusCode, 200, edited.body);
    assert.deepEqual(edited.json().memory, { ...sweet, note: 'Use 20% more erythritol than sugar' });
    assert.equal((await call('PATCH', `/memories/${sweet!.id}`, { note: 'use 20% more erythritol than sugar' })).statusCode, 200, 'recasing itself is fine');
    for (const note of ['', '   ', 'x'.repeat(241), 42, 'oven RUNS hot']) {
      assert.equal((await call('PATCH', `/memories/${sweet!.id}`, { note })).statusCode, 400, String(note));
    }
    const other = ctx.container.forUser(ctx.repos.users.create(identity('other')).id);
    const [theirs] = other.recipes.remember({ notes: ['Private note'] });
    assert.equal((await call('PATCH', `/memories/${theirs!.id}`, { note: 'Mine now' })).statusCode, 404);
    assert.equal(other.recipes.listMemories()[0]!.note, 'Private note');
    assert.deepEqual(cook().recipes.listMemories().map((m) => m.note), ['use 20% more erythritol than sugar', oven!.note]);
  });

  it('rejects invalid feedback and notes, and a full memory', async () => {
    for (const payload of [{ recipe: {}, feedback: 'ok' }, { recipe: sampleRecipe(), feedback: ' ' }, { recipe: sampleRecipe(), feedback: 'x'.repeat(2001) }]) {
      assert.equal((await call('POST', '/feedback', payload)).statusCode, 400);
    }
    assert.equal(ctx.generator.reflectCalls.length, 0);
    for (const notes of [[], 'note', [1], ['x'.repeat(241)], Array.from({ length: 7 }, (_, i) => `n${i}`)]) {
      assert.equal((await call('POST', '/memories', { notes })).statusCode, 400);
    }
    const services = cook();
    for (let i = 0; i < MAX_MEMORIES; i += 6) services.recipes.remember({ notes: Array.from({ length: Math.min(6, MAX_MEMORIES - i) }, (_, j) => `n${i + j}`) });
    const full = await call('POST', '/memories', { notes: ['One more'] });
    assert.equal(full.statusCode, 400);
    assert.match(full.json().error, /memory is full/);
  });

  it('reports AI failures on feedback', async () => {
    ctx.generator.reflection = new AiUnavailableError('Temporarily unavailable');
    const failed = await call('POST', '/feedback', { recipe: sampleRecipe(), feedback: 'Great!' });
    assert.equal(failed.statusCode, 502);
  });
});
