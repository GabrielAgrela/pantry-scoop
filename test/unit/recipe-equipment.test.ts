import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_PROFILE } from '../../src/domain/kitchen-profile.ts';
import { createSuggestionRequest, type Recipe } from '../../src/domain/recipe.ts';
import { AiUnavailableError } from '../../src/domain/errors.ts';
import { AiRecipeGenerator, EQUIPMENT_REVIEW_SCHEMA, recipeSchema } from '../../src/infrastructure/ai/recipe-suggestion.ts';
import type { StructuredRequest } from '../../src/infrastructure/ai/structured-model.ts';
import { sampleRecipe } from '../fakes/fixtures.ts';

const profile = { ...DEFAULT_PROFILE, appliances: [{ name: 'Blender', details: '' }, { name: 'Freezer', details: '' }] };
const request = createSuggestionRequest({ kind: 'Ice cream' }, profile);
const sorbet = sampleRecipe({ title: 'Moscatel & Apple Sorbet with Nutmeg', equipment: ['Blender', 'Freezer'], steps: ['Blend the cooled apple with the syrup.', 'Churn in the ice-cream machine for 20–25 minutes.', 'Freeze for 2 hours.'] });

function generator(recipe: Recipe | Recipe[] = sorbet, review: unknown = { issues: [] }) {
  const calls: StructuredRequest[] = [];
  return {
    calls,
    ai: new AiRecipeGenerator({ complete: async (call) => {
      calls.push(call);
      return call.schemaName === 'recipe_equipment_review' ? review : { recipes: [recipe].flat() };
    } }, 'medium'),
  };
}

const freezerOnly = (title: string) => sampleRecipe({ title, equipment: ['Freezer'], steps: ['Freeze in a shallow tray, stirring by hand.'] });

describe('recipe equipment enforcement', () => {
  it('restricts schema choices to available, non-excluded appliances', async () => {
    const { ai, calls } = generator(sampleRecipe({ equipment: ['Freezer'], steps: ['Freeze in a shallow tray, stirring by hand.'] }));
    await ai.suggest([], profile, { ...request, avoidAppliances: ['Blender'] });
    const schema = calls[0]!.schema as ReturnType<typeof recipeSchema>;
    assert.deepEqual(schema.properties.recipes.items.properties.equipment.items, { type: 'string', enum: ['Freezer'] });
    assert.doesNotMatch(calls[0]!.prompt, /- Blender/);
    assert.match(calls[0]!.prompt, /available kitchen equipment takes priority/);
    const empty = recipeSchema([], []).properties.recipes.items.properties.equipment;
    assert.equal('maxItems' in empty && empty.maxItems, 0);
  });

  it('rejects unavailable and excluded declared appliances before the review', async () => {
    for (const [equipment, choices] of [
      [['Ice-cream machine'], request],
      [['Blender'], { ...request, avoidAppliances: ['Blender'] }],
    ] as const) {
      const { ai, calls } = generator(sampleRecipe({ equipment }));
      await assert.rejects(ai.suggest([], profile, choices), /appliance choices/);
      assert.equal(calls.length, 1);
    }
  });

  it('rejects omission of a required appliance', async () => {
    const { ai } = generator(sampleRecipe({ equipment: ['Freezer'] }));
    await assert.rejects(ai.suggest([], profile, { ...request, appliances: ['Blender'] }), /appliance choices/);
  });

  it('blocks the reported sorbet when the reviewer finds a machine hidden in the method', async () => {
    const { ai, calls } = generator(sorbet, { issues: [{ recipeIndex: 0, reason: 'Churning requires an unavailable ice-cream machine.' }] });
    await assert.rejects(ai.suggest([], profile, request), /instructions did not match your kitchen equipment/);
    assert.equal(calls.length, 2);
    assert.equal(calls[1]!.schema, EQUIPMENT_REVIEW_SCHEMA);
    assert.match(calls[1]!.prompt, /Churn in the ice-cream machine/);
    assert.match(calls[1]!.prompt, /"availableAppliances":\["Blender","Freezer"\]/);
    assert.match(calls[1]!.prompt, /implicit uses/);
  });

  it('checks prose against the equipment list even when the kitchen owns the appliance', async () => {
    const kitchen = { ...profile, appliances: [...profile.appliances, { name: 'Ice-cream machine', details: '' }] };
    const { ai } = generator(sorbet, { issues: [{ recipeIndex: 0, reason: 'Machine missing from the equipment list.' }] });
    await assert.rejects(ai.suggest([], kitchen, request), /instructions did not match/);
  });

  it('returns a reviewed freezer method without changing the public recipe shape', async () => {
    const manual = { ...sorbet, steps: ['Blend the apple mixture.', 'Freeze in a shallow tray, stirring by hand every 30 minutes until frozen.'] };
    const { ai, calls } = generator(manual);
    assert.deepEqual(await ai.suggest([], profile, request), [manual]);
    assert.equal(calls.length, 2);
  });

  it('drops a recipe with mismatched declared equipment and keeps the rest', async () => {
    const batch = [freezerOnly('Granita'), sampleRecipe({ title: 'Churned', equipment: ['Ice-cream machine'] }), freezerOnly('Semifreddo')];
    const { ai, calls } = generator(batch);
    assert.deepEqual((await ai.suggest([], profile, request)).map((recipe) => recipe.title), ['Granita', 'Semifreddo']);
    // Only the surviving recipes are reviewed, so the reviewer's indexes refer to them.
    assert.doesNotMatch(calls[1]!.prompt, /Churned/);
  });

  it('drops only the recipes the reviewer flags', async () => {
    const batch = [freezerOnly('Granita'), sorbet, freezerOnly('Semifreddo')];
    const { ai } = generator(batch, { issues: [{ recipeIndex: 1, reason: 'Churning requires an ice-cream machine.' }] });
    assert.deepEqual((await ai.suggest([], profile, request)).map((recipe) => recipe.title), ['Granita', 'Semifreddo']);
  });

  it('fails when the reviewer flags every recipe', async () => {
    const batch = [sorbet, { ...sorbet, title: 'Churned pear' }];
    const issues = [0, 1].map((recipeIndex) => ({ recipeIndex, reason: 'Churning requires an ice-cream machine.' }));
    await assert.rejects(generator(batch, { issues }).ai.suggest([], profile, request), /instructions did not match your kitchen equipment/);
  });

  it('fails closed if the review is unavailable or malformed, without returning unreviewed recipes', async () => {
    for (const review of [null, {}, { issues: 'ok' }, { issues: [{ recipeIndex: 6, reason: 'x' }] }, { issues: [{ recipeIndex: 0, reason: '' }] }]) {
      await assert.rejects(generator(sorbet, review).ai.suggest([], profile, request), /appliance check could not be completed/);
    }
    const ai = new AiRecipeGenerator({ complete: async (call) => {
      if (call.schemaName === 'recipe_equipment_review') throw new AiUnavailableError('Review unavailable');
      return { recipes: [sorbet] };
    } }, 'medium');
    await assert.rejects(ai.suggest([], profile, request), /Review unavailable/);
  });
});
