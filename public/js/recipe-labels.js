import { h } from './dom.js';
import { difficultyHats } from './difficulty-picker.js';

export const FLAVOUR_LEVELS = [
  { value: 'any', label: 'Any', symbol: '✨' },
  { value: 'familiar', label: 'Crowd pleaser', symbol: '💗' },
  { value: 'creative', label: 'A little twist', symbol: '🌷' },
  { value: 'adventurous', label: 'Adventurous', symbol: '🚀' },
];
const DIFFICULTY_LEVELS = { easy: { rank: 1, label: 'Easy' }, medium: { rank: 2, label: 'Medium' }, hard: { rank: 3, label: 'Hard' } };
const FLAVOUR_NOTES = { familiar: 'Familiar flavours with broad appeal', creative: 'A familiar dish with a gentle surprise', adventurous: 'Unusual flavours for curious eaters' };

export function createCreativityPicker({ value, onChange }) {
  return h('div', { class: 'flavour-picker', role: 'radiogroup', 'aria-labelledby': 'creativity-label', 'aria-describedby': 'creativity-hint' },
    ...FLAVOUR_LEVELS.map((level) => h('label', { class: `flavour-choice flavour-${level.value}`, title: FLAVOUR_NOTES[level.value] },
      h('input', { type: 'radio', name: 'creativity', value: level.value, checked: value === level.value, onchange: () => onChange(level.value) }),
      h('span', { class: 'flavour-choice-copy' }, h('span', { class: 'flavour-symbol', 'aria-hidden': 'true' }, level.symbol), level.label))));
}

/** Labels are supplied by the generator. Older recipes keep their original, unclassified state. */
export function recipeRibbons(recipe) {
  const difficulty = DIFFICULTY_LEVELS[recipe.difficulty];
  const flavour = FLAVOUR_LEVELS.find((level) => level.value === recipe.creativity && level.value !== 'any');
  if (!difficulty && !flavour) return null;
  return h('span', { class: 'recipe-ribbons' },
    difficulty && h('span', { class: `idea-ribbon difficulty-ribbon difficulty-${recipe.difficulty}`, role: 'img', title: `Difficulty: ${difficulty.label}`, 'aria-label': `Difficulty: ${difficulty.label}` }, difficultyHats(difficulty.rank)),
    flavour && h('span', { class: `idea-ribbon flavour-ribbon flavour-${flavour.value}`, role: 'img', title: `${flavour.label}: ${FLAVOUR_NOTES[flavour.value]}`, 'aria-label': `Flavour adventure: ${flavour.label}` }, h('span', { 'aria-hidden': 'true' }, flavour.symbol)));
}
