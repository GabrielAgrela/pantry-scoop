import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ValidationError } from '../../src/domain/errors.ts';
import { cleanChanges, createDraft, normalizeName } from '../../src/domain/ingredient.ts';

describe('normalizeName', () => {
  it('ignores case, accents and extra whitespace', () => {
    assert.equal(normalizeName('  Leite   MAGRÓ '), 'leite magro');
    assert.equal(normalizeName('Maracujá'), normalizeName('maracuja'));
  });

  it('keeps genuinely different names apart', () => {
    assert.notEqual(normalizeName('Leite magro'), normalizeName('Leite meio-gordo'));
  });
});

describe('createDraft', () => {
  it('trims the name and defaults category and notes', () => {
    assert.deepEqual(createDraft({ name: '  Natas ' }, 'manual'), {
      name: 'Natas',
      category: 'other',
      notes: '',
      source: 'manual',
    });
  });

  it('rejects empty names, unknown categories and non-text notes', () => {
    assert.throws(() => createDraft({ name: '   ' }, 'manual'), ValidationError);
    assert.throws(() => createDraft({ name: 42 }, 'manual'), ValidationError);
    assert.throws(() => createDraft({ name: 'Natas', category: 'meat' }, 'manual'), /Unknown category/);
    assert.throws(() => createDraft({ name: 'Natas', notes: 7 }, 'manual'), ValidationError);
  });

  it('rejects overly long names', () => {
    assert.throws(() => createDraft({ name: 'x'.repeat(81) }, 'manual'), /at most 80/);
  });
});

describe('cleanChanges', () => {
  it('keeps only the provided fields', () => {
    assert.deepEqual(cleanChanges({ category: 'dairy' }), { category: 'dairy' });
  });

  it('rejects an empty update', () => {
    assert.throws(() => cleanChanges({}), /Nothing to update/);
  });
});
