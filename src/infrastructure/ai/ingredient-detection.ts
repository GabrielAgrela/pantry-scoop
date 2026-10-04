import { AiUnavailableError } from '../../domain/errors.ts';
import { CATEGORIES, isCategory } from '../../domain/ingredient.ts';
import type { ImageInput } from '../../domain/image.ts';
import type { DetectedIngredient, IngredientDetector } from '../../ports/ingredient-detector.ts';
import type { ReasoningEffort } from '../openai/responses-client.ts';
import type { StructuredModel } from './structured-model.ts';

export const DETECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ingredients'],
  properties: {
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'category'],
        properties: {
          name: { type: 'string' },
          category: { type: 'string', enum: [...CATEGORIES] },
        },
      },
    },
  },
} as const;

export function buildDetectionPrompt(knownNames: readonly string[]): string {
  const known = knownNames.length > 0 ? knownNames.map((name) => `- ${name}`).join('\n') : '(none yet)';
  return `You are the eyes of a home pantry tracker. The attached photo(s) show food the user has at home.

List EVERY distinct food ingredient you can see (packages, jars, fruit, bottles, cartons...),
including the ones that are already in stock — the app needs to know about those too.

Naming rules:
- Name the ingredient itself, as written on the packaging, in its original language (often Portuguese), e.g. "Leite magro", "Natas", "Goma xantana".
- No quantities, sizes, percentages or package words ("1L", "200 ml", "pack", "lata de").
- Keep brand names only when the brand IS the product (e.g. "Nutella", "Canderel").
- If an item is the same thing as one already in stock, still list it, using that exact stock name.
- Skip non-food objects and anything you cannot identify with reasonable confidence.

Already in stock (for naming only — do not leave these out):
${known}`;
}

export class AiIngredientDetector implements IngredientDetector {
  private readonly model: StructuredModel;
  private readonly effort: ReasoningEffort;

  constructor(model: StructuredModel, effort: ReasoningEffort) {
    this.model = model;
    this.effort = effort;
  }

  async detect(images: readonly ImageInput[], knownNames: readonly string[]): Promise<DetectedIngredient[]> {
    const answer = await this.model.complete({
      prompt: buildDetectionPrompt(knownNames),
      schemaName: 'pantry_ingredients',
      schema: DETECTION_SCHEMA,
      images,
      effort: this.effort,
    });
    return parseDetection(answer);
  }
}

export function parseDetection(answer: unknown): DetectedIngredient[] {
  const list = (answer as { ingredients?: unknown } | null)?.ingredients;
  if (!Array.isArray(list)) throw new AiUnavailableError('The AI did not return an ingredient list.');
  return list.flatMap((item: unknown): DetectedIngredient[] => {
    const { name, category } = (item ?? {}) as { name?: unknown; category?: unknown };
    if (typeof name !== 'string' || name.trim() === '') return [];
    return [{ name: name.trim(), category: isCategory(category) ? category : 'other' }];
  });
}
