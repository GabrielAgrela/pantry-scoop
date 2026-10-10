import type { DatabaseSync } from 'node:sqlite';
import type { CookedMeal, Recipe } from '../../domain/recipe.ts';
import type { CookingLogRepository } from '../../ports/cooking-log-repository.ts';

interface Row {
  id: number;
  data: string;
  cooked_at: string;
}

const toMeal = (row: Row): CookedMeal => ({ id: row.id, recipe: JSON.parse(row.data) as Recipe, cookedAt: row.cooked_at });

/** What one user has cooked, and when. */
export class SqliteCookingLogRepository implements CookingLogRepository {
  private readonly db: DatabaseSync;
  private readonly userId: number;
  private readonly now: () => Date;

  constructor(db: DatabaseSync, userId: number, now: () => Date = () => new Date()) {
    this.db = db;
    this.userId = userId;
    this.now = now;
  }

  list(limit: number): CookedMeal[] {
    const rows = this.db.prepare('SELECT id, data, cooked_at FROM cooked_meals WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(this.userId, limit);
    return (rows as unknown as Row[]).map(toMeal);
  }

  insert(recipe: Recipe): CookedMeal {
    const row = this.db
      .prepare('INSERT INTO cooked_meals (user_id, title, data, cooked_at) VALUES (?, ?, ?, ?) RETURNING id, data, cooked_at')
      .get(this.userId, recipe.title.trim(), JSON.stringify(recipe), this.now().toISOString());
    return toMeal(row as unknown as Row);
  }
}
