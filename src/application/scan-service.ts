import { createDraft, normalizeName, type Ingredient } from '../domain/ingredient.ts';
import type { ImageInput } from '../domain/image.ts';
import type { IngredientDetector } from '../ports/ingredient-detector.ts';
import type { AddStatus, StockService } from './stock-service.ts';

export interface ScanResult {
  readonly added: Ingredient[];
  readonly restocked: Ingredient[];
  readonly alreadyInStock: Ingredient[];
}

const BUCKET: Record<AddStatus, keyof ScanResult> = {
  created: 'added',
  restocked: 'restocked',
  unchanged: 'alreadyInStock',
};

/** Photo in, stock updated: detection is delegated, de-duplication is the stock's job. */
export class ScanService {
  private readonly detector: IngredientDetector;
  private readonly stock: StockService;

  constructor(detector: IngredientDetector, stock: StockService) {
    this.detector = detector;
    this.stock = stock;
  }

  async scan(images: readonly ImageInput[]): Promise<ScanResult> {
    // Run-out items are included so the detector reuses their names and they get restocked.
    const knownNames = this.stock.list().map((ingredient) => ingredient.name);
    const detected = await this.detector.detect(images, knownNames);

    const result: ScanResult = { added: [], restocked: [], alreadyInStock: [] };
    const seen = new Set<string>();

    for (const candidate of detected) {
      const key = normalizeName(candidate.name);
      if (key === '' || seen.has(key)) continue;
      seen.add(key);

      const { ingredient, status } = this.stock.addIfMissing(createDraft(candidate, 'photo'));
      result[BUCKET[status]].push(ingredient);
    }
    return result;
  }
}
