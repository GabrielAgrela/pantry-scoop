import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_PROFILE, mergeProfile, PROFILE_LIMITS } from '../../src/domain/kitchen-profile.ts';

describe('DEFAULT_PROFILE', () => {
  it('starts with common tools and generic cooking defaults, ready for confirmation', () => {
    assert.deepEqual(DEFAULT_PROFILE.appliances.map(item => item.name), ['Oven', 'Microwave', 'Fridge', 'Air fryer', 'Hob', 'Freezer']);
    assert.ok(DEFAULT_PROFILE.appliances.every(item => item.details === ''));
    assert.equal(DEFAULT_PROFILE.units, 'Metric (g, ml, °C)');
    assert.equal(DEFAULT_PROFILE.language, 'English');
    assert.equal(DEFAULT_PROFILE.preferences, '');
    assert.equal(DEFAULT_PROFILE.setupComplete, false);
    assert.equal(DEFAULT_PROFILE.dishTypes.find((dish) => dish.name === 'Ice cream')!.details, 'Frozen desserts, including ice cream and sorbet');
  });
});

describe('mergeProfile', () => {
  it('applies a partial update, coerces form strings and trims appliances', () => {
    const profile = mergeProfile(DEFAULT_PROFILE, {
      servings: '4',
      appliances: [{ name: '  Air fryer ', details: ' 4 L ' }, { name: 'Oven' }],
    });
    assert.equal(profile.servings, 4);
    assert.deepEqual(profile.appliances, [
      { name: 'Air fryer', details: '4 L' },
      { name: 'Oven', details: '' },
    ]);
    assert.equal(profile.units, DEFAULT_PROFILE.units);
  });

  it('allows a kitchen with no appliances listed', () => {
    assert.deepEqual(mergeProfile(DEFAULT_PROFILE, { appliances: [] }).appliances, []);
  });

  it('accepts a chosen emoji, including multi-code-point sequences, and rejects other text', () => {
    for (const emoji of ['🍳', '🍽️', '👩🏽‍🍳', '🇵🇹', '1️⃣']) {
      assert.equal(mergeProfile(DEFAULT_PROFILE, { appliances: [{ name: 'Custom tool', emoji: ` ${emoji} ` }] }).appliances[0]?.emoji, emoji);
    }
    for (const emoji of ['', 'oven', '🍳🥣', 3, 'x'.repeat(33)]) {
      assert.throws(() => mergeProfile(DEFAULT_PROFILE, { appliances: [{ name: 'Tool', emoji }] }), /emoji/);
    }
  });

  it('validates dish types: named, unique, and never the reserved "any"', () => {
    assert.deepEqual(mergeProfile(DEFAULT_PROFILE, { dishTypes: [{ name: ' Brunch ', details: ' Late, slow ' }] }).dishTypes, [{ name: 'Brunch', details: 'Late, slow' }]);
    assert.deepEqual(mergeProfile(DEFAULT_PROFILE, { dishTypes: [] }).dishTypes, []);
    assert.throws(() => mergeProfile(DEFAULT_PROFILE, { dishTypes: [{ name: 'Soup' }, { name: 'soup' }] }), /already a dish type/);
    assert.throws(() => mergeProfile(DEFAULT_PROFILE, { dishTypes: [{ name: 'Any dish' }] }), /reserved/);
    assert.throws(() => mergeProfile(DEFAULT_PROFILE, { dishTypes: [{ name: '' }] }), /needs a name/);
  });

  it('ignores unknown keys', () => {
    assert.deepEqual(mergeProfile(DEFAULT_PROFILE, { hacker: true }), DEFAULT_PROFILE);
  });

  it('rejects malformed values', () => {
    assert.throws(() => mergeProfile(DEFAULT_PROFILE, { setupStep: 3 }), /setupStep/);
    assert.throws(() => mergeProfile(DEFAULT_PROFILE, { setupComplete: 'yes' }), /setupComplete/);
    assert.throws(() => mergeProfile(DEFAULT_PROFILE, { servings: 0 }), /servings/);
    assert.throws(() => mergeProfile(DEFAULT_PROFILE, { servings: 2.5 }), /servings/);
    assert.throws(() => mergeProfile(DEFAULT_PROFILE, { appliances: 'oven' }), /must be a list/);
    assert.throws(() => mergeProfile(DEFAULT_PROFILE, { appliances: [{ name: ' ' }] }), /needs a name/);
    assert.throws(() => mergeProfile(DEFAULT_PROFILE, { appliances: [null] }), /must be an object/);
    const tooMany = Array.from({ length: PROFILE_LIMITS.maxAppliances + 1 }, (_, i) => ({ name: `A${i}` }));
    assert.throws(() => mergeProfile(DEFAULT_PROFILE, { appliances: tooMany }), /At most/);
    assert.throws(() => mergeProfile(DEFAULT_PROFILE, { units: 3 }), /must be text/);
    assert.throws(() => mergeProfile(DEFAULT_PROFILE, null), /must be an object/);
  });
});
