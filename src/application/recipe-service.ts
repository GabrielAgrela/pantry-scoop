import { NotFoundError, ValidationError } from '../domain/errors.ts';
import { normalizeName, type Ingredient } from '../domain/ingredient.ts';
import { ingredientEmoji } from '../domain/ingredient-emoji.ts';
import type { KitchenProfile } from '../domain/kitchen-profile.ts';
import {
  assertRecipe,
  createSuggestionRequest,
  pastTitlesFor,
  type PastRecipes,
  type Recipe,
  type SavedRecipe,
  type SuggestionRequest,
} from '../domain/recipe.ts';
import type { JobRepository } from '../ports/job-repository.ts';
import type { RecipeGenerator } from '../ports/recipe-generator.ts';
import type { SavedRecipeRepository } from '../ports/saved-recipe-repository.ts';
import type { ProfileService } from './profile-service.ts';
import type { StockService } from './stock-service.ts';

/** Everything a suggestion needs, validated up front so mistakes are reported immediately. */
export interface SuggestionPlan {
  readonly request: SuggestionRequest;
  readonly stock: readonly Ingredient[];
  readonly profile: KitchenProfile;
  /** Earlier ideas that fit this request, so the new batch does not repeat them. */
  readonly pastTitles: readonly string[];
}

/** How many recent batches of ideas are checked for repeats. */
const PAST_BATCHES = 20;

export class RecipeService {
  private readonly generator: RecipeGenerator;
  private readonly stock: StockService;
  private readonly profiles: ProfileService;
  private readonly saved: SavedRecipeRepository;
  private readonly history: Pick<JobRepository, 'recipeHistory'>;

  constructor(
    generator: RecipeGenerator,
    stock: StockService,
    profiles: ProfileService,
    saved: SavedRecipeRepository,
    history: Pick<JobRepository, 'recipeHistory'>,
  ) {
    this.generator = generator;
    this.stock = stock;
    this.profiles = profiles;
    this.saved = saved;
    this.history = history;
  }

  /** Validates the request against the current stock and kitchen (synchronous). */
  plan(input: unknown): SuggestionPlan {
    const profile = this.profiles.get();
    const stock = this.stock.listInStock();
    if (stock.length === 0) throw new ValidationError('Nothing is in stock. Scan or add some ingredients first.');
    const request = createSuggestionRequest(input, profile, stock);
    return { request, stock, profile, pastTitles: pastTitlesFor(request, this.pastRecipes()) };
  }

  async generate(plan: SuggestionPlan): Promise<Recipe[]> {
    return this.withCurrentStock(await this.generator.suggest(plan.stock, plan.profile, plan.request, plan.pastTitles));
  }

  /** Saved recipes first (the person kept them), then recent batches, newest first. */
  private pastRecipes(): PastRecipes[] {
    const batches = this.history.recipeHistory(PAST_BATCHES).map((job) => {
      const craving = (job.request as { craving?: unknown } | null)?.craving;
      const recipes = (job.result as { recipes?: unknown } | null)?.recipes;
      return { craving: typeof craving === 'string' ? craving : '', recipes: Array.isArray(recipes) ? (recipes as Recipe[]) : [] };
    });
    return [{ recipes: this.saved.list().map((entry) => entry.recipe) }, ...batches];
  }

  /** Availability is current pantry state, never the recipe's saved snapshot. */
  withCurrentStock(recipes: readonly Recipe[]): Recipe[] {
    const pantry = new Map(this.stock.list().map((ingredient) => [normalizeName(ingredient.name), ingredient]));
    return recipes.map((recipe) => ({ ...recipe, ingredients: recipe.ingredients.map((ingredient) => {
      const known = pantry.get(normalizeName(ingredient.name));
      return { ...ingredient, inStock: known?.inStock ?? false, emoji: known?.emoji ?? ingredientEmoji(ingredient.name, 'other'), pantryId: known?.id };
    }) }));
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
