import type { Category, Ingredient } from '../domain/ingredient.ts';

export interface IngredientClassification {
  readonly id: number;
  readonly category: Category;
}

export interface IngredientClassifier {
  classify(ingredients: readonly Ingredient[], categories: readonly Category[]): Promise<IngredientClassification[]>;
}
