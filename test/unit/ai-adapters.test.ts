import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AiUnavailableError } from '../../src/domain/errors.ts';
import { DEFAULT_PROFILE, LEGACY_PROFILE } from '../../src/domain/kitchen-profile.ts';
import {
  AiIngredientDetector,
  buildDetectionPrompt,
  DETECTION_SCHEMA,
  parseDetection,
} from '../../src/infrastructure/ai/ingredient-detection.ts';
import {
  AiRecipeGenerator,
  buildRecipePrompt,
  parseRecipes,
  RECIPE_SCHEMA,
} from '../../src/infrastructure/ai/recipe-suggestion.ts';
import type { StructuredModel, StructuredRequest } from '../../src/infrastructure/ai/structured-model.ts';
import { sampleRecipe, TINY_JPEG } from '../fakes/fixtures.ts';

/** Structured outputs require every object to list all its keys as required and forbid extras. */
function assertStrictSchema(schema: unknown, path = '$'): void {
  const node = schema as Record<string, unknown>;
  if (node.type === 'object') {
    const keys = Object.keys(node.properties as object).sort();
    assert.equal(node.additionalProperties, false, `${path}: additionalProperties must be false`);
    assert.deepEqual([...(node.required as string[])].sort(), keys, `${path}: all properties must be required`);
    for (const key of keys) assertStrictSchema((node.properties as Record<string, unknown>)[key], `${path}.${key}`);
  }
  if (node.type === 'array') assertStrictSchema(node.items, `${path}[]`);
}

function fakeModel(answer: unknown) {
  const requests: StructuredRequest[] = [];
  const model: StructuredModel = {
    complete: async (request) => {
      requests.push(request);
      return answer;
    },
  };
  return { model, requests };
}

const stockItem = (name: string, notes = '') => ({
  id: 1,
  name,
  category: 'dairy' as const,
  notes,
  source: 'manual' as const,
  inStock: true,
  createdAt: '',
});

describe('schemas', () => {
  it('are valid for strict structured output', () => {
    assertStrictSchema(DETECTION_SCHEMA);
    assertStrictSchema(RECIPE_SCHEMA);
  });
});

describe('AiIngredientDetector', () => {
  it('sends the photos, the schema and the known stock names', async () => {
    const { model, requests } = fakeModel({ ingredients: [{ name: 'Natas', category: 'dairy' }] });
    const result = await new AiIngredientDetector(model, 'low').detect([TINY_JPEG], ['Leite magro']);

    assert.deepEqual(result, [{ name: 'Natas', category: 'dairy' }]);
    assert.equal(requests[0]!.images?.length, 1);
    assert.equal(requests[0]!.schema, DETECTION_SCHEMA);
    assert.equal(requests[0]!.schemaName, 'pantry_ingredients');
    assert.equal(requests[0]!.effort, 'low');
    assert.match(requests[0]!.prompt, /- Leite magro/);
  });

  it('asks for stocked items too, so the app can report them as already present', () => {
    const prompt = buildDetectionPrompt(['Natas']);
    assert.match(prompt, /including the ones that are already in stock/);
    assert.match(prompt, /do not leave these out/);
  });

  it('says so when the stock is empty', () => {
    assert.match(buildDetectionPrompt([]), /\(none yet\)/);
  });
});

describe('parseDetection', () => {
  it('drops blank names and maps unknown categories to other', () => {
    assert.deepEqual(
      parseDetection({
        ingredients: [
          { name: '  Manga  ', category: 'fruit' },
          { name: '', category: 'fruit' },
          { name: 'Mystery', category: 'meat' },
          null,
        ],
      }),
      [
        { name: 'Manga', category: 'fruit' },
        { name: 'Mystery', category: 'other' },
      ],
    );
  });

  it('rejects answers without a list', () => {
    assert.throws(() => parseDetection({}), AiUnavailableError);
    assert.throws(() => parseDetection(null), AiUnavailableError);
  });
});

