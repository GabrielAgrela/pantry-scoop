import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { AiUnavailableError, ConflictError, NotFoundError, ValidationError } from '../../src/domain/errors.ts';
import { createDraft } from '../../src/domain/ingredient.ts';
import { DEFAULT_PROFILE } from '../../src/domain/kitchen-profile.ts';
import { ProfileService } from '../../src/application/profile-service.ts';
import { SqliteProfileRepository } from '../../src/infrastructure/db/sqlite-profile-repository.ts';
import { buildTestServices, sampleRecipe, TINY_JPEG } from '../fakes/fixtures.ts';

let ctx: ReturnType<typeof buildTestServices>;
beforeEach(() => {
  ctx = buildTestServices();
});

describe('StockService', () => {
  it('assigns emojis on add and rename, and preserves them through notes and restocking', () => {
    const { stock } = ctx.services;
    const milk = stock.addManual({ name: 'Leite magro' }).ingredient;
    assert.equal(milk.emoji, '🥛');
    assert.equal(stock.update(milk.id, { notes: 'Half left', inStock: false }).emoji, '🥛');
    assert.equal(stock.addManual({ name: 'LEITE MAGRO' }).ingredient.emoji, '🥛');
    assert.equal(stock.update(milk.id, { name: 'Strawberries', category: 'fruit' }).emoji, '🍓');
    const scanned = stock.addIfMissing(createDraft({ name: 'Coco ralado' }, 'photo'));
    assert.equal(scanned.ingredient.emoji, '🥥');
  });

  it('adds an ingredient only once, whatever the spelling', () => {
    const { stock } = ctx.services;
    const first = stock.addIfMissing(createDraft({ name: 'Leite magro', category: 'dairy' }, 'photo'));
    const again = stock.addIfMissing(createDraft({ name: 'LEITE  MAGRO' }, 'photo'));

    assert.equal(first.status, 'created');
    assert.equal(again.status, 'unchanged');
    assert.equal(again.ingredient.id, first.ingredient.id);
    assert.equal(stock.list().length, 1);
  });

  it('reports duplicates on manual add', () => {
    ctx.services.stock.addManual({ name: 'Natas' });
    assert.throws(() => ctx.services.stock.addManual({ name: 'natas' }), ConflictError);
  });

  it('edits name, category and notes', () => {
    const { stock } = ctx.services;
    const natas = stock.addManual({ name: 'Natas' }).ingredient;
    const updated = stock.update(natas.id, { name: 'Natas para bater', category: 'dairy', notes: '35% fat' });
    assert.deepEqual(
      { name: updated.name, category: updated.category, notes: updated.notes },
      { name: 'Natas para bater', category: 'dairy', notes: '35% fat' },
    );
  });

  it('refuses to rename onto another ingredient but allows re-casing itself', () => {
    const { stock } = ctx.services;
    stock.addManual({ name: 'Natas' });
    const milk = stock.addManual({ name: 'Leite' }).ingredient;
    assert.throws(() => stock.update(milk.id, { name: 'NATAS' }), ConflictError);
    assert.equal(stock.update(milk.id, { name: 'LEITE' }).name, 'LEITE');
  });

  it('marks items as run out and back, keeping their details', () => {
    const { stock } = ctx.services;
    const natas = stock.addManual({ name: 'Natas', notes: '35% fat' }).ingredient;
    const out = stock.update(natas.id, { inStock: false });
    assert.equal(out.inStock, false);
    assert.equal(out.notes, '35% fat');
    assert.deepEqual(stock.listInStock(), []);
    assert.equal(stock.list().length, 1);
    assert.throws(() => stock.update(natas.id, { inStock: 'no' }), ValidationError);
  });

  it('restocks a run-out item instead of duplicating it, by photo or by hand', () => {
    const { stock } = ctx.services;
    const natas = stock.addManual({ name: 'Natas' }).ingredient;
    stock.update(natas.id, { inStock: false });

    const viaPhoto = stock.addIfMissing(createDraft({ name: 'natas' }, 'photo'));
    assert.equal(viaPhoto.status, 'restocked');
    assert.equal(viaPhoto.ingredient.id, natas.id);
    assert.equal(viaPhoto.ingredient.inStock, true);

    stock.update(natas.id, { inStock: false });
    assert.equal(stock.addManual({ name: 'NATAS' }).status, 'restocked');
    assert.equal(stock.list().length, 1);
  });

  it('removes ingredients and reports unknown ids', () => {
    const { stock } = ctx.services;
    const natas = stock.addManual({ name: 'Natas' }).ingredient;
    stock.remove(natas.id);
    assert.equal(stock.list().length, 0);
    assert.throws(() => stock.remove(natas.id), NotFoundError);
    assert.throws(() => stock.update(999, { name: 'x' }), NotFoundError);
  });
});

