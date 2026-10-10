import { createDraft, normalizeName, type Ingredient, type IngredientDraft } from '../domain/ingredient.ts';
import { ingredientEmoji } from '../domain/ingredient-emoji.ts';
import { ValidationError } from '../domain/errors.ts';
import type { ImageInput } from '../domain/image.ts';
import type { IngredientDetector } from '../ports/ingredient-detector.ts';
import type { ProfileService } from './profile-service.ts';
import type { AddStatus, StockService } from './stock-service.ts';

export interface ScanResult {
  readonly added: Ingredient[];
  readonly restocked: Ingredient[];
  readonly alreadyInStock: Ingredient[];
}

export interface ScanCandidate extends IngredientDraft {
  readonly candidateId: number;
  readonly emoji?: string;
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
  private readonly profiles: ProfileService;

  constructor(detector: IngredientDetector, stock: StockService, profiles: ProfileService) {
    this.detector = detector;
    this.stock = stock;
    this.profiles = profiles;
  }

  /** Detection is durable job data, but never changes inventory until the user confirms. */
  async preview(images: readonly ImageInput[]): Promise<ScanPreview> {
    const known = this.stock.list();
    const byName = new Map(known.map((item) => [normalizeName(item.name), item]));
    const detected = await this.detector.detect(images, known.map((item) => item.name), this.profiles.get().language);
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
        result[existing ? 'restocked' : 'added'].push({ ...draft, emoji: ingredientEmoji(draft.name, draft.category), candidateId: seen.size });
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
    // Pantry matches use the negative pantry id as their stable review identity,
    // including saved previews created before matches could be corrected.
    const candidates = new Map([...preview.added, ...preview.restocked,
      ...preview.alreadyInStock.map((item) => ({ ...createDraft(item, 'photo'), candidateId: -item.id })),
    ].map((item) => [item.candidateId, item]));
    if (selection.length > candidates.size) throw new ValidationError('Too many ingredients selected.');
    const seenIds = new Set<number>();
    const known = new Map(this.stock.list().map((item) => [item.id, item]));
    const reviewed = selection.map((raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('Invalid ingredient selection.');
      const input = raw as { candidateId?: unknown; name?: unknown; category?: unknown; notes?: unknown; duplicateIngredientId?: unknown; duplicateCandidateId?: unknown; separate?: unknown };
      if (typeof input.candidateId !== 'number' || !candidates.has(input.candidateId) || seenIds.has(input.candidateId)) {
        throw new ValidationError('Invalid ingredient selection.');
      }
      seenIds.add(input.candidateId);
      const candidate = candidates.get(input.candidateId)!;
      if (input.duplicateIngredientId !== undefined && input.duplicateCandidateId !== undefined) throw new ValidationError('Choose one duplicate match.');
      if (input.duplicateIngredientId !== undefined && (typeof input.duplicateIngredientId !== 'number' || !known.has(input.duplicateIngredientId))) {
        throw new ValidationError('That duplicate is no longer in your pantry. Choose another match.');
      }
      if (input.duplicateCandidateId !== undefined && (typeof input.duplicateCandidateId !== 'number' || input.duplicateCandidateId === input.candidateId)) {
        throw new ValidationError('Invalid duplicate match.');
      }
      const draft = createDraft({
        name: input.name ?? candidate.name,
        category: input.category ?? candidate.category,
        notes: input.notes ?? candidate.notes,
      }, 'photo');
      if (input.separate !== undefined && typeof input.separate !== 'boolean') throw new ValidationError('Invalid separate ingredient selection.');
      return { candidateId: input.candidateId, draft, duplicateIngredientId: input.duplicateIngredientId as number | undefined, duplicateCandidateId: input.duplicateCandidateId as number | undefined, separate: input.separate === true };
    });
    for (const item of reviewed) {
      if (item.separate && item.duplicateIngredientId === undefined && item.duplicateCandidateId === undefined) {
        const key = normalizeName(item.draft.name);
        if ([...known.values()].some((other) => normalizeName(other.name) === key) || reviewed.some((other) => other !== item && other.duplicateIngredientId === undefined && other.duplicateCandidateId === undefined && normalizeName(other.draft.name) === key)) {
          throw new ValidationError('Use a distinct name for the separate ingredient.');
        }
      }
      if (item.duplicateCandidateId === undefined) continue;
      const target = reviewed.find((other) => other.candidateId === item.duplicateCandidateId);
      if (!target || target.duplicateCandidateId !== undefined || target.duplicateIngredientId !== undefined) {
        throw new ValidationError('Keep the matched scan ingredient selected, or choose another duplicate.');
      }
    }
    const result: ScanResult = { added: [], restocked: [], alreadyInStock: [] };
    const seenNames = new Set<string>();
    const seenIngredients = new Set<number>();
    for (const { draft, duplicateIngredientId, duplicateCandidateId } of reviewed) {
      // Another selected candidate owns this addition; never create the duplicate's draft.
      if (duplicateCandidateId !== undefined) continue;
      if (duplicateIngredientId !== undefined) {
        if (seenIngredients.has(duplicateIngredientId)) continue;
        const existing = known.get(duplicateIngredientId)!;
        const confirmed = existing.inStock ? existing : this.stock.update(existing.id, { inStock: true });
        result[existing.inStock ? 'alreadyInStock' : 'restocked'].push(confirmed);
        seenIngredients.add(existing.id);
        continue;
      }
      const key = normalizeName(draft.name);
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      const { ingredient, status } = this.stock.addIfMissing(draft);
      if (seenIngredients.has(ingredient.id)) continue;
      // A reviewed restock also saves corrections made in its edit sheet.
      const confirmed = status === 'restocked'
        ? this.stock.update(ingredient.id, { name: draft.name, category: draft.category, notes: draft.notes })
        : ingredient;
      result[BUCKET[status]].push(confirmed);
      seenIngredients.add(ingredient.id);
    }
    return result;
  }

  async scan(images: readonly ImageInput[]): Promise<ScanResult> {
    // Run-out items are included so the detector reuses their names and they get restocked.
    const knownNames = this.stock.list().map((ingredient) => ingredient.name);
    const detected = await this.detector.detect(images, knownNames, this.profiles.get().language);

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
