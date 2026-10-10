import { api } from '../api.js';
import { scanReviewList } from '../scan-review.js';
import { h, openDialog, showError, toast, withBusy } from '../dom.js';
import { categoryLabel, SHELVES, SHELF_EMOJIS, shelvesFor } from '../categories.js';
import { photoToDataUrl } from '../images.js';
import { smoothDetails } from '../smooth-details.js';
import { hideReady, showReady } from '../ready-notice.js';
import { latestJob, watchJob } from '../jobs.js';
import { loadScanPhotos, saveScanPhotos } from '../scan-photos.js';
import { load, save } from '../store.js';
import { emptyState, emoji, field, icon, pantryFriend } from '../ui.js';
import { localeTag, t, tn, translateMessage } from '../i18n.js';

const MAX_PHOTOS = 6;
const SORT_OPTIONS = [
  ['', t('Grouped by category')],
  ['newest', t('Date added: newest first')],
  ['oldest', t('Date added: oldest first')],
  ['az', t('Name: A–Z')],
  ['za', t('Name: Z–A')],
];
const nameOrder = new Intl.Collator(localeTag, { sensitivity: 'base', numeric: true });
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
    h('a', { class: 'job-progress-link', href: '#stock', 'aria-label': t('Open pantry scan') },
      h('div', { class: 'spinner', 'aria-hidden': 'true' }), progressLabel));
  document.body.append(progress);
  const list = h('div', { class: 'stock-list' });
  const sortedItems = h('div', { class: 'items' });
  const sortedList = h('div', { class: 'sorted-inventory' }, sortedItems);
  const shelfNodes = new Map(), rowNodes = new Map();
  const stats = h('p', { class: 'pantry-stats' });
  const stockStates = ['all', 'in', 'out'];
  const stockLabels = { all: t('All'), in: t('In stock'), out: t('To restock') };
  const stockLabel = h('span');
  const stockCount = h('span', { class: 'filter-count' });
  const stockButton = h('button', { class: 'status-filter', type: 'button', onclick: () => {
    stockFilter = stockStates[(stockStates.indexOf(stockFilter) + 1) % stockStates.length];
    render();
  } }, stockLabel, stockCount);
  const categorySelect = h('select', { 'aria-label': t('Filter ingredients'), onchange: () => { categoryFilter = categorySelect.value; render(); } });
  const search = h('input', { type: 'search', placeholder: t('Search ingredients'), 'aria-label': t('Search or add an ingredient'), enterkeyhint: 'done', oninput: () => { filter = search.value.trim(); render(); }, onkeydown: (event) => {
    if (event.key === 'Enter' && filter && !exactMatch()) addManual(filter);
    if (event.key === 'Escape') { event.preventDefault(); setSearchOpen(false); searchToggle.focus(); }
  } });
  const searchToggle = h('button', { class: 'icon pantry-search-toggle', 'aria-label': t('Search pantry'), 'aria-expanded': 'false', 'aria-controls': 'pantry-search', onclick: () => setSearchOpen(!root.classList.contains('search-open')) }, icon('search'));
  document.querySelector('.header-end').prepend(searchToggle);
  function setSearchOpen(open) {
    root.classList.toggle('search-open', open);
    searchToggle.setAttribute('aria-expanded', String(open));
    searchToggle.setAttribute('aria-label', open ? t('Close pantry search') : t('Search pantry'));
    searchToggle.replaceChildren(icon(open ? 'close' : 'search'));
    if (open) search.focus();
    else { search.value = ''; filter = ''; render(); }
  }
  const cameraInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: onPhotos });
  const uploadInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: onPhotos });
  const scanButton = h('button', { class: 'primary', onclick: () => scanOptions() }, icon('camera'), t('Scan groceries'));
  const addButton = h('button', { onclick: addIngredientDialog }, icon('plus'), t('Add'));
  const sortButton = h('button', { class: 'pantry-sort', type: 'button', 'aria-label': t('Sort ingredients'), 'aria-haspopup': 'dialog', onclick: () => {
    const { close } = openDialog('sort-sheet',
      h('div', { class: 'row' }, h('h3', {}, t('Sort ingredients')), h('button', { class: 'icon push-right', 'aria-label': t('Close'), onclick: () => close() }, icon('close'))),
      h('p', { class: 'muted' }, t('Sorting shows one list without category groups.')),
      h('div', { class: 'pantry-sort-options', role: 'group', 'aria-label': t('Ingredient order') }, ...SORT_OPTIONS.map(([value, label]) =>
        h('button', { type: 'button', 'aria-pressed': String(sortOrder === value), onclick: () => {
          sortOrder = value;
          render();
          close();
        } }, h('span', {}, label), icon('check')))));
  } }, icon('sort'), h('span', {}, t('Sort')));
  root.append(
    h('div', { class: 'view-heading' }, h('div', {}, h('h1', {}, t('My pantry'), ' ', emoji('🧺', 'heading-emoji')), stats)),
    cameraInput, uploadInput, status,
    h('div', { class: 'inventory-toolbar' }, h('div', { class: 'search-bar', id: 'pantry-search' }, icon('search'), search),
      h('div', { class: 'pantry-filters', role: 'group', 'aria-label': t('Pantry filters and sorting') }, stockButton, h('div', { class: 'category-filter' }, categorySelect), sortButton)),
    h('div', { class: 'inventory-list-heading' }, h('span', { class: 'inventory-count visually-hidden', 'aria-live': 'polite' })),
    list,
    h('div', { class: 'pantry-actions action-dock' }, scanButton, addButton),
  );

  function scanOptions(source) {
    appendToJob = source;
    const { close } = openDialog('scan-source',
      h('div', { class: 'row' }, h('h3', {}, t('Scan groceries')), h('button', { class: 'icon push-right', 'aria-label': t('Close'), onclick: () => close() }, icon('close'))),
      h('p', { class: 'muted' }, t('Photograph your fridge, pantry or shopping bags.')),
      h('div', { class: 'scan-source-art', 'aria-hidden': 'true' }, pantryFriend(), emoji('📷')),
      h('button', { class: 'primary', onclick: () => { close(); choosePhotos('camera'); } }, icon('camera'), t('Take a photo')),
      h('button', { onclick: () => { close(); choosePhotos('gallery'); } }, icon('image'), t('Choose photos')),
      h('p', { class: 'muted' }, t('Up to 6 photos. Review the ingredients before adding them.')));
  }

  function choosePhotos(source) {
    (source === 'camera' ? cameraInput : uploadInput).click();
  }

  async function onPhotos(event) {
    const files = [...event.target.files];
    event.target.value = '';
    await processPhotos(files);
  }

  async function processPhotos(files) {
    if (!files.length) return;
    const remaining = MAX_PHOTOS - (appendToJob?.request.photos ?? 0);
    if (files.length > remaining) { showError(new Error(tn(remaining, 'Choose up to {count} more photo for this scan.', 'Choose up to {count} more photos for this scan.'))); return; }
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
      saveScanPhotos(job.id, previews).catch((error) => showError(new Error(t('Photo previews could not be saved on this device: {error}', { error: error.message }))));
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
    progressLabel.textContent = tn(count, 'Scanning {count} photo…', 'Scanning {count} photos…');
    progress.hidden = false;
  }

  function showOutcome(job) {
    progress.hidden = true;
    const dismissed = load('stock.dismissedJob', 0) >= job.id;
    const waiting = job.status === 'succeeded' && !!job.result.reviewRequired;
    if (waiting && !dismissed && !reviewDialog?.isConnected) {
      const count = job.result.added.length + job.result.restocked.length + job.result.alreadyInStock.length;
      showReady('scan', { symbol: '🛍️', title: t('Your scan is ready!'), label: t('Review your scan'), detail: tn(count, '{count} ingredient to check', '{count} ingredients to check'),
        onOpen: () => { if (document.body.dataset.page !== 'stock') location.hash = 'stock'; openReview(job); },
        onDismiss: () => save('stock.dismissedJob', job.id) });
    } else hideReady('scan');
    // Completed reviews already report success through a toast; only a failure keeps a note in the pantry.
    if (dismissed || job.status !== 'failed') { status.hidden = true; return; }
    status.replaceChildren(h('span', { class: 'problem' }, translateMessage(job.error.message)),
      h('button', { class: 'icon', 'aria-label': t('Dismiss scan notification'), onclick: () => { save('stock.dismissedJob', job.id); status.hidden = true; } }, icon('close')));
    status.hidden = false;
  }

  async function openReview(job) {
    if (reviewDialog?.isConnected || !job.result.reviewRequired) return;
    const edits = load(`stock.review.${job.id}`, {});
    let added = false;
    const pending = [...job.result.added, ...job.result.restocked].map((item) => ({ ...item, selected: true, ...edits[item.candidateId] }));
    pending.push(...job.result.alreadyInStock.map((item) => ({ ...item, candidateId: -item.id, selected: false, automaticDuplicate: true, ...edits[-item.id] })));
    const rows = h('div', { class: 'scan-review-groups' });
    const automaticList = h('ul', { class: 'automatic-matches', 'aria-label': t('Detected possible duplicates') });
    const automaticLabel = h('span');
    const automaticSection = h('details', { class: 'scan-existing detected-duplicates', open: true },
      h('summary', {}, icon('link'), automaticLabel, icon('chevron')),
      h('p', { class: 'detected-duplicates-hint' }, t('The scan thinks these match your pantry. Please check.')), automaticList);
    const photoStrip = h('div', { class: 'scan-photos' });
    const confirmButton = h('button', { class: 'primary', onclick: async () => {
      const result = await withBusy(confirmButton, t('Adding…'), () => api.confirmScan(job.id, pending.filter((item) => item.selected && !item.deleted).map(({ candidateId, name, category, notes, duplicateIngredientId, duplicateCandidateId, separate }) => ({ candidateId, name, category, notes, duplicateIngredientId, duplicateCandidateId, separate }))));
      if (!result) return;
      added = true;
      close();
      freshIds = new Set([...result.job.result.added, ...result.job.result.restocked].map((item) => item.id));
      stockFilter = 'all'; filter = ''; search.value = ''; categoryFilter = '';
      showOutcome(result.job);
      await refresh();
      toast(t('Your pantry is updated'));
    } });
    const { dialog, close } = openDialog('scan-review',
      h('div', { class: 'review-header' }, h('button', { class: 'icon', 'aria-label': t('Back to pantry'), onclick: () => close() }, icon('back')), h('h2', {}, t('Review scan'))),
      h('div', { class: 'review-scroll' }, photoStrip,
        h('p', { class: 'photo-count' }, tn(job.request.photos, '{count} photo · Scan complete', '{count} photos · Scan complete')),
        document.body.dataset.ai === 'deepseek' ? deepSeekNote() : '',
        h('div', { class: 'scan-overview' }, h('h3', {}, tn(pending.length, '{count} ingredient found', '{count} ingredients found')), h('p', {}, t('Edit, remove or match duplicates before adding.'))),
        rows,
        automaticSection),
      h('div', { class: 'review-actions' }, confirmButton, h('button', { class: 'text-button', disabled: job.request.photos >= MAX_PHOTOS, onclick: () => { close(); scanOptions(job); } }, t('Add another photo'))));
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
      if (dialog.isConnected) photoStrip.replaceChildren(...images.map((src, index) => h('img', { src, alt: t('Scanned photo {number}', { number: index + 1 }) })));
    }).catch((error) => showError(new Error(t('Photo previews could not be loaded: {error}', { error: error.message }))));
    function updateCount() {
      const automaticCount = pending.filter((item) => item.automaticDuplicate).length;
      automaticLabel.textContent = t('Possible duplicates · {count}', { count: automaticCount });
      automaticSection.hidden = !automaticCount;
      const chosen = pending.filter((item) => item.selected && !item.deleted);
      const matches = chosen.filter((item) => item.duplicateIngredientId !== undefined || item.duplicateCandidateId !== undefined).length;
      confirmButton.textContent = chosen.length ? matches ? t('Update my pantry') : tn(chosen.length, 'Add {count} ingredient', 'Add {count} ingredients') : t('Finish review');
      save(`stock.review.${job.id}`, Object.fromEntries(pending.map((item) => [item.candidateId, item])));
    }
  }

  function exactMatch() { return ingredients.some((item) => item.name.toLowerCase() === filter.toLowerCase()); }
  function render() {
    const stocked = ingredients.filter((item) => item.inStock);
    stats.textContent = t('{stocked} in stock · {missing} to restock', { stocked: stocked.length, missing: ingredients.length - stocked.length });
    stockLabel.textContent = stockLabels[stockFilter];
    stockCount.textContent = stockFilter === 'all' ? ingredients.length : stockFilter === 'in' ? stocked.length : ingredients.length - stocked.length;
    stockButton.dataset.state = stockFilter;
    const nextLabel = stockLabels[stockStates[(stockStates.indexOf(stockFilter) + 1) % stockStates.length]];
    stockButton.setAttribute('aria-label', tn(Number(stockCount.textContent), 'Stock filter: {filter}, {count} ingredient. Show {next}', 'Stock filter: {filter}, {count} ingredients. Show {next}', { filter: stockLabels[stockFilter], next: nextLabel.toLocaleLowerCase(localeTag) }));
    stockButton.title = t('Show {next}', { next: nextLabel.toLocaleLowerCase(localeTag) });
    const activeShelf = shelves.find((shelf) => shelf.id === categoryFilter);
    categorySelect.replaceChildren(h('option', { value: '' }, t('All categories')), ...shelves.filter((shelf) => ingredients.some((item) => shelf.categories.includes(item.category))).map((shelf) => h('option', { value: shelf.id }, shelf.label)));
    categorySelect.value = categoryFilter;
    const sortLabel = SORT_OPTIONS.find(([value]) => value === sortOrder)[1];
    sortButton.title = sortLabel;
    sortButton.setAttribute('aria-label', t('Sort ingredients: {order}', { order: sortLabel }));
    sortButton.dataset.active = String(!!sortOrder);
    const key = filter.toLowerCase();
    const visible = ingredients.filter((item) => (!key || `${item.name} ${item.notes}`.toLowerCase().includes(key)) && (stockFilter === 'all' || (stockFilter === 'in' ? item.inStock : !item.inStock)) && (!activeShelf || activeShelf.categories.includes(item.category)));
    if (sortOrder) visible.sort((a, b) => sortOrder === 'az' || sortOrder === 'za'
        ? (nameOrder.compare(a.name, b.name) || a.id - b.id) * (sortOrder === 'za' ? -1 : 1)
        : (Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id) * (sortOrder === 'oldest' ? 1 : -1));
    root.querySelector('.inventory-count').textContent = tn(visible.length, '{count} ingredient', '{count} ingredients');
    if (sortOrder) reconcile(sortedItems, visible.map(ingredientRow));
    reconcile(list, [filter && !exactMatch() ? h('button', { class: 'add-row', onclick: (event) => withBusy(event.currentTarget, t('Adding…'), () => addManual(filter)) }, icon('plus'), t('Add “{name}”', { name: filter })) : null,
      ...(sortOrder ? (visible.length ? [sortedList] : []) : shelves.map((shelf) => [shelf, visible.filter((item) => shelf.categories.includes(item.category))]).filter(([, items]) => items.length).map(([shelf, items]) => section(shelf, items))),
      visible.length ? null : emptyState(filter || categoryFilter ? '🔎' : stockFilter === 'out' ? '🌷' : '🧺', filter || categoryFilter ? t('No matching ingredients') : stockFilter === 'out' ? t('All stocked up') : t('A little room for good things'), filter || categoryFilter ? t('Try a different search or category.') : stockFilter === 'out' ? t('Mark ingredients as out of stock when you run out.') : t('Scan your groceries or add your first ingredient.'))].filter(Boolean));
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
      sortButton.querySelector('.classify-label').textContent = classifying ? t('Finding their shelves…') : sortLabel();
      details.classList.toggle('classifying', classifying);
    }
    reconcile(details.querySelector('.items'), items.map(ingredientRow));
    return details;
  }
  function classificationControl() {
    return h('div', { class: 'classification-control' },
      h('button', { class: 'classify-button', type: 'button', title: t('Sort all Other ingredients into existing or new categories'), onclick: classifyOther },
        h('span', { class: 'classify-art', 'aria-hidden': 'true' }, '🧺', h('span', { class: 'classify-spark' }, '✦')),
        h('span', { class: 'classify-label' }, sortLabel())),
      h('span', { class: 'classify-hint' }, t('Existing shelves, or a new one.')));
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
      toast(count ? [tn(count, '{count} ingredient sorted', '{count} ingredients sorted'), newCount && tn(newCount, '{count} new shelf', '{count} new shelves'), result.remaining && t('{count} still in Other', { count: result.remaining })].filter(Boolean).join(' · ') : t('These ingredients need a little more detail to classify.'));
      (list.querySelector('.classify-button') ?? categorySelect).focus({ preventScroll: true });
    } catch (error) { showError(error); }
    finally { classifying = false; for (const { row } of rowNodes.values()) row.classList.remove('shelf-sorting-out'); render(); }
  }
  function ingredientRow(item) {
    const signature = JSON.stringify([item.category, item.name, item.emoji, item.notes, item.inStock, freshIds.has(item.id)]);
    const cached = rowNodes.get(item.id);
    if (cached?.signature === signature) return cached.row;
    const toggle = h('button', { class: 'stock-toggle', 'aria-pressed': String(item.inStock), title: item.inStock ? t('In stock — mark as out of stock') : t('Out of stock — restock'), 'aria-label': item.inStock ? t('In stock: {name}. Mark as out of stock', { name: item.name }) : t('Out of stock: {name}. Restock', { name: item.name }), onclick: async () => {
      const result = await withBusy(toggle, '…', () => api.updateIngredient(item.id, { inStock: !item.inStock }));
      if (!result) return;
      freshIds.delete(item.id);
      if (stockFilter !== 'all') await leaveShelf(toggle.closest('.item'));
      await restock(item);
      (list.querySelector(`[data-ingredient-id="${item.id}"] .stock-toggle`) ?? stockButton).focus();
    } }, h('span', { class: 'stock-mark' }, icon(item.inStock ? 'check' : 'close')));
    const moved = motion.get(item.id);
    const row = h('div', { class: `item${item.inStock ? '' : ' out-of-stock'}${freshIds.has(item.id) ? ' fresh' : ''}${moved ? ` ${moved}` : ''}`, dataset: { ingredientId: item.id } }, toggle,
      h('button', { class: 'item-edit', onclick: () => edit(item), 'aria-label': t('Edit {name}', { name: item.name }) }, emoji(item.emoji, 'ingredient-emoji'), h('span', { class: 'item-copy' }, h('strong', {}, item.name), item.notes ? h('small', {}, item.notes) : ''), icon('edit', 'item-more')));
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
    const name = h('input', { required: true, maxlength: 80, placeholder: t('e.g. Cherry tomatoes'), value: filter });
    const category = h('select', {}, ...categories.map((id) => h('option', { value: id, selected: id === 'other' }, categoryLabel(id))));
    const notes = h('input', { maxlength: 500, placeholder: t('Optional') });
    const button = h('button', { type: 'submit', class: 'primary' }, t('Add to my pantry'));
    const { close } = openDialog('edit', h('div', { class: 'row' }, h('h3', {}, t('Add ingredient')), h('button', { class: 'icon push-right', 'aria-label': t('Close'), onclick: () => close() }, icon('close'))),
      h('form', { class: 'stack', onsubmit: async (event) => { event.preventDefault(); if (await withBusy(button, t('Adding…'), () => addManual(name.value.trim(), { category: category.value, notes: notes.value }, false))) close(); } }, field(t('Ingredient name'), name), h('details', { class: 'form-options' }, h('summary', {}, t('Category & notes')), field(t('Category'), category), field(t('Notes'), notes)), button));
    name.focus();
  }
  async function addManual(name, details = {}, focusSearch = true) {
    let created;
    try { created = await api.addIngredient({ name, ...details }); } catch (error) { showError(error); return false; }
    search.value = ''; filter = ''; categoryFilter = ''; stockFilter = 'all'; freshIds = new Set([created.ingredient.id]);
    await refresh(); if (focusSearch) search.focus(); return true;
  }
  function edit(item) {
    const name = h('input', { value: item.name, required: true, maxlength: 80, 'aria-label': t('Name') });
    const category = h('select', {}, ...categories.map((id) => h('option', { value: id, selected: id === item.category }, categoryLabel(id))));
    const notes = h('input', { value: item.notes, maxlength: 500 });
    const saveButton = h('button', { type: 'submit', class: 'primary' }, t('Save changes'));
    const act = async (button, work) => { if (await withBusy(button, t('Saving…'), work)) { close(); await refresh(); } };
    const toggle = h('button', { type: 'button', onclick: async () => { if (await withBusy(toggle, t('Saving…'), () => api.updateIngredient(item.id, { inStock: !item.inStock }))) { close(); await restock(item); } } }, item.inStock ? t('Mark as out of stock') : t('Back in my pantry'));
    const { close } = openDialog('edit ingredient-edit', h('div', { class: 'row' }, h('h3', {}, emoji(item.emoji, 'edit-food-emoji'), item.name), h('button', { class: 'icon push-right', 'aria-label': t('Close'), onclick: () => close() }, icon('close'))),
      h('form', { class: 'stack', onsubmit: (event) => { event.preventDefault(); act(saveButton, () => api.updateIngredient(item.id, { name: name.value, category: category.value, notes: notes.value })); } }, field(t('Ingredient name'), name), field(t('Category'), category), field(t('Notes'), notes), saveButton), toggle,
      h('button', { class: 'danger text-button', onclick: (event) => { if (confirm(t('Delete {name}?', { name: item.name }))) act(event.currentTarget, () => api.deleteIngredient(item.id).then(() => true)); } }, t('Delete ingredient')));
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
  return t('Sort with {ai}', { ai: document.body.dataset.ai === 'deepseek' ? 'DeepSeek' : 'ChatGPT' });
}
window.addEventListener('pantry:ai-changed', () => {
  for (const label of document.querySelectorAll('.classify-button:not(:disabled) .classify-label')) label.textContent = sortLabel();
});

/** Scans read by DeepSeek (not the person's ChatGPT plan) are less reliable: ask for a second look. */
function deepSeekNote() {
  return h('div', { class: 'ai-beta-note', role: 'note' },
    emoji('🔍'),
    h('span', {},
      h('strong', {}, t('Read by DeepSeek')), h('span', { class: 'beta-chip' }, t('BETA')), h('br'),
      t('This scan didn’t use a ChatGPT plan, and DeepSeek slips up a little more often. Please double-check each item against your photo before adding it.')));
}
