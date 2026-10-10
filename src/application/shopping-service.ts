import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.ts';
import { cleanName, createDraft, normalizeName, type Ingredient } from '../domain/ingredient.ts';
import { ingredientEmoji } from '../domain/ingredient-emoji.ts';
import { hiddenKey, recipeIds, SHOPPING_LIMITS, type HiddenShoppingItem, type ShoppingItem } from '../domain/shopping.ts';
import type { ShoppingRepository } from '../ports/shopping-repository.ts';
import type { StockService } from './stock-service.ts';

/**
 * The parts of the shopping list the cook decides: what they added by hand and what they don't need.
 * The rest (what ran out, what saved recipes ask for) follows from the pantry and saved recipes.
 */
export class ShoppingService {
  private readonly repository: ShoppingRepository;
  private readonly stock: StockService;

  constructor(repository: ShoppingRepository, stock: StockService) {
    this.repository = repository;
    this.stock = stock;
  }

  list(): { items: ShoppingItem[]; hidden: HiddenShoppingItem[] } {
    return { items: this.repository.listItems(), hidden: this.repository.listHidden() };
  }

  add(input: { name: unknown }): ShoppingItem {
    const name = cleanName(input.name);
    if (this.repository.listItems().length >= SHOPPING_LIMITS.maxItems) throw new ValidationError(`The shopping list holds at most ${SHOPPING_LIMITS.maxItems} items.`);
    const item = this.repository.insertItem(name, normalizeName(name), ingredientEmoji(name, 'other'));
    if (!item) throw new ConflictError(`"${name}" is already in your list.`);
    return item;
  }

  remove(id: number): void {
    if (!this.repository.deleteItem(id)) throw new NotFoundError(`Shopping item ${id} not found.`);
  }

  /** Bought: the item goes into the pantry (or back in stock) and leaves the list, together. */
  bought(id: number): Ingredient {
    return this.stock.transaction(() => {
      const item = this.repository.listItems().find((entry) => entry.id === id);
      if (!item) throw new NotFoundError(`Shopping item ${id} not found.`);
      const { ingredient } = this.stock.addIfMissing(createDraft({ name: item.name }, 'manual'));
      this.repository.deleteItem(id);
      return ingredient;
    });
  }

  hide(input: { key: unknown; recipeIds?: unknown }): HiddenShoppingItem {
    const { key, ingredientId } = hiddenKey(input.key);
    const recipes = recipeIds(input.recipeIds);
    if (ingredientId !== undefined && !this.stock.list().some((item) => item.id === ingredientId)) {
      throw new NotFoundError(`Ingredient ${ingredientId} not found.`);
    }
    const hidden = this.repository.listHidden();
    if (hidden.length >= SHOPPING_LIMITS.maxHidden && !hidden.some((entry) => entry.key === key)) {
      // Oldest first: forgetting the oldest "don't need" is the least surprising way to make room.
      this.repository.unhide(hidden[0]!.id);
    }
    return this.repository.hide(key, recipes, ingredientId);
  }

  unhide(id: number): void {
    if (!this.repository.unhide(id)) throw new NotFoundError(`Hidden item ${id} not found.`);
  }

  unhideAll(): void {
    this.repository.unhideAll();
  }
}
