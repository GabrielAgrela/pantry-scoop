import { calmMotion, h, openDialog } from './dom.js';
import { t, tn } from './i18n.js';

// Scoop drawn inline (same art as /assets/scoop-jar.svg) so the lid, eyes and cheeks can move on their own.
const SCOOP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 128" fill="none" aria-hidden="true">
  <ellipse class="cs-shadow" cx="56" cy="119" rx="35" ry="5" fill="#e7b8ba" opacity=".35"/>
  <g class="cs-jar">
    <path d="M31 28h50v12l8 10v48c0 11-9 18-19 18H42c-10 0-19-7-19-18V50l8-10V28Z" fill="#fff1d7" stroke="#925569" stroke-width="2.5"/>
    <rect x="23" y="50" width="66" height="51" rx="12" fill="#f5c5cf"/>
    <path d="M36 43h38" stroke="#fffdf5" stroke-width="4" stroke-linecap="round"/>
    <g class="cs-cheeks"><ellipse cx="39" cy="78" rx="7" ry="4" fill="#e68d9e"/><ellipse cx="73" cy="78" rx="7" ry="4" fill="#e68d9e"/></g>
    <path class="cs-eyes" d="M43 67v4m26-4v4" stroke="#734853" stroke-width="3" stroke-linecap="round"/>
    <path class="cs-smile" d="M49 78c4 6 10 6 14 0" stroke="#734853" stroke-width="3" stroke-linecap="round"/>
    <path d="M50 99c-5-7-7-14 1-17 4-1 5 3 5 3s3-4 7-2c7 4 3 11-7 16Z" fill="#b75573"/>
  </g>
  <g class="cs-lid">
    <path d="M30 15h52v19H30z" fill="#eba6b7" stroke="#925569" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M38 15v19m12-19v19m12-19v19m12-19v19" stroke="#fff5ea" stroke-width="3"/>
  </g>
