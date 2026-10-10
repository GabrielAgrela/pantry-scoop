import type { Recipe, SavedRecipe } from '../domain/recipe.ts';

export interface SavedRecipeRepository {
  list(): SavedRecipe[];
  insert(recipe: Recipe): SavedRecipe;
  /** Replaces a saved recipe's content; false when it no longer exists. */
  update(id: number, recipe: Recipe): boolean;
  delete(id: number): boolean;
}
