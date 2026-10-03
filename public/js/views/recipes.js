import { api, PANTRY_CHANGED_EVENT } from '../api.js';
import { h, openDialog, MANAGE_USAGE_URL, showError, toast, withBusy } from '../dom.js';
import { latestJob, watchJob } from '../jobs.js';
import { ANY_DISH, createDishPicker } from '../dish-picker.js';
import { kindLabel, recipeBody } from '../recipe-card.js';
import { recipePhoto } from '../recipe-photo.js';
import { load, save } from '../store.js';
import { field, icon } from '../ui.js';

const DEFAULTS = { kind: 'Dinner', servings: '', craving: '', count: '3', maxMissing: '0', difficulty: 'any', machines: [], avoid: [] };
const DIFFICULTY_LABELS = { any: 'Any', easy: 'Easy', medium: 'Medium', hard: 'Hard' };
// Each tap moves an appliance chip one step: no preference → use → don't use → no preference.
const NEXT_MODE = { off: 'use', use: 'avoid', avoid: 'off' };
export function createRecipesView(root) {
  const state = { ...DEFAULTS, ...load('recipes.form', {}) };
  if (state.kind !== ANY_DISH) state.kind = kindLabel(state.kind); // older choices were fixed ids such as "main"
  let dishTypes = [], savedRecipes = [], suggestions = [], collection = 'ideas', stopWatching = () => {};
  let activeJobId = 0, runningJobId, suggestionsJobId;
  const progress = h('div', { id: 'recipe-progress', class: 'job-progress', role: 'status', 'aria-live': 'polite', hidden: true },
    h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('span', {}, 'Finding recipe ideas…'), h('a', { href: '#recipes' }, 'View'));
  document.body.append(progress);
  const bind = (el, key) => { el.value = state[key]; el.addEventListener('input', () => { state[key] = el.value; save('recipes.form', state); updateOptionSummary(); }); return el; };
  const dishPicker = createDishPicker({
    getValue: () => state.kind, onChange: (value) => { state.kind = value; save('recipes.form', state); },
    getDishTypes: () => dishTypes, setDishTypes: (next) => { dishTypes = next; },
  });
  const servings = bind(h('input', { type: 'number', min: 1, max: 20, inputmode: 'numeric', placeholder: '2', 'aria-label': 'Servings' }), 'servings');
  const craving = bind(h('input', { placeholder: 'What are you craving?', 'aria-label': 'Craving' }), 'craving');
  const count = bind(h('select', { 'aria-label': 'How many recipes' }, ...[1, 2, 3, 4, 5].map((n) => h('option', { value: n }, `${n} idea${n === 1 ? '' : 's'}`))), 'count');
  const maxMissing = bind(h('select', { 'aria-label': 'Ingredients to buy' }, h('option', { value: 0 }, 'Pantry only'), ...[1, 2, 3].map((n) => h('option', { value: n }, `Buy up to ${n}`))), 'maxMissing');
  const machines = h('div', { class: 'chips machine-picker', role: 'group', 'aria-labelledby': 'appliance-label', 'aria-describedby': 'appliance-hint' });
  const difficulty = h('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': 'difficulty-label' },
    ...Object.entries(DIFFICULTY_LABELS).map(([value, label]) => h('label', {}, h('input', { type: 'radio', name: 'difficulty', value, checked: state.difficulty === value, onchange: () => { state.difficulty = value; save('recipes.form', state); updateOptionSummary(); } }), h('span', {}, label))));
  const suggestButton = h('button', { type: 'submit', class: 'primary' }, icon('spark'), 'Find recipe ideas');
  const results = h('div', { class: 'recipe-results', 'aria-live': 'polite' });
  const optionSummary = h('span', { class: 'muted' });
  const collectionHeading = h('h2', {}, 'Ideas for you');
  const collectionButton = h('button', { class: 'saved-link', onclick: () => { collection = collection === 'ideas' ? 'saved' : 'ideas'; renderCards(); } });
  const cards = h('div', { class: 'suggestion-grid' });
  const optionTitle = h('span', { class: 'option-title' }, h('strong', {}, 'More options'), optionSummary);
  root.append(h('div', { class: 'recipe-compose' }, h('div', { class: 'view-heading' }, h('div', {}, h('h1', {}, 'What shall we cook?'), h('p', { class: 'recipe-subtitle' }, 'Made for your pantry.'))),
    h('form', { class: 'recipe-generator stack', onsubmit: suggest },
      h('div', { class: 'craving-input' }, icon('search'), craving, h('small', {}, 'Quick pasta, something spicy…')),
      h('div', { class: 'recipe-basic-fields' }, field('Dish', h('div', { class: 'input-icon' }, icon('recipes'), dishPicker.element)), field('Servings', h('div', { class: 'input-icon' }, icon('people'), servings))),
      h('details', { class: 'form-options recipe-options' }, h('summary', {}, icon('settings'), optionTitle, icon('chevron')),
        h('div', { class: 'grid-2' }, field('Number of ideas', count), field('Ingredients to buy', maxMissing)),
        h('div', { class: 'equipment-field' }, h('span', { class: 'field-label', id: 'difficulty-label' }, 'Difficulty'), difficulty),
        h('div', { class: 'equipment-field' }, h('span', { class: 'field-label', id: 'appliance-label' }, 'Appliances'), h('small', { class: 'field-hint', id: 'appliance-hint' }, 'Tap once to use, twice to leave out.'), machines)), suggestButton)),
    h('div', { class: 'recipe-browse' }, results,
      h('div', { class: 'section-heading recipe-collection-heading' }, collectionHeading, collectionButton), cards));
  updateOptionSummary();
  function updateOptionSummary() {
    optionSummary.textContent = [state.maxMissing === '0' ? 'Pantry only' : `Up to ${state.maxMissing} to buy`, `${state.count} idea${state.count === '1' ? '' : 's'}`,
      state.difficulty !== 'any' && DIFFICULTY_LABELS[state.difficulty], state.machines.length && `${state.machines.length} to use`, state.avoid.length && `${state.avoid.length} left out`].filter(Boolean).join(' · ');
  }
  async function suggest(event) {
    event.preventDefault();
    progress.hidden = false;
    const job = await withBusy(suggestButton, 'Starting…', () => api.suggestRecipes({ kind: state.kind, craving: state.craving, count: Number(state.count), maxMissing: Number(state.maxMissing), servings: state.servings === '' ? undefined : Number(state.servings), difficulty: state.difficulty, appliances: state.machines, avoidAppliances: state.avoid }));
    if (job) { collection = 'ideas'; follow(job.job); }
    else progress.hidden = true;
  }
  function follow(job) { if (job.id < activeJobId) return; activeJobId = job.id; stopWatching(); stopWatching = watchJob(job, renderJob); }
  function renderJob(job) {
    if (job.id < activeJobId) return;
    suggestButton.disabled = job.status === 'running';
    progress.hidden = job.status !== 'running';
    if (job.status === 'running') { runningJobId = job.id; results.replaceChildren(); }
    else {
      const justFinished = runningJobId === job.id;
      runningJobId = undefined;
      if (job.status === 'failed') {
        results.replaceChildren(h('div', { class: 'card stack' }, h('span', { class: 'problem' }, job.error.message), job.error.code === 'usage-limit' ? h('a', { class: 'button primary', href: MANAGE_USAGE_URL, target: '_blank', rel: 'noopener' }, 'Manage usage') : ''));
        if (justFinished) showError(job.error);
      } else {
        results.replaceChildren(); suggestions = job.result.recipes; suggestionsJobId = job.id; renderCards();
        if (justFinished) toast('Your recipe ideas are ready');
      }
    }
  }
  function renderCards() {
    collectionHeading.textContent = collection === 'ideas' ? 'Ideas for you' : 'Saved recipes';
    collectionButton.replaceChildren(collection === 'ideas' ? `Saved ${savedRecipes.length}` : 'Ideas', icon('arrow'));
    const entries = collection === 'ideas' ? suggestions.map((recipe) => ({ recipe })) : savedRecipes;
    cards.replaceChildren(...(entries.length ? entries.map(({ recipe, id }) => recipeCard(recipe, id)) : [h('p', { class: 'saved-empty muted' }, collection === 'saved' ? 'Save an idea to keep it here.' : 'Find recipe ideas using what’s in your pantry.')]));
  }
  function savedMatch(recipe) { return savedRecipes.find((entry) => entry.recipe.title === recipe.title); }
  function recipeCard(recipe, id) {
    const missing = recipe.ingredients.filter((ingredient) => !ingredient.inStock).length;
    const photo = recipePhoto(recipe);
    const bookmark = h('button', { class: 'icon recipe-bookmark', 'aria-label': savedMatch(recipe) ? `Unsave ${recipe.title}` : `Save ${recipe.title}`, 'aria-pressed': String(!!savedMatch(recipe)), onclick: async () => {
      await withBusy(bookmark, '…', () => toggleSaved(recipe)); renderCards();
    } }, icon('bookmark'));
    return h('article', { class: `recipe-card${id ? ' saved-recipe' : ''}` },
      h('button', { class: 'recipe-open', 'aria-label': `Open ${recipe.title}`, onclick: () => openRecipe(recipe) },
        photo ? h('img', { class: 'recipe-photo', src: photo, alt: '', loading: 'lazy' }) : h('span', { class: 'recipe-art', 'aria-hidden': 'true' }, icon('bowl')),
        h('span', { class: 'recipe-card-copy' }, h('strong', {}, recipe.title), h('span', { class: 'recipe-meta' }, icon('clock'), `${recipe.totalMinutes} min · ${recipe.makes}`), h('span', { class: `chip ${missing ? 'warn' : 'ok'}` }, missing ? `${missing} to buy` : 'Uses your pantry'))), bookmark);
  }
  async function toggleSaved(recipe) {
    const existing = savedMatch(recipe);
    if (existing) await api.deleteSavedRecipe(existing.id);
    else await api.saveRecipe(recipe);
    await loadSaved();
    return true;
  }
  function openRecipe(recipe) {
    const saveButton = h('button', { class: 'primary', onclick: async () => { if (await withBusy(saveButton, 'Saving…', () => toggleSaved(recipe))) updateSaveButton(); } });
    const updateSaveButton = () => saveButton.replaceChildren(icon(savedMatch(recipe) ? 'check' : 'bookmark'), savedMatch(recipe) ? 'Remove from saved' : 'Save recipe');
    updateSaveButton();
    const { close } = openDialog('recipe-detail', h('div', { class: 'row' }, h('h3', {}, recipe.title), h('button', { class: 'icon push-right', 'aria-label': 'Close recipe', onclick: () => close() }, icon('close'))), ...recipeBody(recipe), saveButton);
  }
  async function loadSaved() { const { recipes } = await api.listSavedRecipes(); savedRecipes = recipes; renderCards(); }
  async function loadKitchen() {
    const { profile } = await api.getProfile(); servings.placeholder = String(profile.servings);
    dishTypes = profile.dishTypes;
    if (state.kind !== ANY_DISH && !dishTypes.some((dish) => dish.name === state.kind)) state.kind = ANY_DISH;
    dishPicker.refresh();
    const names = profile.appliances.map((appliance) => appliance.name);
    state.machines = state.machines.filter((name) => names.includes(name)); state.avoid = state.avoid.filter((name) => names.includes(name) && !state.machines.includes(name));
    save('recipes.form', state); updateOptionSummary();
    machines.replaceChildren(names.length ? '' : h('p', { class: 'muted' }, 'No appliances added. ', h('a', { href: '#profile' }, 'Set up your kitchen')), ...names.map(applianceChip));
  }
  function applianceChip(name) {
    const mode = () => state.machines.includes(name) ? 'use' : state.avoid.includes(name) ? 'avoid' : 'off';
    const mark = h('span', { class: 'chip-mark', 'aria-hidden': 'true' });
    const stateText = h('span', { class: 'visually-hidden' });
    const chip = h('button', { type: 'button', class: 'chip toggle appliance-choice', onclick: () => {
      const next = NEXT_MODE[mode()];
      state.machines = state.machines.filter((value) => value !== name); state.avoid = state.avoid.filter((value) => value !== name);
      if (next === 'use') state.machines.push(name); else if (next === 'avoid') state.avoid.push(name);
      save('recipes.form', state); updateOptionSummary(); paint();
    } }, mark, h('span', { class: 'chip-name' }, name), stateText);
    function paint() {
      const current = mode();
      chip.dataset.mode = current;
      mark.replaceChildren(current === 'off' ? '' : icon(current === 'use' ? 'check' : 'close'));
      stateText.textContent = current === 'use' ? ': use' : current === 'avoid' ? ': leave out' : ': no preference';
    }
    paint();
    return chip;
  }
  async function resume() { try { const job = await latestJob('recipes'); if (job) follow(job); } catch (error) { showError(error); } }
  async function refreshSuggestions() {
    const id = suggestionsJobId;
    if (!id) return;
    const { job } = await api.getJob(id);
    if (suggestionsJobId !== id) return;
    suggestions = job.result.recipes; renderCards();
  }
  async function show() {
    try { await Promise.all([loadKitchen(), loadSaved()]); await resume(); } catch (error) { showError(error); }
  }
  function stop() { stopWatching(); progress.hidden = true; runningJobId = undefined; }
  window.addEventListener(PANTRY_CHANGED_EVENT, () => { Promise.all([loadSaved(), refreshSuggestions()]).then(resume).catch(showError); });
  return { show, resume, stop };
}
