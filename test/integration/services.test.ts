import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { AiUnavailableError, ConflictError, DailyLimitError, NotFoundError, ValidationError } from '../../src/domain/errors.ts';
import { createDraft } from '../../src/domain/ingredient.ts';
import { DEFAULT_PROFILE } from '../../src/domain/kitchen-profile.ts';
import { ProfileService } from '../../src/application/profile-service.ts';
import { SqliteProfileRepository } from '../../src/infrastructure/db/sqlite-profile-repository.ts';
import type { Recipe } from '../../src/domain/recipe.ts';
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
    assert.deepEqual(call.request, { kind: 'Dessert', count: 1, servings: 4, maxMissing: 0, craving: 'mango', appliances: [], avoidAppliances: [], useIngredients: [], avoidIngredients: [], difficulty: 'any', creativity: 'any' });
  });

  it('tells the generator about earlier ideas for a similar request', async () => {
    const { stock, recipes, jobs } = ctx.services;
    stock.addManual({ name: 'Natas' });
    recipes.save(sampleRecipe({ title: 'Saved sundae', kind: 'Dessert' }));
    ctx.generator.answer = [sampleRecipe({ title: 'Mango sorbet', kind: 'Dessert' }), sampleRecipe({ title: 'Roast chicken', kind: 'Dinner' })];
    const plan = recipes.plan({ craving: '' });
    const job = jobs.start('recipes', plan.request, async () => ({ recipes: await recipes.generate(plan) }));
    while (jobs.find(job.id)!.status === 'running') await new Promise((done) => setImmediate(done));

    await recipes.suggest({ kind: 'dessert' });
    assert.deepEqual(ctx.generator.calls.at(-1)!.pastTitles, ['Saved sundae', 'Mango sorbet']);
  });

  it('lets a request override the default servings', async () => {
    ctx.services.stock.addManual({ name: 'Ovos' });
    await ctx.services.recipes.suggest({ servings: 6 });
    assert.equal(ctx.generator.calls[0]!.request.servings, 6);
  });

  it('passes flavour and difficulty separately and preserves labels when saved', async () => {
    ctx.services.stock.addManual({ name: 'Natas' });
    ctx.generator.answer = [sampleRecipe({ title: 'Olive oil ice cream', difficulty: 'easy', creativity: 'adventurous' })];
    const [recipe] = await ctx.services.recipes.suggest({ difficulty: 'easy', creativity: 'adventurous' });
    assert.equal(ctx.generator.calls[0]!.request.creativity, 'adventurous');
    assert.equal(ctx.generator.calls[0]!.request.difficulty, 'easy');
    ctx.services.recipes.save(recipe);
    const saved = ctx.services.recipes.listSaved()[0]!.recipe;
    assert.equal(saved.difficulty, 'easy');
    assert.equal(saved.creativity, 'adventurous');
  });

  it('links a saved recipe ingredient to a pantry item stocked under its translated name', () => {
    const { recipes, stock } = ctx.services;
    const text = { title: 'Gelado', summary: '', makes: '', steps: ['Bate tudo.', 'Turbina.'], tips: ['Vodka.'],
      ingredients: [{ name: 'Leite magro', amount: '350 ml' }, { name: 'Natas', amount: '200 ml' }, { name: 'Avelãs', amount: 'um punhado' }] };
    recipes.save(sampleRecipe({ ingredients: [
      { name: 'Skimmed milk', amount: '350 ml', inStock: false },
      { name: 'Cream', amount: '200 ml', inStock: false },
      { name: 'Hazelnuts', amount: '1 handful', inStock: false },
    ], translations: { 'Português (Portugal)': text } }));
    const { ingredient } = stock.addManual({ name: 'Avelãs' });
    const [milk, , hazelnuts] = recipes.listSaved()[0]!.recipe.ingredients;
    assert.deepEqual([milk!.inStock, milk!.pantryId], [false, undefined]);
    assert.deepEqual([hazelnuts!.name, hazelnuts!.inStock, hazelnuts!.pantryId], ['Hazelnuts', true, ingredient.id]);
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

  async function finishedBatch(titles: string[]) {
    const { recipes, jobs } = ctx.services;
    ctx.generator.answer = titles.map((title) => sampleRecipe({ title }));
    const plan = recipes.plan({});
    const job = jobs.start('recipes', plan.request, async () => ({ recipes: await recipes.generate(plan) }));
    while (jobs.find(job.id)!.status === 'running') await new Promise((done) => setImmediate(done));
    return job.id;
  }

  it('writes new ideas in English and adds a translation in the kitchen language', async () => {
    ctx.services.stock.addManual({ name: 'Natas' });
    ctx.services.profile.update({ language: 'Français' });
    const id = await finishedBatch(['Crêpes']);
    const [recipe] = (ctx.services.jobs.find(id)!.result as { recipes: Recipe[] }).recipes;
    assert.equal(recipe!.language, 'English');
    assert.equal(recipe!.title, 'Crêpes');
    assert.equal(recipe!.translations!['Français']!.title, 'Crêpes [Français]');
    assert.equal(ctx.generator.calls[0]!.profile.language, 'Français', 'the prompt says to write in English');
  });

  it('keeps a new idea untranslated when the translation fails, for the recipes page to retry', async () => {
    ctx.services.stock.addManual({ name: 'Natas' });
    ctx.services.profile.update({ language: 'Español' });
    ctx.generator.translation = new AiUnavailableError('busy');
    const id = await finishedBatch(['Soup']);
    assert.equal(ctx.services.jobs.find(id)!.status, 'succeeded');
    const [recipe] = (ctx.services.jobs.find(id)!.result as { recipes: Recipe[] }).recipes;
    assert.equal(recipe!.translations, undefined);
  });

  it('adds translations to saved recipes and idea batches once, never changing the English text', async () => {
    const { stock, profile, recipes, jobs } = ctx.services;
    stock.addManual({ name: 'Natas' });
    const id = await finishedBatch(['Soup', 'Stew', 'Pie', 'Tart']);
    const saved = recipes.save(sampleRecipe({ title: 'Cake' }));
    profile.update({ language: 'Português (Portugal)' });

    assert.deepEqual(await recipes.translate([id, id, 999]), { saved: 1, batches: [id], failed: 0 });
    const cake = recipes.listSaved()[0]!;
    assert.deepEqual([cake.id, cake.recipe.title, cake.recipe.translations!['Português (Portugal)']!.title], [saved.id, 'Cake', 'Cake [Português (Portugal)]']);
    const batch = (jobs.find(id)!.result as { recipes: Recipe[] }).recipes;
    assert.deepEqual(batch.map((recipe) => recipe.title), ['Soup', 'Stew', 'Pie', 'Tart']);
    assert.deepEqual(batch.map((recipe) => recipe.translations!['Português (Portugal)']!.title), ['Soup', 'Stew', 'Pie', 'Tart'].map((title) => `${title} [Português (Portugal)]`));
    // Groups of three; the cook's own stock names go along so they stay untouched.
    assert.deepEqual(ctx.generator.translateCalls.map((call) => call.recipes.length).sort(), [1, 1, 3]);
    assert.deepEqual(ctx.generator.translateCalls[0]!.pantryNames, ['Natas']);

    const calls = ctx.generator.translateCalls.length;
    assert.deepEqual(await recipes.translate([id]), { saved: 0, batches: [], failed: 0 });
    assert.equal(ctx.generator.translateCalls.length, calls);

    // Switching languages adds another translation beside the first; English needs none.
    profile.update({ language: 'Español' });
    assert.deepEqual(await recipes.translate([id]), { saved: 1, batches: [id], failed: 0 });
    assert.deepEqual(Object.keys(recipes.listSaved()[0]!.recipe.translations!), ['Português (Portugal)', 'Español']);
    profile.update({ language: 'English' });
    assert.deepEqual(await recipes.translate([id]), { saved: 0, batches: [], failed: 0 });
  });

  it('leaves recipes alone for a kitchen language written as free text', async () => {
    ctx.services.recipes.save(sampleRecipe({ title: 'Cake' }));
    ctx.services.profile.update({ language: 'English steps, Portuguese ingredient names' });
    assert.deepEqual(await ctx.services.recipes.translate([]), { saved: 0, batches: [], failed: 0 });
    assert.equal(ctx.generator.translateCalls.length, 0);
  });

  it('stops translating when the daily AI requests run out, keeping the originals', async () => {
    const { stock, profile, recipes, jobs } = ctx.services;
    stock.addManual({ name: 'Natas' });
    const id = await finishedBatch(['Soup', 'Stew', 'Pie', 'Tart', 'Flan', 'Bread', 'Salad']);
    recipes.save(sampleRecipe({ title: 'Cake' }));
    profile.update({ language: 'Español' });
    ctx.generator.translation = new DailyLimitError('Out of requests.');

    assert.deepEqual(await recipes.translate([id]), { saved: 0, batches: [], failed: 8 });
    assert.ok(ctx.generator.translateCalls.length <= 3);
    assert.equal(recipes.listSaved()[0]!.recipe.translations, undefined);
    assert.equal((jobs.find(id)!.result as { recipes: Recipe[] }).recipes[0]!.translations, undefined);
  });
});
