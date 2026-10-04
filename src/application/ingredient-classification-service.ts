import { AiUnavailableError } from '../domain/errors.ts';
import { isCategory, normalizeName } from '../domain/ingredient.ts';
import type { IngredientClassifier } from '../ports/ingredient-classifier.ts';
import type { StockService } from './stock-service.ts';

/** Classify a snapshot, then atomically apply only suggestions whose ingredient is unchanged. */
export class IngredientClassificationService {
  private readonly classifier: IngredientClassifier;
  private readonly stock: StockService;

  constructor(classifier: IngredientClassifier, stock: StockService) {
    this.classifier = classifier;
    this.stock = stock;
  }

  async classifyOther() {
    const snapshot = this.stock.list().filter((item) => item.category === 'other');
    if (!snapshot.length) return { classified: [], remaining: 0, newCategories: [] };
    const categories = this.stock.categories();
    const assignments = await this.classifier.classify(snapshot, categories);
    const ids = new Set(snapshot.map((item) => item.id));
    if (assignments.length !== snapshot.length || new Set(assignments.map((item) => item.id)).size !== snapshot.length ||
        assignments.some((item) => !ids.has(item.id) || !isCategory(item.category))) {
      throw new AiUnavailableError('The AI returned an incomplete classification. Your pantry was not changed.');
    }
    // Reuse custom shelves despite harmless differences in case or spacing.
    const canonical = new Map(categories.map((id) => [normalizeName(id), id]));
    const before = new Set(categories);
    return this.stock.transaction(() => {
      const current = new Map(this.stock.list().map((item) => [item.id, item]));
      const original = new Map(snapshot.map((item) => [item.id, item]));
      const classified = [];
      for (const assignment of assignments) {
        const item = current.get(assignment.id), prior = original.get(assignment.id)!;
        if (!item || item.category !== 'other' || item.name !== prior.name || item.notes !== prior.notes || assignment.category === 'other') continue;
        const key = normalizeName(assignment.category);
        const category = canonical.get(key) ?? assignment.category;
        canonical.set(key, category);
        classified.push(this.stock.update(item.id, { category }));
      }
      return {
        classified,
        remaining: this.stock.list().filter((item) => item.category === 'other').length,
        newCategories: [...new Set(classified.map((item) => item.category))].filter((id) => !before.has(id)),
      };
    });
  }
}
