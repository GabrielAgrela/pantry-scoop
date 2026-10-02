import { ConflictError, NotFoundError } from '../domain/errors.ts';
import {
  cleanChanges,
  createDraft,
  normalizeName,
  type ChangesInput,
  type Ingredient,
  type IngredientDraft,
} from '../domain/ingredient.ts';
import type { IngredientRepository } from '../ports/ingredient-repository.ts';

/** created = new item; restocked = known item that had run out; unchanged = already in stock. */
export type AddStatus = 'created' | 'restocked' | 'unchanged';

export interface AddOutcome {
  readonly ingredient: Ingredient;
  readonly status: AddStatus;
}

/** Owns the stock rules: no duplicate names, and "seeing" an item means you have it. */
export class StockService {
  private readonly repository: IngredientRepository;

  constructor(repository: IngredientRepository) {
    this.repository = repository;
  }

  list(): Ingredient[] {
    return this.repository.list();
  }

  /** What can actually be cooked with right now. */
  listInStock(): Ingredient[] {
    return this.list().filter((ingredient) => ingredient.inStock);
  }

  /** Idempotent add: creates new items, puts run-out items back in stock, leaves the rest alone. */
  addIfMissing(draft: IngredientDraft): AddOutcome {
    const existing = this.repository.findByNormalizedName(normalizeName(draft.name));
    if (!existing) return { ingredient: this.repository.insert(draft), status: 'created' };
    if (!existing.inStock) return { ingredient: this.repository.update(existing.id, { inStock: true }), status: 'restocked' };
    return { ingredient: existing, status: 'unchanged' };
  }

  /** Explicit manual add: adding something you already have is reported as a mistake. */
  addManual(input: { name: unknown; category?: unknown; notes?: unknown }): AddOutcome {
    const outcome = this.addIfMissing(createDraft(input, 'manual'));
    if (outcome.status === 'unchanged') throw new ConflictError(`"${outcome.ingredient.name}" is already in stock.`);
    return outcome;
  }

  update(id: number, input: ChangesInput): Ingredient {
    this.require(id);
    const changes = cleanChanges(input);
    if (changes.name !== undefined) {
      const clash = this.repository.findByNormalizedName(normalizeName(changes.name));
      if (clash && clash.id !== id) throw new ConflictError(`"${clash.name}" is already in your list.`);
    }
    return this.repository.update(id, changes);
  }

  remove(id: number): void {
    if (!this.repository.delete(id)) throw new NotFoundError(`Ingredient ${id} not found.`);
  }

  private require(id: number): Ingredient {
    const ingredient = this.repository.findById(id);
    if (!ingredient) throw new NotFoundError(`Ingredient ${id} not found.`);
    return ingredient;
  }
}
