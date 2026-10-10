import { DailyLimitError, NotFoundError, ValidationError } from '../domain/errors.ts';
import { normalizeName, type Ingredient } from '../domain/ingredient.ts';
import { ingredientEmoji } from '../domain/ingredient-emoji.ts';
import type { KitchenProfile } from '../domain/kitchen-profile.ts';
import { writingLanguage } from '../domain/language.ts';
import {
  assertRecipe,
  createSuggestionRequest,
  missingIngredients,
  needsTranslation,
  pastTitlesFor,
  sameOrder,
  type CookedMeal,
  type PastRecipes,
  type Recipe,
  type SavedRecipe,
  type SuggestionRequest,
} from '../domain/recipe.ts';
import type { CookingLogRepository } from '../ports/cooking-log-repository.ts';
import type { JobRepository } from '../ports/job-repository.ts';
import { editedMemoryNote, feedbackText, MAX_NOTE_LENGTH, MAX_NOTES_PER_FEEDBACK, MAX_STEERING_ROUNDS, newMemoryNotes, type ScoopMemory } from '../domain/scoop-memory.ts';
import type { FeedbackReflection, FeedbackSteering, RecipeChatMessage, RecipeGenerator } from '../ports/recipe-generator.ts';
import type { ScoopMemoryRepository } from '../ports/scoop-memory-repository.ts';
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
  /** What Scoop learned from the cook's feedback. */
  readonly memories: readonly string[];
}

/** How many recent batches of ideas are checked for repeats. */
const PAST_BATCHES = 20;
/** How far back, and how many ideas, the "you asked for this before" check offers. */
const SAME_ORDER_BATCHES = 50;
const SAME_ORDER_IDEAS = 6;
/** Recipes per translation request, and how many requests run at once. */
const TRANSLATE_CHUNK = 3;
const TRANSLATE_PARALLEL = 3;
/** Idea batches one translation pass looks at (the ones on screen). */
const MAX_TRANSLATED_BATCHES = 12;

/** What a translation pass changed; `failed` counts recipes left as they were. */
export interface TranslationOutcome {
  readonly saved: number;
  readonly batches: readonly number[];
  readonly failed: number;
}

/** Earlier messages of a conversation with Scoop, alternating cook / Scoop, in complete exchanges. */
function chatHistory(value: unknown, maxMessages: number, name: string): RecipeChatMessage[] {
  const history = value ?? [];
  if (!Array.isArray(history) || history.length > maxMessages) throw new ValidationError(`${name} may include at most ${maxMessages} previous messages.`);
  const messages: RecipeChatMessage[] = history.map((message, index) => {
    const role = index % 2 === 0 ? 'user' : 'assistant';
    if (!message || message.role !== role || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 6000) {
      throw new ValidationError(`Invalid ${name.toLowerCase()} history.`);
    }
    return { role, content: message.content.trim() };
  });
  if (messages.length % 2 !== 0) throw new ValidationError(`${name} history must contain complete exchanges.`);
  return messages;
}

export class RecipeService {
  private readonly generator: RecipeGenerator;
  private readonly stock: StockService;
  private readonly profiles: ProfileService;
  private readonly saved: SavedRecipeRepository;
  private readonly history: Pick<JobRepository, 'recipeHistory' | 'find' | 'rewriteResult'>;
  private readonly memories: ScoopMemoryRepository;
  private readonly cookingLog: CookingLogRepository;

  constructor(
    generator: RecipeGenerator,
    stock: StockService,
    profiles: ProfileService,
    saved: SavedRecipeRepository,
    history: Pick<JobRepository, 'recipeHistory' | 'find' | 'rewriteResult'>,
    memories: ScoopMemoryRepository,
    cookingLog: CookingLogRepository,
  ) {
    this.generator = generator;
    this.stock = stock;
    this.profiles = profiles;
    this.saved = saved;
    this.history = history;
    this.memories = memories;
    this.cookingLog = cookingLog;
  }

  /** Validates the request against the current stock and kitchen (synchronous). */
  plan(input: unknown): SuggestionPlan {
    const profile = this.profiles.get();
    const stock = this.stock.listInStock();
    if (stock.length === 0) throw new ValidationError('Nothing is in stock. Scan or add some ingredients first.');
    const request = createSuggestionRequest(input, profile, stock);
    const memories = this.memories.list().map((memory) => memory.note);
    return { request, stock, profile, pastTitles: pastTitlesFor(request, this.pastRecipes()), memories };
  }

