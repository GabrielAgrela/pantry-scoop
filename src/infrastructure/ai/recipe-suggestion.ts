import { AiUnavailableError, ValidationError } from '../../domain/errors.ts';
import type { Ingredient } from '../../domain/ingredient.ts';
import { DEFAULT_PROFILE, type KitchenProfile } from '../../domain/kitchen-profile.ts';
import { assertRecipe, CREATIVITIES, DIFFICULTIES, requestedDishType, type Recipe, type Creativity, type Difficulty, type SuggestionRequest } from '../../domain/recipe.ts';
import type { RecipeGenerator } from '../../ports/recipe-generator.ts';
import type { ReasoningEffort } from '../openai/responses-client.ts';
import type { StructuredModel } from './structured-model.ts';

const stringArray = { type: 'array', items: { type: 'string' } } as const;

/** The recipe "kind" is one of the kitchen's dish types (free text when it has none). */
export function recipeSchema(dishTypes: readonly string[]) {
  const kind = dishTypes.length > 0 ? { type: 'string', enum: [...dishTypes] } : { type: 'string' };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['recipes'],
    properties: {
      recipes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'summary', 'kind', 'makes', 'totalMinutes', 'difficulty', 'creativity', 'equipment', 'ingredients', 'steps', 'tips', 'estimate'],
          properties: {
            title: { type: 'string' },
            summary: { type: 'string' },
            kind,
            makes: { type: 'string' },
            totalMinutes: { type: 'number' },
            difficulty: { type: 'string', enum: DIFFICULTIES.slice(1) },
            creativity: { type: 'string', enum: CREATIVITIES.slice(1) },
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
              required: ['kcalMin', 'kcalMax', 'sugarGramsMin', 'sugarGramsMax', 'portions', 'proteinGrams', 'carbsGrams', 'fatGrams', 'fibreGrams', 'saltGrams'],
              properties: {
                kcalMin: { type: 'number' },
                kcalMax: { type: 'number' },
                sugarGramsMin: { type: 'number' },
                sugarGramsMax: { type: 'number' },
                portions: { type: 'number' },
                proteinGrams: { type: 'number' },
                carbsGrams: { type: 'number' },
                fatGrams: { type: 'number' },
                fibreGrams: { type: 'number' },
                saltGrams: { type: 'number' },
              },
            },
          },
        },
      },
    },
  } as const;
}

export const RECIPE_SCHEMA = recipeSchema(DEFAULT_PROFILE.dishTypes.map((dish) => dish.name));

const DIFFICULTY_LABELS: Record<Exclude<Difficulty, 'any'>, string> = {
  easy: 'easy — few steps, simple techniques, beginner friendly',
  medium: 'medium — some technique or a few components, for a confident home cook',
  hard: 'challenging — ambitious techniques or several components, for an experienced cook',
};

