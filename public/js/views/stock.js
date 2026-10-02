import { api } from '../api.js';
import { h, openDialog, showError, toast, withBusy } from '../dom.js';
import { categoryLabel } from '../categories.js';
import { photoToDataUrl } from '../images.js';
import { latestJob, watchJob } from '../jobs.js';
import { load, save } from '../store.js';

const MAX_PHOTOS = 6;
const OUT = '__out__';

export function createStockView(root) {
  let ingredients = [];
  let categories = [];
  let filter = '';
  let freshIds = new Set();
  let stopWatching = () => {};
  const collapsed = new Set(load('stock.collapsed', [OUT]));

  const status = h('div', { class: 'card status', hidden: true });
  const list = h('div', { class: 'stock-list' });
  const search = h('input', {
    type: 'search',
    placeholder: 'Search or add…',
    'aria-label': 'Search or add an ingredient',
    enterkeyhint: 'done',
    oninput: () => {
      filter = search.value.trim();
      render();
    },
    onkeydown: (event) => {
      if (event.key === 'Enter' && filter && !exactMatch()) addManual(filter);
    },
  });

  const photoInput = (attrs) =>
    h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', onchange: onPhotos, ...attrs });

  root.append(
    h('div', { class: 'scan-actions' },
      h('label', { class: 'button primary' }, '📷 Scan', photoInput({ capture: 'environment' })),
      h('label', { class: 'button' }, '🖼️ Photos', photoInput({ multiple: true })),
    ),
    status,
    h('div', { class: 'search-bar' }, search),
    list,
  );

  // ---- scanning (runs as a server job; survives reloads) ----

  async function onPhotos(event) {
    const files = [...event.target.files].slice(0, MAX_PHOTOS);
    event.target.value = '';
    if (files.length === 0) return;
    showRunning(files.length);
    try {
      const images = await Promise.all(files.map(photoToDataUrl));
      const { job } = await api.scan(images);
      follow(job);
    } catch (error) {
      status.hidden = true;
      showError(error);
    }
  }

  function follow(job) {
    stopWatching();
    stopWatching = watchJob(job, (current) => {
      if (current.status === 'running') return showRunning(current.request?.photos ?? 1);
      if (current.status === 'succeeded') {
        const { added, restocked } = current.result;
        freshIds = new Set([...added, ...restocked].map((i) => i.id));
        refresh();
      }
      showOutcome(current);
    });
  }

  function showRunning(photos) {
    status.replaceChildren(h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('span', {}, `Scanning ${photos} photo${photos > 1 ? 's' : ''}…`));
    status.hidden = false;
  }

  function showOutcome(job) {
    if (load('stock.dismissedJob', 0) >= job.id) {
      status.hidden = true;
      return;
    }
    const dismiss = h('button', { class: 'icon', 'aria-label': 'Dismiss', onclick: () => {
      save('stock.dismissedJob', job.id);
      status.hidden = true;
    } }, '✕');
    let body;
    if (job.status === 'failed') {
      body = h('span', { class: 'problem' }, job.error.message);
    } else {
      const { added, restocked, alreadyInStock } = job.result;
      const names = (items) => items.map((i) => i.name).join(', ');
      body = h('div', { class: 'stack tight' },
        added.length ? h('span', {}, h('strong', {}, 'Added '), names(added)) : '',
        restocked.length ? h('span', {}, h('strong', {}, 'Back '), names(restocked)) : '',
        added.length + restocked.length === 0 ? h('span', {}, 'Nothing new') : '',
        alreadyInStock.length ? h('span', { class: 'muted' }, `Had: ${names(alreadyInStock)}`) : '',
      );
    }
    status.replaceChildren(body, dismiss);
    status.hidden = false;
  }

  // ---- list ----

  function exactMatch() {
    const key = filter.toLowerCase();
    return ingredients.some((i) => i.name.toLowerCase() === key);
  }

  function render() {
    const key = filter.toLowerCase();
    const visible = ingredients.filter((i) => !key || i.name.toLowerCase().includes(key) || i.notes.toLowerCase().includes(key));
    const groups = categories
      .map((category) => [category, visible.filter((i) => i.inStock && i.category === category)])
      .filter(([, items]) => items.length > 0);
    const out = visible.filter((i) => !i.inStock);

    list.replaceChildren(
      filter && !exactMatch()
        ? h('button', { class: 'add-row', onclick: () => addManual(filter) }, '＋ Add “', filter, '”')
        : '',
      ...groups.map(([category, items]) => section(category, categoryLabel(category), items)),
      out.length ? section(OUT, 'Out of stock', out) : '',
      visible.length === 0 && !filter ? h('p', { class: 'empty' }, 'Scan your fridge or pantry to start.') : '',
    );
  }

  function section(id, title, items) {
    // While searching, show every match regardless of collapsed sections.
    const open = filter !== '' || !collapsed.has(id);
    const details = h('details', { class: `category${id === OUT ? ' out' : ''}`, open },
      h('summary', {}, h('span', {}, title), h('span', { class: 'count' }, items.length)),
      h('div', { class: 'items' }, ...items.map(chip)),
    );
    details.addEventListener('toggle', () => {
      if (filter) return;
      details.open ? collapsed.delete(id) : collapsed.add(id);
      save('stock.collapsed', [...collapsed]);
    });
    return details;
  }

  function chip(item) {
    const classes = ['item', freshIds.has(item.id) && 'fresh', item.notes && 'has-notes'].filter(Boolean).join(' ');
    return h('button', { class: classes, onclick: () => edit(item) }, item.name);
  }

  async function addManual(name) {
    let created;
    try {
      created = await api.addIngredient({ name });
    } catch (error) {
      showError(error);
      return;
    }
    search.value = '';
    filter = '';
    freshIds = new Set([created.ingredient.id]);
    if (created.status === 'restocked') toast(`${created.ingredient.name} is back`);
    await refresh();
    search.focus();
  }

  /** One sheet per item: the common action (ran out / got it) first, then details. */
  function edit(item) {
    const name = h('input', { value: item.name, 'aria-label': 'Name' });
    const category = h('select', { 'aria-label': 'Category' },
      ...categories.map((c) => h('option', { value: c, selected: c === item.category }, categoryLabel(c))));
    const notes = h('input', { value: item.notes, placeholder: 'Notes', 'aria-label': 'Notes' });
    const saveButton = h('button', { type: 'submit' }, 'Save');

    const act = async (button, work) => {
      const ok = await withBusy(button, '…', work);
      if (!ok) return;
      close();
      await refresh();
    };
    const toggle = h('button', { type: 'button', class: 'primary', onclick: () =>
      act(toggle, async () => {
        await api.updateIngredient(item.id, { inStock: !item.inStock });
        freshIds = item.inStock ? new Set() : new Set([item.id]);
        return true;
      }) }, item.inStock ? 'Ran out' : 'Got it');

    const { close } = openDialog('edit',
      h('div', { class: 'row' }, h('h3', {}, item.name), h('button', { type: 'button', class: 'icon push-right', 'aria-label': 'Close', onclick: () => close() }, '✕')),
      toggle,
      h('form', { class: 'stack', onsubmit: (event) => {
        event.preventDefault();
        act(saveButton, () => api.updateIngredient(item.id, { name: name.value, category: category.value, notes: notes.value }));
      } },
        name, category, notes,
        h('div', { class: 'row' },
          saveButton,
          h('button', { type: 'button', class: 'danger push-right', onclick: (e) => {
            if (!confirm(`Delete ${item.name}?`)) return;
            act(e.currentTarget, () => api.deleteIngredient(item.id).then(() => true));
          } }, 'Delete'),
        ),
      ),
    );
  }

  async function refresh() {
    try {
      ({ ingredients, categories } = await api.listIngredients());
      render();
    } catch (error) {
      showError(error);
    }
  }

  async function show() {
    await refresh();
    try {
      const job = await latestJob('scan');
      if (job) follow(job);
    } catch {
      // no scan history yet
    }
  }

  return { show };
}