describe('AiRecipeGenerator', () => {
  it('puts the stock, machine and request into the prompt', async () => {
    const { model, requests } = fakeModel({ recipes: [sampleRecipe()] });
    const request = { kind: 'Ice cream', count: 2, servings: 2, maxMissing: 0, craving: 'coffee', appliances: [], avoidAppliances: [], difficulty: 'any' as const };
    const recipes = await new AiRecipeGenerator(model, 'medium').suggest([stockItem('Natas', 'half carton left')], LEGACY_PROFILE, request);

    assert.equal(recipes.length, 1);
    const prompt = requests[0]!.prompt;
    assert.match(prompt, /Suggest 2 different recipe/);
    assert.match(prompt, /Type: Ice cream \(Frozen dessert made in the ice-cream machine\)/);
    assert.deepEqual((requests[0]!.schema as typeof RECIPE_SCHEMA).properties.recipes.items.properties.kind.enum, DEFAULT_PROFILE.dishTypes.map((d) => d.name));
    assert.match(prompt, /Servings: 2/);
    assert.match(prompt, /- Cecotec Gelacy 1200 Touch ice-cream machine: .*700–850 ml/);
    assert.match(prompt, /- Freezer: Around -15 ºC/);
    assert.match(prompt, /- Hob\n/);
    assert.match(prompt, /feel like: coffee/);
    assert.match(prompt, /Use ONLY ingredients from the stock list/);
    assert.match(prompt, /- Natas \[dairy\] — half carton left/);
    assert.equal(requests[0]!.images, undefined);
  });

  it('allows missing ingredients when asked', () => {
    const prompt = buildRecipePrompt([stockItem('Natas')], DEFAULT_PROFILE, { kind: 'any', count: 1, servings: 3, maxMissing: 2, craving: '', appliances: [], avoidAppliances: [], difficulty: 'any' as const });
    assert.match(prompt, /at most 2 ingredient/);
    assert.match(prompt, /Type: anything/);
    assert.doesNotMatch(prompt, /feel like/);
  });

  it('falls back to basic equipment when no appliances are configured', () => {
    const prompt = buildRecipePrompt([stockItem('Natas')], { ...DEFAULT_PROFILE, appliances: [] }, { kind: 'Dinner', count: 1, servings: 2, maxMissing: 0, craving: '', appliances: [], avoidAppliances: [], difficulty: 'any' as const });
    assert.match(prompt, /basic hob and utensils only/);
    assert.doesNotMatch(prompt, /Must use/);
    assert.doesNotMatch(prompt, /Do not use/);
    assert.doesNotMatch(prompt, /Difficulty/);
  });
});

describe('buildRecipePrompt appliance selection', () => {
  const base = { kind: 'any', count: 1, servings: 2, maxMissing: 0, craving: '', avoidAppliances: [], difficulty: 'any' as const };

  it('requires the one selected appliance', () => {
    const prompt = buildRecipePrompt([stockItem('Natas')], DEFAULT_PROFILE, { ...base, appliances: ['Oven'] });
    assert.match(prompt, /- Must use: Oven\. Every recipe is built around it;/);
  });

  it('requires all of several selected appliances', () => {
    const prompt = buildRecipePrompt([stockItem('Natas')], DEFAULT_PROFILE, { ...base, appliances: ['Oven', 'Freezer'] });
    assert.match(prompt, /- Must use: Oven \+ Freezer\. Every recipe is built around all of these;/);
  });

  it('excludes avoided appliances', () => {
    const prompt = buildRecipePrompt([stockItem('Natas')], DEFAULT_PROFILE, { ...base, appliances: [], avoidAppliances: ['Oven', 'Freezer'] });
    assert.match(prompt, /- Do not use: Oven, Freezer\. No recipe may need any of these\./);
    assert.doesNotMatch(prompt, /Must use/);
  });

  it('states the requested difficulty', () => {
    const prompt = buildRecipePrompt([stockItem('Natas')], DEFAULT_PROFILE, { ...base, appliances: [], difficulty: 'easy' });
    assert.match(prompt, /- Difficulty: easy — /);
  });
});

describe('parseRecipes', () => {
  it('rejects empty or malformed answers as AI failures', () => {
    assert.throws(() => parseRecipes({ recipes: [] }), AiUnavailableError);
    assert.throws(() => parseRecipes({ recipes: [{ title: 'x' }] }), AiUnavailableError);
  });
});
