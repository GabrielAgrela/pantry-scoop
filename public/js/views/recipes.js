import { api, PANTRY_CHANGED_EVENT } from '../api.js';
import { feel } from '../blob-buddy.js';
import { calmMotion, h, openDialog, MANAGE_USAGE_URL, showError, toast, withBusy } from '../dom.js';
import { latestJob, watchJob } from '../jobs.js';
import { ANY_DISH, createDishPicker, dishLabel } from '../dish-picker.js';
import { openCookingScreen, openEarlierIdeas } from '../cooking-screen.js';
import { createNumberWheel } from '../number-wheel.js';
import { createDifficultyPicker } from '../difficulty-picker.js';
import { createCreativityPicker, FLAVOUR_LEVELS, recipeRibbons } from '../recipe-labels.js';
import { smoothDetails } from '../smooth-details.js';
import { composeReveal } from '../compose-reveal.js';
import { kindLabel, recipePages, recipeTips } from '../recipe-card.js';
import { createRecipeCompanion } from '../recipe-chat.js';
import { recipeFeedbackCard } from '../recipe-feedback.js';
import { hideReady, showReady } from '../ready-notice.js';
import { keepScreenAwake } from '../wake-lock.js';
import { load, save } from '../store.js';
import { dishEmoji, emptyState, emoji, field, icon, pantryFriend } from '../ui.js';
import { LANGUAGES, localeTag, readable, t, tn, translateMessage } from '../i18n.js';

