import type { Category } from '../domain/ingredient.ts';
import type { ImageInput } from '../domain/image.ts';

export interface DetectedIngredient {
  readonly name: string;
  readonly category: Category;
}

/** Turns photos of food into a list of ingredients. */
export interface IngredientDetector {
  /**
   * @param knownNames names already in stock, so the detector can reuse them
   *                   instead of inventing synonyms ("skim milk" vs "leite magro").
   * @param language   the kitchen's language (from its profile), for items without a label to read.
   */
  detect(images: readonly ImageInput[], knownNames: readonly string[], language: string): Promise<DetectedIngredient[]>;
}
