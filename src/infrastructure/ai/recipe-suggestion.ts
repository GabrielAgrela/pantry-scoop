import { AiUnavailableError, ValidationError } from '../../domain/errors.ts';
import type { Ingredient } from '../../domain/ingredient.ts';
import type { KitchenProfile } from '../../domain/kitchen-profile.ts';
import { assertRecipe, DISH_KINDS, type Recipe, type RecipeKind, type SuggestionRequest } from '../../domain/recipe.ts';
import type { RecipeGenerator } from '../../ports/recipe-generator.ts';
import type { ReasoningEffort } from '../openai/responses-client.ts';
import type { StructuredModel } from './structured-model.ts';

const stringArray = { type: 'array', items: { type: 'string' } } as const;

export const RECIPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['recipes'],
  properties: {
    recipes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'summary', 'kind', 'makes', 'totalMinutes', 'equipment', 'ingredients', 'steps', 'tips', 'estimate'],
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          kind: { type: 'string', enum: [...DISH_KINDS] },
          makes: { type: 'string' },
          totalMinutes: { type: 'number' },
          equipment: stringArray,
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'amount', 'inStock'],
              properties: {
                name: { type: 'string' },
                amount: { type: 'string' },
                inStock: { type: 'boolean' },
              },
            },
          },
          steps: stringArray,
          tips: stringArray,
          estimate: {
            type: 'object',
            additionalProperties: false,
            required: ['kcalMin', 'kcalMax', 'sugarGramsMin', 'sugarGramsMax'],
            properties: {
              kcalMin: { type: 'number' },
              kcalMax: { type: 'number' },
              sugarGramsMin: { type: 'number' },
              sugarGramsMax: { type: 'number' },
            },
          },
        },
      },
    },
  },
} as const;

const KIND_LABELS: Record<RecipeKind, string> = {
  any: 'anything that suits the stock (mix it up: savoury and sweet)',
  'ice-cream': 'ice cream / frozen dessert made in the ice-cream machine',
  dessert: 'dessert',
  breakfast: 'breakfast',
  main: 'main course (lunch or dinner)',
  side: 'side dish',
  snack: 'snack',
  baking: 'baking (cakes, bread, biscuits...)',
  drink: 'drink (smoothie, shake, cocktail...)',
};

export function buildRecipePrompt(stock: readonly Ingredient[], profile: KitchenProfile, request: SuggestionRequest): string {
  const stockList = stock
    .map((item) => `- ${item.name} [${item.category}]${item.notes ? ` — ${item.notes}` : ''}`)
    .join('\n');
  const applianceList = profile.appliances
    .map((appliance) => `- ${appliance.name}${appliance.details ? `: ${appliance.details}` : ''}`)
    .join('\n');
  const mustUse =
    request.appliances.length > 0
      ? `- Must use: ${request.appliances.join(' + ')}. Every recipe is built around ${request.appliances.length > 1 ? 'all of these' : 'it'}; other equipment from the list may help.\n`
      : '';
  const missingRule =
    request.maxMissing === 0
      ? 'Use ONLY ingredients from the stock list (water, ice, salt, pepper and cooking oil are always available).'
      : `Prefer stock ingredients; each recipe may need at most ${request.maxMissing} ingredient(s) that are not in stock.`;

  return `You are an expert home cook helping someone decide what to make with what they have.

Suggest ${request.count} different recipe(s).
- Type: ${KIND_LABELS[request.kind]}
${mustUse}- Servings: ${request.servings}. Exception: when a machine with a fixed batch size makes the dish (e.g. ice cream), size it to the machine instead.
- Units: ${profile.units}
- Language: ${profile.language}

Kitchen equipment (use only these, plus basic utensils; respect every capacity and limit given):
${applianceList || '(basic hob and utensils only)'}

User preferences:
${profile.preferences || '(none)'}

${request.craving ? `Today they feel like: ${request.craving}\n\n` : ''}Rules:
- ${missingRule}
- Mark every ingredient line with inStock = true only if it comes from the stock list; use the stock name.
- "equipment" lists the appliances from the kitchen list the recipe uses.
- "makes" is a short yield only, e.g. "2 servings", "12 biscuits" or "~750 ml mix (6 scoops)".
- totalMinutes covers prep + cooking (+ churning), excluding passive chilling/freezing time; mention that in the steps.
- Steps are short and concrete.
- "tips" are practical: texture, substitutions, storage.
- estimate is for the whole recipe, not per serving.
- Make the recipes genuinely different from each other.

Stock:
${stockList}`;
}

export class AiRecipeGenerator implements RecipeGenerator {
  private readonly model: StructuredModel;
  private readonly effort: ReasoningEffort;

  constructor(model: StructuredModel, effort: ReasoningEffort) {
    this.model = model;
    this.effort = effort;
  }

  async suggest(stock: readonly Ingredient[], profile: KitchenProfile, request: SuggestionRequest): Promise<Recipe[]> {
    const answer = await this.model.complete({
      prompt: buildRecipePrompt(stock, profile, request),
      schemaName: 'recipe_suggestions',
      schema: RECIPE_SCHEMA,
      effort: this.effort,
    });
    return parseRecipes(answer);
  }
}

export function parseRecipes(answer: unknown): Recipe[] {
  const list = (answer as { recipes?: unknown } | null)?.recipes;
  if (!Array.isArray(list) || list.length === 0) throw new AiUnavailableError('ChatGPT did not return any recipes.');
  try {
    return list.map(assertRecipe);
  } catch (error) {
    if (error instanceof ValidationError) throw new AiUnavailableError(`ChatGPT returned a malformed recipe (${error.message}).`);
    throw error;
  }
}
