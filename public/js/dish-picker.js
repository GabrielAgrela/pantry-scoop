import { api } from './api.js';
import { h, openDialog, toast, withBusy } from './dom.js';
import { dishEmoji, emoji, field, icon } from './ui.js';

export const ANY_DISH = 'any';
export const dishLabel = (kind) => (kind === ANY_DISH ? 'Any dish' : kind);

/**
 * A field-like button that opens a sheet for choosing the dish type, and for adding,
 * renaming or removing the kitchen's dish types without leaving the recipe form.
 * `getDishTypes`/`setDishTypes` share the list with the view; `onChange` receives a name or 'any'.
 */
export function createDishPicker({ getValue, onChange, getDishTypes, setDishTypes }) {
  const label = h('span', { class: 'picker-value' });
  const trigger = h('button', { type: 'button', class: 'picker-trigger', 'aria-haspopup': 'dialog', onclick: open }, label, icon('chevron', 'picker-chevron'));
  const paint = () => {
    label.textContent = dishLabel(getValue());
    trigger.setAttribute('aria-label', `Dish: ${dishLabel(getValue())}. Change`);
  };
  paint();

  function open() {
    const heading = h('h3', {}, 'Dish type');
    const back = h('button', { type: 'button', class: 'icon sheet-back', 'aria-label': 'Back to dish types', hidden: true, onclick: () => showList() }, icon('back'));
    const body = h('div', { class: 'stack' });
    const { dialog, close } = openDialog('dish-sheet', h('div', { class: 'row' }, back, heading, h('button', { type: 'button', class: 'icon push-right', 'aria-label': 'Close', onclick: () => close() }, icon('close'))), body);
    showList();

    function choose(value) { onChange(value); paint(); close(); }

    function showList(focusName) {
      heading.textContent = 'Dish type'; back.hidden = true;
      const current = getValue();
      const row = (value, details, editable) => h('div', { class: 'dish-row' },
        h('button', { type: 'button', class: 'dish-option', 'aria-pressed': String(current === value), 'data-name': value, onclick: () => choose(value) },
          h('span', { class: 'dish-mark', 'aria-hidden': 'true' }, current === value ? icon('check') : ''),
          emoji(dishEmoji(value), 'dish-emoji'),
          h('span', { class: 'dish-copy' }, h('strong', {}, dishLabel(value)), details ? h('small', {}, details) : '')),
        editable ? h('button', { type: 'button', class: 'icon dish-edit', 'aria-label': `Edit ${value}`, onclick: () => showForm(value) }, icon('edit')) : '');
      const addButton = h('button', { type: 'button', class: 'add-row dish-add', onclick: () => showForm() }, icon('plus'), 'New dish type');
      body.replaceChildren(
        h('div', { class: 'dish-list' }, row(ANY_DISH, 'Whatever suits the pantry', false), ...getDishTypes().map((dish) => row(dish.name, dish.details, true))),
        addButton);
      const target = focusName === undefined ? body.querySelector('.dish-option[aria-pressed="true"]') : focusName === null ? addButton : [...body.querySelectorAll('.dish-option')].find((el) => el.dataset.name === focusName);
      (target ?? body.querySelector('.dish-option'))?.focus();
    }

    function showForm(originalName) {
      const isNew = originalName === undefined;
      const dishTypes = getDishTypes();
      const current = isNew ? { name: '', details: '' } : dishTypes.find((dish) => dish.name === originalName);
      heading.textContent = isNew ? 'New dish type' : `Edit ${current.name}`; back.hidden = false;
      const name = h('input', { value: current.name, required: true, maxlength: 80, placeholder: 'e.g. Soup', autocomplete: 'off' });
      const details = h('textarea', { rows: 3, value: current.details, maxlength: 500, placeholder: 'e.g. One pot, ready in 30 minutes' });
      const submitButton = h('button', { type: 'submit', class: 'primary' }, isNew ? 'Add dish type' : 'Save');
      const persist = async (button, next) => {
        const result = await withBusy(button, 'Saving…', () => api.updateProfile({ dishTypes: next }));
        if (result) setDishTypes(result.profile.dishTypes);
        return !!result;
      };
      const onSubmit = async (event) => {
        event.preventDefault();
        const edited = { name: name.value.trim(), details: details.value.trim() };
        if (!(await persist(submitButton, isNew ? [...dishTypes, edited] : dishTypes.map((dish) => (dish.name === originalName ? edited : dish))))) return;
        if (isNew) { toast(`${edited.name} added`); choose(edited.name); return; }
        if (getValue() === originalName) { onChange(edited.name); paint(); }
        showList(edited.name);
      };
      const remove = async (event) => {
        if (!confirm(`Remove ${current.name}?`)) return;
        if (!(await persist(event.currentTarget, dishTypes.filter((dish) => dish.name !== originalName)))) return;
        if (getValue() === originalName) { onChange(ANY_DISH); paint(); }
        toast(`${current.name} removed`);
        showList(null);
      };
      body.replaceChildren(h('form', { class: 'stack', onsubmit: onSubmit },
        field('Name', name),
        field('What it means', details, 'Optional. Helps the ideas match what you have in mind.'),
        h('div', { class: 'row' }, submitButton, isNew ? '' : h('button', { type: 'button', class: 'danger push-right', onclick: remove }, 'Remove'))));
      name.focus();
    }

    // Escape inside the form steps back to the list rather than closing everything.
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !back.hidden) { event.preventDefault(); event.stopPropagation(); showList(); }
    }, true);
  }

  return { element: trigger, refresh: paint };
}
