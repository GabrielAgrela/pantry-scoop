import { api, PANTRY_CHANGED_EVENT } from '../api.js';
import { calmMotion, h, openDialog, MANAGE_USAGE_URL, showError, toast, withBusy } from '../dom.js';
import { latestJob, watchJob } from '../jobs.js';
import { ANY_DISH, createDishPicker } from '../dish-picker.js';
import { createNumberWheel } from '../number-wheel.js';
import { createDifficultyPicker } from '../difficulty-picker.js';
import { createCreativityPicker, FLAVOUR_LEVELS, recipeRibbons } from '../recipe-labels.js';
import { smoothDetails } from '../smooth-details.js';
import { composeReveal } from '../compose-reveal.js';
import { kindLabel, recipePages, recipeTips } from '../recipe-card.js';
import { hideReady, showReady } from '../ready-notice.js';
import { load, save } from '../store.js';
import { dishEmoji, emptyState, emoji, field, icon, pantryFriend } from '../ui.js';

const DEFAULTS = { kind: 'Dinner', servings: '', craving: '', count: '3', maxMissing: '0', difficulty: 'any', creativity: 'any', machines: [], avoid: [] };
const DIFFICULTY_LABELS = { any: 'Any', easy: 'Easy', medium: 'Medium', hard: 'Hard' };
// Each tap moves an appliance chip one step: no preference → use → don't use → no preference.
const NEXT_MODE = { off: 'use', use: 'avoid', avoid: 'off' };
/** Ideas older than this no longer open the Recipes tab; saved recipes do. */
const FRESH_IDEAS_MS = 5 * 60 * 1000;
const LOADING_MESSAGES = ['Stirring up inspiration…', 'A pinch of pantry magic…', 'Whisking up yummy ideas…', 'A little sprinkle of yum…', 'Good things take a stir…'];
export function createRecipesView(root) {
  const state = { ...DEFAULTS, ...load('recipes.form', {}) };
  if (state.kind !== ANY_DISH) state.kind = kindLabel(state.kind); // older choices were fixed ids such as "main"
  let dishTypes = [], savedRecipes = [], suggestions = [], collection = 'saved', stopWatching = () => {};
  let activeJobId = 0, runningJobId, suggestionsJobId, requestedJobId, openedIdeas = false;
  let loadingTimer, loadingIndex = 0, loadingAnimation;
  const loadingMessage = h('span', { class: 'recipe-loading-message', 'aria-hidden': 'true' });
  const progress = h('div', { id: 'recipe-progress', class: 'job-progress recipe-progress', role: 'status', 'aria-live': 'polite', hidden: true },
    h('a', { class: 'job-progress-link', href: '#recipes', 'aria-label': 'Open recipe ideas' },
    pantryFriend('recipe-loading-friend'),
    h('div', { class: 'recipe-loading-copy' }, h('span', { class: 'visually-hidden' }, 'Finding recipe ideas. You can keep browsing.'), loadingMessage,
      h('span', { class: 'loading-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')))));
  document.body.append(progress);
  const bind = (el, key) => { el.value = state[key]; el.addEventListener('input', () => { state[key] = el.value; save('recipes.form', state); updateOptionSummary(); }); return el; };
  const dishPicker = createDishPicker({
    getValue: () => state.kind, onChange: (value) => { state.kind = value; save('recipes.form', state); },
    getDishTypes: () => dishTypes, setDishTypes: (next) => { dishTypes = next; },
  });
  // Until the wheel is turned, servings stays '' and the server falls back to the profile's default.
  const servings = createNumberWheel({ min: 1, max: 20, value: Number(state.servings) || 2, label: 'Servings', onChange: (value) => { state.servings = String(value); save('recipes.form', state); } });
  const craving = bind(h('input', { placeholder: 'What are you craving?', 'aria-label': 'Craving' }), 'craving');
  const optionWheel = (key, min, max, label) => createNumberWheel({ min, max, value: Number(state[key]), label, onChange: (value) => { state[key] = String(value); save('recipes.form', state); updateOptionSummary(); } });
  const count = optionWheel('count', 1, 5, 'Number of ideas');
  const maxMissing = optionWheel('maxMissing', 0, 3, 'Ingredients to buy');
  const machines = h('div', { class: 'chips machine-picker', role: 'group', 'aria-labelledby': 'appliance-label', 'aria-describedby': 'appliance-hint' });
  const difficulty = createDifficultyPicker({ value: state.difficulty, onChange: (value) => { state.difficulty = value; save('recipes.form', state); updateOptionSummary(); } });
  const creativity = createCreativityPicker({ value: state.creativity, onChange: (value) => { state.creativity = value; save('recipes.form', state); updateOptionSummary(); } });
  const suggestButton = h('button', { type: 'submit', class: 'primary recipe-suggest' },
    h('span', { class: 'recipe-suggest-title' }, icon('spark'), 'Find recipe ideas'), h('small', {}, '~30 sec'));
  const results = h('div', { class: 'recipe-results', 'aria-live': 'polite' });
  const optionSummary = h('span', { class: 'muted' });
  const collectionHeading = h('h2', {}, 'Ideas for you');
  const collectionButton = h('button', { class: 'saved-link', onclick: () => switchCollection() });
  const cards = h('div', { class: 'suggestion-grid' });
  const optionTitle = h('span', { class: 'option-title' }, h('strong', {}, 'More options'), optionSummary);
  const composeToggle = h('button', { type: 'button', class: 'compose-toggle', 'aria-expanded': 'false', 'aria-controls': 'recipe-generator' }, 'What shall we cook?', emoji('🍝', 'heading-emoji'));
  root.append(h('div', { class: 'recipe-compose is-collapsed' }, h('div', { class: 'view-heading' }, h('div', {}, h('h1', {}, composeToggle), h('p', { class: 'recipe-subtitle' }, 'A little inspiration, straight from your pantry.'))),
    h('div', { class: 'compose-body' }, h('p', { class: 'compose-hint', 'aria-hidden': 'true' }, icon('spark'), 'Tap to start cooking', icon('chevron')),
    h('form', { id: 'recipe-generator', class: 'recipe-generator stack', onsubmit: suggest },
      h('div', { class: 'craving-input' }, icon('search'), craving, h('small', {}, 'Quick pasta, something spicy…')),
      h('div', { class: 'recipe-basic-fields' }, field('Dish', h('div', { class: 'input-icon' }, icon('recipes'), dishPicker.element)), field('Servings', h('div', { class: 'input-icon wheel-field' }, icon('people'), servings.element))),
      h('details', { class: 'form-options recipe-options' }, h('summary', {}, icon('settings'), optionTitle, icon('chevron')), h('div', { class: 'options-body' },
        h('div', { class: 'grid-2' }, field('Number of ideas', h('div', { class: 'wheel-field' }, count.element)), field('Ingredients to buy', h('div', { class: 'wheel-field' }, maxMissing.element))),
        h('div', { class: 'equipment-field' }, h('span', { class: 'field-label', id: 'difficulty-label' }, 'Difficulty'), difficulty),
        h('div', { class: 'equipment-field' }, h('span', { class: 'field-label', id: 'creativity-label' }, 'Flavour adventure'), h('small', { class: 'field-hint', id: 'creativity-hint' }, 'How familiar should the flavours be?'), creativity),
        h('div', { class: 'equipment-field' }, h('span', { class: 'field-label', id: 'appliance-label' }, 'Appliances'), h('small', { class: 'field-hint', id: 'appliance-hint' }, 'Tap once to use, twice to leave out.'), machines))), suggestButton))),
    h('div', { class: 'recipe-browse' }, results,
      h('div', { class: 'section-heading recipe-collection-heading' }, collectionHeading, collectionButton), cards));
  smoothDetails(root.querySelector('.recipe-options'));
  composeReveal(root.querySelector('.recipe-compose'), composeToggle);
  updateOptionSummary();
  function updateOptionSummary() {
    optionSummary.textContent = [state.maxMissing === '0' ? 'Pantry only' : `Up to ${state.maxMissing} to buy`, `${state.count} idea${state.count === '1' ? '' : 's'}`,
      state.difficulty !== 'any' && DIFFICULTY_LABELS[state.difficulty], state.creativity !== 'any' && FLAVOUR_LEVELS.find((level) => level.value === state.creativity)?.label, state.machines.length && `${state.machines.length} to use`, state.avoid.length && `${state.avoid.length} left out`].filter(Boolean).join(' · ');
  }
  async function suggest(event) {
    event.preventDefault();
    setProgress(true);
    const job = await withBusy(suggestButton, 'Starting…', () => api.suggestRecipes({ kind: state.kind, craving: state.craving, count: Number(state.count), maxMissing: Number(state.maxMissing), servings: state.servings === '' ? undefined : Number(state.servings), difficulty: state.difficulty, creativity: state.creativity, appliances: state.machines, avoidAppliances: state.avoid }));
    if (job) { collection = 'ideas'; requestedJobId = job.job.id; follow(job.job); }
    else setProgress(false);
  }
  function setProgress(running) {
    progress.hidden = !running;
    if (!running) {
      clearInterval(loadingTimer); loadingTimer = undefined;
      loadingAnimation?.cancel();
      return;
    }
    // Job polls and tab changes keep the same cycle going instead of restarting it.
    if (loadingTimer !== undefined) return;
    loadingIndex = 0;
    loadingMessage.textContent = LOADING_MESSAGES[0];
    loadingTimer = setInterval(() => {
      loadingIndex = (loadingIndex + 1) % LOADING_MESSAGES.length;
      loadingMessage.textContent = LOADING_MESSAGES[loadingIndex];
      loadingAnimation?.cancel();
      if (!calmMotion(loadingMessage)) loadingAnimation = loadingMessage.animate([
        { opacity: 0, transform: 'translateY(7px)' },
        { opacity: 1, transform: 'translateY(-1px)', offset: .8 },
        { opacity: 1, transform: 'none' },
      ], { duration: 450, easing: 'cubic-bezier(.2, .8, .3, 1)' });
    }, 4200);
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
        results.replaceChildren(h('div', { class: 'card stack' }, h('span', { class: 'problem' }, job.error.message), job.error.code === 'usage-limit' ? h('a', { class: 'button primary', href: MANAGE_USAGE_URL, target: '_blank', rel: 'noopener' }, 'Manage usage') : ''));
        if (justFinished) showError(job.error);
      } else {
        if (justFinished) collection = 'ideas';
        results.replaceChildren(); suggestions = job.result.recipes; suggestionsJobId = job.id; renderCards({ reveal: justFinished });
        if (justFinished) announceIdeas(job.result.recipes);
      }
    }
  }
  /** Ideas that finish on another page wait in a notice; on this page the cards themselves arrive. */
  function announceIdeas(recipes) {
    if (document.body.dataset.page === 'recipes') { toast('Your recipe ideas are ready'); return; }
    const count = recipes.length;
    showReady('recipes', { symbol: count ? dishEmoji(`${recipes[0].title} ${recipes[0].kind}`) : '🍽️', title: 'Fresh ideas are ready!', label: 'See your recipe ideas',
      detail: count === 1 ? recipes[0].title : count ? `${count} new recipes to try` : 'Take a peek',
      onOpen: () => { openedIdeas = true; collection = 'ideas'; renderCards(); location.hash = 'recipes'; } });
  }
  /**
   * Flipping between ideas and the recipe box shuffles the cards like index cards: the current ones
   * slide away to one side, the heading flips over and the other collection deals in from the other.
   */
  let switching = false;
  async function switchCollection() {
    if (switching) return;
    const next = collection === 'ideas' ? 'saved' : 'ideas';
    const dir = next === 'saved' ? 1 : -1;
    if (!calmMotion(cards) && !root.hidden) {
      switching = true;
      collectionButton.classList.add('is-flipping');
      const leaving = [...cards.children];
      await Promise.all(leaving.map((card, index) => card.animate([
        { transform: 'none', opacity: 1 },
        { transform: `translateX(${dir * -34}px) rotate(${dir * -3}deg) scale(.94)`, opacity: 0 },
      ], { duration: 190, delay: Math.min(index, 4) * 35, easing: 'cubic-bezier(.5, 0, .9, .5)', fill: 'forwards' }).finished.catch(() => {})));
      switching = false;
      setTimeout(() => collectionButton.classList.remove('is-flipping'), 520);
    }
    collection = next;
    renderCards({ deal: dir });
  }
  function renderCards({ reveal = false, deal = 0 } = {}) {
    const title = collection === 'ideas' ? 'Ideas for you' : 'Saved recipes';
    if (deal && collectionHeading.textContent !== title && !calmMotion(collectionHeading)) {
      collectionHeading.animate([{ transform: 'rotateX(90deg) translateY(6px)', opacity: 0 }, { transform: 'rotateX(-12deg)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }],
        { duration: 380, easing: 'cubic-bezier(.3, 1.3, .5, 1)' });
    }
    collectionHeading.textContent = title;
    collectionButton.replaceChildren(collection === 'ideas' ? `Saved ${savedRecipes.length}` : 'Ideas', icon('arrow'));
    const entries = collection === 'ideas' ? suggestions.map((recipe) => ({ recipe })) : savedRecipes;
    cards.replaceChildren(...(entries.length ? entries.map(({ recipe, id }, index) => {
      const card = recipeCard(recipe, id);
      if (reveal && collection === 'ideas' && !root.hidden && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        card.style.setProperty('--idea-delay', `${index * 110}ms`);
        card.classList.add('idea-fresh');
        card.addEventListener('animationend', (event) => {
          if (event.target === card && event.animationName === 'idea-arrive') {
            card.classList.remove('idea-fresh');
            card.style.removeProperty('--idea-delay');
          }
        });
      }
      return card;
    }) : [emptyState(collection === 'saved' ? '💗' : '🍝', collection === 'saved' ? 'Your little recipe box' : 'Something lovely is cooking', collection === 'saved' ? 'Tap the heart on a recipe to keep it here.' : 'Choose what you’re craving. We’ll bring the ideas.')]));
    if (deal && !calmMotion(cards)) [...cards.children].forEach((card, index) => dealIn(card, index, deal));
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
    const missing = recipe.ingredients.filter((ingredient) => !ingredient.inStock).length;
    const symbol = dishEmoji(`${recipe.title} ${recipe.kind}`);
    const bookmark = h('button', { class: 'icon recipe-bookmark', 'aria-label': savedMatch(recipe) ? `Unsave ${recipe.title}` : `Save ${recipe.title}`, 'aria-pressed': String(!!savedMatch(recipe)), onclick: async () => {
      await withBusy(bookmark, '…', () => toggleSaved(recipe)); renderCards();
    } }, icon('bookmark'));
    return h('article', { class: `recipe-card${id ? ' saved-recipe' : ''}${recipe.difficulty || recipe.creativity ? ' has-ribbons' : ''}` },
      recipeRibbons(recipe),
      h('button', { class: 'recipe-open', 'aria-label': `Open ${recipe.title}`, onclick: () => openRecipe(recipe) },
        h('span', { class: 'recipe-art', 'aria-hidden': 'true' }, emoji(symbol), h('span', { class: 'art-spark art-spark-one' }, '✦'), h('span', { class: 'art-spark art-spark-two' }, '✧')),
        h('span', { class: 'recipe-card-copy' }, h('strong', {}, recipe.title), h('span', { class: 'recipe-meta' }, icon('clock'), h('span', { class: 'recipe-meta-text' }, `${recipe.totalMinutes} min · ${recipe.makes}`)), h('span', { class: `chip ${missing ? 'warn' : 'ok'}` }, missing ? `${missing} to buy` : 'Uses your pantry'))), bookmark);
  }
  async function toggleSaved(recipe) {
    const existing = savedMatch(recipe);
    if (existing) await api.deleteSavedRecipe(existing.id);
    else await api.saveRecipe(recipe);
    await loadSaved();
    toast(existing ? 'Removed from saved recipes' : 'Saved to your recipe box', { mood: existing ? 'shy' : 'love' });
    return true;
  }
  function openRecipe(recipe) {
    const saveButton = h('button', { class: 'recipe-save', onclick: async () => { if (await withBusy(saveButton, 'Saving…', () => toggleSaved(recipe))) updateSaveButton(); } });
    const updateSaveButton = () => saveButton.replaceChildren(icon(savedMatch(recipe) ? 'check' : 'bookmark'), savedMatch(recipe) ? 'Saved' : 'Save');
    updateSaveButton();
    const ribbons = recipeRibbons(recipe);
    const title = h('div', { class: `recipe-sheet-title${ribbons ? ' has-ribbons' : ''}` }, ribbons, h('div', { class: 'recipe-title-main' }, h('div', { class: 'recipe-title-art', 'aria-hidden': 'true' }, emoji(dishEmoji(`${recipe.title} ${recipe.kind}`))), h('div', { class: 'recipe-title-copy' }, h('h3', {}, recipe.title))));
    const sections = recipePages(recipe, { title, openTips: () => {
      const tips = openDialog('recipe-tips', h('h3', {}, 'Scoop’s kitchen tips'), recipeTips(recipe), h('button', { class: 'primary', onclick: () => tips.close() }, 'Got it'));
    }, setInStock: (id, inStock) => api.updateIngredient(id, { inStock }) });
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
      prev.setAttribute('aria-label', prev.disabled ? 'Previous' : `Back to ${pageName(index - 1)}`);
      if (!next.hidden) { nextLabel.textContent = pageName(index + 1); next.setAttribute('aria-label', `Next: ${pageName(index + 1)}`); }
    };
    // The highlight follows the finger while swiping, so the tabs read as the pages' positions.
    const follow = () => {
      if (pages.scrollLeft > 0) stopPeek();
      const progress = Math.min(sections.length - 1, Math.max(0, pages.scrollLeft / (pages.clientWidth || 1)));
      const from = tabs[Math.floor(progress)], to = tabs[Math.ceil(progress)], t = progress - Math.floor(progress);
      indicator.style.width = `${from.offsetWidth + (to.offsetWidth - from.offsetWidth) * t}px`;
      indicator.style.transform = `translateX(${from.offsetLeft + (to.offsetLeft - from.offsetLeft) * t}px)`;
      show(Math.round(progress));
    };
    pages.addEventListener('scroll', follow, { passive: true });
    if ('ResizeObserver' in window) new ResizeObserver(follow).observe(pages);
    show(0);
    const { dialog, close } = openDialog('recipe-detail',
      h('header', { class: 'recipe-sheet-header' }, h('span', { class: 'recipe-book-label' }, emoji('💗'), 'A LITTLE KITCHEN INSPIRATION'), h('button', { class: 'icon', 'aria-label': 'Close recipe', onclick: () => close() }, icon('close'))),
      h('nav', { class: 'recipe-tabs', 'aria-label': 'Recipe pages' }, indicator, ...tabs),
      pages, h('footer', { class: 'recipe-sheet-footer' }, prev, saveButton, next));
    requestAnimationFrame(follow);
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') go(page + 1);
      else if (event.key === 'ArrowLeft') go(page - 1);
    });
  }
  async function loadSaved() { const { recipes } = await api.listSavedRecipes(); savedRecipes = recipes; renderCards(); }
  async function loadKitchen() {
    const { profile } = await api.getProfile();
    if (state.servings === '') servings.setValue(profile.servings);
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
  async function resume(pickCollection = false) {
    try {
      const job = await latestJob('recipes');
      if (pickCollection) { collection = openedIdeas || hasFreshIdeas(job) ? 'ideas' : 'saved'; openedIdeas = false; renderCards(); }
      if (job) follow(job);
    } catch (error) { showError(error); }
  }
  function hasFreshIdeas(job) {
    return job?.status === 'succeeded' && job.result.recipes.length > 0 && Date.now() - Date.parse(job.finishedAt) < FRESH_IDEAS_MS;
  }
  async function refreshSuggestions() {
    const id = suggestionsJobId;
    if (!id) return;
    const { job } = await api.getJob(id);
    if (suggestionsJobId !== id) return;
    suggestions = job.result.recipes; renderCards();
  }
  async function show() {
    if (document.body.dataset.page === 'recipes') hideReady('recipes');
    try { await Promise.all([loadKitchen(), loadSaved()]); await resume(true); } catch (error) { showError(error); }
  }
  function stop() { stopWatching(); setProgress(false); runningJobId = undefined; hideReady('recipes'); }
  window.addEventListener(PANTRY_CHANGED_EVENT, () => { Promise.all([loadSaved(), refreshSuggestions()]).then(resume).catch(showError); });
  return { show, resume, stop };
}
