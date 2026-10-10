import { h } from './dom.js';
import { difficultyHats } from './difficulty-picker.js';
import { t } from './i18n.js';

export const FLAVOUR_LEVELS = [
  { value: 'any', label: t('Any'), example: t('Scoop mixes familiar and bold') },
  { value: 'familiar', label: t('Crowd pleaser'), example: t('Think classic spaghetti bolognese') },
  { value: 'creative', label: t('A little twist'), example: t('Think bolognese with miso and chilli crisp') },
  { value: 'adventurous', label: t('Adventurous'), example: t('Think dan dan noodles instead of bolognese') },
];
const DIFFICULTY_LEVELS = { easy: { rank: 1, label: t('Easy') }, medium: { rank: 2, label: t('Medium') }, hard: { rank: 3, label: t('Hard') } };
// A comic exclamation mark: one per step of boldness, the way difficulty counts chef's hats.
const BANG = '<svg viewBox="0 0 20 40" aria-hidden="true"><path d="M4.5 3h11l-2.6 23h-5.8z"/><circle cx="10" cy="33.5" r="4.2"/></svg>';
const FLAVOUR_NOTES = { familiar: t('Familiar flavours with broad appeal'), creative: t('A familiar dish with a gentle surprise'), adventurous: t('Unusual flavours for curious eaters') };

/**
 * Flavour is one scale, familiar to bold: each step shows one more exclamation mark (! !! !!!),
 * with "Any" set apart as no preference. The caption names the level and shows what it does to
 * one well-known dish.
 */
export function createCreativityPicker({ value, onChange }) {
  const name = h('strong', {}), example = h('span', {});
  const caption = h('p', { class: 'flavour-caption', id: 'creativity-caption', 'aria-live': 'polite' }, name, example);
  const radio = (level) => h('input', { type: 'radio', name: 'creativity', value: level.value, checked: level.value === value, 'aria-label': level.label, onchange: () => choose(level.value) });
  const any = h('label', { class: 'flavour-any' }, radio(FLAVOUR_LEVELS[0]), h('span', { 'aria-hidden': 'true' }, t('Any')));
  const stops = FLAVOUR_LEVELS.slice(1).map((level, i) => {
    const mark = h('span', { class: 'flavour-mark' });
    mark.insertAdjacentHTML('afterbegin', BANG.repeat(i + 1));
    const stop = h('label', { class: `flavour-stop flavour-${level.value}`, title: `${level.label}: ${FLAVOUR_NOTES[level.value]}` }, radio(level), mark);
    return stop;
  });
  const track = h('div', { class: 'flavour-track' }, ...stops,
    h('span', { class: 'flavour-end flavour-end-start', 'aria-hidden': 'true' }, t('Familiar')), h('span', { class: 'flavour-end flavour-end-stop', 'aria-hidden': 'true' }, t('Bold')));
  const picker = h('div', { class: 'flavour-picker', role: 'radiogroup', 'aria-labelledby': 'creativity-label', 'aria-describedby': 'creativity-hint creativity-caption' }, any, track);
  paint(false);

  function choose(next) { value = next; paint(true); onChange(next); }
  function paint(animate) {
    const rank = Math.max(0, FLAVOUR_LEVELS.findIndex((level) => level.value === value));
    picker.dataset.level = String(rank);
    name.textContent = FLAVOUR_LEVELS[rank].label; example.textContent = FLAVOUR_LEVELS[rank].example;
    stops.forEach((stop, i) => {
      stop.classList.remove('pop');
      if (animate && i === rank - 1) { void stop.offsetWidth; stop.classList.add('pop'); } // restart the pop on the chosen step
    });
    if (animate) { caption.classList.remove('swap'); void caption.offsetWidth; caption.classList.add('swap'); }
  }
  return h('div', { class: 'flavour-field' }, picker, caption);
}

/** The flavour level as one to three exclamation marks, as the difficulty ribbon counts hats. */
function flavourMarks(rank) {
  const marks = h('span', { class: 'ribbon-bangs', 'aria-hidden': 'true' });
  marks.insertAdjacentHTML('afterbegin', BANG.repeat(rank));
  return marks;
}

/**
 * Labels are supplied by the generator. Older recipes keep their original, unclassified state.
 * Familiar flavours are the default expectation, so only a twist or an adventure gets a ribbon.
 */
export function recipeRibbons(recipe) {
  const difficulty = DIFFICULTY_LEVELS[recipe.difficulty];
  const flavour = FLAVOUR_LEVELS.find((level) => level.value === recipe.creativity && !['any', 'familiar'].includes(level.value));
  if (!difficulty && !flavour) return null;
  return h('span', { class: 'recipe-ribbons' },
    difficulty && h('span', { class: `idea-ribbon difficulty-ribbon difficulty-${recipe.difficulty}`, role: 'img', title: t('Difficulty: {level}', { level: difficulty.label }), 'aria-label': t('Difficulty: {level}', { level: difficulty.label }) }, difficultyHats(difficulty.rank)),
    flavour && h('span', { class: `idea-ribbon flavour-ribbon flavour-${flavour.value}`, role: 'img', title: `${flavour.label}: ${FLAVOUR_NOTES[flavour.value]}`, 'aria-label': t('Flavour adventure: {level}', { level: flavour.label }) }, flavourMarks(FLAVOUR_LEVELS.indexOf(flavour))));
}
