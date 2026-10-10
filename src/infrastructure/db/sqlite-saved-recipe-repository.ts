import type { DatabaseSync } from 'node:sqlite';
import type { Recipe, SavedRecipe } from '../../domain/recipe.ts';
import type { SavedRecipeRepository } from '../../ports/saved-recipe-repository.ts';

interface Row {
  id: number;
  data: string;
  created_at: string;
}

function toSaved(row: Row): SavedRecipe {
  return { id: row.id, recipe: JSON.parse(row.data) as Recipe, createdAt: row.created_at };
}

/** One user's saved recipes. */
export class SqliteSavedRecipeRepository implements SavedRecipeRepository {
  private readonly db: DatabaseSync;
  private readonly userId: number;
  private readonly now: () => Date;

  constructor(db: DatabaseSync, userId: number, now: () => Date = () => new Date()) {
    this.db = db;
    this.userId = userId;
    this.now = now;
  }

  list(): SavedRecipe[] {
    const rows = this.db.prepare('SELECT id, data, created_at FROM saved_recipes WHERE user_id = ? ORDER BY id DESC').all(this.userId);
    return (rows as unknown as Row[]).map(toSaved);
  }

  insert(recipe: Recipe): SavedRecipe {
    const row = this.db
      .prepare('INSERT INTO saved_recipes (user_id, data, created_at) VALUES (?, ?, ?) RETURNING id, data, created_at')
      .get(this.userId, JSON.stringify(recipe), this.now().toISOString());
    return toSaved(row as unknown as Row);
  }

  update(id: number, recipe: Recipe): boolean {
    return Number(this.db.prepare('UPDATE saved_recipes SET data = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(recipe), id, this.userId).changes) > 0;
  }

  delete(id: number): boolean {
    return Number(this.db.prepare('DELETE FROM saved_recipes WHERE id = ? AND user_id = ?').run(id, this.userId).changes) > 0;
  }
}
