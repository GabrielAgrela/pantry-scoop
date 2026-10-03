import { api } from '../api.js';
import { h, openDialog, showError, toast, withBusy } from '../dom.js';
import { categoryLabel, SHELVES } from '../categories.js';
import { photoToDataUrl } from '../images.js';
import { latestJob, watchJob } from '../jobs.js';
import { loadScanPhotos, saveScanPhotos } from '../scan-photos.js';
import { load, save } from '../store.js';
import { field, icon } from '../ui.js';

const MAX_PHOTOS = 6;
export function createStockView(root) {
  let ingredients = [], categories = [], filter = '', categoryFilter = '', stockFilter = 'in', sortOrder = load('stock.sort', 'newest');
  let freshIds = new Set(), stopWatching = () => {};
  let reviewDialog, appendToJob;
  const collapsed = new Set(load('stock.shelves', []));
  const photos = new Map();
  const status = h('div', { class: 'status scan-status', role: 'status', hidden: true });
  const list = h('div', { class: 'stock-list' });
  const stats = h('p', { class: 'pantry-stats' });
  const stockedCount = h('span', { class: 'filter-count' });
  const restockCount = h('span', { class: 'filter-count' });
  const inStock = h('button', { class: 'status-filter', 'aria-pressed': 'true', onclick: () => { stockFilter = 'in'; render(); } }, 'In stock', stockedCount);
  const outStock = h('button', { class: 'status-filter', 'aria-pressed': 'false', onclick: () => { stockFilter = 'out'; render(); } }, 'To restock', restockCount);
  const categorySelect = h('select', { 'aria-label': 'Filter ingredients', onchange: () => {
    if (categorySelect.value === '__sort__') {
      categorySelect.value = categoryFilter;
      const sheet = openDialog('sort-sheet', h('h3', {}, 'Sort ingredients'), sort, h('button', { class: 'primary', onclick: () => sheet.close() }, 'Done'));
    } else { categoryFilter = categorySelect.value; render(); }
  } });
  const search = h('input', { type: 'search', placeholder: 'Search ingredients', 'aria-label': 'Search or add an ingredient', enterkeyhint: 'done', oninput: () => { filter = search.value.trim(); render(); }, onkeydown: (event) => {
    if (event.key === 'Enter' && filter && !exactMatch()) addManual(filter);
    if (event.key === 'Escape') { event.preventDefault(); setSearchOpen(false); searchToggle.focus(); }
  } });
  const searchToggle = h('button', { class: 'icon pantry-search-toggle', 'aria-label': 'Search pantry', 'aria-expanded': 'false', 'aria-controls': 'pantry-search', onclick: () => setSearchOpen(!root.classList.contains('search-open')) }, icon('search'));
  document.querySelector('.header-end').prepend(searchToggle);
  function setSearchOpen(open) {
    root.classList.toggle('search-open', open);
    searchToggle.setAttribute('aria-expanded', String(open));
    searchToggle.setAttribute('aria-label', open ? 'Close pantry search' : 'Search pantry');
    searchToggle.replaceChildren(icon(open ? 'close' : 'search'));
    if (open) search.focus();
    else { search.value = ''; filter = ''; render(); }
  }
  const cameraInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: onPhotos });
  const uploadInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: onPhotos });
  const scanButton = h('button', { class: 'primary', onclick: () => scanOptions() }, icon('camera'), 'Scan groceries');
  const addButton = h('button', { onclick: addIngredientDialog }, icon('plus'), 'Add');
  const sort = h('select', { 'aria-label': 'Sort ingredients', value: sortOrder, onchange: () => { sortOrder = sort.value; save('stock.sort', sortOrder); render(); } },
    h('option', { value: 'newest' }, 'Recently added'), h('option', { value: 'az' }, 'Name: A–Z'), h('option', { value: 'za' }, 'Name: Z–A'));
  const sortMenu = h('details', { class: 'sort-menu' }, h('summary', { 'aria-label': 'Sort pantry' }, icon('settings')), sort);
  root.append(
    h('div', { class: 'view-heading' }, h('div', {}, h('h1', {}, 'My pantry'), stats)),
    cameraInput, uploadInput, status,
    h('div', { class: 'inventory-toolbar' }, h('div', { class: 'search-bar', id: 'pantry-search' }, icon('search'), search),
      h('div', { class: 'pantry-filters', role: 'group', 'aria-label': 'Pantry filters' }, inStock, outStock, h('div', { class: 'category-filter' }, categorySelect))),
    h('div', { class: 'inventory-list-heading' }, h('span', { class: 'inventory-count visually-hidden', 'aria-live': 'polite' }), sortMenu),
    list,
    h('div', { class: 'pantry-actions action-dock' }, scanButton, addButton),
  );

  function scanOptions(source) {
    appendToJob = source;
    const { close } = openDialog('scan-source',
      h('div', { class: 'row' }, h('h3', {}, 'Scan groceries'), h('button', { class: 'icon push-right', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      h('p', { class: 'muted' }, 'Photograph your fridge, pantry or shopping bags.'),
      h('button', { class: 'primary', onclick: () => { close(); cameraInput.click(); } }, icon('camera'), 'Take a photo'),
      h('button', { onclick: () => { close(); uploadInput.click(); } }, icon('image'), 'Choose photos'),
      h('p', { class: 'muted' }, 'Up to 6 photos. Review the ingredients before adding them.'));
  }

  async function onPhotos(event) {
    const files = [...event.target.files];
    event.target.value = '';
    if (!files.length) return;
    const remaining = MAX_PHOTOS - (appendToJob?.request.photos ?? 0);
    if (files.length > remaining) { showError(new Error(`Choose up to ${remaining} more photo${remaining === 1 ? '' : 's'} for this scan.`)); return; }
    scanButton.disabled = true;
    showRunning(files.length);
    try {
      const images = await Promise.all(files.map(photoToDataUrl));
      const source = appendToJob;
      const { job } = source ? await api.appendScan(source.id, images) : await api.scan(images);
      appendToJob = undefined;
      const previews = source ? [...(photos.get(source.id) ?? await loadScanPhotos(source.id)), ...images].slice(0, MAX_PHOTOS) : images;
      photos.set(job.id, previews);
      if (source) save(`stock.review.${job.id}`, load(`stock.review.${source.id}`, {}));
      // Saving thumbnails is independent of the server's detection result.
      saveScanPhotos(job.id, previews).catch((error) => showError(new Error(`Photo previews could not be saved on this device: ${error.message}`)));
      follow(job);
    } catch (error) { status.hidden = true; showError(error); scanButton.disabled = false; }
  }

  function follow(job) {
    stopWatching();
    stopWatching = watchJob(job, (current) => {
      scanButton.disabled = current.status === 'running';
      if (current.status === 'running') return showRunning(current.request?.photos ?? 1);
      showOutcome(current);
      if (current.status === 'succeeded' && current.result.reviewRequired && !root.hidden) openReview(current);
    });
  }

  function showRunning(count) {
    status.replaceChildren(h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('span', {}, `Scanning ${count} photo${count === 1 ? '' : 's'}… You can leave this screen.`));
    status.hidden = false;
  }

  function showOutcome(job) {
    if (load('stock.dismissedJob', 0) >= job.id) { status.hidden = true; return; }
    const dismiss = h('button', { class: 'icon', 'aria-label': 'Dismiss scan notification', onclick: () => { save('stock.dismissedJob', job.id); status.hidden = true; } }, icon('close'));
    if (job.status === 'failed') status.replaceChildren(h('span', { class: 'problem' }, job.error.message), dismiss);
    else if (job.result.reviewRequired) {
      const count = job.result.added.length + job.result.restocked.length;
      status.replaceChildren(h('span', {}, `${count} ingredient${count === 1 ? '' : 's'} ready to review`), h('button', { onclick: () => openReview(job) }, 'Review scan'));
    } else {
      // Completed reviews already report success through a toast; don't reserve inventory space on later visits.
      status.hidden = true;
      return;
    }
    status.hidden = false;
  }

  async function openReview(job) {
    if (reviewDialog?.isConnected || !job.result.reviewRequired) return;
    const edits = load(`stock.review.${job.id}`, {});
    const pending = [...job.result.added, ...job.result.restocked].map((item) => ({ ...item, selected: true, ...edits[item.candidateId] }));
    const rows = h('div', { class: 'scan-review-groups' });
    const photoStrip = h('div', { class: 'scan-photos' });
    const confirmButton = h('button', { class: 'primary', onclick: async () => {
      const result = await withBusy(confirmButton, 'Adding…', () => api.confirmScan(job.id, pending.filter((item) => item.selected).map(({ selected, ...item }) => item)));
      if (!result) return;
      close();
      freshIds = new Set([...result.job.result.added, ...result.job.result.restocked].map((item) => item.id));
      stockFilter = 'in'; filter = ''; search.value = ''; categoryFilter = '';
      showOutcome(result.job);
      await refresh();
      toast('Your pantry is updated');
    } });
    const { dialog, close } = openDialog('scan-review',
      h('div', { class: 'review-header' }, h('button', { class: 'icon', 'aria-label': 'Back to pantry', onclick: () => close() }, icon('back')), h('h2', {}, 'Review scan')),
      h('div', { class: 'review-scroll' }, photoStrip,
        h('p', { class: 'photo-count' }, `${job.request.photos} photo${job.request.photos === 1 ? '' : 's'} · Scan complete`),
        h('div', { class: 'scan-overview' }, h('h3', {}, `${pending.length} ingredient${pending.length === 1 ? '' : 's'} found`), h('p', {}, 'Review before adding to your pantry.')),
        rows,
        h('details', { class: 'scan-existing' }, h('summary', {}, `Already in your pantry · ${job.result.alreadyInStock.length}`, icon('chevron')),
          ...job.result.alreadyInStock.map((item) => h('p', {}, item.name)))),
      h('div', { class: 'review-actions' }, confirmButton, h('button', { class: 'text-button', disabled: job.request.photos >= MAX_PHOTOS, onclick: () => { close(); scanOptions(job); } }, 'Add another photo')));
    reviewDialog = dialog;
    dialog.addEventListener('close', () => { reviewDialog = undefined; });
    renderReview();
    const localPhotos = photos.get(job.id);
    Promise.resolve(localPhotos ?? loadScanPhotos(job.id)).then((images) => {
      if (dialog.isConnected) photoStrip.replaceChildren(...images.map((src, index) => h('img', { src, alt: `Scanned photo ${index + 1}` })));
    }).catch((error) => showError(new Error(`Photo previews could not be loaded: ${error.message}`)));
    function updateCount() {
      const count = pending.filter((item) => item.selected).length;
      confirmButton.textContent = count ? `Add ${count} ingredient${count === 1 ? '' : 's'}` : 'Finish review';
      save(`stock.review.${job.id}`, Object.fromEntries(pending.map((item) => [item.candidateId, item])));
    }
    function renderReview() {
      rows.replaceChildren(...[['New ingredients', job.result.added], ['Back in stock', job.result.restocked]].filter(([, items]) => items.length).map(([label, originals]) => {
        const ids = new Set(originals.map((item) => item.candidateId));
        return h('details', { class: 'review-group', open: true }, h('summary', {}, label, h('span', { class: 'count' }, originals.length)),
          h('div', { class: 'review-items' }, ...pending.filter((item) => ids.has(item.candidateId)).map((item) => {
            const check = h('input', { type: 'checkbox', checked: item.selected, 'aria-label': `Add ${item.name}`, onchange: () => { item.selected = check.checked; updateCount(); } });
            return h('div', { class: 'review-item' }, h('label', { class: 'review-checkbox' }, check, h('span', {}, icon('check'))),
              h('div', { class: 'item-copy' }, h('strong', {}, item.name), h('small', {}, SHELVES.find((shelf) => shelf.categories.includes(item.category))?.label ?? categoryLabel(item.category))),
              h('button', { class: 'icon', 'aria-label': `Edit detected ${item.name}`, onclick: () => editDetected(item) }, icon('edit')));
          })));
      }));
      updateCount();
    }
    function editDetected(item) {
      const name = h('input', { required: true, maxlength: 80, value: item.name });
      const category = h('select', {}, ...categories.map((id) => h('option', { value: id, selected: id === item.category }, categoryLabel(id))));
      const notes = h('input', { value: item.notes, maxlength: 500 });
      const editSheet = openDialog('edit', h('div', { class: 'row' }, h('h3', {}, 'Edit ingredient'), h('button', { class: 'icon push-right', 'aria-label': 'Close', onclick: () => editSheet.close() }, icon('close'))),
        h('form', { class: 'stack', onsubmit: (event) => { event.preventDefault(); Object.assign(item, { name: name.value.trim(), category: category.value, notes: notes.value.trim() }); editSheet.close(); renderReview(); } }, field('Ingredient name', name), field('Category', category), field('Notes', notes), h('button', { class: 'primary' }, 'Save changes')));
      name.focus();
    }
  }

  function exactMatch() { return ingredients.some((item) => item.name.toLowerCase() === filter.toLowerCase()); }
  function render() {
    const stocked = ingredients.filter((item) => item.inStock);
    stats.textContent = `${stocked.length} in stock · ${ingredients.length - stocked.length} to restock`;
    stockedCount.textContent = stocked.length; restockCount.textContent = ingredients.length - stocked.length;
    inStock.setAttribute('aria-pressed', String(stockFilter === 'in')); outStock.setAttribute('aria-pressed', String(stockFilter === 'out'));
    const activeShelf = SHELVES.find((shelf) => shelf.id === categoryFilter);
    categorySelect.replaceChildren(h('option', { value: '' }, 'All categories'), ...SHELVES.filter((shelf) => ingredients.some((item) => shelf.categories.includes(item.category))).map((shelf) => h('option', { value: shelf.id }, shelf.label)), h('option', { value: '__sort__' }, 'Sort ingredients…'));
    categorySelect.value = categoryFilter;
    const key = filter.toLowerCase();
    const visible = ingredients.filter((item) => (!key || `${item.name} ${item.notes}`.toLowerCase().includes(key)) && (stockFilter === 'in' ? item.inStock : !item.inStock) && (!activeShelf || activeShelf.categories.includes(item.category)))
      .sort((a, b) => sortOrder === 'newest' ? b.id - a.id : a.name.localeCompare(b.name) * (sortOrder === 'za' ? -1 : 1));
    root.querySelector('.inventory-count').textContent = `${visible.length} ingredients`;
    list.replaceChildren(filter && !exactMatch() ? h('button', { class: 'add-row', onclick: (event) => withBusy(event.currentTarget, 'Adding…', () => addManual(filter)) }, icon('plus'), `Add “${filter}”`) : '',
      ...SHELVES.map((shelf) => [shelf, visible.filter((item) => shelf.categories.includes(item.category))]).filter(([, items]) => items.length).map(([shelf, items]) => section(shelf, items)),
      visible.length ? '' : h('div', { class: 'empty-state' }, h('h3', {}, filter || categoryFilter ? 'No matching ingredients' : stockFilter === 'out' ? 'Nothing to restock' : 'Your pantry is empty'), h('p', {}, filter || categoryFilter ? 'Try a different search or category.' : stockFilter === 'out' ? 'Mark ingredients as out of stock when you run out.' : 'Scan groceries or add an ingredient to get started.')));
  }
  function section(shelf, items) {
    const details = h('details', { class: 'category', open: !!filter || !!categoryFilter || !collapsed.has(shelf.id) }, h('summary', {}, h('span', {}, shelf.label)), h('div', { class: 'items' }, ...items.map(ingredientRow)));
    details.addEventListener('toggle', () => { if (filter || categoryFilter) return; details.open ? collapsed.delete(shelf.id) : collapsed.add(shelf.id); save('stock.shelves', [...collapsed]); });
    return details;
  }
  function ingredientRow(item) {
    const toggle = h('button', { class: 'stock-toggle', 'aria-pressed': String(item.inStock), 'aria-label': `${item.inStock ? 'Mark as out of stock' : 'Restock'}: ${item.name}`, onclick: async () => {
      const result = await withBusy(toggle, '…', () => api.updateIngredient(item.id, { inStock: !item.inStock }));
      if (!result) return;
      freshIds = item.inStock ? new Set() : new Set([item.id]);
      await refresh();
      toast(item.inStock ? `${item.name} moved to restock` : `${item.name} is back in stock`);
      (stockFilter === 'in' ? inStock : outStock).focus();
    } }, h('span', { class: 'stock-mark' }, icon(item.inStock ? 'check' : 'plus')));
    return h('div', { class: `item${freshIds.has(item.id) ? ' fresh' : ''}`, dataset: { ingredientId: item.id } }, toggle,
      h('button', { class: 'item-edit', onclick: () => edit(item), 'aria-label': `Edit ${item.name}` }, h('span', { class: 'item-copy' }, h('strong', {}, item.name), item.notes ? h('small', {}, item.notes) : ''), icon('edit', 'item-more')));
  }
  function addIngredientDialog() {
    const name = h('input', { required: true, maxlength: 80, placeholder: 'e.g. Cherry tomatoes', value: filter });
    const category = h('select', {}, ...categories.map((id) => h('option', { value: id, selected: id === 'other' }, categoryLabel(id))));
    const notes = h('input', { maxlength: 500, placeholder: 'Optional' });
    const button = h('button', { type: 'submit', class: 'primary' }, 'Add to my pantry');
    const { close } = openDialog('edit', h('div', { class: 'row' }, h('h3', {}, 'Add ingredient'), h('button', { class: 'icon push-right', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      h('form', { class: 'stack', onsubmit: async (event) => { event.preventDefault(); if (await withBusy(button, 'Adding…', () => addManual(name.value.trim(), { category: category.value, notes: notes.value }, false))) close(); } }, field('Ingredient name', name), h('details', { class: 'form-options' }, h('summary', {}, 'Category & notes'), field('Category', category), field('Notes', notes)), button));
    name.focus();
  }
  async function addManual(name, details = {}, focusSearch = true) {
    let created;
    try { created = await api.addIngredient({ name, ...details }); } catch (error) { showError(error); return false; }
    search.value = ''; filter = ''; categoryFilter = ''; stockFilter = 'in'; freshIds = new Set([created.ingredient.id]);
    await refresh(); if (focusSearch) search.focus(); return true;
  }
  function edit(item) {
    const name = h('input', { value: item.name, required: true, maxlength: 80, 'aria-label': 'Name' });
    const category = h('select', {}, ...categories.map((id) => h('option', { value: id, selected: id === item.category }, categoryLabel(id))));
    const notes = h('input', { value: item.notes, maxlength: 500 });
    const saveButton = h('button', { type: 'submit', class: 'primary' }, 'Save changes');
    const act = async (button, work) => { if (await withBusy(button, 'Saving…', work)) { close(); await refresh(); } };
    const toggle = h('button', { type: 'button', onclick: () => act(toggle, () => api.updateIngredient(item.id, { inStock: !item.inStock })) }, item.inStock ? 'Mark as out of stock' : 'Back in my pantry');
    const { close } = openDialog('edit', h('div', { class: 'row' }, h('h3', {}, item.name), h('button', { class: 'icon push-right', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      h('form', { class: 'stack', onsubmit: (event) => { event.preventDefault(); act(saveButton, () => api.updateIngredient(item.id, { name: name.value, category: category.value, notes: notes.value })); } }, field('Ingredient name', name), field('Category', category), field('Notes', notes), saveButton), toggle,
      h('button', { class: 'danger text-button', onclick: (event) => { if (confirm(`Delete ${item.name}?`)) act(event.currentTarget, () => api.deleteIngredient(item.id).then(() => true)); } }, 'Delete ingredient'));
  }
  async function refresh() {
    try { ({ ingredients, categories } = await api.listIngredients()); render(); } catch (error) { showError(error); }
  }
  async function show() {
    await refresh();
    try { const job = await latestJob('scan'); if (job) follow(job); } catch (error) { showError(error); }
  }
  return { show };
}
