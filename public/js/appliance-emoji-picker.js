import { h, openDialog, showError } from './dom.js';
import { applianceEmoji, emoji, icon } from './ui.js';

const SUGGESTIONS = [
  ['🍳', 'Frying pan'], ['🍲', 'Cooking pot'], ['🧊', 'Ice cube'], ['🥤', 'Blender'],
  ['🫖', 'Teapot'], ['☕', 'Coffee'], ['🍨', 'Ice cream'], ['🔥', 'Fire'],
];

/** The form keeps a compact preview; selection happens in a familiar full emoji picker. */
export function createApplianceEmojiPicker(appliance) {
  let chosen = !!appliance.emoji;
  let selected = appliance.emoji || applianceEmoji(appliance.name);
  const preview = emoji(selected);
  const trigger = h('button', {
    type: 'button', class: 'appliance-emoji-trigger', 'aria-label': 'Change appliance emoji',
    title: 'Change emoji', 'aria-haspopup': 'dialog', 'aria-description': `Current emoji: ${selected}`, onclick: openPicker,
  }, preview, icon('edit'));

  function setEmoji(symbol) {
    selected = symbol;
    preview.textContent = symbol;
    trigger.setAttribute('aria-description', `Current emoji: ${symbol}`);
  }

  async function openPicker() {
    trigger.disabled = true;
    try {
      // Loaded only when needed; both code and data are hosted by this app.
      const { default: Picker } = await import('../vendor/emoji-picker-element/picker.js');
      const picker = new Picker({ dataSource: '/vendor/emoji-picker-element/emojis-en.json' });
      const pick = (symbol) => { chosen = true; setEmoji(symbol); close(); };
      const suggestions = h('div', { class: 'appliance-emoji-suggestions', role: 'group', 'aria-label': 'Kitchen emojis' },
        ...SUGGESTIONS.map(([symbol, label]) => h('button', {
          type: 'button', title: label, 'aria-label': `Choose ${label.toLowerCase()} emoji`,
          'aria-pressed': String(symbol === selected), onclick: () => pick(symbol),
        }, emoji(symbol))));
      const { close } = openDialog('appliance-emoji-sheet',
        h('div', { class: 'row' }, h('h3', {}, 'Choose emoji'),
          h('button', { type: 'button', class: 'icon push-right', 'aria-label': 'Back to appliance', onclick: () => close() }, icon('close'))),
        h('div', { class: 'appliance-emoji-quick' }, h('span', { class: 'muted' }, 'For your kitchen'), suggestions),
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
