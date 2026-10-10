import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertRecipe, createSuggestionRequest, missingIngredients, pastTitlesFor, sameOrder } from '../../src/domain/recipe.ts';
import { DEFAULT_PROFILE } from '../../src/domain/kitchen-profile.ts';
import { sampleRecipe } from '../fakes/fixtures.ts';

const profile = (servings: number) => ({ ...DEFAULT_PROFILE, servings, appliances: [{ name: 'Oven', details: '' }, { name: 'Blender', details: '' }] });

describe('createSuggestionRequest', () => {
  it('applies defaults', () => {
    assert.deepEqual(createSuggestionRequest({}, profile(2)), { kind: 'any', count: 3, servings: 2, maxMissing: 0, craving: '', appliances: [], avoidAppliances: [], useIngredients: [], avoidIngredients: [], difficulty: 'any', creativity: 'any' });
    assert.deepEqual(createSuggestionRequest(undefined, profile(4)), { kind: 'any', count: 3, servings: 4, maxMissing: 0, craving: '', appliances: [], avoidAppliances: [], useIngredients: [], avoidIngredients: [], difficulty: 'any', creativity: 'any' });
  });

  it('accepts form strings and trims the craving', () => {
    assert.deepEqual(createSuggestionRequest({ kind: 'dinner', count: '2', servings: '5', maxMissing: '1', craving: ' coffee ' }, profile(2)), {
      kind: 'Dinner',
      count: 2,
      servings: 5,
      maxMissing: 1,
      craving: 'coffee',
      appliances: [],
      avoidAppliances: [], useIngredients: [], avoidIngredients: [],
      difficulty: 'any',
      creativity: 'any',
    });
  });

  it('resolves desired appliances to the kitchen spelling, without duplicates', () => {
    const request = createSuggestionRequest({ appliances: ['oven', 'OVEN', 'Blender'] }, profile(2));
    assert.deepEqual(request.appliances, ['Oven', 'Blender']);
  });

  it('rejects appliances that are not in the kitchen', () => {
    assert.throws(() => createSuggestionRequest({ appliances: ['Air fryer'] }, profile(2)), /not in your kitchen/);
    assert.throws(() => createSuggestionRequest({ appliances: 'Oven' }, profile(2)), /list of names/);
  });

  it('resolves appliances to avoid and rejects one that is both used and avoided', () => {
    assert.deepEqual(createSuggestionRequest({ avoidAppliances: ['oven'] }, profile(2)).avoidAppliances, ['Oven']);
    assert.throws(() => createSuggestionRequest({ avoidAppliances: ['Air fryer'] }, profile(2)), /not in your kitchen/);
    assert.throws(() => createSuggestionRequest({ avoidAppliances: 'Oven' }, profile(2)), /avoidAppliances must be a list/);
    assert.throws(() => createSuggestionRequest({ appliances: ['Oven'], avoidAppliances: ['oven'] }, profile(2)), /both used and avoided/);
  });

  it('resolves ingredients to use or leave out against the stock', () => {
    const stock = [{ name: 'Natas' }, { name: 'Café' }];
    const request = createSuggestionRequest({ useIngredients: ['natas', 'NATAS'], avoidIngredients: ['cafe'] }, profile(2), stock);
    assert.deepEqual(request.useIngredients, ['Natas']);
    assert.deepEqual(request.avoidIngredients, ['Café']);
    assert.throws(() => createSuggestionRequest({ useIngredients: ['Mango'] }, profile(2), stock), /not in stock/);
    assert.throws(() => createSuggestionRequest({ avoidIngredients: 'Natas' }, profile(2), stock), /avoidIngredients must be a list/);
    assert.throws(() => createSuggestionRequest({ useIngredients: ['Natas'], avoidIngredients: ['natas'] }, profile(2), stock), /both used and left out/);
  });

  it('resolves the dish type to the kitchen spelling', () => {
    assert.equal(createSuggestionRequest({ kind: 'ICE  CREAM' }, profile(2)).kind, 'Ice cream');
    assert.equal(createSuggestionRequest({ kind: 'any' }, profile(2)).kind, 'any');
    const brunch = { ...profile(2), dishTypes: [{ name: 'Brunch', details: '' }] };
    assert.equal(createSuggestionRequest({ kind: 'brunch' }, brunch).kind, 'Brunch');
    assert.throws(() => createSuggestionRequest({ kind: 'Dinner' }, brunch), /Unknown kind/);
  });

  it('accepts a difficulty', () => {
    assert.equal(createSuggestionRequest({ difficulty: 'easy' }, profile(2)).difficulty, 'easy');
    assert.throws(() => createSuggestionRequest({ difficulty: 'expert' }, profile(2)), /Unknown difficulty/);
  });

  it('accepts flavour preferences and rejects unknown levels', () => {
    for (const creativity of ['any', 'familiar', 'creative', 'adventurous']) {
      assert.equal(createSuggestionRequest({ creativity }, profile(2)).creativity, creativity);
    }
    assert.throws(() => createSuggestionRequest({ creativity: 'unsafe' }, profile(2)), /Unknown creativity/);
  });

  it('rejects out-of-range values', () => {
    assert.throws(() => createSuggestionRequest({ count: 0 }, profile(2)), /count/);
    assert.throws(() => createSuggestionRequest({ count: 6 }, profile(2)), /count/);
    assert.throws(() => createSuggestionRequest({ maxMissing: 1.5 }, profile(2)), /maxMissing/);
    assert.throws(() => createSuggestionRequest({ craving: 'x'.repeat(301) }, profile(2)), /too long/);
    assert.throws(() => createSuggestionRequest({ servings: 0 }, profile(2)), /servings/);
    assert.throws(() => createSuggestionRequest({ kind: 'brunch' }, profile(2)), /Unknown kind/);
  });
});

