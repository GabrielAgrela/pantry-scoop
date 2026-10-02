import { api } from '../api.js';
import { h, MANAGE_USAGE_URL, showError, toast, withBusy } from '../dom.js';
import { latestJob, watchJob } from '../jobs.js';
import { KIND_LABELS, recipeBody } from '../recipe-card.js';
import { load, save } from '../store.js';

const DEFAULTS = { kind: 'any', servings: '', craving: '', count: '3', maxMissing: '0', machines: [] };

export function createRecipesView(root) {
  const state = { ...DEFAULTS, ...load('recipes.form', {}) };
  const persist = () => save('recipes.form', state);
  let savedTitles = new Set();
  let stopWatching = () => {};

  const bind = (el, key) => {
    el.value = state[key];
    el.addEventListener('input', () => {
      state[key] = el.value;
      persist();
    });
    return el;
  };

  const kind = bind(h('select', { 'aria-label': 'Kind of dish' },
    ...Object.entries(KIND_LABELS).map(([value, label]) => h('option', { value }, label))), 'kind');
  const servings = bind(h('input', { type: 'number', min: 1, max: 20, inputmode: 'numeric', placeholder: '👥 Servings', 'aria-label': 'Servings' }), 'servings');
  const craving = bind(h('input', { placeholder: 'Craving? (optional)', 'aria-label': 'Craving' }), 'craving');
  const count = bind(h('select', { 'aria-label': 'How many recipes' },
    ...[1, 2, 3, 4, 5].map((n) => h('option', { value: n }, `${n} idea${n > 1 ? 's' : ''}`))), 'count');
  const maxMissing = bind(h('select', { 'aria-label': 'Ingredients to buy' },
    h('option', { value: 0 }, 'Only what I have'),
    ...[1, 2, 3].map((n) => h('option', { value: n }, `Can buy ${n}`))), 'maxMissing');
  const machines = h('div', { class: 'chips machine-picker', role: 'group', 'aria-label': 'Machines to use' });
  const suggestButton = h('button', { type: 'submit', class: 'primary' }, '✨ Get ideas');
  const results = h('div');
  const saved = h('div');

  root.append(
    h('form', { class: 'card stack', onsubmit: suggest },
      h('div', { class: 'grid-2' }, kind, servings),
      machines,
      craving,
      h('div', { class: 'grid-2' }, count, maxMissing),
      suggestButton,
    ),
    results,
    h('h2', {}, 'Saved'),
    saved,
  );

  async function suggest(event) {
    event.preventDefault();
    const job = await withBusy(suggestButton, 'Starting…', () =>
      api.suggestRecipes({
        kind: state.kind,
        craving: state.craving,
        count: Number(state.count),
        maxMissing: Number(state.maxMissing),
        servings: state.servings === '' ? undefined : Number(state.servings),
        appliances: state.machines,
      }));
    if (job) follow(job.job);
  }

  function follow(job) {
    stopWatching();
    stopWatching = watchJob(job, renderJob);
  }

  function renderJob(job) {
    suggestButton.disabled = job.status === 'running';
    if (job.status === 'running') {
      results.replaceChildren(h('div', { class: 'card status' }, h('div', { class: 'spinner' }), h('span', {}, 'Thinking up recipes…')));
    } else if (job.status === 'failed') {
      results.replaceChildren(h('div', { class: 'card stack' },
        h('span', { class: 'problem' }, job.error.message),
        job.error.code === 'usage-limit' ? h('a', { class: 'button primary', href: MANAGE_USAGE_URL, target: '_blank', rel: 'noopener' }, 'Manage usage') : '',
      ));
    } else {
      results.replaceChildren(...job.result.recipes.map(suggestionCard));
    }
  }

  function suggestionCard(recipe) {
    const already = savedTitles.has(recipe.title);
    const button = h('button', { disabled: already, onclick: async () => {
      const ok = await withBusy(button, 'Saving…', () => api.saveRecipe(recipe));
      if (!ok) return;
      button.disabled = true;
      button.textContent = '✓ Saved';
      await loadSaved();
    } }, already ? '✓ Saved' : '💾 Save');
    return h('article', { class: 'card recipe' }, h('h3', {}, recipe.title), ...recipeBody(recipe), button);
  }

  function savedCard({ id, recipe }) {
    const remove = h('button', { class: 'danger', onclick: async () => {
      if (!confirm(`Delete "${recipe.title}"?`)) return;
      const ok = await withBusy(remove, '…', () => api.deleteSavedRecipe(id).then(() => true));
      if (ok) await loadSaved();
    } }, 'Delete');
    return h('details', { class: 'card recipe' }, h('summary', {}, recipe.title), ...recipeBody(recipe), remove);
  }

  async function loadSaved() {
    try {
      const { recipes } = await api.listSavedRecipes();
      savedTitles = new Set(recipes.map((r) => r.recipe.title));
      saved.replaceChildren(...(recipes.length ? recipes.map(savedCard) : [h('p', { class: 'empty' }, 'Nothing saved yet.')]));
    } catch (error) {
      showError(error);
    }
  }

  async function loadMachines() {
    const { profile } = await api.getProfile();
    const names = profile.appliances.map((a) => a.name);
    state.machines = state.machines.filter((name) => names.includes(name));
    machines.replaceChildren(
      ...names.map((name) => h('label', { class: 'chip toggle' },
        h('input', { type: 'checkbox', checked: state.machines.includes(name), onchange: (e) => {
          state.machines = e.target.checked ? [...state.machines, name] : state.machines.filter((m) => m !== name);
          persist();
        } }),
        name)),
    );
  }

  async function show() {
    try {
      await Promise.all([loadMachines(), loadSaved()]);
      const job = await latestJob('recipes');
      if (job) follow(job);
    } catch (error) {
      showError(error);
    }
  }

  return { show };
}