describe('ScanService', () => {
  it('adds new detections, reports known ones and ignores repeats within a photo', async () => {
    const { stock, scan } = ctx.services;
    stock.addManual({ name: 'Natas', category: 'dairy' });
    ctx.detector.answer = [
      { name: 'Nutella', category: 'chocolate' },
      { name: 'natas', category: 'dairy' },
      { name: 'NUTELLA', category: 'chocolate' },
    ];

    const result = await scan.scan([TINY_JPEG]);

    assert.deepEqual(result.added.map((i) => [i.name, i.source]), [['Nutella', 'photo']]);
    assert.deepEqual(result.alreadyInStock.map((i) => i.name), ['Natas']);
    assert.deepEqual(ctx.detector.calls[0]!.knownNames, ['Natas']);
    assert.equal(stock.list().length, 2);
  });

  it('puts run-out items back in stock and offers their names to the detector', async () => {
    const { stock, scan } = ctx.services;
    const mango = stock.addManual({ name: 'Manga', category: 'fruit' }).ingredient;
    stock.update(mango.id, { inStock: false });
    ctx.detector.answer = [{ name: 'MANGA', category: 'fruit' }];

    const result = await scan.scan([TINY_JPEG]);

    assert.deepEqual(ctx.detector.calls[0]!.knownNames, ['Manga']);
    assert.deepEqual(result.restocked.map((i) => [i.name, i.inStock]), [['Manga', true]]);
    assert.deepEqual(result.added, []);
    assert.deepEqual(result.alreadyInStock, []);
  });

  it('leaves stock untouched when detection fails', async () => {
    ctx.detector.answer = new AiUnavailableError('down');
    await assert.rejects(ctx.services.scan.scan([TINY_JPEG]), AiUnavailableError);
    assert.equal(ctx.services.stock.list().length, 0);
  });
});

describe('ProfileService', () => {
  it('starts from the default, persists updates and can reset', () => {
    const { profile } = ctx.services;
    assert.deepEqual(profile.get(), DEFAULT_PROFILE);
    profile.update({ servings: 4 });
    assert.equal(profile.get().servings, 4);
    assert.deepEqual(profile.reset(), DEFAULT_PROFILE);
  });

  it('gives a profile saved before dish types existed the default ones', () => {
    const { dishTypes: _, setupComplete: _complete, setupStep: _step, ...older } = { ...DEFAULT_PROFILE, servings: 3, appliances: [{ name: 'My oven', details: '200°C' }], preferences: 'Vegetarian' };
    ctx.db.prepare('INSERT INTO kitchen_profiles (user_id, data) VALUES (?, ?)').run(ctx.user.id, JSON.stringify(older));
    assert.deepEqual(ctx.services.profile.get(), { ...DEFAULT_PROFILE, ...older, setupComplete: true });
  });

  it('persists incomplete setup through appliance saves and completes across service instances', () => {
    ctx.services.profile.update({ appliances: [{ name: 'Hob', details: '' }], setupStep: 1 });
    const profile = new ProfileService(new SqliteProfileRepository(ctx.db, ctx.user.id));
    assert.equal(profile.get().setupComplete, false);
    assert.equal(profile.get().setupStep, 1);
    profile.update({ units: 'Metric', language: 'Português', setupStep: 2 });
    profile.update({ preferences: 'Vegetarian', setupComplete: true });
    assert.equal(ctx.services.profile.get().setupComplete, true);
    assert.equal(ctx.services.profile.get().language, 'Português');
  });
});

describe('RecipeService', () => {
  it('needs something in stock before suggesting', async () => {
    await assert.rejects(ctx.services.recipes.suggest({}), ValidationError);
    const natas = ctx.services.stock.addManual({ name: 'Natas' }).ingredient;
    ctx.services.stock.update(natas.id, { inStock: false });
    await assert.rejects(ctx.services.recipes.suggest({}), /Nothing is in stock/);
  });

  it('only cooks with items that are in stock', async () => {
    const { stock, recipes } = ctx.services;
    stock.addManual({ name: 'Natas' });
    const eggs = stock.addManual({ name: 'Ovos' }).ingredient;
    stock.update(eggs.id, { inStock: false });
    await recipes.suggest({});
    assert.deepEqual(ctx.generator.calls[0]!.stock.map((i) => i.name), ['Natas']);
  });

  it('passes the desired appliances through', async () => {
    ctx.services.stock.addManual({ name: 'Natas' });
    ctx.services.profile.update({ appliances: [{ name: 'Oven', details: '' }] });
    await ctx.services.recipes.suggest({ appliances: ['oven'] });
    assert.deepEqual(ctx.generator.calls[0]!.request.appliances, ['Oven']);
  });

  it('passes stock, profile and the parsed request to the generator', async () => {
    const { stock, profile, recipes } = ctx.services;
    stock.addManual({ name: 'Natas' });
    profile.update({ servings: 4 });

    const result = await recipes.suggest({ count: 1, craving: 'mango', kind: 'dessert' });

    assert.equal(result.length, 1);
    const call = ctx.generator.calls[0]!;
    assert.deepEqual(call.stock.map((i) => i.name), ['Natas']);
    assert.equal(call.profile.servings, 4);
    assert.deepEqual(call.request, { kind: 'Dessert', count: 1, servings: 4, maxMissing: 0, craving: 'mango', appliances: [], avoidAppliances: [], difficulty: 'any' });
  });

  it('lets a request override the default servings', async () => {
    ctx.services.stock.addManual({ name: 'Ovos' });
    await ctx.services.recipes.suggest({ servings: 6 });
    assert.equal(ctx.generator.calls[0]!.request.servings, 6);
  });

  it('saves, lists and deletes recipes', () => {
    const { recipes } = ctx.services;
    const saved = recipes.save(sampleRecipe());
    assert.deepEqual(recipes.listSaved(), [saved]);
    recipes.removeSaved(saved.id);
    assert.deepEqual(recipes.listSaved(), []);
    assert.throws(() => recipes.removeSaved(saved.id), NotFoundError);
    assert.throws(() => recipes.save({ title: 'half a recipe' }), ValidationError);
  });
});
