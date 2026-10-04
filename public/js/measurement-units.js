/** Units remain plain profile text, including older free-form preferences. */
export const MEASUREMENT_UNITS = [
  { value: 'Spoons (tbsp/tsp)', label: 'Spoons', detail: 'tbsp & tsp' },
  { value: 'Metric (g, ml, °C)', label: 'Metric', detail: 'g, ml & °C' },
  { value: 'US (cups, oz, °F)', label: 'Cups & ounces', detail: 'cups, oz & °F' },
];
export function parseUnitPriorities(text) {
  return [...new Set(String(text || '').split(' → ').map(value => value.trim()).filter(Boolean))];
}
export const serializeUnitPriorities = values => values.join(' → ');
export const unitOption = value => MEASUREMENT_UNITS.find(option => option.value === value) ?? { value, label: 'Custom', detail: value };
export const unitPrioritySummary = text => parseUnitPriorities(text).map(value => {
  const option = MEASUREMENT_UNITS.find(option => option.value === value);
  return option ? option.label : value;
}).join(' → ');
