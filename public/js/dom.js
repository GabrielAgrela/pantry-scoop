import { feel } from './blob-buddy.js';
import { t, translateMessage } from './i18n.js';

/**
 * Tiny element builder. Text is always inserted as text nodes, never parsed as HTML,
 * so ingredient names coming from photos or the AI cannot inject markup.
 *
 *   h('button', { class: 'primary', onclick: save }, 'Save')
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    // `value` must be a property: <textarea> ignores the attribute.
    else if (key === 'value' || (key in el && typeof value !== 'string')) el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  el.append(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false));
  return el;
}

let toastTimer;
let toastKey;
let dialogSequence = 0;
let lastPress;
document.addEventListener('pointerdown', (event) => {
  const el = event.target?.closest?.('button, a, summary, [role="button"]');
  if (el) lastPress = { el, at: Date.now() };
}, { capture: true, passive: true });

export const MANAGE_USAGE_URL = 'https://chatgpt.com/settings/usage';

/** `action` is a link ({ href, label }) or, with `onclick`, a button such as Undo. */
export function toast(message, { error = false, action, mood } = {}) {
  const el = document.getElementById('toast');
  const dialog = [...document.querySelectorAll('dialog[open]:not(.is-closing)')].at(-1);
  const key = JSON.stringify([message, error, action?.href, action?.label]);
  // Repeated polling failures should neither re-announce nor extend a visible notice.
  if (!el.hidden && toastKey === key) return;
  // A routine confirmation must not erase an error the cook still needs to read.
  if (!el.hidden && el.classList.contains('error') && !error) return;
  if (dialog) dialog.prepend(el);
  else document.querySelector('.app-header').after(el);
  toastKey = key;
  el.replaceChildren(error ? '' : h('span', { class: 'toast-sparkle', 'aria-hidden': 'true' }, '✦'),
    h('span', { class: 'toast-message', role: error ? 'alert' : 'status' }, message,
      action?.onclick ? h('button', { type: 'button', class: 'text-button toast-action', onclick: () => { dismissToast(); action.onclick(); } }, action.label)
        : action ? h('a', { class: 'toast-action', href: action.href, target: '_blank', rel: 'noopener' }, action.label) : ''),
    h('button', { type: 'button', class: 'toast-dismiss', 'aria-label': t('Dismiss notification'), onclick: dismissToast }, '×'));
  el.classList.toggle('error', error);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(dismissToast, action ? 12000 : error ? 6000 : 3500);
  feel(mood ?? (error ? 'sad' : 'happy'));
}

function dismissToast() {
  clearTimeout(toastTimer);
  const el = document.getElementById('toast');
  const focused = el.contains(document.activeElement);
  el.hidden = true;
  toastKey = undefined;
  if (focused) {
    const target = el.closest('dialog')?.querySelector('button:not(.toast-dismiss):not(:disabled), input, textarea') ?? document.getElementById('main-content');
    target?.focus({ preventScroll: true });
  }
}

/** Shows an API error; a usage limit gets "Manage usage" as its primary action. */
export function showError(error) {
  if (error.code === 'auth-required') return; // the sign-in screen takes over
  const action = error.code === 'usage-limit' ? { label: t('Manage usage'), href: error.manageUsageUrl ?? MANAGE_USAGE_URL } : undefined;
  // Errors raised in English outside the interface code (browsers) still read in the chosen language.
  toast(translateMessage(error.message), { error: true, action });
}

/** Runs an async action while a button shows a busy label; reports failures as a toast. */
export async function withBusy(button, busyLabel, action) {
  const label = [...button.childNodes];
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    return await action();
  } catch (error) {
    showError(error);
    return undefined;
  } finally {
    button.disabled = false;
    button.replaceChildren(...label);
  }
}