describe('assertRecipe', () => {
  it('accepts a well-formed recipe', () => {
    const recipe = sampleRecipe();
    assert.equal(assertRecipe(recipe), recipe);
  });

  it('accepts recipes saved before the macro estimates', () => {
    const recipe = { ...sampleRecipe(), estimate: { kcalMin: 900, kcalMax: 1000, sugarGramsMin: 10, sugarGramsMax: 20 } };
    assert.equal(assertRecipe(recipe), recipe);
  });

  it('keeps older unclassified recipes readable and validates labels when present', () => {
    const { difficulty, creativity, ...older } = sampleRecipe();
    assert.equal(assertRecipe(older), older);
    assert.throws(() => assertRecipe({ ...older, difficulty: 'any' }), /difficulty/);
    assert.throws(() => assertRecipe({ ...older, creativity: 'unsafe' }), /creativity/);
    const adventurous = { ...older, difficulty: 'easy', creativity: 'adventurous' };
    assert.equal(assertRecipe(adventurous), adventurous);
  });

  it('names the broken field', () => {
    assert.throws(() => assertRecipe({ ...sampleRecipe(), title: '' }), /title/);
    assert.throws(() => assertRecipe({ ...sampleRecipe(), steps: [1] }), /steps/);
    assert.throws(() => assertRecipe({ ...sampleRecipe(), equipment: 'oven' }), /equipment/);
    assert.throws(() => assertRecipe({ ...sampleRecipe(), totalMinutes: '20' }), /totalMinutes/);
    assert.throws(() => assertRecipe({ ...sampleRecipe(), ingredients: [{ name: 'x' }] }), /ingredients/);
    assert.throws(() => assertRecipe({ ...sampleRecipe(), estimate: { kcalMin: 1 } }), /estimate/);
    assert.throws(() => assertRecipe({ ...sampleRecipe(), estimate: { ...sampleRecipe().estimate, proteinGrams: '12' } }), /estimate/);
    assert.throws(() => assertRecipe('nope'), /not an object/);
  });
});

