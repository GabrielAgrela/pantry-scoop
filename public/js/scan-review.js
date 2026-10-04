import { h, openDialog } from './dom.js';
import { categoryLabel, SHELF_EMOJIS, shelvesFor } from './categories.js';
import { emoji, field, icon } from './ui.js';

/** Local review edits stay drafts until the scan's single confirmation. */
export function scanReviewList({ pending, ingredients, categories, automaticList, onChange }) {
  const list = h('ul', { class: 'review-list', 'aria-label': 'Ingredients to review' });
  const calm = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const symbol = (item) => item.emoji || SHELF_EMOJIS[shelvesFor(categories).find((shelf) => shelf.categories.includes(item.category))?.id] || '🫙';
  const nodes = new Map();
  const effects = new Map();
  const selected = (item) => item.selected && !item.deleted;
  const matched = (item) => item.duplicateIngredientId !== undefined || item.duplicateCandidateId !== undefined;
  const targetOf = (item) => item.duplicateIngredientId !== undefined
    ? ingredients.find((target) => target.id === item.duplicateIngredientId)
    : pending.find((target) => target.candidateId === item.duplicateCandidateId);
  function clearMatch(item) { delete item.duplicateIngredientId; delete item.duplicateCandidateId; }
  function detachDependents(item) {
    for (const other of pending) if (other.duplicateCandidateId === item.candidateId) clearMatch(other);
  }
  function focusAction(item, action = 'edit') {
    list.querySelector(`[data-candidate-id="${item.candidateId}"] [data-action="${action}"]`)?.focus({ preventScroll: true });
  }
  function changed(item, effect) {
    if (effect) effects.set(item.candidateId, effect);
    render(); onChange();
  }
  function render() {
    for (const item of pending) {
      const target = targetOf(item);
      if (matched(item) && (!target || (item.duplicateCandidateId !== undefined && (!selected(target) || matched(target))))) clearMatch(item);
      const signature = JSON.stringify([item, target?.name, target?.inStock]);
      let cached = nodes.get(item.candidateId);
      if (!cached || cached.signature !== signature) {
        const row = buildRow(item);
        if (cached) cached.row.replaceWith(row);
        cached = { row, signature }; nodes.set(item.candidateId, cached);
      }
      const parent = item.automaticDuplicate ? automaticList : list;
      if (cached.row.parentElement !== parent) {
        // Moving back from the duplicates returns a row to its original place, not the end.
        const later = pending.slice(pending.indexOf(item) + 1).map((other) => nodes.get(other.candidateId)?.row);
        parent.insertBefore(cached.row, later.find((row) => row?.parentElement === parent) ?? null);
      }
      const effect = effects.get(item.candidateId);
      if (effect) {
        effects.delete(item.candidateId);
        if (!calm?.matches) {
          cached.row.classList.add(`review-${effect}`);
          const finish = (event) => {
            if (event.target !== cached.row && !(effect === 'joined' && event.target.classList.contains('duplicate-badge'))) return;
            cached.row.classList.remove(`review-${effect}`);
            cached.row.removeEventListener('animationend', finish);
          };
          cached.row.addEventListener('animationend', finish);
        }
      }
    }
  }
  function buildRow(item) {
    if (item.automaticDuplicate) return h('li', { class: 'automatic-match', dataset: { candidateId: item.candidateId } },
      h('div', { class: 'automatic-match-copy' },
        h('span', { class: 'match-twins', 'aria-hidden': 'true' }, emoji(symbol(item), 'match-twin-photo'), emoji(symbol(item), 'match-twin-pantry'), h('span', { class: 'match-question' }, '?')),
        h('span', { class: 'match-name' }, h('small', {}, item.markedDuplicate ? 'Marked as duplicate' : 'Detected match'), h('strong', {}, item.name))),
      item.markedDuplicate
        ? h('button', { type: 'button', class: 'automatic-unmatch', 'aria-label': `Not duplicate: add ${item.name} again`, onclick: () => {
            Object.assign(item, { automaticDuplicate: false, markedDuplicate: false, selected: true }); changed(item, 'restored'); focusAction(item, 'duplicate');
          } }, icon('unlink'), 'Not duplicate')
        : h('button', { type: 'button', class: 'automatic-unmatch', 'aria-label': `Not duplicate: edit name of ${item.name}`, onclick: () => edit(item, true) }, icon('unlink'), 'Not duplicate'));
    const row = h('li', { class: `review-list-item${item.deleted ? ' removed' : ''}${selected(item) ? '' : ' skipped'}${matched(item) ? ' matched' : ''}`, dataset: { candidateId: item.candidateId } });
    if (item.deleted) {
      row.append(h('span', { class: 'removed-copy' }, `${item.name} removed`),
        h('button', { type: 'button', class: 'text-button', dataset: { action: 'undo' }, 'aria-label': `Undo removal of ${item.name}`, onclick: () => {
          item.deleted = false; changed(item, 'restored'); focusAction(item);
        } }, icon('back'), 'Undo'));
      return row;
    }
    const check = h('input', { type: 'checkbox', checked: selected(item), 'aria-label': `Include ${item.name}`, onchange: () => {
      item.selected = check.checked;
      if (!item.selected) detachDependents(item);
      row.classList.toggle('skipped', !item.selected);
      nodes.get(item.candidateId).signature = JSON.stringify([item, targetOf(item)?.name, targetOf(item)?.inStock]);
      if (item.selected && !calm?.matches) {
        row.classList.remove('review-selected'); void row.offsetWidth; row.classList.add('review-selected');
        row.addEventListener('animationend', () => row.classList.remove('review-selected'), { once: true });
      }
      render(); onChange();
    } });
    const target = matched(item) ? targetOf(item) : undefined;
    const copy = h('div', { class: 'item-copy' }, h('strong', {}, item.name),
      h('small', {}, categoryLabel(item.category)), item.notes ? h('small', { class: 'review-notes' }, item.notes) : null);
    row.append(h('div', { class: 'review-item-main' },
      h('label', { class: 'review-checkbox' }, check, h('span', {}, icon('check'))),
      emoji(symbol(item), 'review-food-emoji'), copy));
    if (item.separate && !matched(item)) row.append(h('div', { class: 'separate-badge' }, icon('spark'), 'Separate ingredient'));
    if (target) row.append(h('div', { class: 'duplicate-badge' }, icon('link'),
      h('span', {}, `Same as ${target.name}`, h('small', {}, item.duplicateIngredientId !== undefined ? target.inStock ? 'Already in your pantry' : 'Will be restocked' : 'Added once from this scan')),
      h('button', { type: 'button', class: 'icon', 'aria-label': `Unmark duplicate ${item.name}`, onclick: () => { clearMatch(item); changed(item, 'restored'); focusAction(item, 'duplicate'); } }, icon('close'))));
    row.append(h('div', { class: 'review-row-actions', role: 'group', 'aria-label': `Actions for ${item.name}` },
      h('button', { type: 'button', dataset: { action: 'edit' }, 'aria-label': `Edit detected ${item.name}`, onclick: () => edit(item) }, icon('edit'), 'Edit'),
      // A duplicate is simply not added: it joins the possible duplicates, where it can be undone.
      h('button', { type: 'button', dataset: { action: 'duplicate' }, 'aria-label': `Mark ${item.name} as duplicate`, onclick: async () => {
        if (row.classList.contains('review-to-duplicates')) return;
        if (!calm?.matches) {
          row.classList.add('review-to-duplicates');
          await Promise.allSettled(row.getAnimations().map((animation) => animation.finished));
        }
        detachDependents(item); clearMatch(item);
        Object.assign(item, { automaticDuplicate: true, markedDuplicate: true, selected: false });
        changed(item, 'marked');
      } }, icon('link'), 'Mark duplicate'),
      h('button', { type: 'button', class: 'review-delete', 'aria-label': `Delete detected ${item.name}`, onclick: async () => {
        if (row.classList.contains('review-removing')) return;
        item.deleted = true; detachDependents(item); onChange();
        if (!calm?.matches) {
          row.classList.add('review-removing');
          await Promise.allSettled(row.getAnimations().map((animation) => animation.finished));
        }
        render(); focusAction(item, 'undo');
      } }, icon('trash'), 'Delete')));
    return row;
  }
  function edit(item, separate = false) {
    const name = h('input', { required: true, maxlength: 80, value: item.name, 'aria-label': 'Ingredient name' });
    const category = h('select', {}, ...categories.map((id) => h('option', { value: id, selected: id === item.category }, categoryLabel(id))));
    const notes = h('input', { value: item.notes, maxlength: 500 });
    const nameField = field('Ingredient name', name);
    if (separate) {
      nameField.classList.add('rename-field');
      nameField.querySelector('span').prepend(icon('edit', 'rename-pencil'));
    }
    const { close } = openDialog(`edit review-edit-sheet${separate ? ' separate-ingredient-sheet' : ''}`,
      h('div', { class: 'row' }, h('h3', {}, separate ? 'Not a duplicate' : 'Edit ingredient'), h('button', { type: 'button', class: 'icon push-right', 'aria-label': 'Close ingredient editor', onclick: () => close() }, icon('close'))),
      separate ? h('p', { class: 'muted' }, 'Give this ingredient its own name. It will be added separately.') : null,
      h('form', { class: 'stack', onsubmit: (event) => {
        event.preventDefault(); const value = name.value.trim();
        if (!value) { name.setCustomValidity('Enter an ingredient name.'); name.reportValidity(); return; }
        const keyOf = (value) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
        if ((separate || item.separate) && !matched(item) && (ingredients.some((other) => keyOf(other.name) === keyOf(value)) || pending.some((other) => other !== item && selected(other) && !matched(other) && keyOf(other.name) === keyOf(value)))) {
          name.setCustomValidity('Use a distinct name for this ingredient.'); name.reportValidity(); return;
        }
        Object.assign(item, { name: value, category: category.value, notes: notes.value.trim() });
        if (separate) { clearMatch(item); item.automaticDuplicate = false; item.separate = true; item.selected = true; item.deleted = false; }
        close(); changed(item, separate ? 'separated' : 'edited'); focusAction(item);
        if (separate) nodes.get(item.candidateId)?.row.scrollIntoView({ block: 'nearest', behavior: calm?.matches ? 'instant' : 'smooth' });
      } }, nameField, field('Category', category), field('Notes', notes), h('button', { type: 'submit', class: 'primary' }, icon('check'), separate ? 'Keep as separate ingredient' : 'Save changes')));
    name.addEventListener('input', () => name.setCustomValidity('')); name.focus(); if (separate) name.select();
  }
  render();
  return list;
}
