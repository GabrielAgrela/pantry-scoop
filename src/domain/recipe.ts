import { ValidationError } from './errors.ts';
import type { KitchenProfile } from './kitchen-profile.ts';
import { normalizeName } from './text.ts';

/** What sort of dish is wanted. 'any' only makes sense as a request, never on a recipe. */
export const RECIPE_KINDS = ['any', 'ice-cream', 'dessert', 'breakfast', 'main', 'side', 'snack', 'baking', 'drink'] as const;
export type RecipeKind = (typeof RECIPE_KINDS)[number];
export const DISH_KINDS = RECIPE_KINDS.filter((kind) => kind !== 'any');

export interface RecipeIngredient {
  readonly name: string;
  readonly amount: string;
  readonly inStock: boolean;
}

export interface Recipe {
  readonly title: string;
  readonly summary: string;
  readonly kind: string;
  /** Free-form yield, e.g. "4 servings" or "~750 ml mix (6 scoops)". */
  readonly makes: string;
  readonly totalMinutes: number;
  readonly equipment: readonly string[];
  readonly ingredients: readonly RecipeIngredient[];
  readonly steps: readonly string[];
  readonly tips: readonly string[];
  /** For the whole recipe, not per serving. */
  readonly estimate: {
    readonly kcalMin: number;
    readonly kcalMax: number;
    readonly sugarGramsMin: number;
    readonly sugarGramsMax: number;
  };
}

export interface SavedRecipe {
  readonly id: number;
  readonly recipe: Recipe;
  readonly createdAt: string;
}

export interface SuggestionRequest {
  readonly kind: RecipeKind;
  readonly count: number;
  readonly servings: number;
  readonly craving: string;
  /** How many ingredients the recipe may need that are not in stock. */
  readonly maxMissing: number;
  /** Appliances every recipe must use (names as in the kitchen profile). Empty = no preference. */
  readonly appliances: readonly string[];
}

export const SUGGESTION_LIMITS = { maxCount: 5, maxMissing: 5, maxServings: 20, maxCravingLength: 300 } as const;

export function missingIngredients(recipe: Recipe): RecipeIngredient[] {
  return recipe.ingredients.filter((ingredient) => !ingredient.inStock);
}

function boundedInt(value: unknown, field: string, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(value);
  if (!Number.isInteger(num) || num < min || num > max) {
    throw new ValidationError(`${field} must be a whole number between ${min} and ${max}.`);
  }
  return num;
}

/** Resolves requested appliance names against the kitchen, returning the kitchen's spelling. */
function requestedAppliances(value: unknown, profile: KitchenProfile): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new ValidationError('appliances must be a list of names.');
  }
  const byKey = new Map(profile.appliances.map((a) => [normalizeName(a.name), a.name]));
  const names = value.map((name: string) => {
    const match = byKey.get(normalizeName(name));
    if (!match) throw new ValidationError(`"${name}" is not in your kitchen. Add it in the Kitchen tab first.`);
    return match;
  });
  return [...new Set(names)];
}

/** Defaults (servings) and allowed appliances come from the kitchen profile. */
export function createSuggestionRequest(input: unknown, profile: KitchenProfile): SuggestionRequest {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const craving = raw.craving ?? '';
  if (typeof craving !== 'string') throw new ValidationError('craving must be text.');
  if (craving.length > SUGGESTION_LIMITS.maxCravingLength) throw new ValidationError('craving is too long.');
  const kind = raw.kind ?? 'any';
  if (!(RECIPE_KINDS as readonly unknown[]).includes(kind)) {
    throw new ValidationError(`Unknown kind "${String(kind)}". Use one of: ${RECIPE_KINDS.join(', ')}.`);
  }
  return {
    kind: kind as RecipeKind,
    count: boundedInt(raw.count, 'count', 3, 1, SUGGESTION_LIMITS.maxCount),
    servings: boundedInt(raw.servings, 'servings', profile.servings, 1, SUGGESTION_LIMITS.maxServings),
    maxMissing: boundedInt(raw.maxMissing, 'maxMissing', 0, 0, SUGGESTION_LIMITS.maxMissing),
    craving: craving.trim(),
    appliances: requestedAppliances(raw.appliances, profile),
  };
}

/**
 * Shape check for recipes coming back from outside (AI output, saved-recipe payloads).
 * Kept deliberately structural: content quality is the generator's job.
 */
export function assertRecipe(value: unknown): Recipe {
  const fail = (why: string): never => {
    throw new ValidationError(`Invalid recipe: ${why}`);
  };
  if (typeof value !== 'object' || value === null) return fail('not an object');
  const r = value as Record<string, unknown>;
  const isStr = (v: unknown): v is string => typeof v === 'string';
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const isStrList = (v: unknown) => Array.isArray(v) && v.every(isStr);

  if (!isStr(r.title) || r.title.trim() === '') fail('title');
  if (!isStr(r.summary) || !isStr(r.kind) || !isStr(r.makes)) fail('summary/kind/makes');
  if (!isNum(r.totalMinutes)) fail('totalMinutes');
  if (!isStrList(r.equipment)) fail('equipment');
  if (!isStrList(r.steps)) fail('steps');
  if (!isStrList(r.tips)) fail('tips');
  if (
    !Array.isArray(r.ingredients) ||
    !r.ingredients.every((i: unknown) => {
      const ing = i as Record<string, unknown> | null;
      return ing !== null && typeof ing === 'object' && isStr(ing.name) && isStr(ing.amount) && typeof ing.inStock === 'boolean';
    })
  ) {
    fail('ingredients');
  }
  const e = r.estimate as Record<string, unknown> | undefined;
  if (!e || ![e.kcalMin, e.kcalMax, e.sugarGramsMin, e.sugarGramsMax].every(isNum)) fail('estimate');
  return value as Recipe;
}
