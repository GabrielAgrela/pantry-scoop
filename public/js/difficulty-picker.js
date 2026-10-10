import { h } from './dom.js';
import { t } from './i18n.js';

const LEVELS = [
  { value: 'any', name: t('Any'), note: t('Surprise me') },
  { value: 'easy', name: t('Easy'), note: t('Simple and quick') },
  { value: 'medium', name: t('Medium'), note: t('A little effort') },
  { value: 'hard', name: t('Hard'), note: t('Chef mode') },
];
// A chef's toque: puffy crown, band and pleats. Drawn once per hat; colours come from CSS.
const HAT = '<svg viewBox="0 0 40 40" aria-hidden="true"><path class="hat-puff" d="M12 25c-4.4 0-7.5-3-7.5-6.6 0-3.8 3.3-6.7 7.3-6.2C13 8.2 16.2 5.5 20 5.5s7 2.7 8.2 6.7c4-.5 7.3 2.4 7.3 6.2 0 3.6-3.1 6.6-7.5 6.6z"/><rect class="hat-band" x="12" y="24" width="16" height="10" rx="2.5"/><path class="hat-pleat" d="M16.5 27v4M20 27v4M23.5 27v4"/></svg>';

export function difficultyHats(rank) {
  const hats = h('span', { class: 'ribbon-hats', 'aria-hidden': 'true' });
  hats.insertAdjacentHTML('afterbegin', HAT.repeat(rank));
  return hats;
}

/**
 * Difficulty as the cookbook convention: up to three chef's hats. Choosing a level lights its hats
 * one after another with a puff of steam; "Any" shuffles them. Native radios keep it a radiogroup
 * for keyboards and screen readers.
 */
export function createDifficultyPicker({ value, onChange }) {
  const name = h('strong', {}), note = h('span', {});
  const caption = h('span', { class: 'difficulty-caption', 'aria-hidden': 'true' }, name, note);
  const radio = (level) => h('input', { type: 'radio', name: 'difficulty', value: level.value, checked: level.value === value, onchange: () => choose(level.value) });
  const any = h('label', { class: 'difficulty-any' }, radio(LEVELS[0]), h('span', {}, LEVELS[0].name));
  const hats = LEVELS.slice(1).map((level, i) => {
    const art = h('span', { class: 'hat-art' }, h('span', { class: 'steam' }), h('span', { class: 'steam' }), h('span', { class: 'steam' }));
    art.insertAdjacentHTML('afterbegin', HAT);
    const hat = h('label', { class: `hat-choice difficulty-${level.value}`, title: `${level.name}: ${level.note}` }, radio(level), art, h('span', { class: 'visually-hidden' }, level.name));
    hat.style.setProperty('--i', String(i)); // staggers the pops; a style attribute would be blocked by the CSP
    return hat;
  });
  const element = h('div', { class: 'difficulty-picker', role: 'radiogroup', 'aria-labelledby': 'difficulty-label' }, any, h('div', { class: 'hat-row' }, ...hats), caption);
  paint(value, false);

  function choose(next) { const previous = value; value = next; paint(next, true, previous); onChange(next); }
  function paint(level, animate, previous) {
    const rank = LEVELS.findIndex((entry) => entry.value === level);
    const before = LEVELS.findIndex((entry) => entry.value === previous);
    element.dataset.level = String(rank);
    name.textContent = LEVELS[rank].name; note.textContent = LEVELS[rank].note;
    hats.forEach((hat, i) => {
      hat.classList.toggle('lit', i < rank);
      if (!animate) return;
      // Restart the CSS animation: lit hats pop in order, hats switched off deflate, "Any" shuffles all.
      hat.classList.remove('pop', 'drop', 'shuffle');
      void hat.offsetWidth;
      if (i < rank) hat.classList.add('pop');
      else if (rank === 0) hat.classList.add('shuffle');
      else if (i < before) hat.classList.add('drop');
    });
    if (animate) { caption.classList.remove('swap'); void caption.offsetWidth; caption.classList.add('swap'); }
  }
  return element;
}
