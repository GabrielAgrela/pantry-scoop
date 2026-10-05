import type { Ingredient } from '../domain/ingredient.ts';
import type { KitchenProfile } from '../domain/kitchen-profile.ts';
import type { Recipe, SuggestionRequest } from '../domain/recipe.ts';

export interface RecipeGenerator {
  /** `pastTitles`: earlier ideas for a similar request, which the new ones should not repeat. */
  suggest(stock: readonly Ingredient[], profile: KitchenProfile, request: SuggestionRequest, pastTitles?: readonly string[]): Promise<Recipe[]>;
}
