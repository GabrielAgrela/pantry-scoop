import type { DatabaseSync } from 'node:sqlite';
import type { ScoopMemory } from '../../domain/scoop-memory.ts';
import type { ScoopMemoryRepository } from '../../ports/scoop-memory-repository.ts';

interface Row {
  id: number;
  note: string;
  recipe_title: string;
  created_at: string;
}

const toMemory = (row: Row): ScoopMemory => ({ id: row.id, note: row.note, recipeTitle: row.recipe_title, createdAt: row.created_at });

/** What Scoop remembers about one user. */
export class SqliteScoopMemoryRepository implements ScoopMemoryRepository {
  private readonly db: DatabaseSync;
  private readonly userId: number;
  private readonly now: () => Date;

  constructor(db: DatabaseSync, userId: number, now: () => Date = () => new Date()) {
    this.db = db;
    this.userId = userId;
    this.now = now;
  }

  list(): ScoopMemory[] {
    const rows = this.db.prepare('SELECT id, note, recipe_title, created_at FROM scoop_memories WHERE user_id = ? ORDER BY id').all(this.userId);
    return (rows as unknown as Row[]).map(toMemory);
  }

  insert(notes: readonly string[], recipeTitle: string): ScoopMemory[] {
    const insert = this.db.prepare('INSERT INTO scoop_memories (user_id, note, recipe_title, created_at) VALUES (?, ?, ?, ?) RETURNING id, note, recipe_title, created_at');
    const createdAt = this.now().toISOString();
    this.db.exec('BEGIN');
    try {
      const added = notes.map((note) => toMemory(insert.get(this.userId, note, recipeTitle, createdAt) as unknown as Row));
      this.db.exec('COMMIT');
      return added;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  update(id: number, note: string): ScoopMemory | undefined {
    const row = this.db.prepare('UPDATE scoop_memories SET note = ? WHERE id = ? AND user_id = ? RETURNING id, note, recipe_title, created_at').get(note, id, this.userId);
    return row ? toMemory(row as unknown as Row) : undefined;
  }

  delete(id: number): boolean {
    return Number(this.db.prepare('DELETE FROM scoop_memories WHERE id = ? AND user_id = ?').run(id, this.userId).changes) > 0;
  }

  clear(): void {
    this.db.prepare('DELETE FROM scoop_memories WHERE user_id = ?').run(this.userId);
  }
}
