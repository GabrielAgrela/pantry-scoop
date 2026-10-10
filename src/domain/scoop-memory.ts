import { ValidationError } from './errors.ts';
import { normalizeName } from './text.ts';

/** One thing Scoop learned from the cook's feedback, kept to steer future ideas. */
export interface ScoopMemory {
  readonly id: number;
  readonly note: string;
  /** The recipe whose feedback taught it ('' when unknown). */
  readonly recipeTitle: string;
  readonly createdAt: string;
}

/** Every note goes into each recipe prompt, so the memory stays small. */
export const MAX_MEMORIES = 60;
export const MAX_NOTE_LENGTH = 240;
/** How many notes one piece of feedback may add. */
export const MAX_NOTES_PER_FEEDBACK = 6;
export const MAX_FEEDBACK_LENGTH = 2000;
/** How many times the cook may reply to proposed notes before choosing what to keep. */
export const MAX_STEERING_ROUNDS = 3;

/** Confirmed notes, trimmed and without blanks or repeats of each other or of what is already remembered. */
export function newMemoryNotes(value: unknown, remembered: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_NOTES_PER_FEEDBACK) {
    throw new ValidationError(`Choose between 1 and ${MAX_NOTES_PER_FEEDBACK} notes to remember.`);
  }
  const seen = new Set(remembered.map(normalizeName));
  const notes: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') throw new ValidationError('Each note must be text.');
    const note = item.trim().replace(/\s+/g, ' ');
    if (note.length > MAX_NOTE_LENGTH) throw new ValidationError(`Each note may have at most ${MAX_NOTE_LENGTH} characters.`);
    const key = normalizeName(note);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    notes.push(note);
  }
  if (remembered.length + notes.length > MAX_MEMORIES) {
    throw new ValidationError(`Scoop’s memory is full (${MAX_MEMORIES} notes). Forget a few in My kitchen first.`);
  }
  return notes;
}

/** A remembered note rewritten by the cook; it must stay distinct from the other notes. */
export function editedMemoryNote(value: unknown, others: readonly string[]): string {
  if (typeof value !== 'string') throw new ValidationError('The note must be text.');
  const note = value.trim().replace(/\s+/g, ' ');
  if (!note || note.length > MAX_NOTE_LENGTH) throw new ValidationError(`A note must have between 1 and ${MAX_NOTE_LENGTH} characters.`);
  if (others.some((other) => normalizeName(other) === normalizeName(note))) throw new ValidationError('Scoop already remembers that.');
  return note;
}

export function feedbackText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_FEEDBACK_LENGTH) {
    throw new ValidationError(`Feedback must be at most ${MAX_FEEDBACK_LENGTH.toLocaleString('en')} characters.`);
  }
  return value.trim();
}