describe('missingIngredients', () => {
  it('lists only out-of-stock lines', () => {
    assert.deepEqual(
      missingIngredients(sampleRecipe()).map((i) => i.name),
      ['Avelãs'],
    );
  });
});

describe('sameOrder', () => {
  const request = (overrides = {}) => ({ ...createSuggestionRequest({}, DEFAULT_PROFILE), ...overrides });

  it('matches the same order regardless of count, case, accents and list order', () => {
    const now = request({ craving: 'Crème brûlée', count: 1, appliances: ['Oven', 'Blender'], useIngredients: ['Natas'] });
    assert.ok(sameOrder(now, request({ craving: ' creme  BRULEE ', count: 5, appliances: ['blender', 'Oven'], useIngredients: ['natas'] })));
  });

  it('treats fields an older batch did not record as their defaults', () => {
    const { difficulty, creativity, useIngredients, avoidIngredients, ...older } = request();
    assert.ok(sameOrder(request(), older));
    assert.ok(!sameOrder(request({ difficulty: 'easy' }), older));
  });

  it('tells apart anything that shapes the ideas', () => {
    for (const change of [{ kind: 'Dinner' }, { servings: 7 }, { maxMissing: 2 }, { craving: 'pizza' }, { difficulty: 'hard' }, { creativity: 'adventurous' },
      { appliances: ['Oven'] }, { avoidAppliances: ['Oven'] }, { useIngredients: ['Natas'] }, { avoidIngredients: ['Natas'] }]) {
      assert.ok(!sameOrder(request(), request(change)), JSON.stringify(change));
    }
    assert.ok(!sameOrder(request(), null));
    assert.ok(!sameOrder(request(), {}));
  });
});

describe('pastTitlesFor', () => {
  const request = (overrides = {}) => ({ ...createSuggestionRequest({}, DEFAULT_PROFILE), ...overrides });

  it('lists every earlier idea when the request is open, without duplicates', () => {
    const titles = pastTitlesFor(request(), [
      { recipes: [sampleRecipe({ title: 'Mango sorbet' })] },
      { craving: 'pizza', recipes: [sampleRecipe({ title: 'mango  SORBET' }), sampleRecipe({ title: 'Pan pizza' })] },
    ]);
    assert.deepEqual(titles, ['Mango sorbet', 'Pan pizza']);
  });

  it('keeps only ideas that fit the same dish type, labels, appliances and ingredients', () => {
    const recipes = [
      sampleRecipe({ title: 'Fits' }),
      sampleRecipe({ title: 'Other dish', kind: 'Dinner' }),
      sampleRecipe({ title: 'Harder', difficulty: 'hard' }),
      sampleRecipe({ title: 'No blender', equipment: ['Ice-cream machine'] }),
      sampleRecipe({ title: 'No natas', ingredients: [{ name: 'Leite magro', amount: '1', inStock: true }] }),
    ];
    const titles = pastTitlesFor(request({ kind: 'Ice-Cream', difficulty: 'easy', appliances: ['blender'], useIngredients: ['natas'] }), [{ recipes }]);
    assert.deepEqual(titles, ['Fits']);
  });

  it('with a craving, keeps batches for the same craving and recipes that name it', () => {
    const titles = pastTitlesFor(request({ craving: 'Fries' }), [
      { craving: 'fries', recipes: [sampleRecipe({ title: 'Crispy potato wedges' })] },
      { craving: 'something salty', recipes: [sampleRecipe({ title: 'Garlic fries' }), sampleRecipe({ title: 'Popcorn' })] },
      { recipes: [sampleRecipe({ title: 'Sweet potato fries' }), sampleRecipe({ title: 'Mash' })] },
    ]);
    assert.deepEqual(titles, ['Crispy potato wedges', 'Garlic fries', 'Sweet potato fries']);
  });

  it('stops at the limit', () => {
    const recipes = Array.from({ length: 10 }, (_, i) => sampleRecipe({ title: `Idea ${i}` }));
    assert.equal(pastTitlesFor(request(), [{ recipes }], 4).length, 4);
  });
});
