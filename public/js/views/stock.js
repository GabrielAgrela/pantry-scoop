import { api } from '../api.js';
import { scanReviewList } from '../scan-review.js';
import { h, openDialog, showError, toast, withBusy } from '../dom.js';
import { categoryLabel, SHELVES, SHELF_EMOJIS, shelvesFor } from '../categories.js';
import { photoToDataUrl } from '../images.js';
import { platform } from '../platform.js';
import { smoothDetails } from '../smooth-details.js';
import { hideReady, showReady } from '../ready-notice.js';
import { latestJob, watchJob } from '../jobs.js';
import { loadScanPhotos, saveScanPhotos } from '../scan-photos.js';
import { load, save } from '../store.js';
import { emptyState, emoji, field, icon, pantryFriend } from '../ui.js';

const MAX_PHOTOS = 6;
const SORT_OPTIONS = [
  ['', 'Grouped by category'],
  ['newest', 'Date added: newest first'],
  ['oldest', 'Date added: oldest first'],
  ['az', 'Name: A–Z'],
  ['za', 'Name: Z–A'],
];
const nameOrder = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
export function createStockView(root) {
  let ingredients = [], categories = [], filter = '', categoryFilter = '', stockFilter = 'all', sortOrder = '';
  let freshIds = new Set(), stopWatching = () => {};
  let reviewDialog, appendToJob, watchedJobId, classifying = false;
  let shelves = SHELVES;
  const collapsed = new Set(load('stock.shelves', []));
  // One-shot shelf animations for the row a stock toggle just rebuilt: 'restocked' or 'emptied'.
  const motion = new Map();
  const calm = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const photos = new Map();
  const status = h('div', { class: 'status scan-status', role: 'status', hidden: true });
  const progressLabel = h('span');
  const progress = h('div', { id: 'scan-progress', class: 'job-progress', role: 'status', 'aria-live': 'polite', hidden: true },
    h('a', { class: 'job-progress-link', href: '#stock', 'aria-label': 'Open pantry scan' },
      h('div', { class: 'spinner', 'aria-hidden': 'true' }), progressLabel));
  document.body.append(progress);
  const list = h('div', { class: 'stock-list' });
  const sortedItems = h('div', { class: 'items' });
  const sortedList = h('div', { class: 'sorted-inventory' }, sortedItems);
  const shelfNodes = new Map(), rowNodes = new Map();
  const stats = h('p', { class: 'pantry-stats' });
  const stockStates = ['all', 'in', 'out'];
  const stockLabels = { all: 'All', in: 'In stock', out: 'To restock' };
  const stockLabel = h('span');
  const stockCount = h('span', { class: 'filter-count' });
  const stockButton = h('button', { class: 'status-filter', type: 'button', onclick: () => {
    stockFilter = stockStates[(stockStates.indexOf(stockFilter) + 1) % stockStates.length];
    render();
  } }, stockLabel, stockCount);
  const categorySelect = h('select', { 'aria-label': 'Filter ingredients', onchange: () => { categoryFilter = categorySelect.value; render(); } });
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
  const sortButton = h('button', { class: 'pantry-sort', type: 'button', 'aria-label': 'Sort ingredients', 'aria-haspopup': 'dialog', onclick: () => {
    const { close } = openDialog('sort-sheet',
      h('div', { class: 'row' }, h('h3', {}, 'Sort ingredients'), h('button', { class: 'icon push-right', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      h('p', { class: 'muted' }, 'Sorting shows one list without category groups.'),
      h('div', { class: 'pantry-sort-options', role: 'group', 'aria-label': 'Ingredient order' }, ...SORT_OPTIONS.map(([value, label]) =>
        h('button', { type: 'button', 'aria-pressed': String(sortOrder === value), onclick: () => {
          sortOrder = value;
          render();
          close();
        } }, h('span', {}, label), icon('check')))));
  } }, icon('sort'), h('span', {}, 'Sort'));
  root.append(
    h('div', { class: 'view-heading' }, h('div', {}, h('h1', {}, 'My pantry ', emoji('🧺', 'heading-emoji')), stats)),
    cameraInput, uploadInput, status,
    h('div', { class: 'inventory-toolbar' }, h('div', { class: 'search-bar', id: 'pantry-search' }, icon('search'), search),
      h('div', { class: 'pantry-filters', role: 'group', 'aria-label': 'Pantry filters and sorting' }, stockButton, h('div', { class: 'category-filter' }, categorySelect), sortButton)),
    h('div', { class: 'inventory-list-heading' }, h('span', { class: 'inventory-count visually-hidden', 'aria-live': 'polite' })),
    list,
    h('div', { class: 'pantry-actions action-dock' }, scanButton, addButton),
  );

  function scanOptions(source) {
    appendToJob = source;
    const { close } = openDialog('scan-source',
      h('div', { class: 'row' }, h('h3', {}, 'Scan groceries'), h('button', { class: 'icon push-right', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      h('p', { class: 'muted' }, 'Photograph your fridge, pantry or shopping bags.'),
      h('div', { class: 'scan-source-art', 'aria-hidden': 'true' }, pantryFriend(), emoji('📷')),
      h('button', { class: 'primary', onclick: () => { close(); choosePhotos('camera'); } }, icon('camera'), 'Take a photo'),
      h('button', { onclick: () => { close(); choosePhotos('gallery'); } }, icon('image'), 'Choose photos'),
      h('p', { class: 'muted' }, 'Up to 6 photos. Review the ingredients before adding them.'));
  }

  async function choosePhotos(source) {
    if (!platform.native) { (source === 'camera' ? cameraInput : uploadInput).click(); return; }
    try {
      await processPhotos(await platform.pickPhotos(source, MAX_PHOTOS - (appendToJob?.request.photos ?? 0), appendToJob?.id));
    } catch (error) { showError(error); }
  }

  if (platform.native) window.addEventListener('pantry:restored-photos', async ({ detail }) => {
    try {
      appendToJob = detail.jobId ? (await api.getJob(detail.jobId)).job : undefined;
      await processPhotos(detail.files);
    } catch (error) { showError(error); }
  });

  async function onPhotos(event) {
    const files = [...event.target.files];
    event.target.value = '';
    await processPhotos(files);
  }

  async function processPhotos(files) {
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
    } catch (error) { progress.hidden = true; status.hidden = true; showError(error); scanButton.disabled = false; }
  }

  function follow(job) {
    stopWatching();
    stopWatching = watchJob(job, (current) => {
      scanButton.disabled = current.status === 'running';
      if (current.status === 'running') { watchedJobId = current.id; return showRunning(current.request?.photos ?? 1); }
      // A scan that finishes while the pantry is in view opens its review; otherwise the notice waits.
      const justFinished = watchedJobId === current.id;
      watchedJobId = undefined;
      showOutcome(current);
      if (justFinished && current.status === 'succeeded' && current.result.reviewRequired && document.body.dataset.page === 'stock') openReview(current);
    });
  }

  function showRunning(count) {
    status.hidden = true;
    progressLabel.textContent = `Scanning ${count} photo${count === 1 ? '' : 's'}…`;
    progress.hidden = false;
  }

  function showOutcome(job) {
    progress.hidden = true;
    const dismissed = load('stock.dismissedJob', 0) >= job.id;
    const waiting = job.status === 'succeeded' && !!job.result.reviewRequired;
    if (waiting && !dismissed && !reviewDialog?.isConnected) {
      const count = job.result.added.length + job.result.restocked.length + job.result.alreadyInStock.length;
      showReady('scan', { symbol: '🛍️', title: 'Your scan is ready!', label: 'Review your scan', detail: `${count} ingredient${count === 1 ? '' : 's'} to check`,
        onOpen: () => { if (document.body.dataset.page !== 'stock') location.hash = 'stock'; openReview(job); },
        onDismiss: () => save('stock.dismissedJob', job.id) });
    } else hideReady('scan');
    // Completed reviews already report success through a toast; only a failure keeps a note in the pantry.
    if (dismissed || job.status !== 'failed') { status.hidden = true; return; }
    status.replaceChildren(h('span', { class: 'problem' }, job.error.message),
      h('button', { class: 'icon', 'aria-label': 'Dismiss scan notification', onclick: () => { save('stock.dismissedJob', job.id); status.hidden = true; } }, icon('close')));
    status.hidden = false;
  }

  async function openReview(job) {
    if (reviewDialog?.isConnected || !job.result.reviewRequired) return;
    const edits = load(`stock.review.${job.id}`, {});
    let added = false;
    const pending = [...job.result.added, ...job.result.restocked].map((item) => ({ ...item, selected: true, ...edits[item.candidateId] }));
    pending.push(...job.result.alreadyInStock.map((item) => ({ ...item, candidateId: -item.id, selected: false, automaticDuplicate: true, ...edits[-item.id] })));
    const rows = h('div', { class: 'scan-review-groups' });
    const automaticList = h('ul', { class: 'automatic-matches', 'aria-label': 'Detected possible duplicates' });
    const automaticLabel = h('span');
    const automaticSection = h('details', { class: 'scan-existing detected-duplicates', open: true },
      h('summary', {}, icon('link'), automaticLabel, icon('chevron')),
      h('p', { class: 'detected-duplicates-hint' }, 'The scan thinks these match your pantry. Please check.'), automaticList);
    const photoStrip = h('div', { class: 'scan-photos' });
    const confirmButton = h('button', { class: 'primary', onclick: async () => {
      const result = await withBusy(confirmButton, 'Adding…', () => api.confirmScan(job.id, pending.filter((item) => item.selected && !item.deleted).map(({ candidateId, name, category, notes, duplicateIngredientId, duplicateCandidateId, separate }) => ({ candidateId, name, category, notes, duplicateIngredientId, duplicateCandidateId, separate }))));
      if (!result) return;
      added = true;
      close();
      freshIds = new Set([...result.job.result.added, ...result.job.result.restocked].map((item) => item.id));
      stockFilter = 'all'; filter = ''; search.value = ''; categoryFilter = '';
      showOutcome(result.job);
      await refresh();
      toast('Your pantry is updated');
    } });
    const { dialog, close } = openDialog('scan-review',
      h('div', { class: 'review-header' }, h('button', { class: 'icon', 'aria-label': 'Back to pantry', onclick: () => close() }, icon('back')), h('h2', {}, 'Review scan')),
      h('div', { class: 'review-scroll' }, photoStrip,
        h('p', { class: 'photo-count' }, `${job.request.photos} photo${job.request.photos === 1 ? '' : 's'} · Scan complete`),
        document.body.dataset.ai === 'deepseek' ? deepSeekNote() : '',
        h('div', { class: 'scan-overview' }, h('h3', {}, `${pending.length} ingredient${pending.length === 1 ? '' : 's'} found`), h('p', {}, 'Edit, remove or match duplicates before adding.')),
        rows,
        automaticSection),
      h('div', { class: 'review-actions' }, confirmButton, h('button', { class: 'text-button', disabled: job.request.photos >= MAX_PHOTOS, onclick: () => { close(); scanOptions(job); } }, 'Add another photo')));
    reviewDialog = dialog;
    // Shrink the pinned photo once the list scrolls; grow it back only at the very top, so the
    // height change can't flip it back and forth near the threshold.
    const scroller = dialog.querySelector('.review-scroll');
    scroller.addEventListener('scroll', () => {
      if (scroller.scrollTop > 40) photoStrip.classList.add('compact');
      else if (scroller.scrollTop === 0) photoStrip.classList.remove('compact');
    }, { passive: true });
    hideReady('scan');
    // Closing without adding brings the notice back, so the scan is never lost.
    dialog.addEventListener('close', () => { reviewDialog = undefined; if (!added) showOutcome(job); });
    rows.append(scanReviewList({ pending, ingredients, categories, automaticList, onChange: updateCount }));
    updateCount();
    const localPhotos = photos.get(job.id);
    Promise.resolve(localPhotos ?? loadScanPhotos(job.id)).then((images) => {
      if (dialog.isConnected) photoStrip.replaceChildren(...images.map((src, index) => h('img', { src, alt: `Scanned photo ${index + 1}` })));
    }).catch((error) => showError(new Error(`Photo previews could not be loaded: ${error.message}`)));
    function updateCount() {
      const automaticCount = pending.filter((item) => item.automaticDuplicate).length;
      automaticLabel.textContent = `Possible duplicates · ${automaticCount}`;
      automaticSection.hidden = !automaticCount;
      const chosen = pending.filter((item) => item.selected && !item.deleted);
      const matches = chosen.filter((item) => item.duplicateIngredientId !== undefined || item.duplicateCandidateId !== undefined).length;
      confirmButton.textContent = chosen.length ? matches ? 'Update my pantry' : `Add ${chosen.length} ingredient${chosen.length === 1 ? '' : 's'}` : 'Finish review';
      save(`stock.review.${job.id}`, Object.fromEntries(pending.map((item) => [item.candidateId, item])));
    }
  }

  function exactMatch() { return ingredients.some((item) => item.name.toLowerCase() === filter.toLowerCase()); }
  function render() {
    const stocked = ingredients.filter((item) => item.inStock);
    stats.textContent = `${stocked.length} in stock · ${ingredients.length - stocked.length} to restock`;
    stockLabel.textContent = stockLabels[stockFilter];
    stockCount.textContent = stockFilter === 'all' ? ingredients.length : stockFilter === 'in' ? stocked.length : ingredients.length - stocked.length;
    stockButton.dataset.state = stockFilter;
    const nextLabel = stockLabels[stockStates[(stockStates.indexOf(stockFilter) + 1) % stockStates.length]];
    stockButton.setAttribute('aria-label', `Stock filter: ${stockLabels[stockFilter]}, ${stockCount.textContent} ingredient${stockCount.textContent === '1' ? '' : 's'}. Show ${nextLabel.toLowerCase()}`);
    stockButton.title = `Show ${nextLabel.toLowerCase()}`;
    const activeShelf = shelves.find((shelf) => shelf.id === categoryFilter);
    categorySelect.replaceChildren(h('option', { value: '' }, 'All categories'), ...shelves.filter((shelf) => ingredients.some((item) => shelf.categories.includes(item.category))).map((shelf) => h('option', { value: shelf.id }, shelf.label)));
    categorySelect.value = categoryFilter;
    const sortLabel = SORT_OPTIONS.find(([value]) => value === sortOrder)[1];
    sortButton.title = sortLabel;
    sortButton.setAttribute('aria-label', `Sort ingredients: ${sortLabel}`);
    sortButton.dataset.active = String(!!sortOrder);
    const key = filter.toLowerCase();
    const visible = ingredients.filter((item) => (!key || `${item.name} ${item.notes}`.toLowerCase().includes(key)) && (stockFilter === 'all' || (stockFilter === 'in' ? item.inStock : !item.inStock)) && (!activeShelf || activeShelf.categories.includes(item.category)));
    if (sortOrder) visible.sort((a, b) => sortOrder === 'az' || sortOrder === 'za'
        ? (nameOrder.compare(a.name, b.name) || a.id - b.id) * (sortOrder === 'za' ? -1 : 1)
        : (Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id) * (sortOrder === 'oldest' ? 1 : -1));
    root.querySelector('.inventory-count').textContent = `${visible.length} ingredients`;
    if (sortOrder) reconcile(sortedItems, visible.map(ingredientRow));
    reconcile(list, [filter && !exactMatch() ? h('button', { class: 'add-row', onclick: (event) => withBusy(event.currentTarget, 'Adding…', () => addManual(filter)) }, icon('plus'), `Add “${filter}”`) : null,
      ...(sortOrder ? (visible.length ? [sortedList] : []) : shelves.map((shelf) => [shelf, visible.filter((item) => shelf.categories.includes(item.category))]).filter(([, items]) => items.length).map(([shelf, items]) => section(shelf, items))),
      visible.length ? null : emptyState(filter || categoryFilter ? '🔎' : stockFilter === 'out' ? '🌷' : '🧺', filter || categoryFilter ? 'No matching ingredients' : stockFilter === 'out' ? 'All stocked up' : 'A little room for good things', filter || categoryFilter ? 'Try a different search or category.' : stockFilter === 'out' ? 'Mark ingredients as out of stock when you run out.' : 'Scan your groceries or add your first ingredient.')].filter(Boolean));
    for (const id of rowNodes.keys()) if (!ingredients.some((item) => item.id === id)) rowNodes.delete(id);
  }
  // Keep unchanged shelves and rows mounted so stock updates do not replay their entry animations.
  function reconcile(parent, children) {
    const keep = new Set(children);
    for (const child of [...parent.children]) if (!keep.has(child)) child.remove();
    children.forEach((child, index) => { if (parent.children[index] !== child) parent.insertBefore(child, parent.children[index] ?? null); });
  }
  function section(shelf, items) {
    let details = shelfNodes.get(shelf.id);
    if (!details) {
      details = h('details', { class: 'category' }, h('summary', {}, emoji(SHELF_EMOJIS[shelf.id] ?? '🫙', 'shelf-emoji'), h('span', {}, shelf.label), h('span', { class: 'shelf-count' })),
        h('div', { class: 'shelf-body' }, ...(shelf.id === 'other' ? [classificationControl()] : []), h('div', { class: 'items' })));
      // Opening lifts the jar lid and tumbles the items out one by one; closing scoops them back in.
      smoothDetails(details, { stagger: (body) => [...body.querySelectorAll('.item')], openMs: 420, closeMs: 300 });
      details.addEventListener('toggle', () => { if (filter || categoryFilter) return; details.open ? collapsed.delete(shelf.id) : collapsed.add(shelf.id); save('stock.shelves', [...collapsed]); });
      shelfNodes.set(shelf.id, details);
    }
    details.open = !!filter || !!categoryFilter || !collapsed.has(shelf.id);
    details.querySelector('.shelf-count').textContent = items.length;
    const sortButton = details.querySelector('.classify-button');
    if (sortButton) {
      sortButton.disabled = classifying;
      sortButton.classList.toggle('sorting', classifying);
      sortButton.querySelector('.classify-label').textContent = classifying ? 'Finding their shelves…' : sortLabel();
      details.classList.toggle('classifying', classifying);
    }
    reconcile(details.querySelector('.items'), items.map(ingredientRow));
    return details;
  }
  function classificationControl() {
    return h('div', { class: 'classification-control' },
      h('button', { class: 'classify-button', type: 'button', title: 'Sort all Other ingredients into existing or new categories', onclick: classifyOther },
        h('span', { class: 'classify-art', 'aria-hidden': 'true' }, '🧺', h('span', { class: 'classify-spark' }, '✦')),
        h('span', { class: 'classify-label' }, sortLabel())),
      h('span', { class: 'classify-hint' }, 'Existing shelves, or a new one.'));
  }
  async function classifyOther() {
    if (classifying) return;
    classifying = true;
    render();
    try {
      const result = await api.classifyOther();
      const changed = result.classified;
      if (changed.length) {
        const rows = changed.map((item) => rowNodes.get(item.id)?.row).filter((row) => row?.isConnected);
        if (!calm?.matches) {
          rows.forEach((row, index) => { row.style.setProperty('--sort-delay', `${Math.min(index, 6) * 35}ms`); row.classList.add('shelf-sorting-out'); });
          await new Promise((done) => setTimeout(done, 520));
        }
        for (const item of changed) { motion.set(item.id, 'shelf-sorted'); collapsed.delete(shelvesFor([...categories, item.category]).find((shelf) => shelf.categories.includes(item.category)).id); }
        save('stock.shelves', [...collapsed]);
        // Reveal the destination shelves even when the previous filter selected Other.
        if (categoryFilter === 'other') categoryFilter = '';
      }
      ingredients = ingredients.map((item) => changed.find((next) => next.id === item.id) ?? item);
      categories = [...new Set([...categories, ...result.newCategories])];
      shelves = shelvesFor(categories);
      classifying = false;
      render();
      const count = changed.length, newCount = result.newCategories.length;
      toast(count ? `${count} ingredient${count === 1 ? '' : 's'} sorted${newCount ? ` · ${newCount} new ${newCount === 1 ? 'shelf' : 'shelves'}` : ''}${result.remaining ? ` · ${result.remaining} still in Other` : ''}` : 'These ingredients need a little more detail to classify.');
      (list.querySelector('.classify-button') ?? categorySelect).focus({ preventScroll: true });
    } catch (error) { showError(error); }
    finally { classifying = false; for (const { row } of rowNodes.values()) row.classList.remove('shelf-sorting-out'); render(); }
  }
  function ingredientRow(item) {
    const signature = JSON.stringify([item.category, item.name, item.emoji, item.notes, item.inStock, freshIds.has(item.id)]);
    const cached = rowNodes.get(item.id);
    if (cached?.signature === signature) return cached.row;
    const toggle = h('button', { class: 'stock-toggle', 'aria-pressed': String(item.inStock), title: item.inStock ? 'In stock — mark as out of stock' : 'Out of stock — restock', 'aria-label': `${item.inStock ? 'In stock' : 'Out of stock'}: ${item.name}. ${item.inStock ? 'Mark as out of stock' : 'Restock'}`, onclick: async () => {
      const result = await withBusy(toggle, '…', () => api.updateIngredient(item.id, { inStock: !item.inStock }));
      if (!result) return;
      freshIds.delete(item.id);
      if (stockFilter !== 'all') await leaveShelf(toggle.closest('.item'));
      await restock(item);
      toast(item.inStock ? `${item.name} moved to restock` : `${item.name} is back in stock`);
      (list.querySelector(`[data-ingredient-id="${item.id}"] .stock-toggle`) ?? stockButton).focus();
    } }, h('span', { class: 'stock-mark' }, icon(item.inStock ? 'check' : 'close')));
    const moved = motion.get(item.id);
    const row = h('div', { class: `item${item.inStock ? '' : ' out-of-stock'}${freshIds.has(item.id) ? ' fresh' : ''}${moved ? ` ${moved}` : ''}`, dataset: { ingredientId: item.id } }, toggle,
      h('button', { class: 'item-edit', onclick: () => edit(item), 'aria-label': `Edit ${item.name}` }, emoji(item.emoji, 'ingredient-emoji'), h('span', { class: 'item-copy' }, h('strong', {}, item.name), item.notes ? h('small', {}, item.notes) : ''), icon('edit', 'item-more')));
    // Drop the class once played, so moving the row between shelves or filters does not replay it.
    if (moved) { motion.delete(item.id); setTimeout(() => row.classList.remove(moved), 1100); }
    rowNodes.set(item.id, { signature, row });
    return row;
  }
  /** Re-renders after a stock flip; the rebuilt row plays its restock or scoop-out animation. */
  async function restock(item) {
    motion.set(item.id, item.inStock ? 'emptied' : 'restocked');
    await refresh();
    motion.delete(item.id);
  }
  /** A row the active stock filter is about to hide slides off the shelf first. */
  function leaveShelf(row) {
    if (!row || calm?.matches) return Promise.resolve();
    row.classList.add('leaving');
    return new Promise((done) => { row.addEventListener('animationend', (event) => event.target === row && done()); setTimeout(done, 450); });
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
    search.value = ''; filter = ''; categoryFilter = ''; stockFilter = 'all'; freshIds = new Set([created.ingredient.id]);
    await refresh(); if (focusSearch) search.focus(); return true;
  }
  function edit(item) {
    const name = h('input', { value: item.name, required: true, maxlength: 80, 'aria-label': 'Name' });
    const category = h('select', {}, ...categories.map((id) => h('option', { value: id, selected: id === item.category }, categoryLabel(id))));
    const notes = h('input', { value: item.notes, maxlength: 500 });
    const saveButton = h('button', { type: 'submit', class: 'primary' }, 'Save changes');
    const act = async (button, work) => { if (await withBusy(button, 'Saving…', work)) { close(); await refresh(); } };
    const toggle = h('button', { type: 'button', onclick: async () => { if (await withBusy(toggle, 'Saving…', () => api.updateIngredient(item.id, { inStock: !item.inStock }))) { close(); await restock(item); } } }, item.inStock ? 'Mark as out of stock' : 'Back in my pantry');
    const { close } = openDialog('edit ingredient-edit', h('div', { class: 'row' }, h('h3', {}, emoji(item.emoji, 'edit-food-emoji'), item.name), h('button', { class: 'icon push-right', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      h('form', { class: 'stack', onsubmit: (event) => { event.preventDefault(); act(saveButton, () => api.updateIngredient(item.id, { name: name.value, category: category.value, notes: notes.value })); } }, field('Ingredient name', name), field('Category', category), field('Notes', notes), saveButton), toggle,
      h('button', { class: 'danger text-button', onclick: (event) => { if (confirm(`Delete ${item.name}?`)) act(event.currentTarget, () => api.deleteIngredient(item.id).then(() => true)); } }, 'Delete ingredient'));
  }
  async function refresh() {
    try { ({ ingredients, categories } = await api.listIngredients()); shelves = shelvesFor(categories); render(); } catch (error) { showError(error); }
  }
  async function show() {
    await refresh();
    try { const job = await latestJob('scan'); if (job) follow(job); } catch (error) { showError(error); }
  }
  function hide() {
    if (!sortOrder) return;
    sortOrder = '';
    render();
  }
  window.addEventListener('pagehide', hide);
  document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); });
  return { show, hide };
}

/** Names the intelligence the account menu says is in use (set on <body> as data-ai). */
function sortLabel() {
  return `Sort with ${document.body.dataset.ai === 'deepseek' ? 'DeepSeek' : 'ChatGPT'}`;
}
window.addEventListener('pantry:ai-changed', () => {
  for (const label of document.querySelectorAll('.classify-button:not(:disabled) .classify-label')) label.textContent = sortLabel();
});

/** Scans read by DeepSeek (not the person's ChatGPT plan) are less reliable: ask for a second look. */
function deepSeekNote() {
  return h('div', { class: 'ai-beta-note', role: 'note' },
    emoji('🔍'),
    h('span', {},
      h('strong', {}, 'Read by DeepSeek'), h('span', { class: 'beta-chip' }, 'BETA'), h('br'),
      'This scan didn’t use a ChatGPT plan, and DeepSeek slips up a little more often. Please double-check each item against your photo before adding it.'));
}
