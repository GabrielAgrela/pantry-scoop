import type { ScoopMemory } from '../domain/scoop-memory.ts';

export interface ScoopMemoryRepository {
  /** Oldest first, the order Scoop learned them. */
  list(): ScoopMemory[];
  insert(notes: readonly string[], recipeTitle: string): ScoopMemory[];
  /** Undefined when the note does not exist (or belongs to someone else). */
  update(id: number, note: string): ScoopMemory | undefined;
  delete(id: number): boolean;
  clear(): void;
}
