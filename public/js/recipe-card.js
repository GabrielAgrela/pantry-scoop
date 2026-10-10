import { calmMotion, h, openDialog, withBusy } from './dom.js';
import { load, save } from './store.js';
import { emoji, icon } from './ui.js';
import { localeTag, t, tn } from './i18n.js';

/** Set once the cook has marked something used up from a recipe (or waved the tip away). */
const STOCK_TIP_LEARNED = 'recipes.stockTipLearned';
/** How many sheets have shown the tap demo; it stops after a few even if never tried. */
const STOCK_NUDGES = 'recipes.stockNudges';
const MAX_STOCK_NUDGES = 4;

const range = (min, max) => (min === max ? `${min}` : `${min}–${max}`);

/** Only bold markers are supported; recipe text is always inserted as text, never HTML. */
function instructionText(step) {
  return step.split(/\*\*([^*\n]+)\*\*/g).map((part, index) =>
    index % 2 ? h('strong', {}, part) : part);
}

/** Recipes saved before dish types were editable carry a fixed id as their kind. */
const LEGACY_KIND_LABELS = {
  'ice-cream': t('Ice cream'),
  dessert: t('Dessert'),
  breakfast: t('Breakfast'),
  main: t('Dinner'),
  side: t('Side dish'),
  snack: t('Snack'),
  baking: t('Baking'),
  drink: t('Drink'),
};
export const kindLabel = (kind) => LEGACY_KIND_LABELS[kind] ?? kind;