  /**
   * Earlier ideas for exactly this order that still fit the pantry, newest first, so the person
   * can keep those instead of asking again. Nothing is generated.
   */
  earlierIdeas(input: unknown): Recipe[] {
    const { request } = this.plan(input);
    const titles = new Set<string>();
    const ideas: Recipe[] = [];
    for (const job of this.history.recipeHistory(SAME_ORDER_BATCHES)) {
      if (!sameOrder(request, job.request)) continue;
      const recipes = (job.result as { recipes?: unknown } | null)?.recipes;
      for (const recipe of this.withCurrentStock(Array.isArray(recipes) ? (recipes as Recipe[]) : [])) {
        const key = normalizeName(recipe.title);
        if (titles.has(key) || missingIngredients(recipe).length > request.maxMissing) continue;
        titles.add(key); ideas.push(recipe);
        if (ideas.length === SAME_ORDER_IDEAS) return ideas;
      }
    }
    return ideas;
  }

  async generate(plan: SuggestionPlan): Promise<Recipe[]> {
    const written = await this.generator.suggest(plan.stock, plan.profile, plan.request, plan.pastTitles, plan.memories);
    const recipes = written.map((recipe) => ({ ...recipe, language: writingLanguage(plan.profile.language) }));
    // The cook reads the ideas in their language straight away; if that fails, the recipes page asks again.
    const translated = await this.translator().translateAll(recipes);
    return this.withCurrentStock(recipes.map((recipe, index) => translated[index] ?? recipe));
  }

  /**
   * Adds a translation in the kitchen's language to saved recipes and the given idea batches that
   * lack one, storing it so each is translated once. The recipe text itself (what prompts read) never
   * changes. A chunk that fails stays untranslated and is tried again next time.
   */
  async translate(batchIds: readonly number[]): Promise<TranslationOutcome> {
    const translator = this.translator();
    const stale = this.saved.list().filter((entry) => needsTranslation(entry.recipe, translator.language));
    const savedWork = translator.translateAll(stale.map((entry) => entry.recipe)).then((translated) =>
      stale.filter((entry, i) => translated[i] && this.saved.update(entry.id, translated[i])).length);
    const batchWork = [...new Set(batchIds)].slice(0, MAX_TRANSLATED_BATCHES).map(async (id) => {
      const job = this.history.find(id);
      const recipes = job?.kind === 'recipes' && job.status === 'succeeded' ? (job.result as { recipes?: unknown } | null)?.recipes : undefined;
      if (!Array.isArray(recipes)) return undefined;
      const translated = await translator.translateAll(recipes as Recipe[]);
      if (!translated.some(Boolean)) return undefined;
      const result = (recipes as Recipe[]).map((recipe, index) => translated[index] ?? recipe);
      this.history.rewriteResult(id, { ...(job!.result as object), recipes: result });
      return id;
    });
    const [saved, ...batches] = await Promise.all([savedWork, ...batchWork]);
    return { saved: saved as number, batches: batches.filter((id): id is number => id !== undefined), failed: translator.failed() };
  }

  /**
   * Translates recipes into the kitchen's language a few requests at a time, in small groups. Each
   * result is the recipe with the translation added, or undefined when it needs none or it failed.
   */
  private translator() {
    const language = this.profiles.get().language;
    const pantryNames = this.stock.list().map((ingredient) => ingredient.name);
    let failed = 0, outOfRequests = false, running = 0;
    const queue: (() => void)[] = [];
    const slot = async <T>(work: () => Promise<T>): Promise<T> => {
      if (running >= TRANSLATE_PARALLEL) await new Promise<void>((resolve) => queue.push(resolve));
      running++;
      try { return await work(); } finally { running--; queue.shift()?.(); }
    };
    const translateAll = async (recipes: readonly Recipe[]): Promise<(Recipe | undefined)[]> => {
      const indexes = recipes.flatMap((recipe, index) => (needsTranslation(recipe, language) ? [index] : []));
      const groups = Array.from({ length: Math.ceil(indexes.length / TRANSLATE_CHUNK) }, (_, i) => indexes.slice(i * TRANSLATE_CHUNK, (i + 1) * TRANSLATE_CHUNK));
      const result: (Recipe | undefined)[] = recipes.map(() => undefined);
      await Promise.all(groups.map((group) => slot(async () => {
        try {
          if (outOfRequests) throw new DailyLimitError('');
          const texts = await this.generator.translate(group.map((index) => recipes[index]!), language, pantryNames);
          group.forEach((index, i) => { const recipe = recipes[index]!; result[index] = { ...recipe, translations: { ...recipe.translations, [language]: texts[i]! } }; });
        } catch (error) {
          // Out of AI requests for today: the rest would fail the same way.
          if (error instanceof DailyLimitError) outOfRequests = true;
          failed += group.length;
        }
      })));
      return result;
    };
    return { language, translateAll, failed: () => failed };
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
    return recipes.map((recipe) => ({ ...recipe, ingredients: recipe.ingredients.map((ingredient, index) => {
      // Something bought from the shopping list is stocked under the name the cook read, which may be a translation.
      const names = [ingredient.name, ...Object.values(recipe.translations ?? {}).map((text) => text.ingredients[index]?.name ?? '')];
      const known = names.map((name) => pantry.get(normalizeName(name))).find(Boolean);
      return { ...ingredient, inStock: known?.inStock ?? false, emoji: known?.emoji ?? ingredientEmoji(ingredient.name, 'other'), pantryId: known?.id };
    }) }));
  }