</svg>`;

// The CSP blocks style="" attributes, so per-element values go through the CSSOM.
const styled = (el, properties) => { for (const [name, value] of Object.entries(properties)) el.style.setProperty(name, value); return el; };

/** How long the order waits on screen before it goes to the AI. */
export const COUNTDOWN_SECONDS = 5;

/**
 * Shown when asking for ideas: Scoop tosses the chosen ingredients into the jar while a ticket
 * repeats the order back and a timer runs down. When the timer runs out the order is fine and
 * `onGo` sends it; Cancel, Escape or a tap outside drops it before anything reaches the AI.
 * `onClose` runs once the screen is gone, either way.
 */
export function openCookingScreen({ lines, toss, onGo, onClose }) {
  const scoop = document.importNode(new DOMParser().parseFromString(SCOOP, 'image/svg+xml').documentElement, true);
  // Staggered across one 2.6 s throw, alternating sides, so something is always on its way in.
  const tossed = toss.slice(0, 5);
  const flying = tossed.map((symbol, index) => styled(h('span', { class: 'cs-toss', 'aria-hidden': 'true' }, symbol),
    { '--from': `${(index % 2 ? 1 : -1) * (58 + index * 7)}px`, 'animation-delay': `${(index * 2.6 / tossed.length).toFixed(2)}s` }));
  const sparkles = ['✦', '✧', '✦'].map((symbol, index) => h('span', { class: `cs-sparkle cs-sparkle-${index + 1}`, 'aria-hidden': 'true' }, symbol));
  const stage = h('div', { class: 'cs-stage' }, h('span', { class: 'cs-halo', 'aria-hidden': 'true' }), ...sparkles, ...flying, h('span', { class: 'cs-scoop' }, scoop), h('span', { class: 'cs-confetti', 'aria-hidden': 'true' }));
  const heading = h('h2', {}, t('Scoop’s getting ready!'));
  const seconds = h('b', {}, String(COUNTDOWN_SECONDS));
  // The ticking number is for the eyes; screen readers hear the hint once instead of every second.
  const message = h('p', { class: 'cs-message', 'aria-hidden': 'true' }, ...t('Starting in {seconds}…').split(/(\{seconds\})/).map((part) => (part === '{seconds}' ? seconds : part)));
  const ticket = h('div', { class: 'cs-ticket' }, h('p', { class: 'cs-ticket-title' }, t('Your order')),
    h('ul', {}, ...lines.map((line, index) => styled(h('li', {},
      h('span', { class: 'cs-ticket-icon', 'aria-hidden': 'true' }, line.symbol),
      h('span', { class: 'cs-ticket-label' }, line.label),
      h('span', { class: 'cs-ticket-value' }, line.value)), { '--i': String(index) }))));
  const bar = styled(h('div', { class: 'cs-countdown', 'aria-hidden': 'true' }, h('i')), { '--countdown': `${COUNTDOWN_SECONDS}s` });
  const cancel = h('button', { type: 'button', class: 'cs-cancel' }, t('Cancel'));
  // Not shown: the countdown says it visually, but screen readers skip the ticking number and hear this once.
  const hint = h('span', { class: 'visually-hidden', id: 'cooking-screen-hint' }, t('Starts in {count} seconds. Nothing is sent if you cancel.', { count: COUNTDOWN_SECONDS }));
  const { dialog, close } = openDialog('cooking-screen', stage, heading, message, ticket, bar, cancel, hint);
  dialog.setAttribute('aria-describedby', hint.id);
  cancel.addEventListener('click', close);

  let left = COUNTDOWN_SECONDS, sent = false;
  const tick = setInterval(() => { left = Math.max(1, left - 1); seconds.textContent = String(left); }, 1000);
  const timer = setTimeout(go, COUNTDOWN_SECONDS * 1000);
  // However it closes (Cancel, Escape, tap outside, or after sending), openDialog ends with the close event.
  dialog.addEventListener('close', () => { clearInterval(tick); clearTimeout(timer); onClose?.(); }, { once: true });

  /** Time's up, so the order stands: send it, let Scoop cheer, then step aside for the cooking. */
  function go() {
    if (sent || !dialog.open || dialog.classList.contains('is-closing')) return; // already cancelled on its way out
    sent = true; clearInterval(tick);
    dialog.classList.add('is-sent');
    heading.textContent = t('Off to the kitchen!');
    message.textContent = t('Your ideas are on their way…');
    cancel.disabled = true; cancel.textContent = t('Sent!');
    onGo();
    setTimeout(close, calmMotion(dialog) ? 400 : 1100);
  }
  return { cancel: () => { if (!sent) close(); } };
}

/**
 * Shown instead of the countdown when this exact order was cooked before: Scoop pops the lid and
 * the earlier dishes peek out, with the ideas listed so they can be saved right here. `onNew`
 * asks for fresh ideas anyway; closing any other way sends nothing.
 */
export function openEarlierIdeas({ ideas, peek, onNew, onClose }) {
  const scoop = document.importNode(new DOMParser().parseFromString(SCOOP, 'image/svg+xml').documentElement, true);
  const shown = peek.slice(0, 3);
  const peeking = shown.map((symbol, index) => styled(h('span', { class: 'cs-peek', 'aria-hidden': 'true' }, symbol),
    { '--to': `${(index - (shown.length - 1) / 2) * 46 + 18}px`, 'animation-delay': `${(index * 0.35).toFixed(2)}s` }));
  const sparkles = ['✦', '✧', '✦'].map((symbol, index) => h('span', { class: `cs-sparkle cs-sparkle-${index + 1}`, 'aria-hidden': 'true' }, symbol));
  const stage = h('div', { class: 'cs-stage' }, h('span', { class: 'cs-halo', 'aria-hidden': 'true' }), ...sparkles, h('span', { class: 'cs-scoop' }, scoop), ...peeking);
  const heading = h('h2', {}, t('Scoop remembers!'));
  const message = h('p', { class: 'cs-message' }, tn(ideas.length, 'You asked for this exact order before, and that idea is still here.', 'You asked for this exact order before, and those ideas are still here.'));
  const ticket = h('div', { class: 'cs-ticket' }, h('p', { class: 'cs-ticket-title' }, t('Tap the heart to keep one')),
    h('ul', {}, ...ideas.map((idea, index) => styled(h('li', {}, idea), { '--i': String(index) }))));
  const done = h('button', { type: 'button', class: 'primary cs-done' }, t('Thanks, Scoop!'));
  const fresh = h('button', { type: 'button', class: 'text-button cs-fresh' }, t('Cook up new ones instead'));
  const { dialog, close } = openDialog('cooking-screen earlier-ideas', stage, heading, message, ticket, done, fresh);
  done.addEventListener('click', close);
  fresh.addEventListener('click', () => { close(); onNew(); });
  dialog.addEventListener('close', () => onClose?.(), { once: true });
  return { cancel: close };
}