// Recipes are written in the kitchen's language, so the yield words cover each supported one.
const SERVING_YIELD = /(\d+)\s*(servings?|portions?|people|persons?|porç(?:ão|ões)|pessoas?|doses?|porci(?:ón|ones)|raci(?:ón|ones)|personas?|personnes?|parts?)(?!\p{L})/iu;
const COUNTED_YIELD = /(?:^|\()\s*~?(\d+)\s+(?!(?:ml|l|g|kg|cl|oz)(?!\p{L}))(\p{L}+)/iu;

/** The estimate covers the whole recipe. Newer recipes say how many portions it makes; older ones only say it in "makes". */
function portion(recipe) {
  const serving = SERVING_YIELD.exec(recipe.makes);
  const counted = serving ?? COUNTED_YIELD.exec(recipe.makes);
  const count = recipe.estimate.portions > 0 ? recipe.estimate.portions : counted ? Number(counted[1]) : 0;
  if (!count) return { count: 1, label: t('whole recipe'), note: t('For the whole recipe') };
  return { count, label: t('per portion'), note: t('Whole recipe ÷ {portions}', { portions: counted && Number(counted[1]) === count ? `${count} ${counted[2]}` : count }) };
}

const grams = (value) => (value >= 10 ? Math.round(value) : Math.round(value * 10) / 10).toLocaleString(localeTag);
const NUTRIENTS = [
  ['💪', t('Protein'), (e) => e.proteinGrams],
  ['🍞', t('Carbs'), (e) => e.carbsGrams],
  ['🍬', t('Sugar'), (e) => [e.sugarGramsMin, e.sugarGramsMax]],
  ['🧈', t('Fat'), (e) => e.fatGrams],
  ['🌾', t('Fibre'), (e) => e.fibreGrams],
  ['🧂', t('Salt'), (e) => e.saltGrams],
];

function nutritionBanner(recipe) {
  const { count, label, note } = portion(recipe);
  const share = (value) => (Array.isArray(value) ? range(grams(value[0] / count), grams(value[1] / count)) : grams(value / count));
  const kcal = range(Math.round(recipe.estimate.kcalMin / count), Math.round(recipe.estimate.kcalMax / count));
  const nutrients = NUTRIENTS.map(([symbol, name, pick]) => [symbol, name, pick(recipe.estimate)]).filter(([, , value]) => value !== undefined && (!Array.isArray(value) || value.every((v) => v !== undefined)));
  return h('section', { class: 'recipe-nutrition', 'aria-label': t('Estimated nutrition, {basis}', { basis: label }) },
    h('div', { class: 'nutrition-hero' }, emoji('🔥'), h('strong', {}, kcal, h('small', {}, 'kcal'))),
    h('dl', { class: 'nutrition-grid' }, ...nutrients.map(([symbol, name, value]) => h('div', { class: 'nutrition-stat' },
      h('dt', {}, emoji(symbol), name), h('dd', {}, share(value), h('small', {}, 'g'))))),
    h('p', { class: 'nutrition-note' }, h('span', {}, t('AI estimate')), h('span', { class: 'nutrition-per', title: note }, label)));
}

/**
 * The recipe sheet's three pages: overview, ingredients and method.
 * `openTips` shows the recipe's tips; the method page offers it when there are any.
 * `setInStock(pantryId, inStock)` marks a pantry item used up or back in stock (resolves truthy on success);
 * ingredients linked to the pantry offer it, since cooking this could use the last of something.
 */
export function recipePages(recipe, { title, openTips, setInStock }) {
  const stocked = recipe.ingredients.map((i) => i.inStock);
  const missingCount = () => stocked.filter((inStock) => !inStock).length;
  const missingChip = h('span', { class: 'chip' });
  const ingredientCount = h('span', { class: 'muted' });
  const painters = [];
  const linkedAny = !!setInStock && recipe.ingredients.some((i) => i.pantryId !== undefined);
  const stockTip = linkedAny && !load(STOCK_TIP_LEARNED, false)
    ? h('div', { class: 'recipe-stock-tip' }, emoji('👆', 'tip-finger'),
      h('p', {}, t('Using up the last of something? Tap its '), h('b', {}, t('In pantry')), t(' badge to mark it out of stock.')),
      h('button', { type: 'button', onclick: () => learnStockTip() }, t('Got it')))
    : '';
  function learnStockTip() {
    if (!stockTip || !stockTip.isConnected) return;
    save(STOCK_TIP_LEARNED, true);
    if (calmMotion(stockTip)) { stockTip.remove(); return; }
    const { height } = stockTip.getBoundingClientRect();
    stockTip.animate([{ height: `${height}px`, opacity: 1 }, { height: '0px', opacity: 0, marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px', transform: 'scale(.96)' }],
      { duration: 320, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' }).finished.then(() => stockTip.remove(), () => stockTip.remove());
  }
  const rows = recipe.ingredients.map((ingredient, index) => ingredientRow(ingredient, index));
  const paintCounts = () => {
    const missing = missingCount();
    missingChip.className = `chip ${missing ? 'warn' : 'ok'}`;
    missingChip.replaceChildren(icon(missing ? 'pantry' : 'check'), missing ? t('{count} to buy', { count: missing }) : t('All in your pantry'));
    ingredientCount.textContent = missing ? t('{count} of {total} to buy', { count: missing, total: recipe.ingredients.length }) : tn(recipe.ingredients.length, '{count} ingredient', '{count} ingredients');
  };
  paintCounts();
  function ingredientRow(ingredient, index) {
    const row = h('li', {}, emoji(ingredient.emoji || '🫙', 'recipe-food-emoji'), h('span', { class: 'recipe-ingredient-copy' }, h('strong', {}, ingredient.name), h('span', {}, ingredient.amount)));
    const linked = ingredient.pantryId !== undefined && setInStock;
    const badge = linked ? h('button', { type: 'button', onclick: toggle }) : h('span', {});
    row.append(badge);
    const paint = () => {
      const inStock = stocked[index];
      row.className = inStock ? 'available' : 'missing';
      badge.className = `ingredient-availability ${inStock ? 'available' : 'missing'}`;
      badge.replaceChildren(icon(inStock ? 'check' : 'plus'), inStock ? t('In pantry') : t('To buy'));
      if (linked) {
        badge.setAttribute('aria-pressed', String(inStock));
        badge.setAttribute('aria-label', inStock ? t('{name}: in pantry. Mark as used up', { name: ingredient.name }) : t('{name}: to buy. Mark as back in pantry', { name: ingredient.name }));
        badge.title = inStock ? t('Used the last of it? Tap to mark as out of stock') : t('Got it again? Tap to put it back in your pantry');
      }
    };
    async function toggle() {
      const inStock = !stocked[index];
      if (!(await withBusy(badge, '…', () => setInStock(ingredient.pantryId, inStock)))) { paint(); return; }
      // One pantry item can stand behind several of the recipe's ingredients.
      recipe.ingredients.forEach((other, i) => { if (other.pantryId === ingredient.pantryId) { stocked[i] = inStock; painters[i](); } });
      paintCounts();
      pop(badge);
      learnStockTip();
    }
    paint();
    painters[index] = paint;
    return row;
  }
  // Yield gets the title's width; long descriptions must not stretch a narrow pill column.
  title.classList.add('with-pills');
  title.append(h('p', { class: 'recipe-yield' }, recipe.makes));
  title.append(h('div', { class: 'chips recipe-title-pills' },
    h('span', { class: 'chip' }, emoji('🍽️'), kindLabel(recipe.kind)),
    h('span', { class: 'chip' }, icon('clock'), t('{count} min', { count: recipe.totalMinutes })),
    missingChip,
    ...appliancePills(recipe.equipment)));
  const summaryText = h('p', { class: 'recipe-summary-text' }, recipe.summary);
  const summaryMore = h('button', { type: 'button', class: 'recipe-summary-more', onclick: () => {
    const note = openDialog('recipe-note', h('h3', {}, recipe.title), h('p', {}, recipe.summary), h('button', { class: 'primary', onclick: () => note.close() }, t('Back to recipe')));
  } }, t('Read full note'), icon('chevron'));
  const summary = h('div', { class: 'recipe-summary' }, summaryText, summaryMore);
  // The complete note is always accessible, including when text size changes its wrapping.
  const overview = h('section', { class: 'recipe-page recipe-overview', 'aria-label': t('Overview') },
    title,
    summary,
    nutritionBanner(recipe));
  const ingredients = h('section', { class: 'recipe-page recipe-ingredients', 'aria-label': t('Ingredients') },
    h('div', { class: 'recipe-section-title' }, h('h5', {}, emoji('🧺'), t('Ingredients')), ingredientCount),
    stockTip,
    h('ul', { class: 'recipe-ingredient-list' }, ...rows));
  if (stockTip) nudgeWhenSeen(ingredients, () => recipe.ingredients.findIndex((i, index) => i.pantryId !== undefined && stocked[index]), rows);
  const method = h('section', { class: 'recipe-page recipe-method', 'aria-label': t('Method') },
    h('div', { class: 'recipe-section-title' }, h('h5', {}, emoji('🥄'), t('Method')),
      recipe.tips.length ? h('button', { type: 'button', class: 'tips-button', onclick: openTips }, emoji('💡'), t('Tips {count}', { count: recipe.tips.length })) : ''),
    h('ol', { class: 'recipe-step-list' }, ...recipe.steps.map((step, index) => h('li', {}, h('span', { class: 'step-number', 'aria-hidden': 'true' }, String(index + 1).padStart(2, '0')), h('p', {}, ...instructionText(step))))));
  return [overview, ingredients, method];
}

/** One compact tool pill opens the complete list, including on touch screens. */
function appliancePills(equipment) {
  if (!equipment.length) return [];
  return [h('button', { type: 'button', class: 'chip recipe-tools', title: equipment.join(', '), 'aria-label': t('Equipment: {list}', { list: equipment.join(', ') }), onclick: () => {
    const tools = openDialog('recipe-tools-note', h('h3', {}, t('What you’ll use')), h('ul', { class: 'recipe-tip-list' }, ...equipment.map(name => h('li', {}, name))), h('button', { class: 'primary', onclick: () => tools.close() }, t('Back to recipe')));
  } }, icon('appliance'), h('span', { class: 'recipe-tool-name' }, equipment[0]), equipment.length > 1 ? h('b', { class: 'chip-more' }, `+${equipment.length - 1}`) : '')];
}

export function recipeTips(recipe) {
  return h('ul', { class: 'recipe-tip-list' }, ...recipe.tips.map((tip) => h('li', {}, tip)));
}

/** A little bounce so the badge visibly answers the tap. */
function pop(badge) {
  badge.classList.remove('stock-flip');
  void badge.offsetWidth; // restart the animation on quick repeat taps
  badge.classList.add('stock-flip');
  badge.addEventListener('animationend', () => badge.classList.remove('stock-flip'), { once: true });
}

/**
 * The first few times the ingredients page comes into view, a finger demonstrates tapping
 * an "In pantry" badge, so the badges read as buttons rather than labels.
 */
function nudgeWhenSeen(page, pickIndex, rows) {
  const shown = load(STOCK_NUDGES, 0);
  if (shown >= MAX_STOCK_NUDGES || !('IntersectionObserver' in window) || calmMotion(page)) return;
  const observer = new IntersectionObserver(([entry]) => {
    if (entry.intersectionRatio < 0.6) return;
    observer.disconnect();
    const badge = rows[pickIndex()]?.querySelector('button.ingredient-availability');
    if (!badge) return;
    save(STOCK_NUDGES, shown + 1);
    const finger = h('span', { class: 'tap-finger', 'aria-hidden': 'true' }, '👆');
    const done = () => { badge.classList.remove('stock-nudge'); finger.remove(); };
    badge.append(finger);
    badge.classList.add('stock-nudge');
    finger.addEventListener('animationend', done, { once: true });
    badge.addEventListener('pointerdown', done, { once: true });
  }, { threshold: 0.6 });
  observer.observe(page);
}
