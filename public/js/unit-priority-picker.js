import { h } from './dom.js';
import { icon } from './ui.js';
import { MEASUREMENT_UNITS, parseUnitPriorities, serializeUnitPriorities, unitOption } from './measurement-units.js';

/** Select several measurement systems, in the order recipes should prefer them. */
export function createUnitPriorityPicker(initialValue, { onChange = () => {} } = {}) {
  let values = parseUnitPriorities(initialValue);
  const list = h('ol', { class: 'unit-priority-list', 'aria-label': 'Unit priority, first choice at the top' });
  const additions = h('div', { class: 'unit-additions', 'aria-label': 'Add units' });
  const problem = h('p', { class: 'problem', role: 'alert', hidden: true }, 'Choose at least one kind of unit.');
  const customInput = h('input', { maxlength: 1800, placeholder: 'e.g. weighed grams only', 'aria-label': 'Custom units', onkeydown: event => { if (event.key === 'Enter') { event.preventDefault(); addCustom(); } } });
  const custom = h('div', { class: 'unit-custom', hidden: true }, customInput, h('button', { type: 'button', onclick: addCustom }, 'Add'));
  const element = h('div', { class: 'unit-priority-picker', role: 'group', 'aria-label': 'Preferred units' },
    h('p', { class: 'unit-priority-hint' }, 'First choice at the top. Use the arrows to reorder.'), list, additions, custom, problem);
  function change(next, focus) {
    values = next; problem.hidden = true; render(focus); onChange(serializeUnitPriorities(values));
  }
  function addCustom() {
    const value = customInput.value.trim();
    if (!value) { customInput.focus(); return; }
    if (!values.includes(value)) change([...values, value], value);
    customInput.value = ''; custom.hidden = true;
  }
  function render(focus) {
    list.replaceChildren(...values.map((value, index) => {
      const option = unitOption(value);
      const move = direction => {
        const next = [...values]; [next[index], next[index + direction]] = [next[index + direction], next[index]];
        change(next, value);
      };
      return h('li', { class: 'unit-priority-row', tabindex: -1, dataset: { value } },
        h('span', { class: 'unit-rank', 'aria-label': `Priority ${index + 1}` }, String(index + 1)),
        h('span', { class: 'unit-copy' }, h('strong', {}, option.label), h('small', {}, option.detail)),
        h('div', { class: 'unit-moves' },
          h('button', { type: 'button', class: 'icon unit-up', disabled: index === 0, 'aria-label': `Move ${option.label} up`, onclick: () => move(-1) }, icon('arrow')),
          h('button', { type: 'button', class: 'icon unit-down', disabled: index === values.length - 1, 'aria-label': `Move ${option.label} down`, onclick: () => move(1) }, icon('arrow')),
          h('button', { type: 'button', class: 'icon', 'aria-label': `Remove ${option.label}`, onclick: () => change(values.filter(item => item !== value), values[index + 1] ?? values[index - 1]) }, icon('close'))));
    }));
    additions.replaceChildren(...MEASUREMENT_UNITS.filter(option => !values.includes(option.value)).map(option =>
      h('button', { type: 'button', onclick: () => change([...values, option.value], option.value) }, icon('plus'), option.label)),
      h('button', { type: 'button', onclick: () => { custom.hidden = !custom.hidden; if (!custom.hidden) customInput.focus(); } }, icon('plus'), 'Custom'));
    if (focus) [...list.children].find(row => row.dataset.value === focus)?.focus({ preventScroll: true });
  }
  render();
  return {
    element,
    value: () => serializeUnitPriorities(values),
    setValue(value) { values = parseUnitPriorities(value); custom.hidden = true; problem.hidden = true; render(); },
    reportValidity() { problem.hidden = !!values.length; if (!values.length) additions.querySelector('button')?.focus(); return !!values.length; },
  };
}
