import { ValidationError } from './errors.ts';

/** Something the cook put on the shopping list by hand. */
export interface ShoppingItem {
  readonly id: number;
  readonly name: string;
  readonly emoji: string;
  readonly createdAt: string;
}

/**
 * An item the cook said they don't need. `key` names a list entry: `pantry:<id>` for something that
 * ran out, `new:<name>` for something only recipes ask for. It stays hidden until a recipe (saved,
 * or among the latest ideas) outside `recipeIds` needs it, or (for pantry items) until it is back in stock and runs out again.
 */
export interface HiddenShoppingItem {
  readonly id: number;
  readonly key: string;
  readonly recipeIds: readonly string[];
  readonly createdAt: string;
}

export const SHOPPING_LIMITS = { maxItems: 200, maxHidden: 500, maxKeyLength: 120, maxRecipeIds: 200 } as const;

/** A hidden entry's key, and the pantry ingredient it is about (if any). */
export function hiddenKey(raw: unknown): { key: string; ingredientId?: number } {
  if (typeof raw !== 'string' || raw.length > SHOPPING_LIMITS.maxKeyLength) throw new ValidationError('Invalid shopping list item.');
  const pantry = /^pantry:([1-9]\d{0,15})$/.exec(raw);
  if (pantry) return { key: raw, ingredientId: Number(pantry[1]) };
  if (/^new:\S/.test(raw) && raw === raw.trim()) return { key: raw };
  throw new ValidationError('Invalid shopping list item.');
}

/** A recipe asking for an entry: `saved:<id>`, or `idea:<batch id>:<index>` for a recipe idea. */
const RECIPE_ID = /^(saved:[1-9]\d{0,15}|idea:[1-9]\d{0,15}:\d{1,2})$/;

export function recipeIds(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > SHOPPING_LIMITS.maxRecipeIds || !raw.every((id) => typeof id === 'string' && RECIPE_ID.test(id))) {
    throw new ValidationError('Invalid recipes.');
  }
  return [...new Set(raw as string[])];
}
