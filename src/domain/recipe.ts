import { ValidationError } from './errors.ts';
import { ANY_DISH, type DishType, type KitchenProfile } from './kitchen-profile.ts';
import { normalizeName } from './text.ts';

/** How demanding the recipes may be. 'any' = no preference. */
export const DIFFICULTIES = ['any', 'easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
/** Flavour familiarity, independent of cooking difficulty or food safety. */
export const CREATIVITIES = ['any', 'familiar', 'creative', 'adventurous'] as const;
export type Creativity = (typeof CREATIVITIES)[number];

export interface RecipeIngredient {
  readonly name: string;
  readonly amount: string;
  readonly inStock: boolean;
  /** Assigned by the app, including ingredients in older saved recipes. */
  readonly emoji?: string;
  /** The matching pantry ingredient, so the recipe can mark it as used up. Assigned by the app. */
  readonly pantryId?: number;
}

export interface Recipe {
  readonly title: string;
  readonly summary: string;
  /** A dish type name from the kitchen profile (older recipes: a fixed id such as "main"). */
  readonly kind: string;
  /** Free-form yield, e.g. "4 servings" or "~750 ml mix (6 scoops)". */
  readonly makes: string;
  readonly totalMinutes: number;
  /** Absent only on recipes created before idea labels were introduced. */
  readonly difficulty?: Exclude<Difficulty, 'any'>;
  readonly creativity?: Exclude<Creativity, 'any'>;
  readonly equipment: readonly string[];
  readonly ingredients: readonly RecipeIngredient[];
  readonly steps: readonly string[];
  readonly tips: readonly string[];
  /** For the whole recipe, not per serving. Recipes saved before the macros were asked for only carry kcal and sugar. */
  readonly estimate: {
    readonly kcalMin: number;
    readonly kcalMax: number;
    readonly sugarGramsMin: number;
    readonly sugarGramsMax: number;
    /** How many servings or pieces the whole recipe divides into. */
    readonly portions?: number;
    readonly proteinGrams?: number;
    readonly carbsGrams?: number;
    readonly fatGrams?: number;
    readonly fibreGrams?: number;
    readonly saltGrams?: number;
  };
}

export interface SavedRecipe {
  readonly id: number;
  readonly recipe: Recipe;
  readonly createdAt: string;
}

export interface SuggestionRequest {
  /** 'any', or a dish type name as spelled in the kitchen profile. */
  readonly kind: string;
  readonly count: number;
  readonly servings: number;
  readonly craving: string;
  /** How many ingredients the recipe may need that are not in stock. */
  readonly maxMissing: number;
  /** Appliances every recipe must use (names as in the kitchen profile). Empty = no preference. */
  readonly appliances: readonly string[];
  /** Appliances no recipe may use (names as in the kitchen profile). */
  readonly avoidAppliances: readonly string[];
  readonly difficulty: Difficulty;
  readonly creativity: Creativity;
}

const OPTIONAL_ESTIMATES = ['portions', 'proteinGrams', 'carbsGrams', 'fatGrams', 'fibreGrams', 'saltGrams'] as const;

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
function requestedAppliances(value: unknown, profile: KitchenProfile, field = 'appliances'): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new ValidationError(`${field} must be a list of names.`);
  }
  const byKey = new Map(profile.appliances.map((a) => [normalizeName(a.name), a.name]));
  const names = value.map((name: string) => {
    const match = byKey.get(normalizeName(name));
    if (!match) throw new ValidationError(`"${name}" is not in your kitchen. Add it in the Kitchen tab first.`);
    return match;
  });
  return [...new Set(names)];
}

/** The kitchen's dish type a request asks for; undefined for 'any'. */
export function requestedDishType(request: SuggestionRequest, profile: KitchenProfile): DishType | undefined {
  return profile.dishTypes.find((dish) => dish.name === request.kind);
}

function requestedKind(value: unknown, profile: KitchenProfile): string {
  if (value === undefined || value === null || value === '' || value === ANY_DISH) return ANY_DISH;
  if (typeof value !== 'string') throw new ValidationError('kind must be text.');
  const match = profile.dishTypes.find((dish) => normalizeName(dish.name) === normalizeName(value));
  if (!match) throw new ValidationError(`Unknown kind "${value}". Add it as a dish type first.`);
  return match.name;
}

/** Defaults (servings), dish types and allowed appliances come from the kitchen profile. */
export function createSuggestionRequest(input: unknown, profile: KitchenProfile): SuggestionRequest {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const craving = raw.craving ?? '';
  if (typeof craving !== 'string') throw new ValidationError('craving must be text.');
  if (craving.length > SUGGESTION_LIMITS.maxCravingLength) throw new ValidationError('craving is too long.');
  const kind = requestedKind(raw.kind, profile);
  const difficulty = raw.difficulty ?? 'any';
  if (!(DIFFICULTIES as readonly unknown[]).includes(difficulty)) {
    throw new ValidationError(`Unknown difficulty "${String(difficulty)}". Use one of: ${DIFFICULTIES.join(', ')}.`);
  }
  const creativity = raw.creativity ?? 'any';
  if (!(CREATIVITIES as readonly unknown[]).includes(creativity)) {
    throw new ValidationError(`Unknown creativity "${String(creativity)}". Use one of: ${CREATIVITIES.join(', ')}.`);
  }
  const appliances = requestedAppliances(raw.appliances, profile);
  const avoidAppliances = requestedAppliances(raw.avoidAppliances, profile, 'avoidAppliances');
  const clash = appliances.find((name) => avoidAppliances.includes(name));
  if (clash) throw new ValidationError(`"${clash}" cannot be both used and avoided.`);
  return {
    kind,
    count: boundedInt(raw.count, 'count', 3, 1, SUGGESTION_LIMITS.maxCount),
    servings: boundedInt(raw.servings, 'servings', profile.servings, 1, SUGGESTION_LIMITS.maxServings),
    maxMissing: boundedInt(raw.maxMissing, 'maxMissing', 0, 0, SUGGESTION_LIMITS.maxMissing),
    craving: craving.trim(),
    appliances,
    avoidAppliances,
    difficulty: difficulty as Difficulty,
    creativity: creativity as Creativity,
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
  if (r.difficulty !== undefined && !(DIFFICULTIES.slice(1) as readonly unknown[]).includes(r.difficulty)) fail('difficulty');
  if (r.creativity !== undefined && !(CREATIVITIES.slice(1) as readonly unknown[]).includes(r.creativity)) fail('creativity');
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
  if (!OPTIONAL_ESTIMATES.every((key) => e![key] === undefined || isNum(e![key]))) fail('estimate');
  return value as Recipe;
}
