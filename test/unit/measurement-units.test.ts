import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
const { parseUnitPriorities, serializeUnitPriorities, unitPrioritySummary } = (await import(new URL('../../public/js/measurement-units.js', import.meta.url).href)) as {
  parseUnitPriorities: (text: string) => string[];
  serializeUnitPriorities: (values: string[]) => string;
  unitPrioritySummary: (text: string) => string;
};

describe('unit priority compatibility', () => {
  it('keeps older free-text restrictions intact instead of replacing them with a generic preset', () => {
    const original = 'ml and spoons (tbsp/tsp), not grams';
    assert.equal(serializeUnitPriorities(parseUnitPriorities(original)), original);
    assert.equal(unitPrioritySummary(original), original);
  });
  it('preserves the chosen priority order when saved and reopened', () => {
    const chosen = ['Spoons (tbsp/tsp)', 'Metric (g, ml, °C)'];
    assert.deepEqual(parseUnitPriorities(serializeUnitPriorities(chosen)), chosen);
    assert.equal(unitPrioritySummary(serializeUnitPriorities(chosen)), 'Spoons → Metric');
  });
});
