import { h } from './dom.js';

const range = (min, max) => (min === max ? `${min}` : `${min}–${max}`);

export const KIND_LABELS = {
  any: '🎲 Anything',
  'ice-cream': '🍨 Ice cream',
  dessert: '🍰 Dessert',
  breakfast: '🥞 Breakfast',
  main: '🍝 Lunch / dinner',
  side: '🥗 Side',
  snack: '🥪 Snack',
  baking: '🥖 Baking',
  drink: '🥤 Drink',
};

/** Renders a recipe's body. Shared by fresh suggestions and saved recipes. */
export function recipeBody(recipe) {
  const missing = recipe.ingredients.filter((i) => !i.inStock).length;
  return [
    h('p', { class: 'muted' }, recipe.summary),
    h('div', { class: 'chips' },
      h('span', { class: 'chip' }, KIND_LABELS[recipe.kind] ?? recipe.kind),
      h('span', { class: 'chip' }, recipe.makes),
      h('span', { class: 'chip' }, `⏱ ${recipe.totalMinutes} min`),
      h('span', { class: 'chip' }, `${range(recipe.estimate.kcalMin, recipe.estimate.kcalMax)} kcal`),
      h('span', { class: 'chip' }, `${range(recipe.estimate.sugarGramsMin, recipe.estimate.sugarGramsMax)} g sugar`),
      h('span', { class: `chip ${missing ? 'warn' : 'ok'}` }, missing ? `${missing} to buy` : 'all in stock'),
    ),
    recipe.equipment.length ? h('p', { class: 'muted' }, recipe.equipment.join(' · ')) : '',
    h('h5', {}, 'Ingredients'),
    h('ul', {}, ...recipe.ingredients.map((i) => h('li', { class: i.inStock ? '' : 'missing' }, h('strong', {}, i.amount), ' ', i.name))),
    h('h5', {}, 'Method'),
    h('ol', {}, ...recipe.steps.map((step) => h('li', {}, step))),
    recipe.tips.length ? [h('h5', {}, 'Tips'), h('ul', {}, ...recipe.tips.map((tip) => h('li', {}, tip)))] : '',
  ];
}
