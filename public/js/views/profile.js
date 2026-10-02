import { api } from '../api.js';
import { h, showError, toast, withBusy } from '../dom.js';

/** Simple text fields: drives both rendering and reading the form back (one list, no drift). */
const TEXT_FIELDS = [
  { key: 'units', label: 'Units' },
  { key: 'language', label: 'Language' },
  { key: 'preferences', label: 'Preferences & diet', multiline: true },
];

export function createProfileView(root) {
  const appliancesList = h('div', { class: 'stack' });
  const servings = h('input', { type: 'number', min: 1, max: 20, required: true });
  const textInputs = new Map(
    TEXT_FIELDS.map((f) => [f.key, f.multiline ? h('textarea', { rows: 6 }) : h('input', { type: 'text' })]),
  );

  const save = h('button', { type: 'submit', class: 'primary' }, 'Save');
  const reset = h('button', { type: 'button', onclick: async () => {
    if (!confirm('Reset kitchen settings to the defaults?')) return;
    const result = await withBusy(reset, 'Resetting…', () => api.resetProfile());
    if (result) fill(result.profile);
  } }, 'Reset defaults');

  root.append(
    h('form', { class: 'card stack', onsubmit: onSave },
      h('h2', {}, 'Appliances'),
      appliancesList,
      h('button', { type: 'button', onclick: () => appliancesList.append(applianceRow({ name: '', details: '' }, true)) }, '＋ Add appliance'),
      h('h2', {}, 'Defaults'),
      h('label', {}, 'Servings (people)', servings),
      ...TEXT_FIELDS.map((f) => h('label', {}, f.label, textInputs.get(f.key))),
      h('div', { class: 'row' }, save, reset),
    ),
  );

  function applianceRow(appliance, focus = false) {
    const name = h('input', { name: 'name', value: appliance.name, placeholder: 'e.g. Air fryer', 'aria-label': 'Appliance name', required: true });
    const details = h('textarea', { name: 'details', rows: 2, value: appliance.details, placeholder: 'Details (optional)', 'aria-label': 'Appliance details' });
    const row = h('div', { class: 'appliance' },
      h('div', { class: 'row' }, name,
        h('button', { type: 'button', class: 'icon danger', 'aria-label': 'Remove appliance', onclick: () => row.remove() }, '✕')),
      details,
    );
    if (focus) queueMicrotask(() => name.focus());
    return row;
  }

  async function onSave(event) {
    event.preventDefault();
    const profile = {
      appliances: [...appliancesList.children].map((row) => ({
        name: row.querySelector('[name=name]').value,
        details: row.querySelector('[name=details]').value,
      })),
      servings: Number(servings.value),
      ...Object.fromEntries([...textInputs].map(([key, input]) => [key, input.value])),
    };
    const result = await withBusy(save, 'Saving…', () => api.updateProfile(profile));
    if (result) {
      fill(result.profile);
      toast('Kitchen settings saved');
    }
  }

  function fill(profile) {
    appliancesList.replaceChildren(...profile.appliances.map((a) => applianceRow(a)));
    servings.value = profile.servings;
    for (const [key, input] of textInputs) input.value = profile[key];
  }

  async function show() {
    try {
      fill((await api.getProfile()).profile);
    } catch (error) {
      showError(error);
    }
  }

  return { show };
}
