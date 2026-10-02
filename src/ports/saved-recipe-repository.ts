import type { Recipe, SavedRecipe } from '../domain/recipe.ts';

export interface SavedRecipeRepository {
  list(): SavedRecipe[];
  insert(recipe: Recipe): SavedRecipe;
  delete(id: number): boolean;
}
