import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertRecipe, createSuggestionRequest, missingIngredients } from '../../src/domain/recipe.ts';
import { DEFAULT_PROFILE } from '../../src/domain/kitchen-profile.ts';
import { sampleRecipe } from '../fakes/fixtures.ts';

const profile = (servings: number) => ({ ...DEFAULT_PROFILE, servings, appliances: [{ name: 'Oven', details: '' }, { name: 'Blender', details: '' }] });

describe('createSuggestionRequest', () => {
  it('applies defaults', () => {
    assert.deepEqual(createSuggestionRequest({}, profile(2)), { kind: 'any', count: 3, servings: 2, maxMissing: 0, craving: '', appliances: [], avoidAppliances: [], difficulty: 'any' });
    assert.deepEqual(createSuggestionRequest(undefined, profile(4)), { kind: 'any', count: 3, servings: 4, maxMissing: 0, craving: '', appliances: [], avoidAppliances: [], difficulty: 'any' });
  });

  it('accepts form strings and trims the craving', () => {
    assert.deepEqual(createSuggestionRequest({ kind: 'dinner', count: '2', servings: '5', maxMissing: '1', craving: ' coffee ' }, profile(2)), {
      kind: 'Dinner',
      count: 2,
      servings: 5,
      maxMissing: 1,
      craving: 'coffee',
      appliances: [],
      avoidAppliances: [],
      difficulty: 'any',
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

  it('names the broken field', () => {
    assert.throws(() => assertRecipe({ ...sampleRecipe(), title: '' }), /title/);
    assert.throws(() => assertRecipe({ ...sampleRecipe(), steps: [1] }), /steps/);
    assert.throws(() => assertRecipe({ ...sampleRecipe(), equipment: 'oven' }), /equipment/);
    assert.throws(() => assertRecipe({ ...sampleRecipe(), totalMinutes: '20' }), /totalMinutes/);
    assert.throws(() => assertRecipe({ ...sampleRecipe(), ingredients: [{ name: 'x' }] }), /ingredients/);
    assert.throws(() => assertRecipe({ ...sampleRecipe(), estimate: { kcalMin: 1 } }), /estimate/);
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