const CREATIVITY_LABELS: Record<Exclude<Creativity, 'any'>, string> = {
  familiar: 'crowd pleaser — familiar flavours and classic combinations with broad appeal; avoid polarising twists',
  creative: 'a little twist — a recognisable dish with a gentle, approachable flavour surprise',
  adventurous: 'adventurous — unusual or polarising flavour pairings for a curious eater, even if they are easy to prepare',
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
  const avoid =
    request.avoidAppliances.length > 0
      ? `- Do not use: ${request.avoidAppliances.join(', ')}. No recipe may need ${request.avoidAppliances.length > 1 ? 'any of these' : 'it'}.\n`
      : '';
  const dish = requestedDishType(request, profile);
  const craving = request.craving;
  const anyType = craving ? 'whatever fits what they asked for' : 'anything that suits the stock (mix it up: savoury and sweet)';
  const type = dish ? `${dish.name}${dish.details ? ` (${dish.details})` : ''}` : anyType;
  const difficulty = request.difficulty === 'any' ? '' : `- Difficulty: ${DIFFICULTY_LABELS[request.difficulty]}\n`;
  const creativity = request.creativity === 'any' ? '' : `- Flavour adventure: ${CREATIVITY_LABELS[request.creativity]}\n`;
  const cravingBlock = craving
    ? `What they asked for: "${craving}"
This is the main request. Every recipe must be something a person who typed "${craving}" would immediately recognise as that, not a loose pun on the word or a different dish that merely shares a shape, texture or ingredient. Vary the ideas within the request (seasoning, cut, cooking method, dip or side) instead of drifting away from it.
If the stock and constraints can only make fewer than ${request.count} recipe(s) that truly match, return only those (at least one, the closest honest match). Never pad the list with ideas that do not match.

`
    : '';
  const flavourRule = craving
    ? 'Respect the selected flavour adventure; when it is unrestricted, keep most ideas familiar takes on what they asked for, with at most one gentle twist.'
    : 'Respect the selected flavour adventure; when it is unrestricted, varied levels are welcome.';
  const varietyRule = craving
    ? 'Make the recipes genuinely different from each other, while every one still matches what they asked for.'
    : 'Make the recipes genuinely different from each other.';
  const missingRule =
    request.maxMissing === 0
      ? 'Use ONLY ingredients from the stock list (water, ice, salt, pepper and cooking oil are always available).'
      : `Prefer stock ingredients; each recipe may need at most ${request.maxMissing} ingredient(s) that are not in stock.`;

  return `You are an expert home cook helping someone decide what to make with what they have.

${cravingBlock}Suggest ${request.count} different recipe(s).
- Type: ${type}
${mustUse}${avoid}${difficulty}${creativity}- Servings: ${request.servings}. Exception: when a machine with a fixed batch size makes the dish (e.g. ice cream), size it to the machine instead.
- Units: ${profile.units}
  When units are separated by →, they are ranked from most to least preferred. Use the first suitable unit for each quantity; use the next only when an earlier one is impractical or unsuitable. For example, spoons before metric means tbsp/tsp where practical, then g/ml for quantities that need them. Respect any restrictions in the unit preferences.
- Language: ${profile.language}

Kitchen equipment (use only these, plus basic utensils; respect every capacity and limit given):
${applianceList || '(basic hob and utensils only)'}

User preferences:
${profile.preferences || '(none)'}

Rules:
- ${missingRule}
- Mark every ingredient line with inStock = true only if it comes from the stock list; use the stock name.
- Each stock line is ONE product as bought, even when its name lists several things (e.g. "Sal, pimenta e alho" is a pre-mixed seasoning, not separate salt, pepper and garlic). Use such a product whole, by its full stock name, or not at all; never take one component out of it, and never write an amount like "the salt only". If the recipe needs just one of those things on its own, list it as its own ingredient instead.
- "kind" is the dish type that fits best.
- Label each recipe's actual cooking difficulty: "easy" (few steps, simple techniques), "medium" (some technique or several components), or "hard" (ambitious techniques). Respect the requested difficulty when one is selected.
- Label each recipe's actual flavour adventure as "familiar" (classic crowd pleaser), "creative" (a gentle twist), or "adventurous" (unusual or polarising). This describes broad taste appeal, never food safety or a guarantee that everyone will like it. Olive oil ice cream is "adventurous" even when easy to make. ${flavourRule} Assess difficulty and creativity independently.
- "equipment" lists the appliances from the kitchen list the recipe uses.
- "makes" is a short yield only, e.g. "2 servings", "12 biscuits" or "~750 ml mix (6 scoops)".
- totalMinutes covers prep + cooking (+ churning), excluding passive chilling/freezing time; mention that in the steps.
- Steps are short and concrete.
- "tips" are practical: texture, substitutions, storage.
- "estimate" is for the whole recipe, not per serving: kcal and sugar as low–high ranges; protein, carbs (including sugar), fat, fibre and salt as your best single estimate in grams; "portions" is how many servings or pieces the yield divides into (e.g. 2 for "2 servings", 6 for "~750 ml mix (6 scoops)").
- ${varietyRule}

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
      schema: recipeSchema(profile.dishTypes.map((dish) => dish.name)),
      effort: this.effort,
    });
    return parseRecipes(answer);
  }
}

export function parseRecipes(answer: unknown): Recipe[] {
  const list = (answer as { recipes?: unknown } | null)?.recipes;
  if (!Array.isArray(list) || list.length === 0) throw new AiUnavailableError('The AI did not return any recipes.');
  try {
    return list.map((value) => {
      const recipe = assertRecipe(value);
      if (!recipe.difficulty || !recipe.creativity) throw new ValidationError('Invalid recipe: missing difficulty/creativity labels');
      return recipe;
    });
  } catch (error) {
    if (error instanceof ValidationError) throw new AiUnavailableError(`The AI returned a malformed recipe (${error.message}).`);
    throw error;
  }
}
