import { h } from './dom.js';
import { emoji, icon } from './ui.js';

/**
 * Floating "something is ready" notices in the bottom-right corner: a scan to review, fresh
 * recipe ideas. One notice per key; showing a key again updates it in place without replaying
 * its entrance, so polling and page visits can call it freely.
 */
const stack = h('div', { class: 'ready-stack', 'aria-live': 'polite' });
const notices = new Map();

export function showReady(key, { symbol, title, detail, label = title, onOpen, onDismiss, dismissible = true }) {
  let notice = notices.get(key);
  if (!notice) {
    if (!stack.isConnected) document.body.append(stack);
    const art = h('span', { class: 'ready-art', 'aria-hidden': 'true' });
    const copy = h('span', { class: 'ready-copy' });
    const open = h('button', { class: 'ready-open', type: 'button' }, art, copy, h('span', { class: 'ready-go', 'aria-hidden': 'true' }, icon('arrow')));
    const dismiss = h('button', { class: 'ready-dismiss', type: 'button' }, icon('close'));
    const element = h('div', { class: 'ready-notice arriving', dataset: { kind: key } }, open, dismiss,
      h('span', { class: 'ready-sparkle ready-sparkle-one', 'aria-hidden': 'true' }, '✦'), h('span', { class: 'ready-sparkle ready-sparkle-two', 'aria-hidden': 'true' }, '✧'));
    element.addEventListener('animationend', (event) => { if (event.animationName === 'ready-arrive') element.classList.remove('arriving'); });
    notice = { element, art, copy, open, dismiss };
    notices.set(key, notice);
    stack.prepend(element);
  }
  // Page visits call this again with the same content: leave the drawn notice and its motion alone.
  const content = JSON.stringify([symbol, title, detail]);
  if (notice.content !== content) {
    notice.content = content;
    notice.art.replaceChildren(h('img', { class: 'ready-friend', src: '/assets/scoop-jar.svg', alt: '', width: 40, height: 46 }), emoji(symbol, 'ready-badge'));
    notice.copy.replaceChildren(h('strong', {}, title), h('span', {}, detail));
  }
  notice.open.setAttribute('aria-label', `${label}: ${detail}`);
  notice.dismiss.setAttribute('aria-label', `Dismiss: ${label}`);
  notice.dismiss.hidden = !dismissible;
  notice.open.onclick = () => { hideReady(key); onOpen?.(); };
  notice.dismiss.onclick = () => { hideReady(key); onDismiss?.(); };
}

export function hideReady(key) {
  const notice = notices.get(key);
  if (!notice) return;
  notices.delete(key);
  const { element } = notice;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { element.remove(); return; }
  element.classList.add('leaving');
  element.addEventListener('animationend', () => element.remove(), { once: true });
  setTimeout(() => element.remove(), 400);
}
