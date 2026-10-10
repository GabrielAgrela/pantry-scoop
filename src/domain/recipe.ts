import { ValidationError } from './errors.ts';
import { ANY_DISH, type DishType, type KitchenProfile } from './kitchen-profile.ts';
import { isRecipeLanguage } from './language.ts';
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

/** The words of a recipe a cook reads, in one language; lists line up with the recipe's own. */
export interface RecipeText {
  readonly title: string;
  readonly summary: string;
  readonly makes: string;
  readonly ingredients: readonly { readonly name: string; readonly amount: string }[];
  readonly steps: readonly string[];
  readonly tips: readonly string[];
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
  /** The language the text above is written in. The AI writes and reads recipes in English; older recipes have none and are in English too. */
  readonly language?: string;
  /** What the cook reads in another language, keyed by recipe language (e.g. "Français"). Prompts only ever see the text above. */
  readonly translations?: Readonly<Record<string, RecipeText>>;
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
  /** Stock ingredients every recipe must use (names as in the pantry). Empty = no preference. */
  readonly useIngredients: readonly string[];
  /** Stock ingredients no recipe may use (names as in the pantry). */
  readonly avoidIngredients: readonly string[];
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

/** Resolves requested ingredient names against what is in stock, returning the pantry's spelling. */
function requestedIngredients(value: unknown, stock: readonly { readonly name: string }[], field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new ValidationError(`${field} must be a list of names.`);
  }
  const byKey = new Map(stock.map((item) => [normalizeName(item.name), item.name]));
  const names = value.map((name: string) => {
    const match = byKey.get(normalizeName(name));
    if (!match) throw new ValidationError(`"${name}" is not in stock. Pick it from your pantry.`);
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

/**
 * Defaults (servings), dish types and allowed appliances come from the kitchen profile;
 * ingredients to use or leave out must be in stock.
 */
export function createSuggestionRequest(input: unknown, profile: KitchenProfile, stock: readonly { readonly name: string }[] = []): SuggestionRequest {
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
  const useIngredients = requestedIngredients(raw.useIngredients, stock, 'useIngredients');
  const avoidIngredients = requestedIngredients(raw.avoidIngredients, stock, 'avoidIngredients');
  const ingredientClash = useIngredients.find((name) => avoidIngredients.includes(name));
  if (ingredientClash) throw new ValidationError(`"${ingredientClash}" cannot be both used and left out.`);
  return {
    kind,
    count: boundedInt(raw.count, 'count', 3, 1, SUGGESTION_LIMITS.maxCount),
    servings: boundedInt(raw.servings, 'servings', profile.servings, 1, SUGGESTION_LIMITS.maxServings),
    maxMissing: boundedInt(raw.maxMissing, 'maxMissing', 0, 0, SUGGESTION_LIMITS.maxMissing),
    craving: craving.trim(),
    appliances,
    avoidAppliances,
    useIngredients,
    avoidIngredients,
    difficulty: difficulty as Difficulty,
    creativity: creativity as Creativity,
  };
}

/**
 * Whether the cook needs a translation of this recipe to read it. Only languages the language
 * switcher sets count, so an older free-text language never triggers one.
 */
export function needsTranslation(recipe: Recipe, language: string): boolean {
  return isRecipeLanguage(language) && normalizeName(recipe.language ?? 'English') !== normalizeName(language)
    && !Object.keys(recipe.translations ?? {}).some((name) => normalizeName(name) === normalizeName(language));
}

/** The text that prompts may use: the recipe without its translations. */
export function promptRecipe(recipe: Recipe): Recipe {
  const { translations: _translations, ...rest } = recipe;
  return rest;
}

/** Recipes the person has already seen: a past batch (with what was asked) or a saved recipe (craving unknown). */
export interface PastRecipes {
  readonly craving?: string;
  readonly recipes: readonly Recipe[];
}

export const MAX_PAST_TITLES = 30;

/** Every word of the (normalised) craving with 3+ letters appears in the recipe's title or summary. */
function namesCraving(recipe: Recipe, craving: string): boolean {
  const text = normalizeName(`${recipe.title} ${recipe.summary}`);
  const words = craving.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3);
  return words.length > 0 && words.every((word) => text.includes(word));
}

/** Would this past recipe be a valid answer to the request, so suggesting it again would repeat it? */
function fitsRequest(recipe: Recipe, request: SuggestionRequest, pastCraving: string | undefined): boolean {
  const has = (names: readonly string[], wanted: readonly string[]) => {
    const keys = new Set(names.map(normalizeName));
    return wanted.every((name) => keys.has(normalizeName(name)));
  };
  const craving = normalizeName(request.craving);
  if (craving && normalizeName(pastCraving ?? '') !== craving && !namesCraving(recipe, craving)) return false;
  if (request.kind !== ANY_DISH && normalizeName(recipe.kind) !== normalizeName(request.kind)) return false;
  if (request.difficulty !== 'any' && recipe.difficulty && recipe.difficulty !== request.difficulty) return false;
  if (request.creativity !== 'any' && recipe.creativity && recipe.creativity !== request.creativity) return false;
  return has(recipe.equipment, request.appliances) && has(recipe.ingredients.map((item) => item.name), request.useIngredients);
}

/**
 * Titles of earlier ideas that fit the same request, newest source first and without duplicates,
 * so the generator can steer away from repeating them.
 */
export function pastTitlesFor(request: SuggestionRequest, sources: readonly PastRecipes[], limit = MAX_PAST_TITLES): string[] {
  const titles = new Map<string, string>();
  for (const source of sources) {
    for (const recipe of source.recipes) {
      if (titles.size >= limit) return [...titles.values()];
      const key = normalizeName(recipe.title);
      if (!titles.has(key) && fitsRequest(recipe, request, source.craving)) titles.set(key, recipe.title.trim());
    }
  }
  return [...titles.values()];
}

/**
 * Did a past batch ask for the same order? Everything that shapes the ideas must match; how many
 * were asked for does not, since the earlier ones are still ideas for this order either way.
 * Fields added since an older batch ran count as their defaults.
 */
export function sameOrder(request: SuggestionRequest, past: unknown): boolean {
  if (typeof past !== 'object' || past === null) return false;
  const old = past as Partial<Record<keyof SuggestionRequest, unknown>>;
  const text = (value: unknown) => normalizeName(typeof value === 'string' ? value : '');
  const names = (value: unknown) => [...new Set((Array.isArray(value) ? value : []).map(text))].sort().join('\n');
  const sameNames = (key: 'appliances' | 'avoidAppliances' | 'useIngredients' | 'avoidIngredients') => names(request[key]) === names(old[key]);
  return text(old.kind) === text(request.kind) && old.servings === request.servings && (old.maxMissing ?? 0) === request.maxMissing
    && text(old.craving) === text(request.craving) && (old.difficulty ?? 'any') === request.difficulty && (old.creativity ?? 'any') === request.creativity
    && sameNames('appliances') && sameNames('avoidAppliances') && sameNames('useIngredients') && sameNames('avoidIngredients');
}

/**
 * Shape check for recipes coming back from outside (AI output, saved-recipe payloads).
 * Kept deliberately structural: content quality is the generator's job.
 */
function validTranslations(value: unknown, recipe: Record<string, unknown>): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length > 8) return false;
  const isStr = (v: unknown): v is string => typeof v === 'string';
  const sameLength = (list: unknown, original: unknown) => Array.isArray(list) && Array.isArray(original) && list.length === original.length;
  return Object.values(value).every((text: Record<string, unknown> | null) => text !== null && typeof text === 'object'
    && isStr(text.title) && isStr(text.summary) && isStr(text.makes)
    && sameLength(text.steps, recipe.steps) && (text.steps as unknown[]).every(isStr)
    && sameLength(text.tips, recipe.tips) && (text.tips as unknown[]).every(isStr)
    && sameLength(text.ingredients, recipe.ingredients)
    && (text.ingredients as unknown[]).every((item) => item !== null && typeof item === 'object' && isStr((item as Record<string, unknown>).name) && isStr((item as Record<string, unknown>).amount)));
}

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
  if (r.language !== undefined && !isStr(r.language)) fail('language');
  if (r.translations !== undefined && !validTranslations(r.translations, r)) fail('translations');
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