// The starter dish type, named as the server saved it in this language.
const DEFAULTS = { kind: t('Dinner'), servings: '', craving: '', count: '3', maxMissing: '0', difficulty: 'any', creativity: 'any', machines: [], avoid: [], useIngredients: [], avoidIngredients: [] };
// The pantry can hold dozens of items, so ingredients are searched rather than all listed.
const INGREDIENT_MATCHES = 12;
const RECIPE_LANGUAGES = new Set(LANGUAGES.map((language) => language.recipe.toLocaleLowerCase()));
const DIFFICULTY_LABELS = { any: t('Any'), easy: t('Easy'), medium: t('Medium'), hard: t('Hard') };
// Each tap moves an appliance chip one step: no preference → use → don't use → no preference.
const NEXT_MODE = { off: 'use', use: 'avoid', avoid: 'off' };
// The craving, appliances and ingredients are picked fresh for each request, so only the other choices are remembered.
const FRESH_EACH_TIME = ['craving', 'machines', 'avoid', 'useIngredients', 'avoidIngredients'];
const lasting = (form) => Object.fromEntries(Object.entries(form).filter(([key]) => !FRESH_EACH_TIME.includes(key)));
const LOADING_MESSAGES = [t('Stirring up inspiration…'), t('A pinch of pantry magic…'), t('Whisking up yummy ideas…'), t('A little sprinkle of yum…'), t('Good things take a stir…')];
export function createRecipesView(root) {
  const state = { ...DEFAULTS, ...lasting(load('recipes.form', {})) };
  if (state.kind !== ANY_DISH) state.kind = kindLabel(state.kind); // older choices were fixed ids such as "main"
  let dishTypes = [], pantry = [], defaultServings = 2, cookingScreen, savedRecipes = [], batches = [], collection = 'saved', stopWatching = () => {};
  let kitchenLanguage = '', translatingNow = false;
  let nextBefore = null, focusJobId, historyLoaded = false, olderExpanded = false;
  let searchQuery = '', searchBatches = [], searchNextBefore = null, searchTimer, searchVersion = 0, searchLoading = false, searchError;
  const newBatches = new Set();
  const seenBatches = new Set(load('recipes.seenBatches', []));
  let activeJobId = 0, runningJobId, requestedJobId, announcedJobId, checkingEarlier = false;
  let loadingTimer, loadingIndex = 0, loadingAnimations = [], cooking = false;
  const loadingMessage = h('span', { class: 'recipe-loading-message', 'aria-hidden': 'true' });
  const cookingMessage = h('p', { class: 'ideas-cooking-message', 'aria-hidden': 'true' });
  // While ideas cook, Scoop takes the latest batch's place so old ideas don't pass for new ones.
  const cookingCard = h('div', { class: 'empty-state ideas-cooking', role: 'status' },
    h('div', { class: 'empty-art', 'aria-hidden': 'true' }, pantryFriend('ideas-cooking-friend'), emoji('🍳', 'empty-companion')),
    h('h3', {}, t('Cooking up ideas')), h('span', { class: 'visually-hidden' }, t('Finding recipe ideas.')), cookingMessage,
    h('span', { class: 'loading-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
  const progress = h('div', { id: 'recipe-progress', class: 'job-progress recipe-progress', role: 'status', 'aria-live': 'polite', hidden: true },
    h('a', { class: 'job-progress-link', href: '#recipes', 'aria-label': t('Open recipe ideas'), onclick: () => switchCollection('ideas') },
    pantryFriend('recipe-loading-friend'),
    h('div', { class: 'recipe-loading-copy' }, h('span', { class: 'visually-hidden' }, t('Finding recipe ideas. You can keep browsing.')), loadingMessage,
      h('span', { class: 'loading-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')))));
  document.body.append(progress);
  // The page switch lands after this listener, so check the pill once it has settled.
  window.addEventListener('hashchange', () => requestAnimationFrame(syncProgress));
  const bind = (el, key) => { el.value = state[key]; el.addEventListener('input', () => { state[key] = el.value; save('recipes.form', lasting(state)); updateOptionSummary(); }); return el; };
  const dishPicker = createDishPicker({
    getValue: () => state.kind, onChange: (value) => { state.kind = value; save('recipes.form', lasting(state)); },
    getDishTypes: () => dishTypes, setDishTypes: (next) => { dishTypes = next; },
  });
  // Until the wheel is turned, servings stays '' and the server falls back to the profile's default.
  const servings = createNumberWheel({ min: 1, max: 20, value: Number(state.servings) || 2, label: t('Servings'), onChange: (value) => { state.servings = String(value); save('recipes.form', lasting(state)); } });
  const craving = bind(h('input', { placeholder: t('What are you craving?'), 'aria-label': t('Craving') }), 'craving');
  const optionWheel = (key, min, max, label) => createNumberWheel({ min, max, value: Number(state[key]), label, onChange: (value) => { state[key] = String(value); save('recipes.form', lasting(state)); updateOptionSummary(); } });
  const count = optionWheel('count', 1, 5, t('Number of ideas'));
  const maxMissing = optionWheel('maxMissing', 0, 3, t('Ingredients to buy'));
  const machines = h('div', { class: 'chips machine-picker', role: 'group', 'aria-labelledby': 'appliance-label', 'aria-describedby': 'appliance-hint' });
  const chosenIngredients = h('div', { class: 'chips machine-picker', role: 'group', 'aria-label': t('Chosen ingredients') });
  const ingredientMatches = h('div', { class: 'chips machine-picker', role: 'group', 'aria-label': t('Matching ingredients') });
  const ingredientSearch = h('input', { type: 'search', placeholder: t('Search your pantry…'), 'aria-label': t('Search your pantry'), 'aria-describedby': 'ingredient-hint', maxLength: 100, oninput: renderIngredientMatches });
  const difficulty = createDifficultyPicker({ value: state.difficulty, onChange: (value) => { state.difficulty = value; save('recipes.form', lasting(state)); updateOptionSummary(); } });
  const creativity = createCreativityPicker({ value: state.creativity, onChange: (value) => { state.creativity = value; save('recipes.form', lasting(state)); updateOptionSummary(); } });
  const suggestButton = h('button', { type: 'submit', class: 'primary recipe-suggest' },
    h('span', { class: 'recipe-suggest-title' }, icon('spark'), t('Find recipe ideas')));
  const results = h('div', { class: 'recipe-results', 'aria-live': 'polite' });
  const optionSummary = h('span', { class: 'muted' });
  const collectionHeading = h('h2', { class: 'visually-hidden' }, t('Saved recipes'));
  const savedTab = h('button', { type: 'button', role: 'tab', id: 'recipes-saved-tab', 'aria-controls': 'recipe-collection', onclick: () => switchCollection('saved') });
  const ideasTab = h('button', { type: 'button', role: 'tab', id: 'recipes-ideas-tab', 'aria-controls': 'recipe-collection', onclick: () => switchCollection('ideas') });
  const collectionTabs = h('div', { class: 'recipe-collection-tabs', role: 'tablist', 'aria-label': t('Recipe collections') }, savedTab, ideasTab);
  collectionTabs.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'saved' : event.key === 'End' ? 'ideas' : collection === 'saved' ? 'ideas' : 'saved';
    switchCollection(next); (next === 'saved' ? savedTab : ideasTab).focus();
  });
  const cards = h('div', { id: 'recipe-collection', class: 'recipe-collections', role: 'tabpanel' });
  const searchInput = h('input', { type: 'search', placeholder: t('Search recipes…'), 'aria-label': t('Search recipes'), maxLength: 200, oninput: () => {
    searchQuery = searchInput.value.trim(); searchChanged();
  } });
  const clearSearch = h('button', { type: 'button', class: 'icon', 'aria-label': t('Clear recipe search'), hidden: true, onclick: () => {
    searchInput.value = ''; searchQuery = ''; searchChanged(); searchInput.focus();
  } }, icon('close'));
  const searchBox = h('div', { class: 'recipe-search' }, icon('search'), searchInput, clearSearch);
  const optionTitle = h('span', { class: 'option-title' }, h('strong', {}, t('More options')), optionSummary);
  const composeToggle = h('button', { type: 'button', class: 'compose-toggle', 'aria-expanded': 'false', 'aria-controls': 'recipe-generator' }, t('What shall we cook?'), emoji('🍝', 'heading-emoji'));
  root.append(h('div', { class: 'recipe-compose is-collapsed' }, h('div', { class: 'view-heading' }, h('div', {}, h('h1', {}, composeToggle), h('p', { class: 'recipe-subtitle' }, t('A little inspiration, straight from your pantry.')))),
    h('div', { class: 'compose-body' }, h('p', { class: 'compose-hint', 'aria-hidden': 'true' }, icon('spark'), t('Tap to start cooking'), icon('chevron')),
    h('form', { id: 'recipe-generator', class: 'recipe-generator stack', onsubmit: suggest },
      h('div', { class: 'craving-input' }, icon('search'), craving, h('small', {}, t('Quick pasta, something spicy…'))),
      h('div', { class: 'recipe-basic-fields' }, field(t('Dish'), h('div', { class: 'input-icon' }, icon('recipes'), dishPicker.element)), field(t('Servings'), h('div', { class: 'input-icon wheel-field' }, icon('people'), servings.element))),
      h('details', { class: 'form-options recipe-options' }, h('summary', {}, icon('settings'), optionTitle, icon('chevron')), h('div', { class: 'options-body' },
        h('div', { class: 'grid-2' }, field(t('Number of ideas'), h('div', { class: 'wheel-field' }, count.element)), field(t('Ingredients to buy'), h('div', { class: 'wheel-field' }, maxMissing.element))),
        h('div', { class: 'equipment-field' }, h('span', { class: 'field-label', id: 'difficulty-label' }, t('Difficulty')), difficulty),
        h('div', { class: 'equipment-field' }, h('span', { class: 'field-label', id: 'creativity-label' }, t('Flavour adventure')), h('small', { class: 'field-hint', id: 'creativity-hint' }, t('How familiar should the flavours be?')), creativity),
        h('div', { class: 'equipment-field' }, h('span', { class: 'field-label', id: 'appliance-label' }, t('Appliances')), h('small', { class: 'field-hint', id: 'appliance-hint' }, t('Tap once to use, twice to leave out.')), machines),
        h('div', { class: 'equipment-field ingredient-field' }, h('span', { class: 'field-label' }, t('Ingredients')), h('small', { class: 'field-hint', id: 'ingredient-hint' }, t('Find something in your pantry. Tap once to use, twice to leave out.')),
          chosenIngredients, h('div', { class: 'recipe-search ingredient-search' }, icon('search'), ingredientSearch), ingredientMatches))), suggestButton))),
    h('div', { class: 'recipe-browse' }, results,
      h('div', { class: 'recipe-collection-heading' }, collectionHeading, collectionTabs), searchBox, cards));
  smoothDetails(root.querySelector('.recipe-options'));
  const composer = composeReveal(root.querySelector('.recipe-compose'), composeToggle);
  updateOptionSummary();
  function updateOptionSummary() {
    optionSummary.textContent = [state.maxMissing === '0' ? t('Pantry only') : t('Up to {count} to buy', { count: state.maxMissing }), tn(Number(state.count), '{count} idea', '{count} ideas'),
      state.difficulty !== 'any' && DIFFICULTY_LABELS[state.difficulty], state.creativity !== 'any' && FLAVOUR_LEVELS.find((level) => level.value === state.creativity)?.label, state.machines.length && t('{count} to use', { count: state.machines.length }), state.avoid.length && t('{count} left out', { count: state.avoid.length }),
      state.useIngredients.length && tn(state.useIngredients.length, '{count} ingredient in', '{count} ingredients in'), state.avoidIngredients.length && tn(state.avoidIngredients.length, '{count} ingredient out', '{count} ingredients out')].filter(Boolean).join(' · ');
  }
  const order = () => ({ kind: state.kind, craving: state.craving, count: Number(state.count), maxMissing: Number(state.maxMissing), servings: state.servings === '' ? undefined : Number(state.servings), difficulty: state.difficulty, creativity: state.creativity, appliances: state.machines, avoidAppliances: state.avoid, useIngredients: state.useIngredients, avoidIngredients: state.avoidIngredients });
  /**
   * Ideas already made for this exact order are offered first, so they can be saved instead of
   * asked for again. Otherwise the order is shown, and only sent once its countdown runs out.
   */
  async function suggest(event) {
    event.preventDefault();
    if (cookingScreen || checkingEarlier) return;
    checkingEarlier = true; suggestButton.setAttribute('aria-busy', 'true');
    // The check only saves a trip; if it fails, the order goes ahead as usual.
    const earlier = await api.earlierIdeas(order()).then(({ recipes }) => recipes, () => []);
    checkingEarlier = false; suggestButton.removeAttribute('aria-busy');
    if (cookingScreen || !onRecipesPage()) return;
    if (earlier.length) showEarlierIdeas(earlier); else showCookingScreen();
  }
  async function startIdeas() {
    collection = 'ideas'; olderExpanded = false;
    setProgress(true);
    const job = await withBusy(suggestButton, t('Starting…'), () => api.suggestRecipes(order()));
    if (job) { composer.close(); requestedJobId = job.job.id; follow(job.job); }
    else setProgress(false);
  }
  /** Repeats the order back while Scoop gets ready; ingredients chosen to use are what he tosses in. */
  function showCookingScreen() {
    const item = (name) => pantry.find((entry) => entry.name === name);
    const chips = (names, out) => h('span', { class: 'cs-chips' }, ...names.map((name) => h('span', { class: `cs-chip${out ? ' is-out' : ''}` }, emoji(item(name)?.emoji ?? '🥄'), name)));
    const flavour = FLAVOUR_LEVELS.find((level) => level.value === state.creativity);
    const lines = [
      { symbol: state.kind === ANY_DISH ? '🍽️' : dishEmoji(state.kind), label: t('Dish'), value: dishLabel(state.kind) },
      state.craving.trim() && { symbol: '💭', label: t('Craving'), value: `“${state.craving.trim()}”` },
      { symbol: '👥', label: t('Servings'), value: String(state.servings || defaultServings) },
      { symbol: '✨', label: t('Ideas'), value: `${state.count} · ${state.maxMissing === '0' ? t('pantry only') : t('up to {count} to buy', { count: state.maxMissing })}` },
      state.useIngredients.length > 0 && { symbol: '🧺', label: t('With'), value: chips(state.useIngredients) },
      state.avoidIngredients.length > 0 && { symbol: '🙅', label: t('Without'), value: chips(state.avoidIngredients, true) },
      state.machines.length > 0 && { symbol: '🫖', label: t('Using'), value: state.machines.join(', ') },
      state.avoid.length > 0 && { symbol: '🚫', label: t('Not using'), value: state.avoid.join(', ') },
      state.difficulty !== 'any' && { symbol: '🧑‍🍳', label: t('Difficulty'), value: DIFFICULTY_LABELS[state.difficulty] },
      state.creativity !== 'any' && flavour && { symbol: '❗'.repeat(FLAVOUR_LEVELS.indexOf(flavour)), label: t('Flavour'), value: flavour.label },
    ].filter(Boolean);
    const chosen = state.useIngredients.map((name) => item(name)?.emoji).filter(Boolean);
    const others = [...new Set(pantry.filter((entry) => !state.avoidIngredients.includes(entry.name)).map((entry) => entry.emoji))].sort(() => Math.random() - .5);
    const toss = [...new Set([...chosen, ...others])].slice(0, 5);
    const screen = openCookingScreen({ lines, toss: toss.length ? toss : ['🍅', '🧀', '🌿'], onGo: startIdeas,
      onClose: () => { if (cookingScreen === screen) cookingScreen = undefined; } });
    cookingScreen = screen;
  }
  /** Scoop shows the earlier ideas for this order, each with its own heart; new ones are a deliberate extra tap. */
  function showEarlierIdeas(recipes) {
    const screen = openEarlierIdeas({ ideas: recipes.map(earlierIdea), peek: recipes.map((recipe) => dishEmoji(`${readable(recipe).title} ${recipe.kind}`)),
      onNew: startIdeas, onClose: () => { if (cookingScreen === screen) cookingScreen = undefined; } });
    cookingScreen = screen;
  }
  function earlierIdea(recipe) {
    const shown = readable(recipe);
    const missing = shown.ingredients.filter((ingredient) => !ingredient.inStock).length;
    const bookmark = h('button', { type: 'button', class: 'icon recipe-bookmark', onclick: async () => {
      if (await withBusy(bookmark, '…', () => toggleSaved(recipe))) paint();
    } }, icon('bookmark'));
    const paint = () => {
      const saved = !!savedMatch(recipe);
      bookmark.setAttribute('aria-pressed', String(saved));
      bookmark.setAttribute('aria-label', saved ? t('Unsave {title}', { title: shown.title }) : t('Save {title}', { title: shown.title }));
      bookmark.replaceChildren(icon('bookmark'));
    };
    paint();
    return h('div', { class: 'earlier-idea' },
      h('button', { type: 'button', class: 'earlier-idea-open', 'aria-label': t('Open {title}', { title: shown.title }), onclick: () => openRecipe(recipe).addEventListener('close', paint) },
        emoji(dishEmoji(`${shown.title} ${recipe.kind}`), 'earlier-idea-art'),
        h('span', { class: 'earlier-idea-copy' }, h('strong', {}, shown.title), h('small', {}, `${t('{count} min', { count: recipe.totalMinutes })} · ${missing ? t('{count} to buy', { count: missing }) : t('uses your pantry')}`))),
      bookmark);
  }
  function setProgress(running) {
    if (running !== cooking) { cooking = running; renderCards(); }
    syncProgress();
    if (!running) {
      clearInterval(loadingTimer); loadingTimer = undefined;
      loadingAnimations.forEach((animation) => animation.cancel());
      return;
    }
    // Job polls and tab changes keep the same cycle going instead of restarting it.
    if (loadingTimer !== undefined) return;
    loadingIndex = 0;
    loadingMessage.textContent = cookingMessage.textContent = LOADING_MESSAGES[0];
    loadingTimer = setInterval(() => {
      loadingIndex = (loadingIndex + 1) % LOADING_MESSAGES.length;
      loadingMessage.textContent = cookingMessage.textContent = LOADING_MESSAGES[loadingIndex];
      loadingAnimations.forEach((animation) => animation.cancel());
      loadingAnimations = [loadingMessage, cookingMessage].filter((message) => message.isConnected && !calmMotion(message)).map((message) => message.animate([
        { opacity: 0, transform: 'translateY(7px)' },
        { opacity: 1, transform: 'translateY(-1px)', offset: .8 },
        { opacity: 1, transform: 'none' },
      ], { duration: 450, easing: 'cubic-bezier(.2, .8, .3, 1)' }));
    }, 4200);
  }
  const ideasInView = () => onRecipesPage() && collection === 'ideas' && !searchQuery;
  /**
   * The floating pill and ready notice are for elsewhere in the app; on the Ideas tab Scoop is
   * already cooking or showing the batch in place, and a new cook makes the old notice stale.
   */
  function syncProgress() {
    progress.hidden = !cooking || ideasInView();
    if (announcedJobId !== undefined && (cooking || ideasInView())) {
      if (!cooking) markSeen(announcedJobId);
      announcedJobId = undefined; hideReady('recipes');
    }
  }
  function follow(job) { if (job.id < activeJobId) return; activeJobId = job.id; stopWatching(); stopWatching = watchJob(job, renderJob); }
  function renderJob(job) {
    if (job.id < activeJobId) return;
    suggestButton.disabled = job.status === 'running';
    setProgress(job.status === 'running');
    if (job.status === 'running') { runningJobId = job.id; results.replaceChildren(); }
    else {
      // A fast job can already be complete in the submit response, before the first poll.
      const justFinished = runningJobId === job.id || requestedJobId === job.id;
      runningJobId = undefined;
      if (requestedJobId === job.id) requestedJobId = undefined;
      if (job.status === 'failed') {
        results.replaceChildren(h('div', { class: 'card stack' }, h('span', { class: 'problem' }, translateMessage(job.error.message)), job.error.code === 'usage-limit' ? h('a', { class: 'button primary', href: MANAGE_USAGE_URL, target: '_blank', rel: 'noopener' }, t('Manage usage')) : ''));
        if (justFinished) showError(job.error);
      } else {
        if (justFinished) { composer.close(); collection = 'ideas'; olderExpanded = false; }
        results.replaceChildren();
        upsertBatch({ id: job.id, createdAt: job.createdAt, finishedAt: job.finishedAt, recipes: job.result.recipes });
        if (justFinished || !seenBatches.has(job.id)) { newBatches.clear(); newBatches.add(job.id); }
        renderCards({ reveal: justFinished });
        if (justFinished || !seenBatches.has(job.id)) announceIdeas(job);
        focusNewBatch();
      }
    }
  }
  function upsertBatch(batch) {
    batches = [...batches.filter((entry) => entry.id !== batch.id), batch].sort((a, b) => b.id - a.id);
  }
  function markSeen(id) {
    seenBatches.add(id);
    save('recipes.seenBatches', [...seenBatches].slice(-200));
  }
  const onRecipesPage = () => document.body.dataset.page === 'recipes' && location.hash === '#recipes';
  /** A ready notice opens the exact batch, even after switching collections or scrolling away. */
  function announceIdeas(job) {
    if (ideasInView()) { markSeen(job.id); return; }
    const recipes = job.result.recipes.map((recipe) => readable(recipe)), count = recipes.length;
    announcedJobId = job.id;
    showReady('recipes', { symbol: count ? dishEmoji(`${recipes[0].title} ${recipes[0].kind}`) : '🍽️', title: t('Fresh ideas are ready!'), label: t('See your recipe ideas'), dismissible: false,
      detail: count === 1 ? recipes[0].title : count ? tn(count, '{count} new recipe to try', '{count} new recipes to try') : t('Take a peek'),
      onOpen: () => {
        announcedJobId = undefined; markSeen(job.id);
        searchInput.value = ''; searchQuery = ''; searchChanged();
        focusJobId = job.id; collection = 'ideas'; olderExpanded = batches[0]?.id !== job.id; renderCards();
        if (onRecipesPage()) focusNewBatch();
        else location.hash = 'recipes';
      } });
  }
  function focusNewBatch() {
    if (!focusJobId || !onRecipesPage() || collection !== 'ideas') return;
    const batch = cards.querySelector(`[data-job-id="${focusJobId}"]`);
    if (!batch) return;
    const id = focusJobId; focusJobId = undefined;
    requestAnimationFrame(() => {
      if (!batch.isConnected) { focusJobId = id; focusNewBatch(); return; }
      const page = root.closest('.page');
      batch.querySelector('h3').focus({ preventScroll: true });
      // Scroll only this page vertically; scrollIntoView would also move the horizontal pager.
      page.scrollTo({ top: page.scrollTop + batch.getBoundingClientRect().top - page.getBoundingClientRect().top - 12,
        behavior: calmMotion(batch) ? 'instant' : 'smooth' });
    });
  }
  function switchCollection(next) {
    if (next === collection) return;
    collection = next;
    if (next === 'ideas' && searchQuery) searchChanged();
    renderCards({ deal: next === 'saved' ? 1 : -1 });
  }
  const normalizeSearch = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  function matchesSearch(recipe) {
    const shown = readable(recipe);
    return normalizeSearch([recipe.title, recipe.summary, recipe.kind, ...recipe.ingredients.map((item) => item.name), shown.title, shown.summary, ...shown.ingredients.map((item) => item.name)].join(' ')).includes(normalizeSearch(searchQuery));
  }
  function searchChanged() {
    clearTimeout(searchTimer); searchVersion++;
    searchError = undefined; searchBatches = []; searchNextBefore = null;
    searchLoading = !!searchQuery && collection === 'ideas';
    renderCards();
    if (searchLoading) searchTimer = setTimeout(() => searchIdeas(), 250);
  }
  async function searchIdeas(before) {
    const version = ++searchVersion, query = searchQuery;
    if (!query) return;
    try {
      const page = await api.recipeHistory(before, query);
      if (version !== searchVersion) return;
      searchBatches = before ? [...searchBatches, ...page.batches] : page.batches;
      searchNextBefore = page.nextBefore; searchLoading = false; searchError = undefined; renderCards();
    } catch (error) {
      if (version !== searchVersion) return;
      searchLoading = false; searchError = error.message; renderCards(); showError(error);
    }
  }
  function renderCards({ reveal = false, deal = 0 } = {}) {
    const focusedBatch = document.activeElement?.closest('.ideas-batch')?.dataset.jobId;
    collectionHeading.textContent = collection === 'ideas' ? t('Ideas') : t('Saved recipes');
    savedTab.textContent = `${t('Saved recipes')}${savedRecipes.length ? ` (${savedRecipes.length})` : ''}`;
    ideasTab.textContent = t('Ideas');
    for (const [tab, name] of [[savedTab, 'saved'], [ideasTab, 'ideas']]) {
      tab.setAttribute('aria-selected', String(collection === name));
      tab.tabIndex = collection === name ? 0 : -1;
    }
    cards.setAttribute('aria-labelledby', collection === 'ideas' ? ideasTab.id : savedTab.id);
    clearSearch.hidden = !searchInput.value;
    const noMatches = () => emptyState('🔎', t('No recipes found'), t('Try a different name or ingredient.'));
    if (collection === 'saved') {
      const matching = savedRecipes.filter(({ recipe }) => matchesSearch(recipe));
      cards.replaceChildren(h('div', { class: 'suggestion-grid' }, ...(matching.length
        ? matching.map(({ recipe, id }) => recipeCard(recipe, id))
        : [searchQuery ? noMatches() : emptyState('💗', t('Your little recipe box'), t('Tap the heart on a recipe to keep it here.'))])));
    } else {
      const latest = cooking ? 0 : 1;
      const visibleBatches = searchQuery ? searchBatches : batches.slice(0, latest);
      const batchSection = (batch) => {
        const isNew = newBatches.has(batch.id);
        const time = new Date(batch.finishedAt || batch.createdAt);
        const heading = h('h3', { tabindex: '-1' }, isNew ? t('Fresh ideas') : t('Recipe ideas'),
          isNew ? h('span', { class: 'ideas-new-badge' }, t('New')) : '');
        const grid = h('div', { class: 'suggestion-grid' }, ...batch.recipes.map((recipe, index) => {
          const card = recipeCard(recipe);
          if (reveal && batch.id === activeJobId && onRecipesPage() && !calmMotion(card)) {
            card.style.setProperty('--idea-delay', `${index * 110}ms`); card.classList.add('idea-fresh');
            card.addEventListener('animationend', (event) => {
              if (event.target === card && event.animationName === 'idea-arrive') card.classList.remove('idea-fresh');
            });
          }
          return card;
        }));
        return h('section', { class: `ideas-batch${isNew ? ' has-new-ideas' : ''}`, dataset: { jobId: batch.id }, 'aria-label': t('Ideas from {time}', { time: time.toLocaleString(localeTag) }) },
          h('div', { class: 'ideas-batch-heading' }, heading, h('time', { datetime: time.toISOString() }, time.toLocaleString(localeTag, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))), grid);
      };
      cards.replaceChildren(...(cooking && !searchQuery ? [h('div', { class: 'suggestion-grid' }, cookingCard)] : visibleBatches.length ? visibleBatches.map(batchSection) : [searchQuery ? searchLoading ? h('p', { class: 'muted', role: 'status' }, t('Searching recipes…')) : searchError ? emptyState('🔎', t('Search couldn’t load'), searchError) : noMatches() : emptyState('🍝', t('Something lovely is cooking'), t('Find recipe ideas and revisit them here.'))]));
      let older;
      if (!searchQuery && (batches.length > latest || nextBefore)) {
        const toggle = h('button', { type: 'button', class: 'ideas-history-toggle', 'aria-expanded': String(olderExpanded), 'aria-controls': 'recipe-older-ideas', onclick: () => {
          olderExpanded = !olderExpanded; renderCards();
          cards.querySelector('.ideas-history-toggle')?.focus({ preventScroll: true });
        } }, olderExpanded ? t('Hide older ideas') : t('Show older ideas'));
        older = h('div', { id: 'recipe-older-ideas', class: 'ideas-older', hidden: !olderExpanded }, ...(olderExpanded ? batches.slice(latest).map(batchSection) : []));
        cards.append(toggle, older);
      }
      if (searchQuery ? searchNextBefore : olderExpanded && nextBefore) {
        const more = h('button', { type: 'button', class: 'ideas-load-more', onclick: () => withBusy(more, t('Loading…'), async () => {
          if (searchQuery) await searchIdeas(searchNextBefore);
          else {
            const page = await api.recipeHistory(nextBefore);
            page.batches.forEach(upsertBatch); nextBefore = page.nextBefore; renderCards(); translateStale();
          }
        }) }, t('Load older ideas'));
        (searchQuery ? cards : older).append(more);
      }
      if (!searchQuery && !cooking && batches.length) {
        const clear = h('button', { type: 'button', class: 'danger text-button ideas-clear', onclick: () => clearHistory(clear) }, icon('trash'), t('Clear ideas history'));
        cards.append(clear);
      }
    }
    syncProgress();
    if (focusedBatch) cards.querySelector(`[data-job-id="${focusedBatch}"] h3`)?.focus({ preventScroll: true });
    if (deal && !calmMotion(cards)) cards.querySelectorAll('.recipe-card').forEach((card, index) => dealIn(card, index, deal));
  }
  function dealIn(card, index, dir) {
    card.style.setProperty('--deal-delay', `${Math.min(index, 5) * 70}ms`);
    card.style.setProperty('--deal-dir', String(dir));
    card.classList.add('collection-deal');
    card.addEventListener('animationend', (event) => {
      if (event.target !== card || event.animationName !== 'collection-deal') return;
      card.classList.remove('collection-deal');
      card.style.removeProperty('--deal-delay');
      card.style.removeProperty('--deal-dir');
    });
  }
  function savedMatch(recipe) { return savedRecipes.find((entry) => entry.recipe.title === recipe.title); }
  function recipeCard(recipe, id) {
    const shown = readable(recipe);
    const missing = shown.ingredients.filter((ingredient) => !ingredient.inStock).length;
    const symbol = dishEmoji(`${shown.title} ${recipe.kind}`);
    const bookmark = h('button', { class: 'icon recipe-bookmark', 'aria-label': savedMatch(recipe) ? t('Unsave {title}', { title: shown.title }) : t('Save {title}', { title: shown.title }), 'aria-pressed': String(!!savedMatch(recipe)), onclick: async () => {
      await withBusy(bookmark, '…', () => toggleSaved(recipe)); renderCards();
    } }, icon('bookmark'));
    const ribbons = recipeRibbons(recipe);
    return h('article', { class: `recipe-card${id ? ' saved-recipe' : ''}${ribbons ? ' has-ribbons' : ''}` },
      ribbons,
      h('button', { class: 'recipe-open', 'aria-label': t('Open {title}', { title: shown.title }), onclick: () => openRecipe(recipe) },
        h('span', { class: 'recipe-art', 'aria-hidden': 'true' }, emoji(symbol), h('span', { class: 'art-spark art-spark-one' }, '✦'), h('span', { class: 'art-spark art-spark-two' }, '✧')),
        h('span', { class: 'recipe-card-copy' }, h('strong', {}, shown.title), h('span', { class: 'recipe-meta' }, icon('clock'), h('span', { class: 'recipe-meta-text' }, `${t('{count} min', { count: recipe.totalMinutes })} · ${shown.makes}`)), h('span', { class: `chip ${missing ? 'warn' : 'ok'}` }, missing ? t('{count} to buy', { count: missing }) : t('Uses your pantry')))), bookmark);
  }
  async function toggleSaved(recipe) {
    const existing = savedMatch(recipe);
    if (existing) await api.deleteSavedRecipe(existing.id);
    else await api.saveRecipe(recipe);
    await loadSaved();
    feel(existing ? 'shy' : 'love');
    return true;
  }
  function openRecipe(recipe) {
    const shown = readable(recipe);
    const saveButton = h('button', { class: 'recipe-save', onclick: async () => { if (await withBusy(saveButton, t('Saving…'), () => toggleSaved(recipe))) updateSaveButton(); } });
    const updateSaveButton = () => saveButton.replaceChildren(icon(savedMatch(recipe) ? 'check' : 'bookmark'), savedMatch(recipe) ? t('Saved') : t('Save'));
    updateSaveButton();
    const ribbons = recipeRibbons(recipe);
    const title = h('div', { class: `recipe-sheet-title${ribbons ? ' has-ribbons' : ''}` }, ribbons, h('div', { class: 'recipe-title-main' }, h('div', { class: 'recipe-title-art', 'aria-hidden': 'true' }, emoji(dishEmoji(`${shown.title} ${recipe.kind}`))), h('div', { class: 'recipe-title-copy' }, h('h3', {}, shown.title))));
    const { pages: sections, pantry } = recipePages(shown, { title, openTips: () => {
      const tips = openDialog('recipe-tips', h('h3', {}, t('Scoop’s kitchen tips')), recipeTips(shown), h('button', { class: 'primary', onclick: () => tips.close() }, t('Got it')));
    }, setInStock: (id, inStock) => api.updateIngredient(id, { inStock }) });
    // The last page ends with "I cooked this": what ran out, then feedback for Scoop's memory.
    sections.at(-1).append(recipeFeedbackCard(recipe, { pantry, onShowMemory: () => { close(); location.hash = 'profile'; } }));
    // Briefly reveal the next page on every open, even for returning cooks.
    const pages = h('div', { class: 'recipe-pages peek' }, ...sections);
    const stopPeek = () => pages.classList.remove('peek');
    pages.addEventListener('pointerdown', stopPeek, { passive: true });
    pages.addEventListener('touchstart', stopPeek, { passive: true });
    pages.addEventListener('wheel', stopPeek, { passive: true });
    pages.addEventListener('animationend', (event) => { if (event.animationName === 'swipe-peek') stopPeek(); });
    const tabs = sections.map((section, index) => h('button', { type: 'button', class: 'recipe-tab', onclick: () => go(index) }, h('span', { class: 'recipe-tab-number', 'aria-hidden': 'true' }, String(index + 1)), section.getAttribute('aria-label')));
    const indicator = h('span', { class: 'recipe-tab-indicator', 'aria-hidden': 'true' });
    const prev = h('button', { class: 'icon recipe-prev', onclick: () => go(page - 1) }, icon('back'));
    const nextLabel = h('span', {});
    const next = h('button', { class: 'primary recipe-next', onclick: () => go(page + 1) }, nextLabel, icon('arrow'));
    const pageName = (index) => sections[index].getAttribute('aria-label');
    let page = -1;
    const go = (index) => { if (sections[index]) { stopPeek(); pages.scrollTo({ left: index * pages.clientWidth, behavior: 'smooth' }); } };
    const show = (index) => {
      if (index === page) return;
      page = index;
      sections.forEach((section, i) => { section.inert = i !== index; });
      tabs.forEach((tab, i) => (i === index ? tab.setAttribute('aria-current', 'step') : tab.removeAttribute('aria-current')));
      prev.disabled = index === 0; next.hidden = index === sections.length - 1;
      prev.setAttribute('aria-label', prev.disabled ? t('Previous') : t('Back to {page}', { page: pageName(index - 1) }));
      if (!next.hidden) { nextLabel.textContent = pageName(index + 1); next.setAttribute('aria-label', t('Next: {page}', { page: pageName(index + 1) })); }
    };
    // The highlight follows the finger while swiping, so the tabs read as the pages' positions.
    const follow = () => {
      if (pages.scrollLeft > 0) stopPeek();
      const progress = Math.min(sections.length - 1, Math.max(0, pages.scrollLeft / (pages.clientWidth || 1)));
      const from = tabs[Math.floor(progress)], to = tabs[Math.ceil(progress)], mix = progress - Math.floor(progress);
      indicator.style.width = `${from.offsetWidth + (to.offsetWidth - from.offsetWidth) * mix}px`;
      indicator.style.transform = `translateX(${from.offsetLeft + (to.offsetLeft - from.offsetLeft) * mix}px)`;
      show(Math.round(progress));
    };
    pages.addEventListener('scroll', follow, { passive: true });
    if ('ResizeObserver' in window) new ResizeObserver(follow).observe(pages);
    show(0);
    const { dialog, close } = openDialog('recipe-detail',
      h('header', { class: 'recipe-sheet-header' }, h('span', { class: 'recipe-book-label' }, t('A LITTLE KITCHEN INSPIRATION')), h('button', { class: 'icon', 'aria-label': t('Close recipe'), onclick: () => close() }, icon('close'))),
      h('nav', { class: 'recipe-tabs', 'aria-label': t('Recipe pages') }, indicator, ...tabs),
      h('div', { class: 'recipe-sheet-content' }, pages, createRecipeCompanion(recipe)), h('footer', { class: 'recipe-sheet-footer' }, prev, saveButton, next));
    // The cook may be following the steps with messy hands: the screen stays on until the sheet closes.
    dialog.addEventListener('close', keepScreenAwake(), { once: true });
    requestAnimationFrame(follow);
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') go(page + 1);
      else if (event.key === 'ArrowLeft') go(page - 1);
    });
    return dialog;
  }
  async function loadSaved() { const { recipes } = await api.listSavedRecipes(); savedRecipes = recipes; renderCards(); }
  async function loadKitchen() {
    const { profile } = await api.getProfile();
    defaultServings = profile.servings; kitchenLanguage = profile.language;
    if (state.servings === '') servings.setValue(profile.servings);
    dishTypes = profile.dishTypes;
    if (state.kind !== ANY_DISH && !dishTypes.some((dish) => dish.name === state.kind)) state.kind = ANY_DISH;
    dishPicker.refresh();
    const names = profile.appliances.map((appliance) => appliance.name);
    state.machines = state.machines.filter((name) => names.includes(name)); state.avoid = state.avoid.filter((name) => names.includes(name) && !state.machines.includes(name));
    save('recipes.form', lasting(state)); updateOptionSummary();
    machines.replaceChildren(names.length ? '' : h('p', { class: 'muted' }, t('No appliances added.'), ' ', h('a', { href: '#profile' }, t('Set up your kitchen'))),
      ...names.map((name) => choiceChip('appliance-choice', [name], name, 'machines', 'avoid')));
  }
  async function loadPantry() {
    pantry = (await api.listIngredients()).ingredients.filter((item) => item.inStock);
    const names = pantry.map((item) => item.name);
    state.useIngredients = state.useIngredients.filter((name) => names.includes(name));
    state.avoidIngredients = state.avoidIngredients.filter((name) => names.includes(name) && !state.useIngredients.includes(name));
    save('recipes.form', lasting(state)); updateOptionSummary(); renderIngredients();
  }
  function ingredientChip(item) {
    return choiceChip('ingredient-choice', [emoji(item.emoji, 'chip-emoji'), item.name], item.name, 'useIngredients', 'avoidIngredients', () => {
      // A chosen ingredient moves up beside the others; keep focus on it so tapping again leaves it out.
      renderIngredients();
      const moved = [...chosenIngredients.children].find((chip) => chip.dataset.name === item.name);
      (moved || ingredientSearch).focus();
    });
  }
  function renderIngredients() {
    const chosen = [...state.useIngredients, ...state.avoidIngredients];
    chosenIngredients.replaceChildren(...pantry.filter((item) => chosen.includes(item.name)).map(ingredientChip));
    chosenIngredients.hidden = !chosen.length;
    renderIngredientMatches();
  }
  function renderIngredientMatches() {
    const query = normalizeSearch(ingredientSearch.value.trim());
    const chosen = [...state.useIngredients, ...state.avoidIngredients];
    const found = query ? pantry.filter((item) => normalizeSearch(item.name).includes(query)) : [];
    const matches = found.filter((item) => !chosen.includes(item.name));
    // A match that is already chosen sits in the row above, so it is not "nothing".
    ingredientMatches.replaceChildren(...matches.slice(0, INGREDIENT_MATCHES).map(ingredientChip),
      query && !found.length ? h('p', { class: 'muted' }, pantry.length ? t('Nothing in stock matches.') : t('Your pantry is empty.')) : '');
    ingredientMatches.hidden = !query;
  }
  /** A chip that cycles no preference → use → leave out, keeping `state[use]` and `state[avoid]` in step. */
  function choiceChip(kind, content, name, use, avoid, afterChange) {
    const mode = () => state[use].includes(name) ? 'use' : state[avoid].includes(name) ? 'avoid' : 'off';
    const mark = h('span', { class: 'chip-mark', 'aria-hidden': 'true' });
    const stateText = h('span', { class: 'visually-hidden' });
    const chip = h('button', { type: 'button', class: `chip toggle choice-chip ${kind}`, 'data-name': name, onclick: () => {
      const next = NEXT_MODE[mode()];
      state[use] = state[use].filter((value) => value !== name); state[avoid] = state[avoid].filter((value) => value !== name);
      if (next === 'use') state[use].push(name); else if (next === 'avoid') state[avoid].push(name);
      save('recipes.form', lasting(state)); updateOptionSummary(); paint();
      afterChange?.();
    } }, mark, h('span', { class: 'chip-name' }, ...content), stateText);
    function paint() {
      const current = mode();
      chip.dataset.mode = current;
      mark.replaceChildren(current === 'off' ? '' : icon(current === 'use' ? 'check' : 'close'));
      stateText.textContent = `: ${current === 'use' ? t('use') : current === 'avoid' ? t('leave out') : t('no preference')}`;
    }
    paint();
    return chip;
  }
  async function clearHistory(button) {
    if (!confirm(t('Clear all past recipe ideas? Saved recipes stay. New ideas will no longer steer away from these.'))) return;
    // withBusy reports a failure itself and returns undefined.
    if (!await withBusy(button, t('Clearing…'), () => api.clearRecipeHistory().then(() => true))) return;
    batches = []; nextBefore = null; olderExpanded = false; newBatches.clear(); hideReady('recipes');
    renderCards();
    toast(t('Ideas history cleared'));
  }
  async function loadHistory() {
    const page = await api.recipeHistory();
    // Keep already loaded older pages when refreshing current stock or returning to this page.
    page.batches.forEach(upsertBatch);
    if (!historyLoaded) nextBefore = page.nextBefore;
    historyLoaded = true;
  }
  async function resume() {
    try {
      const [job] = await Promise.all([latestJob('recipes'), loadHistory()]);
      if (focusJobId) collection = 'ideas';
      renderCards();
      if (job) follow(job);
      if (searchQuery && collection === 'ideas') await searchIdeas();
      focusNewBatch();
    } catch (error) { showError(error); }
  }
  async function refreshHistory() {
    const pages = await Promise.all(batches.map((batch) => api.getJob(batch.id)));
    pages.forEach(({ job }) => upsertBatch({ id: job.id, createdAt: job.createdAt, finishedAt: job.finishedAt, recipes: job.result.recipes }));
    renderCards();
  }
  async function show() {
    try { await Promise.all([loadKitchen(), loadPantry(), loadSaved()]); await resume(); translateStale(); } catch (error) { showError(error); }
  }
  /** Same rule as the server: recipes without a language are English, and free-text kitchen languages are left alone. */
  function needsTranslation(recipe) {
    const language = kitchenLanguage.trim().toLocaleLowerCase();
    return RECIPE_LANGUAGES.has(language) && (recipe.language ?? 'English').trim().toLocaleLowerCase() !== language
      && !Object.keys(recipe.translations ?? {}).some((name) => name.toLocaleLowerCase() === language);
  }
  /** Asks once for translations of recipes the cook can't read yet (made before a language change), then shows them. */
  async function translateStale() {
    if (translatingNow) return;
    const stale = batches.filter((batch) => batch.recipes.some(needsTranslation)).map((batch) => batch.id).slice(0, 12);
    if (!stale.length && !savedRecipes.some((entry) => needsTranslation(entry.recipe))) return;
    translatingNow = true;
    const status = h('p', { class: 'muted recipe-translating', role: 'status' }, t('Translating your recipes…'));
    cards.before(status);
    try {
      const outcome = await api.translateRecipes(stale);
      if (outcome.saved) await loadSaved();
      const pages = await Promise.all(outcome.batches.map((id) => api.getJob(id)));
      pages.forEach(({ job }) => upsertBatch({ id: job.id, createdAt: job.createdAt, finishedAt: job.finishedAt, recipes: job.result.recipes }));
      if (pages.length) renderCards();
      if (outcome.failed) toast(t('Some recipes couldn’t be translated. They’ll be tried again next time.'));
    } catch (error) { showError(error); } finally { status.remove(); translatingNow = false; }
  }
  function stop() { cookingScreen?.cancel(); clearTimeout(searchTimer); searchVersion++; stopWatching(); setProgress(false); runningJobId = undefined; announcedJobId = undefined; hideReady('recipes'); }
  window.addEventListener(PANTRY_CHANGED_EVENT, () => { Promise.all([loadPantry(), loadSaved(), refreshHistory()]).then(resume).catch(showError); });
  return { show, resume, stop };
}
