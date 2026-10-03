import { createDraft, normalizeName, type Ingredient, type IngredientDraft } from '../domain/ingredient.ts';
import { ValidationError } from '../domain/errors.ts';
import type { ImageInput } from '../domain/image.ts';
import type { IngredientDetector } from '../ports/ingredient-detector.ts';
import type { AddStatus, StockService } from './stock-service.ts';

export interface ScanResult {
  readonly added: Ingredient[];
  readonly restocked: Ingredient[];
  readonly alreadyInStock: Ingredient[];
}

export interface ScanCandidate extends IngredientDraft {
  readonly candidateId: number;
}

export interface ScanPreview {
  readonly reviewRequired: true;
  readonly added: ScanCandidate[];
  readonly restocked: ScanCandidate[];
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

  /** Detection is durable job data, but never changes inventory until the user confirms. */
  async preview(images: readonly ImageInput[]): Promise<ScanPreview> {
    const known = this.stock.list();
    const byName = new Map(known.map((item) => [normalizeName(item.name), item]));
    const detected = await this.detector.detect(images, known.map((item) => item.name));
    const result: ScanPreview = { reviewRequired: true, added: [], restocked: [], alreadyInStock: [] };
    const seen = new Set<string>();
    for (const candidate of detected) {
      const key = normalizeName(candidate.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const existing = byName.get(key);
      if (existing?.inStock) result.alreadyInStock.push(existing);
      else {
        const draft = existing
          ? createDraft({ name: existing.name, category: existing.category, notes: existing.notes }, 'photo')
          : createDraft(candidate, 'photo');
        result[existing ? 'restocked' : 'added'].push({ ...draft, candidateId: seen.size });
      }
    }
    return result;
  }

  combine(previous: ScanPreview, next: ScanPreview): ScanPreview {
    const result: ScanPreview = {
      reviewRequired: true,
      added: [...previous.added], restocked: [...previous.restocked], alreadyInStock: [...previous.alreadyInStock],
    };
    const items = [...result.added, ...result.restocked, ...result.alreadyInStock];
    const names = new Set(items.map((item) => normalizeName(item.name)));
    let candidateId = Math.max(0, ...[...result.added, ...result.restocked].map((item) => item.candidateId));
    for (const bucket of ['added', 'restocked'] as const) {
      for (const item of next[bucket]) {
        const key = normalizeName(item.name);
        if (names.has(key)) continue;
        names.add(key);
        result[bucket].push({ ...item, candidateId: ++candidateId });
      }
    }
    for (const item of next.alreadyInStock) {
      const key = normalizeName(item.name);
      if (!names.has(key)) { names.add(key); result.alreadyInStock.push(item); }
    }
    return result;
  }

  /** Validate the entire selection before any write. Edits are restricted to this scan's candidates. */
  confirm(preview: ScanPreview, selection: unknown): ScanResult {
    if (!Array.isArray(selection)) throw new ValidationError('Choose the ingredients to add.');
    const candidates = new Map([...preview.added, ...preview.restocked].map((item) => [item.candidateId, item]));
    if (selection.length > candidates.size) throw new ValidationError('Too many ingredients selected.');
    const seenIds = new Set<number>();
    const drafts = selection.map((raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('Invalid ingredient selection.');
      const input = raw as { candidateId?: unknown; name?: unknown; category?: unknown; notes?: unknown };
      if (typeof input.candidateId !== 'number' || !candidates.has(input.candidateId) || seenIds.has(input.candidateId)) {
        throw new ValidationError('Invalid ingredient selection.');
      }
      seenIds.add(input.candidateId);
      const candidate = candidates.get(input.candidateId)!;
      return createDraft({
        name: input.name ?? candidate.name,
        category: input.category ?? candidate.category,
        notes: input.notes ?? candidate.notes,
      }, 'photo');
    });
    const result: ScanResult = { added: [], restocked: [], alreadyInStock: [] };
    const seenNames = new Set<string>();
    for (const draft of drafts) {
      const key = normalizeName(draft.name);
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      const { ingredient, status } = this.stock.addIfMissing(draft);
      // A reviewed restock also saves corrections made in its edit sheet.
      const confirmed = status === 'restocked'
        ? this.stock.update(ingredient.id, { name: draft.name, category: draft.category, notes: draft.notes })
        : ingredient;
      result[BUCKET[status]].push(confirmed);
    }
    return result;
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
