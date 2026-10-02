import type { Ingredient } from '../domain/ingredient.ts';
import type { KitchenProfile } from '../domain/kitchen-profile.ts';
import type { Recipe, SuggestionRequest } from '../domain/recipe.ts';

export interface RecipeGenerator {
  suggest(stock: readonly Ingredient[], profile: KitchenProfile, request: SuggestionRequest): Promise<Recipe[]>;
}
