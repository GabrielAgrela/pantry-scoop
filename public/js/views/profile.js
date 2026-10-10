import { api } from '../api.js';
import { h, openDialog, showError, withBusy } from '../dom.js';
import { applianceEmoji, emptyState, emoji, field, icon } from '../ui.js';
import { arrangeMosaic, tileSpan } from '../tile-layout.js';
import { createNumberWheel } from '../number-wheel.js';
import { createApplianceEmojiPicker } from '../appliance-emoji-picker.js';
import { createKitchenGuide } from '../kitchen-guide.js';
import { createUnitPriorityPicker } from '../unit-priority-picker.js';
import { unitPrioritySummary } from '../measurement-units.js';
import { createProfileAutosave } from '../profile-autosave.js';
import { LANGUAGES, languageName, languageOfText, locale, t } from '../i18n.js';
import { chooseLanguage } from '../language-picker.js';

export function createProfileView(root, { onSetupComplete = () => {} } = {}) {
  let dirty = false, loaded = false, loading, appliances = [];
  const values = { servings: 2, units: 'Metric', language: 'English' };
  // A supported language shows in its own name; older free-text languages show as written.
  const languageLabel = (text) => languageOfText(text) ? languageName(languageOfText(text)) : text;
  const displays = new Map();
  const saveNote = h('span', { role: 'status', 'aria-live': 'polite' });
  const saveRetry = h('button', { type: 'button', hidden: true, onclick: () => autosave.flush() }, t('Try again'));
  const saveStatus = h('div', { class: 'preference-status', hidden: true }, saveNote, saveRetry);
  const autosave = createProfileAutosave(changes => api.updateProfile(changes, { keepalive: true }), (status, error) => {
    dirty = status !== 'saved';
    saveStatus.hidden = false;
    saveRetry.hidden = status !== 'error';
    saveNote.textContent = status === 'saved' ? t('Changes saved') : status === 'error' ? t('Changes couldn’t be saved.') : t('Saving…');
    if (error) showError(error);
  });
  window.addEventListener('pagehide', () => { void autosave.flush(); });
  const appliancesList = h('div', { class: 'appliance-list' });
  // Tile heights follow the text, which reflows with the column width and once the font loads.
  let arrangeAppliances = () => {}, arrangedWidth = 0;
  if (window.ResizeObserver) new ResizeObserver(() => { if (appliancesList.clientWidth !== arrangedWidth) { arrangedWidth = appliancesList.clientWidth; arrangeAppliances(); } }).observe(appliancesList);
  document.fonts?.ready.then(() => arrangeAppliances());
  const applianceEmpty = emptyState('🥣', t('Make yourself at home'), t('Add the appliances you cook with.'));
  const preferences = h('textarea', { rows: 1, placeholder: t('e.g. Vegetarian, less sugar'), 'aria-label': t('Dietary preferences'), oninput: () => { saveChanges({ preferences: preferences.value }); resizePreferences(); }, onblur: () => { if (!guide.active()) void autosave.flush(); } });
  const loadMessage = h('p', { role: 'status' }, t('Loading your kitchen…'));
  const retry = h('button', { type: 'button', hidden: true, onclick: () => show() }, t('Try again'));
  const loadState = h('div', { class: 'kitchen-load-state card stack' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), loadMessage, retry);
  // Servings is turned in place; the text defaults open a small editor.
  const servingsWheel = createNumberWheel({ min: 1, max: 20, value: values.servings, label: t('Servings'), onChange: (value) => { values.servings = value; saveChanges({ servings: value }); } });
  const defaultRows = [h('div', { class: 'default-row servings-row' }, icon('recipes'), h('span', {}, t('Servings')), h('div', { class: 'wheel-field' }, servingsWheel.element)), ...[
    ['units', t('Unit priority'), 'scale'], ['language', t('Language'), 'globe'],
  ].map(([key, label, symbol]) => {
    const display = h('span', { class: 'default-value' }); displays.set(key, display);
    return h('button', { type: 'button', class: 'default-row', 'aria-label': t('Edit {setting}', { setting: label.toLocaleLowerCase(locale) }), onclick: () => editDefault(key, label) }, icon(symbol), h('span', {}, label), display, icon('chevron'));
   })];
  const form = h('form', { class: 'kitchen-form', hidden: true, onsubmit: event => event.preventDefault() },
      h('section', { class: 'kitchen-equipment' }, h('div', { class: 'section-heading' }, h('h2', {}, emoji('🍳', 'section-emoji'), t('Appliances')), h('button', { type: 'button', onclick: () => editAppliance() }, icon('plus'), t('Add'))), appliancesList, applianceEmpty),
      h('section', { class: 'kitchen-defaults' }, h('h2', {}, emoji('🥄', 'section-emoji'), t('Cooking defaults')), h('div', { class: 'defaults-list' }, ...defaultRows)),
      h('section', { class: 'kitchen-diet' }, h('h2', {}, emoji('🌿', 'section-emoji'), t('Dietary preferences')), h('div', { class: 'diet-input' }, icon('leaf'), preferences)),
      saveStatus);
  const guide = createKitchenGuide({
    sections: [...form.querySelectorAll('section')],
    addAppliance: () => editAppliance(),
    onAppliancesSaved: (profile) => { appliances = profile.appliances; renderAppliances(); },
    onSaved: fill,
    onComplete: onSetupComplete,
  });
  // What Scoop learned from feedback after cooking; it steers every new batch of ideas.
  const memoryList = h('ul', { class: 'memory-list' });
  const memoryEmpty = h('p', { class: 'memory-empty muted' }, t('Nothing yet. After cooking, tap '), h('b', {}, t('Feedback')), t(' on a recipe’s Method page and Scoop will suggest what to remember.'));
  const forgetAll = h('button', { type: 'button', class: 'text-button', hidden: true, onclick: forgetEverything }, t('Forget all'));
  const memorySection = h('section', { class: 'kitchen-memory', id: 'scoop-memory', hidden: true },
    h('div', { class: 'section-heading' }, h('h2', {}, emoji('🧠', 'section-emoji'), t('Scoop’s memory')), forgetAll),
    h('p', { class: 'memory-intro' }, t('Scoop uses these notes for every new batch of ideas.')),
    memoryList, memoryEmpty);
  root.append(h('div', { class: 'view-heading' }, h('div', {}, h('h1', {}, t('My kitchen'), ' ', emoji('🫖', 'heading-emoji')), h('p', { class: 'view-subtitle' }, t('Your tools, your tastes, your way.')))), loadState, guide.element, form, memorySection);

  function renderMemories(memories) {
    memoryList.replaceChildren(...memories.map((memory) => h('li', {},
      h('button', { type: 'button', class: 'memory-note', 'aria-label': t('Edit: {note}', { note: memory.note }), onclick: () => editMemory(memory) },
        h('span', {}, memory.note, memory.recipeTitle ? h('small', {}, t('From {recipe}', { recipe: memory.recipeTitle })) : ''), icon('edit', 'memory-edit')),
      h('button', { type: 'button', class: 'icon', 'aria-label': t('Forget: {note}', { note: memory.note }), title: t('Forget this'), onclick: (event) => forget(event.currentTarget, memory) }, icon('trash')))));
    memoryList.hidden = !memories.length;
    memoryEmpty.hidden = !!memories.length;
    forgetAll.hidden = !memories.length;
  }
  async function loadMemories() {
    try { renderMemories((await api.listMemories()).memories); } catch (error) { showError(error); }
  }
  /** The cook rewrites a note in their own words; Scoop uses the new wording from the next batch on. */
  function editMemory(memory) {
    const note = h('textarea', { rows: 4, value: memory.note, required: true, maxLength: 240 });
    const saveButton = h('button', { type: 'submit', class: 'primary' }, t('Save'));
    const { close } = openDialog('edit memory-sheet', h('div', { class: 'row' }, h('h3', {}, t('Edit memory')), h('button', { type: 'button', class: 'icon push-right', 'aria-label': t('Close'), onclick: () => close() }, icon('close'))),
      h('form', { class: 'stack', onsubmit: async (event) => {
        event.preventDefault();
        const text = note.value.trim();
        if (!text) { note.reportValidity(); return; }
        if (text === memory.note) { close(); return; }
        if (await withBusy(saveButton, t('Saving…'), () => api.editMemory(memory.id, text))) { close(); await loadMemories(); }
      } },
        field(t('What Scoop remembers'), note, memory.recipeTitle ? t('Learned from {recipe}. Used for every new batch of ideas.', { recipe: memory.recipeTitle }) : t('Used for every new batch of ideas.')),
        h('div', { class: 'row' }, saveButton, h('button', { type: 'button', class: 'danger push-right', onclick: async (event) => { if (await withBusy(event.currentTarget, '…', () => api.forgetMemory(memory.id).then(() => true))) { close(); await loadMemories(); } } }, t('Forget')))));
    note.focus(); note.setSelectionRange(note.value.length, note.value.length);
  }
  async function forget(button, memory) {
    if (await withBusy(button, '…', () => api.forgetMemory(memory.id).then(() => true))) await loadMemories();
  }
  async function forgetEverything() {
    if (!confirm(t('Forget everything Scoop learned from your feedback? New ideas will no longer use these notes.'))) return;
    if (await withBusy(forgetAll, t('Forgetting…'), () => api.forgetAllMemories().then(() => true))) renderMemories([]);
  }

  function resizePreferences() { preferences.style.height = 'auto'; preferences.style.height = `${Math.max(50, preferences.scrollHeight)}px`; }
  function saveChanges(changes, wait) { if (loaded && !guide.active()) autosave.change(changes, wait); }
  function renderAppliances() {
    appliancesList.hidden = !appliances.length;
    applianceEmpty.hidden = !!appliances.length;
    const spans = appliances.map((appliance) => tileSpan(appliance.name, appliance.details));
    const tiles = appliances.map((appliance, index) => h('button', { type: 'button', class: 'appliance', onclick: () => editAppliance(index), 'aria-label': t('Edit {name}', { name: appliance.name }) },
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
    if (key === 'language') return editLanguage();
    const input = h('input', { required: true, value: values[key], oninput: () => {
      if (!input.value.trim() || !input.checkValidity()) return;
      values[key] = input.value.trim(); displays.get(key).textContent = values[key]; saveChanges({ [key]: values[key] });
    }, onblur: () => { void autosave.flush(); } });
    const { close } = openDialog('edit', h('div', { class: 'row' }, h('h3', {}, label), h('button', { type: 'button', class: 'icon push-right', 'aria-label': t('Close'), onclick: () => close() }, icon('close'))),
      h('form', { class: 'stack', onsubmit: event => { event.preventDefault(); input.blur(); if (input.value.trim() && input.reportValidity()) close(); } }, field(label, input)));
    input.focus();
  }
  function editUnits() {
    const picker = createUnitPriorityPicker(values.units, { onChange: units => {
      if (!units) { picker.reportValidity(); return; }
      values.units = units; displays.get('units').textContent = unitPrioritySummary(units); saveChanges({ units }, 0);
    } });
    const { close } = openDialog('edit units-sheet', h('div', { class: 'row' }, h('h3', {}, t('Unit priority')), h('button', { type: 'button', class: 'icon push-right', 'aria-label': t('Close'), onclick: () => close() }, icon('close'))),
      picker.element);
  }
  /** One choice sets the app's language and the language Scoop writes recipes in. */
  function editLanguage() {
    const current = languageOfText(values.language);
    const { close } = openDialog('sort-sheet language-sheet', h('div', { class: 'row' }, h('h3', {}, t('Language')), h('button', { type: 'button', class: 'icon push-right', 'aria-label': t('Close'), onclick: () => close() }, icon('close'))),
      h('p', { class: 'muted' }, t('The app and Scoop’s recipes use this language.')),
      h('div', { class: 'pantry-sort-options', role: 'group', 'aria-label': t('Language') }, ...LANGUAGES.map((language) =>
        h('button', { type: 'button', lang: language.code, 'aria-pressed': String(current === language.code), onclick: async (event) => {
          if (current === language.code && locale === language.code) { close(); return; }
          await withBusy(event.currentTarget, t('Saving…'), async () => { await autosave.flush(); await chooseLanguage(language.code, { signedIn: true }); });
        } }, h('span', {}, language.name), icon('check')))));
  }
  function editAppliance(index) {
    if (!loaded) return;
    const isNew = index === undefined;
    const current = isNew ? { name: '', details: '' } : appliances[index];
    const emojiPicker = createApplianceEmojiPicker(current);
    const name = h('input', { value: current.name, required: true, maxlength: 80, placeholder: t('e.g. Air fryer'), oninput: (event) => emojiPicker.suggest(event.target.value) });
    const details = h('textarea', { rows: 4, value: current.details, placeholder: t('e.g. 4 L basket, max. 200°C') });
    const submitButton = h('button', { type: 'submit', class: 'primary' }, isNew ? t('Add appliance') : t('Save'));
    const persist = async (button, next) => {
      const result = await withBusy(button, t('Saving…'), () => api.updateProfile({ appliances: next }));
      if (!result) return;
      appliances = result.profile.appliances; renderAppliances(); guide.fill(result.profile); close();
    };
    const { close } = openDialog('edit appliance-sheet', h('div', { class: 'row' }, h('h3', {}, isNew ? t('Add appliance') : current.name), h('button', { type: 'button', class: 'icon push-right', 'aria-label': t('Close'), onclick: () => close() }, icon('close'))),
      h('form', { class: 'stack', onsubmit: (event) => { event.preventDefault(); const edited = { name: name.value.trim(), details: details.value.trim(), emoji: emojiPicker.value() }; persist(submitButton, isNew ? [...appliances, edited] : appliances.map((a, i) => i === index ? edited : a)); } },
        h('div', { class: 'appliance-name-field' }, emojiPicker.element, field(t('Appliance name'), name)),
        field(t('Capacity & limits'), details, t('Sizes, max temperatures or anything a recipe should respect.')),
        h('div', { class: 'row' }, submitButton, isNew ? '' : h('button', { type: 'button', class: 'danger push-right', onclick: (event) => { if (confirm(t('Remove {name}?', { name: current.name }))) persist(event.currentTarget, appliances.filter((_, i) => i !== index)); } }, t('Remove')))));
    name.focus();
  }
  function fill(profile, basics) {
    dirty = false; saveStatus.hidden = true; appliances = profile.appliances; renderAppliances();
    for (const key of Object.keys(values)) { values[key] = profile[key]; displays.get(key)?.replaceChildren(key === 'units' ? unitPrioritySummary(profile[key]) : key === 'language' ? languageLabel(profile[key]) : profile[key]); }
    preferences.value = profile.preferences;
    loaded = true; form.hidden = false; loadState.hidden = true; resizePreferences();
    guide.fill(profile, basics);
    form.hidden = guide.active();
    memorySection.hidden = guide.active();
    form.classList.toggle('setting-up', guide.active());
    root.classList.toggle('guided-setup', guide.active());
    servingsWheel.setValue(profile.servings);
  }
  function show() {
    if (dirty && loaded) return;
    if (loading) return loading;
    loadState.hidden = loaded; retry.hidden = true; loadState.querySelector('.spinner').hidden = false;
    loadMessage.setAttribute('role', 'status'); loadMessage.textContent = t('Loading your kitchen…');
    root.setAttribute('aria-busy', 'true');
    loading = (async () => {
      try {
        const { profile } = await api.getProfile();
        const basics = profile.setupComplete === false ? (await api.getPantryBasics()).basics : undefined;
        if (!dirty) fill(profile, basics);
        if (!guide.active()) await loadMemories();
      } catch (error) {
        if (error.code === 'auth-required') return;
        loadState.hidden = false; loadState.querySelector('.spinner').hidden = true; retry.hidden = false;
        loadMessage.setAttribute('role', 'alert'); loadMessage.textContent = t('Could not load your kitchen. {error}', { error: error.message });
      } finally { root.setAttribute('aria-busy', 'false'); loading = undefined; }
    })();
    return loading;
  }
  /** Offered from the account menu; puts appliances, defaults and preferences back to the starting set. */
  async function restoreDefaults() {
    if (!confirm(t('Restart setup with pantry basics to review and common appliances selected? This replaces your kitchen settings.'))) return false;
    try {
      const { profile } = await api.resetProfile();
      fill(profile, (await api.getPantryBasics()).basics);
      return true;
    } catch (error) {
      showError(error);
      return false;
    }
  }
  return { show, restoreDefaults };
}
