import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_PROFILE, mergeProfile, PROFILE_LIMITS } from '../../src/domain/kitchen-profile.ts';

describe('DEFAULT_PROFILE', () => {
  it('keeps the ice-cream machine limits as appliance details', () => {
    const machine = DEFAULT_PROFILE.appliances.find((a) => /ice-cream machine/.test(a.name));
    assert.match(machine?.details ?? '', /700–850 ml/);
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

  it('ignores unknown keys', () => {
    assert.deepEqual(mergeProfile(DEFAULT_PROFILE, { hacker: true }), DEFAULT_PROFILE);
  });

  it('rejects malformed values', () => {
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
