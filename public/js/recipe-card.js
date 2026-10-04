import { calmMotion, h, toast, withBusy } from './dom.js';
import { load, save } from './store.js';
import { emoji, icon, scoopSays } from './ui.js';

/** Set once the cook has marked something used up from a recipe (or waved the tip away). */
const STOCK_TIP_LEARNED = 'recipes.stockTipLearned';
/** How many sheets have shown the tap demo; it stops after a few even if never tried. */
const STOCK_NUDGES = 'recipes.stockNudges';
const MAX_STOCK_NUDGES = 4;

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

const SERVING_YIELD = /(\d+)\s*(servings?|portions?|people|persons?)\b/i;
const COUNTED_YIELD = /(?:^|\()\s*~?(\d+)\s+(?!ml\b|l\b|g\b|kg\b|cl\b|oz\b)([a-z]+)/i;

/** The estimate covers the whole recipe. Newer recipes say how many portions it makes; older ones only say it in "makes". */
function portion(recipe) {
  const serving = SERVING_YIELD.exec(recipe.makes);
  const counted = serving ?? COUNTED_YIELD.exec(recipe.makes);
  const count = recipe.estimate.portions > 0 ? recipe.estimate.portions : counted ? Number(counted[1]) : 0;
  if (!count) return { count: 1, label: 'whole recipe', note: 'For the whole recipe' };
  return { count, label: 'per portion', note: `Whole recipe ÷ ${counted && Number(counted[1]) === count ? `${count} ${counted[2]}` : count}` };
}

const grams = (value) => (value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10));
const NUTRIENTS = [
  ['💪', 'Protein', (e) => e.proteinGrams],
  ['🍞', 'Carbs', (e) => e.carbsGrams],
  ['🍬', 'Sugar', (e) => [e.sugarGramsMin, e.sugarGramsMax]],
  ['🧈', 'Fat', (e) => e.fatGrams],
  ['🌾', 'Fibre', (e) => e.fibreGrams],
  ['🧂', 'Salt', (e) => e.saltGrams],
];

function nutritionBanner(recipe) {
  const { count, label, note } = portion(recipe);
  const share = (value) => (Array.isArray(value) ? range(grams(value[0] / count), grams(value[1] / count)) : grams(value / count));
  const kcal = range(Math.round(recipe.estimate.kcalMin / count), Math.round(recipe.estimate.kcalMax / count));
  const nutrients = NUTRIENTS.map(([symbol, name, pick]) => [symbol, name, pick(recipe.estimate)]).filter(([, , value]) => value !== undefined && (!Array.isArray(value) || value.every((v) => v !== undefined)));
  return h('section', { class: 'recipe-nutrition', 'aria-label': `Estimated nutrition, ${label}` },
    h('div', { class: 'nutrition-hero' }, emoji('🔥'), h('strong', {}, kcal, h('small', {}, 'kcal'))),
    h('dl', { class: 'nutrition-grid' }, ...nutrients.map(([symbol, name, value]) => h('div', { class: 'nutrition-stat' },
      h('dt', {}, emoji(symbol), name), h('dd', {}, share(value), h('small', {}, 'g'))))),
    h('p', { class: 'nutrition-note' }, h('span', {}, 'AI estimate'), h('span', { class: 'nutrition-per', title: note }, label)));
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
      h('p', {}, 'Using up the last of something? Tap its ', h('b', {}, 'In pantry'), ' badge to mark it out of stock.'),
      h('button', { type: 'button', onclick: () => learnStockTip() }, 'Got it'))
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
    missingChip.replaceChildren(icon(missing ? 'pantry' : 'check'), missing ? `${missing} to buy` : 'All in your pantry');
    ingredientCount.textContent = missing ? `${missing} of ${recipe.ingredients.length} to buy` : `${recipe.ingredients.length} ingredients`;
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
      badge.replaceChildren(icon(inStock ? 'check' : 'plus'), inStock ? 'In pantry' : 'To buy');
      if (linked) {
        badge.setAttribute('aria-pressed', String(inStock));
        badge.setAttribute('aria-label', `${ingredient.name}: ${inStock ? 'in pantry. Mark as used up' : 'to buy. Mark as back in pantry'}`);
        badge.title = inStock ? 'Used the last of it? Tap to mark as out of stock' : 'Got it again? Tap to put it back in your pantry';
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
      toast(inStock ? `${ingredient.name} is back in your pantry` : `${ingredient.name} marked as out of stock`);
    }
    paint();
    painters[index] = paint;
    return row;
  }
  // The pills sit in a single column beside the title, so the overview keeps its room for the summary and nutrition.
  title.classList.add('with-pills');
  title.append(h('div', { class: 'chips recipe-title-pills' },
    h('span', { class: 'chip' }, emoji('🍽️'), kindLabel(recipe.kind)),
    h('span', { class: 'chip' }, icon('people'), recipe.makes),
    h('span', { class: 'chip' }, icon('clock'), `${recipe.totalMinutes} min`),
    missingChip,
    ...appliancePills(recipe.equipment)));
  const overview = h('section', { class: 'recipe-page recipe-overview', 'aria-label': 'Overview' },
    title,
    scoopSays(recipe.summary, 'recipe-summary'),
    nutritionBanner(recipe));
  const ingredients = h('section', { class: 'recipe-page recipe-ingredients', 'aria-label': 'Ingredients' },
    h('div', { class: 'recipe-section-title' }, h('h5', {}, emoji('🧺'), 'Ingredients'), ingredientCount),
    stockTip,
    h('ul', { class: 'recipe-ingredient-list' }, ...rows));
  if (stockTip) nudgeWhenSeen(ingredients, () => recipe.ingredients.findIndex((i, index) => i.pantryId !== undefined && stocked[index]), rows);
  const method = h('section', { class: 'recipe-page recipe-method', 'aria-label': 'Method' },
    h('div', { class: 'recipe-section-title' }, h('h5', {}, emoji('🥄'), 'Method'),
      recipe.tips.length ? h('button', { type: 'button', class: 'tips-button', onclick: openTips }, emoji('💡'), `Tips ${recipe.tips.length}`) : ''),
    h('ol', { class: 'recipe-step-list' }, ...recipe.steps.map((step, index) => h('li', {}, h('span', { class: 'step-number', 'aria-hidden': 'true' }, String(index + 1).padStart(2, '0')), h('p', {}, step)))));
  return [overview, ingredients, method];
}

/** Two appliance pills at most; the second one counts the rest, which its tooltip names. */
function appliancePills(equipment) {
  const [first, second, ...rest] = equipment;
  const pills = [first, second].filter(Boolean).map((name) => h('span', { class: 'chip' }, icon('appliance'), name));
  if (rest.length) {
    const more = h('b', { class: 'chip-more', 'aria-hidden': 'true' }, `+${rest.length}`);
    pills[1].append(more);
    pills[1].title = `Also uses: ${rest.join(', ')}`;
    pills[1].setAttribute('aria-label', `${second}, plus ${rest.join(', ')}`);
  }
  return pills;
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
