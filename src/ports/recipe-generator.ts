import type { Ingredient } from '../domain/ingredient.ts';
import type { KitchenProfile } from '../domain/kitchen-profile.ts';
import type { Recipe, RecipeText, SuggestionRequest } from '../domain/recipe.ts';

export interface RecipeChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/** Scoop's answer to feedback: a reply, and the notes it proposes to remember (nothing is saved yet). */
export interface FeedbackReflection {
  readonly reply: string;
  readonly notes: readonly string[];
}

/** The feedback conversation so far, when the cook is steering notes Scoop already proposed. */
export interface FeedbackSteering {
  /** Earlier messages, alternating cook / Scoop, starting with the cook's feedback. */
  readonly history: readonly RecipeChatMessage[];
  /** The notes on screen that the latest message is about. */
  readonly proposed: readonly string[];
}

export interface RecipeGenerator {
  /**
   * `pastTitles`: earlier ideas for a similar request, which the new ones should not repeat.
   * `memories`: what Scoop learned from the cook's earlier feedback.
   */
  suggest(stock: readonly Ingredient[], profile: KitchenProfile, request: SuggestionRequest, pastTitles?: readonly string[], memories?: readonly string[]): Promise<Recipe[]>;
  /**
   * Reads feedback on a cooked recipe and proposes lasting notes that are not already remembered.
   * With `steering`, `feedback` is the cook's reply to proposed notes, and the full revised list comes back.
   */
  reflect(recipe: Recipe, feedback: string, profile: KitchenProfile, memories: readonly string[], steering?: FeedbackSteering): Promise<FeedbackReflection>;
  ask(recipe: Recipe, stock: readonly Ingredient[], profile: KitchenProfile, question: string, history: readonly RecipeChatMessage[]): Promise<string>;
  /**
   * What the cook reads of each recipe, in order, in `language`: title, summary, yield, ingredient
   * names and amounts, steps and tips. Names in `pantryNames` stay exactly as the cook wrote them.
   */
  translate(recipes: readonly Recipe[], language: string, pantryNames: readonly string[]): Promise<RecipeText[]>;
}
