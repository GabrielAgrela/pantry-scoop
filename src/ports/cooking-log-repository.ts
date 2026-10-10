import type { CookedMeal, Recipe } from '../domain/recipe.ts';

export interface CookingLogRepository {
  /** Newest first. */
  list(limit: number): CookedMeal[];
  insert(recipe: Recipe): CookedMeal;
}
