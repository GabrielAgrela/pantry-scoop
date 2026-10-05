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
  emoji: '🥛',
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
  it('passes ranked units to recipes and instructs them to use the first suitable choice', () => {
    const profile = { ...DEFAULT_PROFILE, units: 'Spoons (tbsp/tsp) → Metric (g, ml, °C)' };
    const prompt = buildRecipePrompt([stockItem('Natas')], profile, { kind: 'any', count: 1, servings: 2, maxMissing: 0, craving: '', appliances: [], avoidAppliances: [], useIngredients: [], avoidIngredients: [], difficulty: 'any', creativity: 'any' });
    assert.match(prompt, /Units: Spoons \(tbsp\/tsp\) → Metric \(g, ml, °C\)/);
    assert.match(prompt, /Use the first suitable unit for each quantity/);
    assert.match(prompt, /Respect any restrictions in the unit preferences/);
  });

  it('puts the stock, machine and request into the prompt', async () => {
    const { model, requests } = fakeModel({ recipes: [sampleRecipe()] });
    const request = { kind: 'Ice cream', count: 2, servings: 2, maxMissing: 0, craving: 'coffee', appliances: [], avoidAppliances: [], useIngredients: [], avoidIngredients: [], difficulty: 'any' as const, creativity: 'any' as const };
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
    assert.match(prompt, /What they asked for: "coffee"/);
    assert.match(prompt, /Use ONLY ingredients from the stock list/);
    assert.match(prompt, /- Natas \[dairy\] — half carton left/);
    assert.equal(requests[0]!.images, undefined);
  });

  it('allows missing ingredients when asked', () => {
    const prompt = buildRecipePrompt([stockItem('Natas')], DEFAULT_PROFILE, { kind: 'any', count: 1, servings: 3, maxMissing: 2, craving: '', appliances: [], avoidAppliances: [], useIngredients: [], avoidIngredients: [], difficulty: 'any' as const, creativity: 'any' as const });
    assert.match(prompt, /at most 2 ingredient/);
    assert.match(prompt, /Type: anything/);
    assert.doesNotMatch(prompt, /asked for/);
    assert.match(prompt, /varied levels are welcome/);
  });

  it('keeps every idea on the craving instead of mixing in other dishes', () => {
    const prompt = buildRecipePrompt([stockItem('Batata')], DEFAULT_PROFILE, { kind: 'any', count: 5, servings: 4, maxMissing: 0, craving: 'fries', appliances: [], avoidAppliances: [], useIngredients: [], avoidIngredients: [], difficulty: 'any' as const, creativity: 'any' as const });
    assert.match(prompt, /^You are .*\n\nWhat they asked for: "fries"\nThis is the main request/);
    assert.match(prompt, /Type: whatever fits what they asked for/);
    assert.doesNotMatch(prompt, /mix it up: savoury and sweet/);
    assert.match(prompt, /fewer than 5 recipe\(s\) that truly match, return only those/);
    assert.match(prompt, /Never pad the list/);
    assert.match(prompt, /keep most ideas familiar takes on what they asked for/);
    assert.doesNotMatch(prompt, /varied levels are welcome/);
  });

  it('treats each stock line as one indivisible product, even a blend', () => {
    const prompt = buildRecipePrompt([stockItem('Sal, pimenta e alho')], DEFAULT_PROFILE, { kind: 'any', count: 1, servings: 2, maxMissing: 0, craving: '', appliances: [], avoidAppliances: [], useIngredients: [], avoidIngredients: [], difficulty: 'any' as const, creativity: 'any' as const });
    assert.match(prompt, /Each stock line is ONE product as bought/);
    assert.match(prompt, /never take one component out of it/);
  });

  it('asks for the macros and portions of the whole recipe', () => {
    const prompt = buildRecipePrompt([stockItem('Natas')], DEFAULT_PROFILE, { kind: 'any', count: 1, servings: 2, maxMissing: 0, craving: '', appliances: [], avoidAppliances: [], useIngredients: [], avoidIngredients: [], difficulty: 'any' as const, creativity: 'any' as const });
    assert.match(prompt, /protein, carbs \(including sugar\), fat, fibre and salt/);
    assert.match(prompt, /"portions" is how many servings/);
  });

  it('falls back to basic equipment when no appliances are configured', () => {
    const prompt = buildRecipePrompt([stockItem('Natas')], { ...DEFAULT_PROFILE, appliances: [] }, { kind: 'Dinner', count: 1, servings: 2, maxMissing: 0, craving: '', appliances: [], avoidAppliances: [], useIngredients: [], avoidIngredients: [], difficulty: 'any' as const, creativity: 'any' as const });
    assert.match(prompt, /basic hob and utensils only/);
    assert.doesNotMatch(prompt, /Must use/);
    assert.doesNotMatch(prompt, /Do not use/);
    assert.doesNotMatch(prompt, /Difficulty/);
  });
});

