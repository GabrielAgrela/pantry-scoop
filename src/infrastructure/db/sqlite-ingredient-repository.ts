import type { DatabaseSync } from 'node:sqlite';
import { NotFoundError } from '../../domain/errors.ts';
import { ingredientEmoji } from '../../domain/ingredient-emoji.ts';
import {
  normalizeName,
  type Category,
  type Ingredient,
  type IngredientChanges,
  type IngredientDraft,
  type IngredientSource,
} from '../../domain/ingredient.ts';
import type { IngredientRepository } from '../../ports/ingredient-repository.ts';

interface Row {
  id: number;
  name: string;
  emoji: string;
  category: string;
  notes: string;
  source: string;
  in_stock: number;
  created_at: string;
}

const COLUMNS = 'id, name, emoji, category, notes, source, in_stock, created_at';

function toIngredient(row: Row): Ingredient {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    category: row.category as Category,
    notes: row.notes,
    source: row.source as IngredientSource,
    inStock: row.in_stock === 1,
    createdAt: row.created_at,
  };
}

/** One user's ingredients: every query is filtered by owner, so ids from other users are invisible. */
export class SqliteIngredientRepository implements IngredientRepository {
  private readonly db: DatabaseSync;
  private readonly userId: number;
  private readonly now: () => Date;

  constructor(db: DatabaseSync, userId: number, now: () => Date = () => new Date()) {
    this.db = db;
    this.userId = userId;
    this.now = now;
  }

  list(): Ingredient[] {
    const rows = this.db.prepare(`SELECT ${COLUMNS} FROM ingredients WHERE user_id = ? ORDER BY category, name COLLATE NOCASE`).all(this.userId);
    return (rows as unknown as Row[]).map(toIngredient);
  }

  transaction<T>(work: () => T): T {
    this.db.exec('SAVEPOINT stock_batch');
    try {
      const result = work();
      this.db.exec('RELEASE stock_batch');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK TO stock_batch; RELEASE stock_batch');
      throw error;
    }
  }

  findById(id: number): Ingredient | undefined {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM ingredients WHERE id = ? AND user_id = ?`).get(id, this.userId);
    return row ? toIngredient(row as unknown as Row) : undefined;
  }

  findByNormalizedName(normalizedName: string): Ingredient | undefined {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM ingredients WHERE normalized_name = ? AND user_id = ?`).get(normalizedName, this.userId);
    return row ? toIngredient(row as unknown as Row) : undefined;
  }

  insert(draft: IngredientDraft): Ingredient {
    const row = this.db
      .prepare(
        `INSERT INTO ingredients (user_id, name, normalized_name, emoji, category, notes, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${COLUMNS}`,
      )
      .get(this.userId, draft.name, normalizeName(draft.name), ingredientEmoji(draft.name, draft.category), draft.category, draft.notes, draft.source, this.now().toISOString());
    return toIngredient(row as unknown as Row);
  }

  update(id: number, changes: IngredientChanges): Ingredient {
    const current = this.findById(id);
    if (!current) throw new NotFoundError(`Ingredient ${id} not found.`);
    const next = { ...current, ...changes };
    const emoji = changes.name !== undefined || changes.category !== undefined ? ingredientEmoji(next.name, next.category) : current.emoji;
    const row = this.db
      .prepare(
        `UPDATE ingredients SET name = ?, normalized_name = ?, emoji = ?, category = ?, notes = ?, in_stock = ?
         WHERE id = ? AND user_id = ? RETURNING ${COLUMNS}`,
      )
      .get(next.name, normalizeName(next.name), emoji, next.category, next.notes, next.inStock ? 1 : 0, id, this.userId);
    return toIngredient(row as unknown as Row);
  }

  delete(id: number): boolean {
    return Number(this.db.prepare('DELETE FROM ingredients WHERE id = ? AND user_id = ?').run(id, this.userId).changes) > 0;
  }
}
