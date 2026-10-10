import type { DatabaseSync } from 'node:sqlite';
import type { HiddenShoppingItem, ShoppingItem } from '../../domain/shopping.ts';
import type { ShoppingRepository } from '../../ports/shopping-repository.ts';

interface ItemRow {
  id: number;
  name: string;
  emoji: string;
  created_at: string;
}

interface HiddenRow {
  id: number;
  item_key: string;
  recipe_ids: string;
  created_at: string;
}

const toItem = (row: ItemRow): ShoppingItem => ({ id: row.id, name: row.name, emoji: row.emoji, createdAt: row.created_at });
const toHidden = (row: HiddenRow): HiddenShoppingItem => ({ id: row.id, key: row.item_key, recipeIds: JSON.parse(row.recipe_ids) as string[], createdAt: row.created_at });

/** One user's hand-added shopping items and the items they said they don't need. */
export class SqliteShoppingRepository implements ShoppingRepository {
  private readonly db: DatabaseSync;
  private readonly userId: number;
  private readonly now: () => Date;

  constructor(db: DatabaseSync, userId: number, now: () => Date = () => new Date()) {
    this.db = db;
    this.userId = userId;
    this.now = now;
  }

  listItems(): ShoppingItem[] {
    const rows = this.db.prepare('SELECT id, name, emoji, created_at FROM shopping_items WHERE user_id = ? ORDER BY id').all(this.userId);
    return (rows as unknown as ItemRow[]).map(toItem);
  }

  insertItem(name: string, normalizedName: string, emoji: string): ShoppingItem | undefined {
    const row = this.db
      .prepare(`INSERT INTO shopping_items (user_id, name, normalized_name, emoji, created_at) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (user_id, normalized_name) DO NOTHING RETURNING id, name, emoji, created_at`)
      .get(this.userId, name, normalizedName, emoji, this.now().toISOString());
    return row ? toItem(row as unknown as ItemRow) : undefined;
  }

  deleteItem(id: number): boolean {
    return Number(this.db.prepare('DELETE FROM shopping_items WHERE id = ? AND user_id = ?').run(id, this.userId).changes) > 0;
  }

  listHidden(): HiddenShoppingItem[] {
    const rows = this.db.prepare('SELECT id, item_key, recipe_ids, created_at FROM shopping_hidden WHERE user_id = ? ORDER BY id').all(this.userId);
    return (rows as unknown as HiddenRow[]).map(toHidden);
  }

  hide(key: string, recipeIds: readonly string[], ingredientId?: number): HiddenShoppingItem {
    const row = this.db
      .prepare(`INSERT INTO shopping_hidden (user_id, item_key, ingredient_id, recipe_ids, created_at) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (user_id, item_key) DO UPDATE SET recipe_ids = excluded.recipe_ids, ingredient_id = excluded.ingredient_id, created_at = excluded.created_at
                RETURNING id, item_key, recipe_ids, created_at`)
      .get(this.userId, key, ingredientId ?? null, JSON.stringify(recipeIds), this.now().toISOString());
    return toHidden(row as unknown as HiddenRow);
  }

  unhide(id: number): boolean {
    return Number(this.db.prepare('DELETE FROM shopping_hidden WHERE id = ? AND user_id = ?').run(id, this.userId).changes) > 0;
  }

  unhideAll(): void {
    this.db.prepare('DELETE FROM shopping_hidden WHERE user_id = ?').run(this.userId);
  }
}
