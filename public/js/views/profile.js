import { api } from '../api.js';
import { h, openDialog, showError, toast, withBusy } from '../dom.js';
import { applianceEmoji, emptyState, emoji, field, icon } from '../ui.js';
import { arrangeMosaic, tileSpan } from '../tile-layout.js';
import { createNumberWheel } from '../number-wheel.js';
import { createApplianceEmojiPicker } from '../appliance-emoji-picker.js';
import { createKitchenGuide } from '../kitchen-guide.js';
import { createUnitPriorityPicker } from '../unit-priority-picker.js';
import { unitPrioritySummary } from '../measurement-units.js';
import { createProfileAutosave } from '../profile-autosave.js';

export function createProfileView(root, { onSetupComplete = () => {} } = {}) {
  let dirty = false, loaded = false, loading, appliances = [];
  const values = { servings: 2, units: 'Metric', language: 'English' };
  const displays = new Map();
  const saveNote = h('span', { role: 'status', 'aria-live': 'polite' });
  const saveRetry = h('button', { type: 'button', hidden: true, onclick: () => autosave.flush() }, 'Try again');
  const saveStatus = h('div', { class: 'preference-status', hidden: true }, saveNote, saveRetry);
  const autosave = createProfileAutosave(changes => api.updateProfile(changes, { keepalive: true }), (status, error) => {
    dirty = status !== 'saved';
    saveStatus.hidden = false;
    saveRetry.hidden = status !== 'error';
    saveNote.textContent = status === 'saved' ? 'Changes saved' : status === 'error' ? 'Changes couldn’t be saved.' : 'Saving…';
    if (error) showError(error);
  });
  window.addEventListener('pagehide', () => { void autosave.flush(); });
  const appliancesList = h('div', { class: 'appliance-list' });
  // Tile heights follow the text, which reflows with the column width and once the font loads.
  let arrangeAppliances = () => {}, arrangedWidth = 0;
  if (window.ResizeObserver) new ResizeObserver(() => { if (appliancesList.clientWidth !== arrangedWidth) { arrangedWidth = appliancesList.clientWidth; arrangeAppliances(); } }).observe(appliancesList);
  document.fonts?.ready.then(() => arrangeAppliances());
  const applianceEmpty = emptyState('🥣', 'Make yourself at home', 'Add the appliances you cook with.');
  const preferences = h('textarea', { rows: 1, placeholder: 'e.g. Vegetarian, less sugar', 'aria-label': 'Dietary preferences', oninput: () => { saveChanges({ preferences: preferences.value }); resizePreferences(); }, onblur: () => { if (!guide.active()) void autosave.flush(); } });
  const loadMessage = h('p', { role: 'status' }, 'Loading your kitchen…');
  const retry = h('button', { type: 'button', hidden: true, onclick: () => show() }, 'Try again');
  const loadState = h('div', { class: 'kitchen-load-state card stack' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), loadMessage, retry);
  // Servings is turned in place; the text defaults open a small editor.
  const servingsWheel = createNumberWheel({ min: 1, max: 20, value: values.servings, label: 'Servings', onChange: (value) => { values.servings = value; saveChanges({ servings: value }); } });
  const defaultRows = [h('div', { class: 'default-row servings-row' }, icon('recipes'), h('span', {}, 'Servings'), h('div', { class: 'wheel-field' }, servingsWheel.element)), ...[
    ['units', 'Unit priority', 'scale'], ['language', 'Language', 'globe'],
  ].map(([key, label, symbol]) => {
    const display = h('span', { class: 'default-value' }); displays.set(key, display);
    return h('button', { type: 'button', class: 'default-row', 'aria-label': `Edit ${label.toLowerCase()}`, onclick: () => editDefault(key, label) }, icon(symbol), h('span', {}, label), display, icon('chevron'));
   })];
  const form = h('form', { class: 'kitchen-form', hidden: true, onsubmit: event => event.preventDefault() },
      h('section', { class: 'kitchen-equipment' }, h('div', { class: 'section-heading' }, h('h2', {}, emoji('🍳', 'section-emoji'), 'Appliances'), h('button', { type: 'button', onclick: () => editAppliance() }, icon('plus'), 'Add')), appliancesList, applianceEmpty),
      h('section', { class: 'kitchen-defaults' }, h('h2', {}, emoji('🥄', 'section-emoji'), 'Cooking defaults'), h('div', { class: 'defaults-list' }, ...defaultRows)),
      h('section', { class: 'kitchen-diet' }, h('h2', {}, emoji('🌿', 'section-emoji'), 'Dietary preferences'), h('div', { class: 'diet-input' }, icon('leaf'), preferences)),
      saveStatus);
  const guide = createKitchenGuide({
    sections: [...form.querySelectorAll('section')],
    addAppliance: () => editAppliance(),
    onAppliancesSaved: (profile) => { appliances = profile.appliances; renderAppliances(); },
    onSaved: fill,
    onComplete: () => { toast('Your kitchen is ready! Let’s fill your pantry.'); onSetupComplete(); },
  });
  root.append(h('div', { class: 'view-heading' }, h('div', {}, h('h1', {}, 'My kitchen ', emoji('🫖', 'heading-emoji')), h('p', { class: 'view-subtitle' }, 'Your tools, your tastes, your way.'))), loadState, guide.element, form);

  function resizePreferences() { preferences.style.height = 'auto'; preferences.style.height = `${Math.max(50, preferences.scrollHeight)}px`; }
  function saveChanges(changes, wait) { if (loaded && !guide.active()) autosave.change(changes, wait); }
  function renderAppliances() {
    appliancesList.hidden = !appliances.length;
    applianceEmpty.hidden = !!appliances.length;
    const spans = appliances.map((appliance) => tileSpan(appliance.name, appliance.details));
    const tiles = appliances.map((appliance, index) => h('button', { type: 'button', class: 'appliance', onclick: () => editAppliance(index), 'aria-label': `Edit ${appliance.name}` },
      emoji(appliance.emoji || applianceEmoji(appliance.name), 'appliance-symbol'),
      h('span', { class: 'appliance-copy' }, h('strong', {}, appliance.name), appliance.details ? h('small', {}, appliance.details) : ''), icon('edit', 'appliance-go')));
    // Wide, short tiles put the emoji beside the text; feature tiles get a larger emoji.
    const shapeFor = (index, w) => w >= 4 && spans[index].h <= 2 ? 'tile-row' : w <= 2 ? 'tile-narrow' : spans[index].h >= 4 ? 'tile-feature' : 'tile-stack';
    appliancesList.replaceChildren(...tiles);
    arrangeAppliances = () => arrangeMosaic(appliancesList, tiles, spans, shapeFor);
    arrangeAppliances();
  }
  function editDefault(key, label) {
    if (!loaded) return;
    if (key === 'units') return editUnits();
    const input = h('input', { required: true, value: values[key], oninput: () => {
      if (!input.value.trim() || !input.checkValidity()) return;
      values[key] = input.value.trim(); displays.get(key).textContent = values[key]; saveChanges({ [key]: values[key] });
    }, onblur: () => { void autosave.flush(); } });
    const { close } = openDialog('edit', h('div', { class: 'row' }, h('h3', {}, label), h('button', { type: 'button', class: 'icon push-right', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      h('form', { class: 'stack', onsubmit: event => { event.preventDefault(); input.blur(); if (input.value.trim() && input.reportValidity()) close(); } }, field(label, input)));
    input.focus();
  }
  function editUnits() {
    const picker = createUnitPriorityPicker(values.units, { onChange: units => {
      if (!units) { picker.reportValidity(); return; }
      values.units = units; displays.get('units').textContent = unitPrioritySummary(units); saveChanges({ units }, 0);
    } });
    const { close } = openDialog('edit units-sheet', h('div', { class: 'row' }, h('h3', {}, 'Unit priority'), h('button', { type: 'button', class: 'icon push-right', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      picker.element);
  }
  function editAppliance(index) {
    if (!loaded) return;
    const isNew = index === undefined;
    const current = isNew ? { name: '', details: '' } : appliances[index];
    const emojiPicker = createApplianceEmojiPicker(current);
    const name = h('input', { value: current.name, required: true, maxlength: 80, placeholder: 'e.g. Air fryer', oninput: (event) => emojiPicker.suggest(event.target.value) });
    const details = h('textarea', { rows: 4, value: current.details, placeholder: 'e.g. 4 L basket, max. 200°C' });
    const submitButton = h('button', { type: 'submit', class: 'primary' }, isNew ? 'Add appliance' : 'Save');
    const persist = async (button, next, message) => {
      const result = await withBusy(button, 'Saving…', () => api.updateProfile({ appliances: next }));
      if (!result) return;
      appliances = result.profile.appliances; renderAppliances(); guide.fill(result.profile); close(); toast(message);
    };
    const { close } = openDialog('edit appliance-sheet', h('div', { class: 'row' }, h('h3', {}, isNew ? 'Add appliance' : current.name), h('button', { type: 'button', class: 'icon push-right', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      h('form', { class: 'stack', onsubmit: (event) => { event.preventDefault(); const edited = { name: name.value.trim(), details: details.value.trim(), emoji: emojiPicker.value() }; persist(submitButton, isNew ? [...appliances, edited] : appliances.map((a, i) => i === index ? edited : a), isNew ? `${edited.name} added` : `${edited.name} saved`); } },
        h('div', { class: 'appliance-name-field' }, emojiPicker.element, field('Appliance name', name)),
        field('Capacity & limits', details, 'Sizes, max temperatures or anything a recipe should respect.'),
        h('div', { class: 'row' }, submitButton, isNew ? '' : h('button', { type: 'button', class: 'danger push-right', onclick: (event) => { if (confirm(`Remove ${current.name}?`)) persist(event.currentTarget, appliances.filter((_, i) => i !== index), `${current.name} removed`); } }, 'Remove'))));
    name.focus();
  }
  function fill(profile) {
    dirty = false; saveStatus.hidden = true; appliances = profile.appliances; renderAppliances();
    for (const key of Object.keys(values)) { values[key] = profile[key]; displays.get(key)?.replaceChildren(key === 'units' ? unitPrioritySummary(profile[key]) : profile[key]); }
    preferences.value = profile.preferences;
    loaded = true; form.hidden = false; loadState.hidden = true; resizePreferences();
    guide.fill(profile);
    form.hidden = guide.active();
    form.classList.toggle('setting-up', guide.active());
    root.classList.toggle('guided-setup', guide.active());
    servingsWheel.setValue(profile.servings);
  }
  function show() {
    if (dirty && loaded) return;
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
  /** Offered from the account menu; puts appliances, defaults and preferences back to the starting set. */
  async function restoreDefaults() {
    if (!confirm('Restart setup with the common appliances selected? This replaces your kitchen settings.')) return false;
    try {
      const { profile } = await api.resetProfile();
      fill(profile);
      toast('Scoop is ready to help you set up again');
      return true;
    } catch (error) {
      showError(error);
      return false;
    }
  }
  return { show, restoreDefaults };
}
