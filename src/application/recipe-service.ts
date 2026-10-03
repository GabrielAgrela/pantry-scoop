import { NotFoundError, ValidationError } from '../domain/errors.ts';
import { normalizeName, type Ingredient } from '../domain/ingredient.ts';
import type { KitchenProfile } from '../domain/kitchen-profile.ts';
import {
  assertRecipe,
  createSuggestionRequest,
  type Recipe,
  type SavedRecipe,
  type SuggestionRequest,
} from '../domain/recipe.ts';
import type { RecipeGenerator } from '../ports/recipe-generator.ts';
import type { SavedRecipeRepository } from '../ports/saved-recipe-repository.ts';
import type { ProfileService } from './profile-service.ts';
import type { StockService } from './stock-service.ts';

/** Everything a suggestion needs, validated up front so mistakes are reported immediately. */
export interface SuggestionPlan {
  readonly request: SuggestionRequest;
  readonly stock: readonly Ingredient[];
  readonly profile: KitchenProfile;
}

export class RecipeService {
  private readonly generator: RecipeGenerator;
  private readonly stock: StockService;
  private readonly profiles: ProfileService;
  private readonly saved: SavedRecipeRepository;

  constructor(generator: RecipeGenerator, stock: StockService, profiles: ProfileService, saved: SavedRecipeRepository) {
    this.generator = generator;
    this.stock = stock;
    this.profiles = profiles;
    this.saved = saved;
  }

  /** Validates the request against the current stock and kitchen (synchronous). */
  plan(input: unknown): SuggestionPlan {
    const profile = this.profiles.get();
    const request = createSuggestionRequest(input, profile);
    const stock = this.stock.listInStock();
    if (stock.length === 0) throw new ValidationError('Nothing is in stock. Scan or add some ingredients first.');
    return { request, stock, profile };
  }

  async generate(plan: SuggestionPlan): Promise<Recipe[]> {
    return this.withCurrentStock(await this.generator.suggest(plan.stock, plan.profile, plan.request));
  }

  /** Availability is current pantry state, never the recipe's saved snapshot. */
  withCurrentStock(recipes: readonly Recipe[]): Recipe[] {
    const available = new Set(this.stock.listInStock().map((ingredient) => normalizeName(ingredient.name)));
    return recipes.map((recipe) => ({ ...recipe, ingredients: recipe.ingredients.map((ingredient) => ({ ...ingredient, inStock: available.has(normalizeName(ingredient.name)) })) }));
  }

  async suggest(input: unknown): Promise<Recipe[]> {
    return this.generate(this.plan(input));
  }

  listSaved(): SavedRecipe[] {
    const saved = this.saved.list();
    const current = this.withCurrentStock(saved.map((entry) => entry.recipe));
    return saved.map((entry, index) => ({ ...entry, recipe: current[index]! }));
  }

  save(recipe: unknown): SavedRecipe {
    const saved = this.saved.insert(assertRecipe(recipe));
    return { ...saved, recipe: this.withCurrentStock([saved.recipe])[0]! };
  }

  removeSaved(id: number): void {
    if (!this.saved.delete(id)) throw new NotFoundError(`Saved recipe ${id} not found.`);
  }
}
