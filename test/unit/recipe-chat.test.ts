import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AiRecipeGenerator } from '../../src/infrastructure/ai/recipe-suggestion.ts';
import { DEFAULT_PROFILE } from '../../src/domain/kitchen-profile.ts';
import type { StructuredRequest } from '../../src/infrastructure/ai/structured-model.ts';
import { sampleRecipe } from '../fakes/fixtures.ts';

describe('Scoop recipe answers', () => {
  it('uses recipe quantities, method, kitchen and conversation with bounded structured output', async () => {
    let received: StructuredRequest | undefined;
    const generator = new AiRecipeGenerator({ complete: async request => { received = request; return { answer: '  Use 200 ml.  ' }; } }, 'medium');
    const history = [{ role: 'user' as const, content: 'Can I use oat cream?' }, { role: 'assistant' as const, content: 'Yes.' }];
    assert.equal(await generator.ask(sampleRecipe(), [], DEFAULT_PROFILE, 'How much?', history), 'Use 200 ml.');
    const payload = JSON.parse(received!.prompt.slice(received!.prompt.indexOf('{')));
    assert.deepEqual(payload.recipe.steps, sampleRecipe().steps);
    assert.deepEqual(payload.recipe.ingredients, sampleRecipe().ingredients);
    assert.deepEqual(payload.kitchen, JSON.parse(JSON.stringify(DEFAULT_PROFILE)));
    assert.deepEqual(payload.history, history);
    assert.equal(payload.question, 'How much?');
    assert.equal(received!.schemaName, 'recipe_help');
    assert.equal(received!.effort, 'low');
  });
  it('rejects unusable model answers', async () => {
    for (const result of [null, {}, { answer: '' }, { answer: 4 }, { answer: 'x'.repeat(6001) }]) {
      const generator = new AiRecipeGenerator({ complete: async () => result }, 'medium');
      await assert.rejects(generator.ask(sampleRecipe(), [], DEFAULT_PROFILE, 'Help?', []), /Scoop could not answer/);
    }
  });
});
