import { h, openDialog, showError } from './dom.js';
import { applianceEmoji, emoji, icon } from './ui.js';
import { locale, t } from './i18n.js';

const SUGGESTIONS = [
  ['🍳', t('Frying pan')], ['🍲', t('Cooking pot')], ['🧊', t('Ice cube')], ['🥤', t('Blender')],
  ['🫖', t('Teapot')], ['☕', t('Coffee')], ['🍨', t('Ice cream')], ['🔥', t('Fire')],
];

/** The form keeps a compact preview; selection happens in a familiar full emoji picker. */
export function createApplianceEmojiPicker(appliance) {
  let chosen = !!appliance.emoji;
  let selected = appliance.emoji || applianceEmoji(appliance.name);
  const preview = emoji(selected);
  const trigger = h('button', {
    type: 'button', class: 'appliance-emoji-trigger', 'aria-label': t('Change appliance emoji'),
    title: t('Change emoji'), 'aria-haspopup': 'dialog', 'aria-description': t('Current emoji: {emoji}', { emoji: selected }), onclick: openPicker,
  }, preview, icon('edit'));

  function setEmoji(symbol) {
    selected = symbol;
    preview.textContent = symbol;
    trigger.setAttribute('aria-description', t('Current emoji: {emoji}', { emoji: symbol }));
  }

  async function openPicker() {
    trigger.disabled = true;
    try {
      // Loaded only when needed; both code and data are hosted by this app.
      const { default: Picker } = await import('../vendor/emoji-picker-element/picker.js');
      // Search words and the picker's own labels follow the interface language.
      const i18n = locale === 'en' ? undefined : (await import(`../vendor/emoji-picker-element/i18n-${locale}.js`)).default;
      const picker = new Picker({ locale, i18n, dataSource: `/vendor/emoji-picker-element/emojis-${locale}.json` });
      const pick = (symbol) => { chosen = true; setEmoji(symbol); close(); };
      const suggestions = h('div', { class: 'appliance-emoji-suggestions', role: 'group', 'aria-label': t('Kitchen emojis') },
        ...SUGGESTIONS.map(([symbol, label]) => h('button', {
          type: 'button', title: label, 'aria-label': t('Choose emoji: {name}', { name: label }),
          'aria-pressed': String(symbol === selected), onclick: () => pick(symbol),
        }, emoji(symbol))));
      const { close } = openDialog('appliance-emoji-sheet',
        h('div', { class: 'row' }, h('h3', {}, t('Choose emoji')),
          h('button', { type: 'button', class: 'icon push-right', 'aria-label': t('Back to appliance'), onclick: () => close() }, icon('close'))),
        h('div', { class: 'appliance-emoji-quick' }, h('span', { class: 'muted' }, t('For your kitchen')), suggestions),
        picker);
      picker.addEventListener('emoji-click', (event) => pick(event.detail.unicode));
    } catch (error) { showError(error); }
    finally { trigger.disabled = false; }
  }

  return {
    element: trigger,
    value: () => selected,
    suggest: (name) => { if (!chosen) setEmoji(applianceEmoji(name)); },
  };
}
