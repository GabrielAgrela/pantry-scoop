import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ingredientEmoji } from '../../src/domain/ingredient-emoji.ts';

describe('ingredient emojis', () => {
  it('recognizes food names across the existing pantry languages, even under Other', () => {
    for (const [name, expected] of [
      ['Cherry tomatoes', '🍅'], ['Leite MAGRÓ', '🥛'], ['Ananás em calda', '🍍'],
      ['Pêssego calda', '🍑'], ['Cebolla en polvo', '🧅'], ['Coco ralado', '🥥'],
      ['Arroz', '🍚'], ['Massa', '🍝'], ['Azeite', '🫒'], ['Água', '💧'],
      ['Café solúvel', '☕'], ['Palitos de champanhe', '🍪'], ['Mascarpone', '🧀'],
      ['Courgette', '🥒'], ['Abobrinha', '🥒'],
    ] as const) assert.equal(ingredientEmoji(name, 'other'), expected, name);
  });

  it('distinguishes seasonings, whole peppers and names containing another food word', () => {
    assert.equal(ingredientEmoji('Steak Seasoning Canadian Blend', 'herbs-spices'), '🫙');
    assert.equal(ingredientEmoji('Noz moscada moída', 'herbs-spices'), '🫙');
    assert.equal(ingredientEmoji('Orange Pepper', 'herbs-spices'), '🌶️');
    assert.equal(ingredientEmoji('Bell peppers', 'vegetables'), '🫑');
    assert.equal(ingredientEmoji('Pearl barley', 'grains'), '🌾');
    assert.equal(ingredientEmoji('Grape tomatoes', 'vegetables'), '🍅');
    assert.equal(ingredientEmoji('Peanut butter', 'nuts'), '🥜');
  });

  it('uses the assigned food shelf for ingredients without a specific food emoji', () => {
    assert.equal(ingredientEmoji('Dragon fruit', 'fruit'), '🍎');
    assert.equal(ingredientEmoji('Tarragon', 'herbs-spices'), '🌿');
    assert.equal(ingredientEmoji('Agar agar', 'baking'), '🧁');
  });
});
