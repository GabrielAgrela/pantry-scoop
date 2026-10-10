import { api, PANTRY_CHANGED_EVENT } from '../api.js';
import { h, showError, toast, withBusy } from '../dom.js';
import { nameKey, shoppingList, toBuy } from '../shopping-list.js';
import { emoji, emptyState, icon } from '../ui.js';
import { readable, t, tn } from '../i18n.js';

/**
 * What to buy: what the cook added by hand, pantry items marked as run out, and ingredients saved
 * recipes need that the pantry doesn't have yet. Ticking an item off puts it in the pantry; the
 * cross takes it off the list (a hidden item comes back when something new asks for it).
 */
export function createShoppingView(root) {
  let list = { mine: [], restock: [], forRecipes: [], hidden: [] };
  let loading, reload = false, queued;
  const stats = h('p', { class: 'pantry-stats' });
  const body = h('div', { class: 'shopping-list' });
  const input = h('input', { type: 'text', maxlength: 80, placeholder: t('Add something to buy'), 'aria-label': t('Add something to buy'), enterkeyhint: 'done', autocomplete: 'off' });
  const addButton = h('button', { type: 'submit', class: 'icon', 'aria-label': t('Add to the list') }, icon('plus'));
  const form = h('form', { class: 'shopping-add search-bar', onsubmit: (event) => { event.preventDefault(); add(); } }, input, addButton);
  const hiddenNote = h('p', { class: 'shopping-hidden muted', hidden: true });
  root.append(
    h('div', { class: 'view-heading' }, h('div', {}, h('h1', {}, t('Shopping list'), ' ', emoji('🛒', 'heading-emoji')), stats)),
    form, body, hiddenNote);

  function render() {
    const count = toBuy(list).length;
    stats.textContent = count ? tn(count, '{count} thing to buy', '{count} things to buy') : '';
    hiddenNote.hidden = !list.hidden.length;
    hiddenNote.replaceChildren(tn(list.hidden.length, '{count} item you don’t need is hidden.', '{count} items you don’t need are hidden.'), ' ',
      h('button', { type: 'button', class: 'text-button', onclick: (event) => showHidden(event.currentTarget) }, t('Show them again')));
    if (!count) {
      body.replaceChildren(emptyState('🛒', t('Nothing to buy'),
        t('Items you mark as run out in your pantry, and ingredients your saved recipes and latest ideas still need, show up here. You can add your own too.')));
      return;
    }
    body.replaceChildren(
      section(t('Added by you'), '', list.mine),
      section(t('To restock'), t('Ran out in your pantry'), list.restock),
      section(t('For your recipes'), t('Not in your pantry yet. 💡 marks your latest ideas.'), list.forRecipes));
  }

  function section(title, hint, items) {
    if (!items.length) return '';
    return h('section', { class: 'shopping-section', 'aria-label': title },
      h('h2', {}, title, h('span', { class: 'shelf-count' }, items.length)),
      hint ? h('p', { class: 'muted' }, hint) : '',
      h('div', { class: 'items' }, ...items.map(row)));
  }

  function row(item) {
    const needText = (need) => (need.amount ? `${need.title} (${need.amount})` : need.title);
    const needs = item.recipes.map(needText).join(' · ');
    // 💡 marks a recipe idea, as opposed to a saved recipe.
    const needNodes = item.recipes.flatMap((need, index) => [index ? ' · ' : '', need.idea ? emoji('💡', 'need-idea') : '', needText(need)]);
    const tick = h('button', { class: 'stock-toggle', 'aria-pressed': 'false', 'aria-label': t('Got {name}. Put it in my pantry', { name: item.name }), title: t('Got it — put it in my pantry'), onclick: () => bought(item, tick) },
      h('span', { class: 'stock-mark' }));
    const onlyMine = item.pantryId === undefined && !item.recipes.length;
    const drop = h('button', { class: 'icon shopping-drop', 'aria-label': onlyMine ? t('Remove {name}', { name: item.name }) : t('Don’t need {name}', { name: item.name }),
      title: onlyMine ? t('Remove from the list') : t('Don’t need it'), onclick: () => notNeeded(item, drop) }, icon('close'));
    return h('div', { class: 'item shopping-item', dataset: { key: item.key } }, tick,
      h('div', { class: 'item-edit' }, emoji(item.emoji || '🛒', 'ingredient-emoji'),
        h('span', { class: 'item-copy' }, h('strong', {}, item.name), needs ? h('small', { title: needs }, t('For'), ' ', ...needNodes) : '')),
      drop);
  }

  /** Plays the row's goodbye before the list is rebuilt without it. */
  async function leave(button) {
    const node = button.closest('.shopping-item');
    if (!node || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    node.classList.add('bought');
    await new Promise((resolve) => setTimeout(resolve, 380));
  }

  async function bought(item, tick) {
    tick.setAttribute('aria-pressed', 'true');
    tick.firstElementChild.replaceChildren(icon('check'));
    // A new item lands on the Other shelf; the pantry's sort button finds it a home later.
    const done = await withBusy(tick, '…', () => (item.itemId !== undefined ? api.boughtShoppingItem(item.itemId)
      : item.pantryId === undefined ? api.addIngredient({ name: item.name })
        : api.updateIngredient(item.pantryId, { inStock: true })));
    if (!done) { tick.setAttribute('aria-pressed', 'false'); tick.firstElementChild.replaceChildren(); return; }
    await leave(tick);
    toast(t('{name} is in your pantry', { name: item.name }));
    // The pantry change event refreshes the list.
  }

  async function notNeeded(item, button) {
    const hiding = item.pantryId !== undefined || item.recipes.length > 0;
    const hidden = await withBusy(button, '…', async () => {
      if (item.itemId !== undefined) await api.removeShoppingItem(item.itemId);
      return hiding ? (await api.hideShoppingItem(item.key, item.recipes.map((need) => need.id))).hidden : true;
    });
    if (!hidden) return;
    await leave(button);
    await show();
    toast(hiding ? t('{name} won’t be on the list until something new needs it', { name: item.name }) : t('{name} removed', { name: item.name }), {
      action: { label: t('Undo'), onclick: () => undo(item, hidden) },
    });
  }

  async function undo(item, hidden) {
    try {
      // Already shown again ("Show them again") is fine.
      if (hidden !== true) await api.unhideShoppingItem(hidden.id).catch((error) => { if (error.status !== 404) throw error; });
      if (item.itemId !== undefined) await api.addShoppingItem(item.name);
    } catch (error) { showError(error); }
    await show();
  }

  async function add() {
    const name = input.value.replace(/\s+/g, ' ').trim();
    if (!name) return;
    if (toBuy(list).some((entry) => nameKey(entry.name) === nameKey(name))) {
      toast(t('"{name}" is already in your list.', { name }));
      return;
    }
    if (!await withBusy(addButton, '…', () => api.addShoppingItem(name))) return;
    input.value = '';
    await show();
    input.focus();
  }

  async function showHidden(button) {
    if (await withBusy(button, '…', () => api.unhideAllShopping().then(() => true))) await show();
  }


  async function load() {
    const [{ ingredients }, { recipes }, { items, hidden }, { batches }] = await Promise.all([api.listIngredients(), api.listSavedRecipes(), api.getShopping(), api.recipeHistory()]);
    list = shoppingList({ pantry: ingredients, saved: recipes, ideas: batches[0], items, hidden }, (recipe) => readable(recipe));
    render();
  }

  /** One load at a time; a refresh asked for meanwhile runs once more afterwards, so it sees the latest change. */
  function show() {
    if (loading) { reload = true; return loading.then(() => queued); }
    loading = load().catch(showError).finally(() => {
      loading = undefined;
      if (reload) { reload = false; queued = show(); }
    });
    return loading;
  }

  window.addEventListener(PANTRY_CHANGED_EVENT, () => { if (root.isConnected) show(); });
  return { show };
}
