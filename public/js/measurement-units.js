import { t } from './i18n.js';

/** Units remain plain profile text, including older free-form preferences; only labels are translated. */
export const MEASUREMENT_UNITS = [
  { value: 'Spoons (tbsp/tsp)', label: t('Spoons'), detail: t('tbsp & tsp') },
  { value: 'Metric (g, ml, °C)', label: t('Metric'), detail: 'g, ml & °C' },
  { value: 'US (cups, oz, °F)', label: t('Cups & ounces'), detail: t('cups, oz & °F') },
];
export function parseUnitPriorities(text) {
  return [...new Set(String(text || '').split(' → ').map(value => value.trim()).filter(Boolean))];
}
export const serializeUnitPriorities = values => values.join(' → ');
export const unitOption = value => MEASUREMENT_UNITS.find(option => option.value === value) ?? { value, label: t('Custom'), detail: value };
export const unitPrioritySummary = text => parseUnitPriorities(text).map(value => {
  const option = MEASUREMENT_UNITS.find(option => option.value === value);
  return option ? option.label : value;
}).join(' → ');
