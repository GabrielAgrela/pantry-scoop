import { api } from '../api.js';
import { h, openDialog, toast, withBusy } from '../dom.js';
import { field, icon } from '../ui.js';

export function createProfileView(root) {
  let dirty = false, loaded = false, loading, appliances = [];
  const values = { servings: 2, units: 'Metric', language: 'English' };
  const displays = new Map();
  const saveNote = h('span', { class: 'save-note', 'aria-live': 'polite', hidden: true });
  const appliancesList = h('div', { class: 'appliance-list' });
  const applianceEmpty = h('p', { class: 'muted appliance-empty' }, 'Add the appliances you cook with.');
  const preferences = h('textarea', { rows: 1, placeholder: 'e.g. Vegetarian, less sugar', 'aria-label': 'Dietary preferences', oninput: () => { markDirty(); resizePreferences(); } });
  const saveButton = h('button', { type: 'submit', class: 'primary', disabled: true }, 'Save preferences');
  const loadMessage = h('p', { role: 'status' }, 'Loading your kitchen…');
  const retry = h('button', { type: 'button', hidden: true, onclick: () => show() }, 'Try again');
  const loadState = h('div', { class: 'kitchen-load-state card stack' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), loadMessage, retry);
  const reset = h('button', { type: 'button', class: 'text-button', onclick: async () => {
    if (!confirm('Reset kitchen settings to the defaults?')) return;
    const result = await withBusy(reset, 'Resetting…', () => api.resetProfile());
    if (result) { fill(result.profile); toast('Kitchen defaults restored'); }
  } }, 'Restore defaults');
  const settingsMenu = h('details', { class: 'kitchen-more', hidden: true }, h('summary', { 'aria-label': 'Kitchen settings' }, icon('settings')), reset);
  const defaultRows = [
    ['servings', 'Servings', 'recipes'], ['units', 'Units', 'scale'], ['language', 'Language', 'globe'],
  ].map(([key, label, symbol]) => {
    const display = h('span', { class: 'default-value' }); displays.set(key, display);
    return h('button', { type: 'button', class: 'default-row', 'aria-label': `Edit ${label.toLowerCase()}`, onclick: () => editDefault(key, label) }, icon(symbol), h('span', {}, label), display, icon('chevron'));
  });
  const form = h('form', { class: 'kitchen-form', hidden: true, onsubmit: onSave },
      h('section', { class: 'kitchen-equipment' }, h('div', { class: 'section-heading' }, h('h2', {}, 'Appliances'), h('button', { type: 'button', onclick: () => editAppliance() }, icon('plus'), 'Add')), appliancesList, applianceEmpty),
      h('section', { class: 'kitchen-defaults' }, h('h2', {}, 'Cooking defaults'), h('div', { class: 'defaults-list' }, ...defaultRows)),
      h('section', { class: 'kitchen-diet' }, h('h2', {}, 'Dietary preferences'), h('div', { class: 'diet-input' }, icon('leaf'), preferences)),
      h('div', { class: 'kitchen-save action-dock' }, saveNote, saveButton));
  root.append(h('div', { class: 'view-heading' }, h('h1', {}, 'My kitchen'), settingsMenu), loadState, form);

  function resizePreferences() { preferences.style.height = 'auto'; preferences.style.height = `${Math.max(50, preferences.scrollHeight)}px`; }
  function markDirty() { dirty = true; saveNote.hidden = false; saveNote.textContent = 'Unsaved changes'; }
  function renderAppliances() {
    appliancesList.hidden = !appliances.length;
    applianceEmpty.hidden = !!appliances.length;
    appliancesList.replaceChildren(...appliances.map((appliance, index) => h('button', { type: 'button', class: 'appliance', onclick: () => editAppliance(index), 'aria-label': `Edit ${appliance.name}` },
      icon(/air.?fryer/i.test(appliance.name) ? 'airfryer' : 'appliance', 'appliance-symbol'),
      h('span', { class: 'appliance-copy' }, h('strong', {}, appliance.name), appliance.details ? h('small', {}, appliance.details) : ''), icon('edit', 'appliance-go'))));
  }
  function editDefault(key, label) {
    if (!loaded) return;
    const input = h('input', { type: key === 'servings' ? 'number' : 'text', min: key === 'servings' ? 1 : undefined, max: key === 'servings' ? 20 : undefined, required: true, value: values[key] });
    const { close } = openDialog('edit', h('div', { class: 'row' }, h('h3', {}, label), h('button', { type: 'button', class: 'icon push-right', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      h('form', { class: 'stack', onsubmit: (event) => { event.preventDefault(); values[key] = key === 'servings' ? Number(input.value) : input.value.trim(); displays.get(key).textContent = values[key]; markDirty(); close(); } }, field(label, input), h('button', { class: 'primary' }, 'Done')));
    input.focus();
  }
  function editAppliance(index) {
    if (!loaded) return;
    const isNew = index === undefined;
    const current = isNew ? { name: '', details: '' } : appliances[index];
    const name = h('input', { value: current.name, required: true, maxlength: 80, placeholder: 'e.g. Air fryer' });
    const details = h('textarea', { rows: 4, value: current.details, placeholder: 'e.g. 4 L basket, max. 200°C' });
    const submitButton = h('button', { type: 'submit', class: 'primary' }, isNew ? 'Add appliance' : 'Save');
    const persist = async (button, next, message) => {
      const result = await withBusy(button, 'Saving…', () => api.updateProfile({ appliances: next }));
      if (!result) return;
      appliances = result.profile.appliances; renderAppliances(); close(); toast(message);
    };
    const { close } = openDialog('edit appliance-sheet', h('div', { class: 'row' }, h('h3', {}, isNew ? 'Add appliance' : current.name), h('button', { type: 'button', class: 'icon push-right', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      h('form', { class: 'stack', onsubmit: (event) => { event.preventDefault(); const edited = { name: name.value.trim(), details: details.value.trim() }; persist(submitButton, isNew ? [...appliances, edited] : appliances.map((a, i) => i === index ? edited : a), isNew ? `${edited.name} added` : `${edited.name} saved`); } },
        field('Appliance name', name), field('Capacity & limits', details, 'Sizes, max temperatures or anything a recipe should respect.'),
        h('div', { class: 'row' }, submitButton, isNew ? '' : h('button', { type: 'button', class: 'danger push-right', onclick: (event) => { if (confirm(`Remove ${current.name}?`)) persist(event.currentTarget, appliances.filter((_, i) => i !== index), `${current.name} removed`); } }, 'Remove'))));
    name.focus();
  }
  async function onSave(event) {
    event.preventDefault();
    if (!loaded) return;
    const result = await withBusy(saveButton, 'Saving…', () => api.updateProfile({ ...values, preferences: preferences.value }));
    if (result) { fill(result.profile); toast('Kitchen preferences saved'); }
  }
  function fill(profile) {
    dirty = false; saveNote.hidden = true; appliances = profile.appliances; renderAppliances();
    for (const key of Object.keys(values)) { values[key] = profile[key]; displays.get(key).textContent = profile[key]; }
    preferences.value = profile.preferences;
    loaded = true; form.hidden = false; settingsMenu.hidden = false; saveButton.disabled = false; loadState.hidden = true; resizePreferences();
  }
  function show() {
    if (dirty) return;
    if (loading) return loading;
    loadState.hidden = loaded; retry.hidden = true; loadState.querySelector('.spinner').hidden = false;
    loadMessage.setAttribute('role', 'status'); loadMessage.textContent = 'Loading your kitchen…';
    root.setAttribute('aria-busy', 'true');
    loading = (async () => {
      try {
        const { profile } = await api.getProfile();
        if (!dirty) fill(profile);
      } catch (error) {
        if (error.code === 'auth-required') return;
        loadState.hidden = false; loadState.querySelector('.spinner').hidden = true; retry.hidden = false;
        loadMessage.setAttribute('role', 'alert'); loadMessage.textContent = `Could not load your kitchen. ${error.message}`;
      } finally { root.setAttribute('aria-busy', 'false'); loading = undefined; }
    })();
    return loading;
  }
  return { show };
}