/** True when animations should be skipped (reduced motion, or no Web Animations support). */
export function calmMotion(el = document.body) {
  return !el.animate || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Modal dialog that removes itself when closed. Returns { dialog, close }. Closing tucks the sheet
 * back into whatever opened it (the recipe card, the appliance tile, the Add button), which gives a
 * little boop and sparkle as it lands; with nothing to return to, the sheet drops gently away.
 */
export function openDialog(className, ...content) {
  // Safari does not focus tapped buttons, so the last press stands in for the focused element.
  const pressed = lastPress && Date.now() - lastPress.at < 1500 && lastPress.el.isConnected ? lastPress.el : undefined;
  const focused = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : undefined;
  const source = pressed ?? focused;
  const opener = source ? openerKey(source) : undefined;
  const dialog = h('dialog', { class: `card stack ${className}` }, ...content);
  const heading = dialog.querySelector('h3, h2');
  if (heading) {
    if (!className.includes('recipe-detail') && !className.includes('cooking-screen')) {
      const symbol = className.includes('scan') ? '📷' : className.includes('qr') ? '📱' : className.includes('dish') ? '🍽️' : className.includes('welcome') ? '🫶' : className.includes('sort') ? '🧺' : className.includes('tips') ? '💡' : '✨';
      // Tips come from Scoop, so he signs them himself instead of a lightbulb stamp.
      heading.prepend(className.includes('tips')
        ? h('img', { class: 'dialog-stamp scoop-stamp', src: '/assets/scoop-guide.svg', alt: '', width: 52, height: 55, 'aria-hidden': 'true' })
        : h('span', { class: 'dialog-stamp', 'aria-hidden': 'true' }, symbol));
    }
    heading.id = `dialog-title-${++dialogSequence}`;
    dialog.setAttribute('aria-labelledby', heading.id);
  }
  let closing = false;
  const finish = () => {
    if (!dialog.isConnected) return;
    // Keep the shared notice mounted when its modal is removed.
    const notice = dialog.querySelector('#toast');
    if (notice) { dismissToast(); document.querySelector('.app-header').after(notice); }
    dialog.close();
    dialog.remove();
  };
  const close = () => {
    if (closing) return;
    closing = true;
    if (calmMotion(dialog) || !dialog.open) return finish();
    dialog.inert = true; // a second tap during the goodbye does nothing
    dialog.classList.add('is-closing');
    const target = findOpener(opener, dialog);
    const animation = target ? tuckInto(dialog, target) : dropAway(dialog);
    animation.onfinish = () => { finish(); if (target) landed(target); };
    setTimeout(finish, 900); // never leave an invisible modal behind
  };
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('close', finish); // the browser may still force a close past `cancel`
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close(); // tap outside
  });
  document.body.append(dialog);
  dismissToast();
  dialog.showModal();
  return { dialog, close };
}

/**
 * Remembers what opened a dialog. Views often re-render while a sheet is open (saving a recipe
 * rebuilds its card), so the element is found again by its class and label when it was replaced.
 */
function openerKey(el) {
  return { el, tag: el.tagName, className: el.className, label: el.getAttribute('aria-label') ?? el.textContent.trim() };
}

function findOpener(key, dialog) {
  if (!key) return undefined;
  const same = (el) => el.className === key.className && (el.getAttribute('aria-label') ?? el.textContent.trim()) === key.label;
  const el = key.el.isConnected ? key.el : [...document.querySelectorAll(key.tag)].find(same);
  if (!el || dialog.contains(el) || el.closest('dialog.is-closing')) return undefined;
  return visibleBox(el);
}

/** Some openers are see-through buttons filling a card or shelf row; the sheet lands on, and squishes, the box you can see. */
function visibleBox(el) {
  const box = el.matches('.recipe-open, .item-edit') ? el.parentElement.closest('.recipe-card, .item') ?? el : el;
  return onScreen(box) ? box : undefined;
}

function onScreen(el) {
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth;
}

/** A small inhale, then the sheet shrinks and swoops into the element that opened it. */
function tuckInto(dialog, target) {
  const from = dialog.getBoundingClientRect(), to = target.getBoundingClientRect();
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const scale = Math.min(0.5, Math.max(0.06, to.width / from.width));
  const tilt = dx < 0 ? 4 : -4;
  return dialog.animate([
    { transform: 'none', opacity: 1, easing: 'cubic-bezier(.3, 0, .5, 1)' },
    { transform: 'translateY(-8px) scale(1.025, .975)', opacity: 1, offset: 0.18, easing: 'cubic-bezier(.55, 0, .8, .4)' },
    { transform: `translate(${dx * 0.9}px, ${dy * 0.9}px) scale(${scale * 1.25}) rotate(${tilt}deg)`, opacity: 0.85, offset: 0.82 },
    { transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(0deg)`, opacity: 0 },
  ], { duration: 460, fill: 'forwards' });
}

/** Nothing to return to: the sheet hops up, then settles down and out of sight. */
function dropAway(dialog) {
  return dialog.animate([
    { transform: 'none', opacity: 1, easing: 'cubic-bezier(.3, 0, .5, 1)' },
    { transform: 'translateY(-8px) scale(1.02, .98)', opacity: 1, offset: 0.22, easing: 'cubic-bezier(.5, 0, .9, .5)' },
    { transform: 'translateY(48px) scale(.9) rotate(1.5deg)', opacity: 0 },
  ], { duration: 340, fill: 'forwards' });
}

/** The opener catches the sheet: a squishy boop and a few sparkles. */
function landed(target) {
  if (!target.isConnected) return;
  target.animate([
    { transform: 'none' }, { transform: 'scale(.92, 1.06)', offset: 0.3 }, { transform: 'scale(1.05, .96)', offset: 0.65 }, { transform: 'none' },
  ], { duration: 420, easing: 'ease-out' });
  const box = target.getBoundingClientRect();
  const puff = h('span', { class: 'tuck-puff', 'aria-hidden': 'true' }, h('span', {}, '✦'), h('span', {}, '✧'), h('span', {}, '✦'));
  puff.style.left = `${box.left + box.width / 2}px`; // CSSOM, since the CSP refuses style attributes
  puff.style.top = `${box.top + box.height / 2}px`;
  document.body.append(puff);
  setTimeout(() => puff.remove(), 800);
}
