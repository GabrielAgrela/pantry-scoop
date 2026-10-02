import type { Ingredient, IngredientChanges, IngredientDraft } from '../domain/ingredient.ts';

export interface IngredientRepository {
  list(): Ingredient[];
  findById(id: number): Ingredient | undefined;
  /** Lookup by the canonical key produced by `normalizeName`. */
  findByNormalizedName(normalizedName: string): Ingredient | undefined;
  insert(draft: IngredientDraft): Ingredient;
  update(id: number, changes: IngredientChanges): Ingredient;
  delete(id: number): boolean;
}
