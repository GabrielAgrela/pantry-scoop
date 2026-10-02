import { ValidationError } from './errors.ts';

export { normalizeName } from './text.ts';

export const CATEGORIES = [
  'dairy',
  'eggs',
  'meat-fish',
  'vegetables',
  'fruit',
  'grains',
  'legumes',
  'nuts',
  'herbs-spices',
  'flavouring',
  'condiments',
  'baking',
  'sweetener',
  'chocolate',
  'snacks',
  'drinks',
  'alcohol',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export type IngredientSource = 'photo' | 'manual';

export interface Ingredient {
  readonly id: number;
  readonly name: string;
  readonly category: Category;
  readonly notes: string;
  readonly source: IngredientSource;
  /** False = ran out. Kept (not deleted) so its name/notes survive and a photo can restock it. */
  readonly inStock: boolean;
  readonly createdAt: string;
}

/** What we know about an ingredient before it is persisted. */
export interface IngredientDraft {
  readonly name: string;
  readonly category: Category;
  readonly notes: string;
  readonly source: IngredientSource;
}

export type IngredientChanges = Partial<Pick<IngredientDraft, 'name' | 'category' | 'notes'> & { readonly inStock: boolean }>;

const MAX_NAME_LENGTH = 80;
const MAX_NOTES_LENGTH = 500;

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') throw new ValidationError('Ingredient name must be text.');
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length === 0) throw new ValidationError('Ingredient name cannot be empty.');
  if (name.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`Ingredient name must be at most ${MAX_NAME_LENGTH} characters.`);
  }
  return name;
}

export function cleanCategory(raw: unknown): Category {
  if (raw === undefined || raw === null || raw === '') return 'other';
  if (!isCategory(raw)) {
    throw new ValidationError(`Unknown category "${String(raw)}". Use one of: ${CATEGORIES.join(', ')}.`);
  }
  return raw;
}

export function cleanNotes(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw new ValidationError('Notes must be text.');
  const notes = raw.trim();
  if (notes.length > MAX_NOTES_LENGTH) {
    throw new ValidationError(`Notes must be at most ${MAX_NOTES_LENGTH} characters.`);
  }
  return notes;
}

export function createDraft(
  input: { name: unknown; category?: unknown; notes?: unknown },
  source: IngredientSource,
): IngredientDraft {
  return {
    name: cleanName(input.name),
    category: cleanCategory(input.category),
    notes: cleanNotes(input.notes),
    source,
  };
}

export type ChangesInput = { name?: unknown; category?: unknown; notes?: unknown; inStock?: unknown };

export function cleanChanges(input: ChangesInput): IngredientChanges {
  const changes: { -readonly [K in keyof IngredientChanges]: IngredientChanges[K] } = {};
  if (input.name !== undefined) changes.name = cleanName(input.name);
  if (input.category !== undefined) changes.category = cleanCategory(input.category);
  if (input.notes !== undefined) changes.notes = cleanNotes(input.notes);
  if (input.inStock !== undefined) {
    if (typeof input.inStock !== 'boolean') throw new ValidationError('inStock must be true or false.');
    changes.inStock = input.inStock;
  }
  if (Object.keys(changes).length === 0) throw new ValidationError('Nothing to update.');
  return changes;
}