describe('buildRecipePrompt past ideas', () => {
  const base = { kind: 'any', count: 2, servings: 2, maxMissing: 0, craving: '', appliances: [], avoidAppliances: [], useIngredients: [], avoidIngredients: [], difficulty: 'any' as const, creativity: 'any' as const };

  it('lists earlier ideas and asks for different ones', () => {
    const prompt = buildRecipePrompt([stockItem('Natas')], DEFAULT_PROFILE, base, ['Mango sorbet', 'Pan pizza']);
    assert.match(prompt, /Already suggested or saved for a similar request[^\n]*\n- Mango sorbet\n- Pan pizza\n/);
    assert.match(prompt, /Pick different dishes/);
  });

  it('keeps a craving on target while varying it', () => {
    const prompt = buildRecipePrompt([stockItem('Batata')], DEFAULT_PROFILE, { ...base, craving: 'fries' }, ['Garlic fries']);
    assert.match(prompt, /Still match what they asked for/);
  });

  it('says nothing about past ideas when there are none', () => {
    assert.doesNotMatch(buildRecipePrompt([stockItem('Natas')], DEFAULT_PROFILE, base), /Already suggested/);
  });
});

describe('buildRecipePrompt appliance selection', () => {
  const base = { kind: 'any', count: 1, servings: 2, maxMissing: 0, craving: '', avoidAppliances: [], useIngredients: [], avoidIngredients: [], difficulty: 'any' as const, creativity: 'any' as const };

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

  it('requires chosen ingredients and drops left-out ones from the stock list', () => {
    const prompt = buildRecipePrompt([stockItem('Natas'), stockItem('Café'), stockItem('Ovos')], DEFAULT_PROFILE,
      { ...base, appliances: [], useIngredients: ['Natas'], avoidIngredients: ['Café', 'Ovos'] });
    assert.match(prompt, /- Must include: Natas\. Every recipe uses it from the stock\./);
    assert.match(prompt, /- Leave out: Café, Ovos\. No recipe may contain any of these, not even as an ingredient to buy\./);
    assert.match(prompt, /- Natas \[dairy\]/);
    assert.doesNotMatch(prompt, /- Café \[/);
    assert.doesNotMatch(prompt, /- Ovos \[/);
  });

  it('states the requested difficulty', () => {
    const prompt = buildRecipePrompt([stockItem('Natas')], DEFAULT_PROFILE, { ...base, appliances: [], difficulty: 'easy' });
    assert.match(prompt, /- Difficulty: easy — /);
  });

  it('separates flavour appeal from difficulty and food safety', () => {
    for (const [creativity, label] of [['familiar', 'crowd pleaser'], ['creative', 'a little twist'], ['adventurous', 'adventurous']] as const) {
      const prompt = buildRecipePrompt([stockItem('Natas')], DEFAULT_PROFILE, { ...base, appliances: [], difficulty: 'easy', creativity });
      assert.match(prompt, /- Difficulty: easy/);
      assert.ok(prompt.includes(`- Flavour adventure: ${label}`));
      assert.match(prompt, /Olive oil ice cream is "adventurous" even when easy/);
      assert.match(prompt, /never food safety/);
    }
    const shape = RECIPE_SCHEMA.properties.recipes.items;
    assert.ok(shape.required.includes('difficulty'));
    assert.ok(shape.required.includes('creativity'));
    assert.deepEqual(shape.properties.difficulty.enum, ['easy', 'medium', 'hard']);
    assert.deepEqual(shape.properties.creativity.enum, ['familiar', 'creative', 'adventurous']);
  });
});

describe('parseRecipes', () => {
  it('requires actual labels for new AI output', () => {
    const { difficulty, creativity, ...older } = sampleRecipe();
    assert.throws(() => parseRecipes({ recipes: [older] }), /missing difficulty\/creativity/);
    assert.throws(() => parseRecipes({ recipes: [{ ...sampleRecipe(), creativity: 'unsafe' }] }), /creativity/);
    assert.deepEqual(parseRecipes({ recipes: [sampleRecipe({ difficulty: 'easy', creativity: 'adventurous' })] })[0]?.creativity, 'adventurous');
  });
  it('rejects empty or malformed answers as AI failures', () => {
    assert.throws(() => parseRecipes({ recipes: [] }), AiUnavailableError);
    assert.throws(() => parseRecipes({ recipes: [{ title: 'x' }] }), AiUnavailableError);
  });
});
