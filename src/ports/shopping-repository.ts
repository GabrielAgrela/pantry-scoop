import type { HiddenShoppingItem, ShoppingItem } from '../domain/shopping.ts';

export interface ShoppingRepository {
  /** Oldest first, the order they were added. */
  listItems(): ShoppingItem[];
  /** Undefined when an item with the same normalized name is already on the list. */
  insertItem(name: string, normalizedName: string, emoji: string): ShoppingItem | undefined;
  deleteItem(id: number): boolean;
  listHidden(): HiddenShoppingItem[];
  /** Hides `key`, replacing an earlier entry for it. Ingredient-linked entries end when it is restocked or deleted. */
  hide(key: string, recipeIds: readonly string[], ingredientId?: number): HiddenShoppingItem;
  unhide(id: number): boolean;
  unhideAll(): void;
}
