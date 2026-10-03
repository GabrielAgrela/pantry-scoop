import { h } from './dom.js';
import { icon } from './ui.js';

const range = (min, max) => (min === max ? `${min}` : `${min}–${max}`);

/** Recipes saved before dish types were editable carry a fixed id as their kind. */
const LEGACY_KIND_LABELS = {
  'ice-cream': 'Ice cream',
  dessert: 'Dessert',
  breakfast: 'Breakfast',
  main: 'Dinner',
  side: 'Side dish',
  snack: 'Snack',
  baking: 'Baking',
  drink: 'Drink',
};
export const kindLabel = (kind) => LEGACY_KIND_LABELS[kind] ?? kind;

/** Renders a recipe's body. Shared by fresh suggestions and saved recipes. */
export function recipeBody(recipe, { collapsible = false } = {}) {
  const missing = recipe.ingredients.filter((i) => !i.inStock).length;
  const instructions = [
    h('p', { class: 'muted' }, `Estimated nutrition: ${range(recipe.estimate.kcalMin, recipe.estimate.kcalMax)} kcal · ${range(recipe.estimate.sugarGramsMin, recipe.estimate.sugarGramsMax)} g sugar`),
    recipe.equipment.length ? h('p', { class: 'muted' }, recipe.equipment.join(' · ')) : '',
    h('h5', {}, 'Ingredients'),
    h('ul', {}, ...recipe.ingredients.map((i) => h('li', { class: i.inStock ? '' : 'missing' }, h('strong', {}, i.amount), ' ', i.name))),
    h('h5', {}, 'Method'),
    h('ol', {}, ...recipe.steps.map((step) => h('li', {}, step))),
    recipe.tips.length ? [h('h5', {}, 'Tips'), h('ul', {}, ...recipe.tips.map((tip) => h('li', {}, tip)))] : '',
  ];
  return [
    h('p', { class: 'muted' }, recipe.summary),
    h('div', { class: 'chips' },
      h('span', { class: 'chip' }, kindLabel(recipe.kind)),
      h('span', { class: 'chip' }, recipe.makes),
      h('span', { class: 'chip' }, icon('clock'), `${recipe.totalMinutes} min`),
      h('span', { class: `chip ${missing ? 'warn' : 'ok'}` }, icon(missing ? 'pantry' : 'check'), missing ? `${missing} to buy` : 'All in your pantry'),
    ),
    collapsible ? h('details', { class: 'recipe-instructions' }, h('summary', {}, 'Ingredients & method', icon('arrow')), ...instructions) : instructions,
  ];
}