  async suggest(input: unknown): Promise<Recipe[]> {
    return this.generate(this.plan(input));
  }

  async ask(input: Record<string, unknown>): Promise<string> {
    const recipe = assertRecipe(input.recipe);
    const question = input.question;
    if (typeof question !== 'string' || !question.trim() || question.length > 2000) {
      throw new ValidationError('Ask a question of at most 2,000 characters.');
    }
    const messages = chatHistory(input.history, 20, 'Recipe chat');
    return this.generator.ask(this.withCurrentStock([recipe])[0]!, this.stock.listInStock(), this.profiles.get(), question.trim(), messages);
  }

  /** Scoop answers feedback on a cooked recipe and proposes notes; nothing is remembered until confirmed. */
  async reflect(input: Record<string, unknown>): Promise<FeedbackReflection> {
    const recipe = assertRecipe(input.recipe);
    const feedback = feedbackText(input.feedback);
    const remembered = this.memories.list().map((memory) => memory.note);
    const history = chatHistory(input.history, MAX_STEERING_ROUNDS * 2, 'Feedback');
    let steering: FeedbackSteering | undefined;
    if (history.length > 0) {
      const proposed = input.proposed;
      if (!Array.isArray(proposed) || proposed.length > MAX_NOTES_PER_FEEDBACK || proposed.some((note) => typeof note !== 'string' || note.length > MAX_NOTE_LENGTH)) {
        throw new ValidationError('Invalid proposed notes.');
      }
      steering = { history, proposed };
    }
    const { reply, notes } = await this.generator.reflect(recipe, feedback, this.profiles.get(), remembered, steering);
    const known = new Set(remembered.map(normalizeName));
    return { reply, notes: notes.filter((note) => !known.has(normalizeName(note))) };
  }

  /** The notes the cook confirmed, skipping any Scoop already knows. */
  remember(input: Record<string, unknown>): ScoopMemory[] {
    const title = input.recipeTitle ?? '';
    if (typeof title !== 'string' || title.length > 200) throw new ValidationError('Invalid recipe title.');
    const notes = newMemoryNotes(input.notes, this.memories.list().map((memory) => memory.note));
    return notes.length ? this.memories.insert(notes, title.trim()) : [];
  }

  listMemories(): ScoopMemory[] {
    return this.memories.list();
  }

  /** The cook rewrites a note in their own words. */
  editMemory(id: number, input: Record<string, unknown>): ScoopMemory {
    const others = this.memories.list().filter((memory) => memory.id !== id).map((memory) => memory.note);
    const updated = this.memories.update(id, editedMemoryNote(input.note, others));
    if (!updated) throw new NotFoundError(`Memory ${id} not found.`);
    return updated;
  }

  forgetMemory(id: number): void {
    if (!this.memories.delete(id)) throw new NotFoundError(`Memory ${id} not found.`);
  }

  forgetEverything(): void {
    this.memories.clear();
  }

  /**
   * The cook made this recipe: it goes in the cooking log, and the pantry items they say they
   * finished are marked as run out, all or nothing.
   */
  cooked(input: Record<string, unknown>): { meal: CookedMeal; ranOut: Ingredient[] } {
    const recipe = assertRecipe(input.recipe);
    const ranOut = input.ranOut ?? [];
    if (!Array.isArray(ranOut) || !ranOut.every((id) => Number.isSafeInteger(id) && id > 0)) throw new ValidationError('Invalid run-out ingredients.');
    const linked = new Set(this.withCurrentStock([recipe])[0]!.ingredients.map((ingredient) => ingredient.pantryId));
    if (!ranOut.every((id) => linked.has(id))) throw new ValidationError('Only this recipe’s pantry ingredients can be marked as run out.');
    return this.stock.transaction(() => ({
      ranOut: [...new Set(ranOut as number[])].map((id) => this.stock.update(id, { inStock: false })),
      meal: this.cookingLog.insert(recipe),
    }));
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
