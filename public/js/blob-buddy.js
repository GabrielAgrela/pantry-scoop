import { _parts } from '../vendor/blobatar/internal.js';
import * as poses from '../vendor/blobatar/expression.js';
import { gaze } from '../vendor/blobatar/gaze.js';

/**
 * Your blob buddy: an animated blobatar that breathes, blinks and glances around, and wears a mood
 * that follows the app. It thinks while an AI job runs, cheers when one lands, droops on errors and
 * dozes late at night. Every mounted buddy shares the mood, so the header and the menu agree.
 *
 * The library renders markup with inline `style` attributes, which our CSP refuses, so the SVG is
 * parsed inertly and those declarations are re-applied through the CSSOM instead.
 */

const SVG = 'http://www.w3.org/2000/svg';
const buddies = new Set();
const running = new Set();
let burst;
let burstTimer;
let wakeTimer;

/** What each mood says in the menu, a few options each so it does not repeat itself. */
const LINES = {
  idle: ['Hi there!', 'Hungry?', 'What’s cooking?', 'Ready when you are'],
  happy: ['Yay!', 'Look at that!', 'Nice one!'],
  sad: ['Oh no…', 'That didn’t work'],
  love: ['Ooh, a keeper!', 'Saved with love'],
  thinking: ['Hmm, let me think…', 'Cooking up ideas…'],
  sleepy: ['zzz… late snack?', 'Yawn… still up?'],
  surprised: ['Whoa!', 'Eep!'],
  wink: ['Hehe', '😉'],
  smug: ['I knew it', 'Chef’s kiss'],
  shy: ['Oh, hi…', 'Stop it, you'],
};
const POKES = ['happy', 'surprised', 'wink', 'love', 'smug', 'shy'];

for (const file of ['motion.css', 'gaze.css']) {
  const href = new URL(`../vendor/blobatar/${file}`, import.meta.url).href;
  if (!document.querySelector(`link[href="${href}"]`)) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href }));
}

/**
 * An animated blobatar for `seed`. Returns { el, poke, follow }: `poke` plays a random reaction,
 * `follow(true)` makes the eyes track the pointer (worth it only at larger sizes).
 */
export function blobBuddy(seed, { className = '', speech, crop = 0 } = {}) {
  const svg = document.createElementNS(SVG, 'svg');
  // Cropping the viewBox zooms in: the body only fills the middle ~70% of the library's frame.
  svg.setAttribute('viewBox', `${crop} ${crop} ${100 - 2 * crop} ${100 - 2 * crop}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `blob-buddy ${className}`.trim());
  const first = _parts(seed, { animate: 'always' });
  const root = document.createElementNS(SVG, 'g');
  root.append(...inertNodes(first.inner));
  svg.append(root);

  let vars = [];
  let shown;
  let driver;
  let pokes = 0;
  const buddy = {
    el: svg,
    show(mood) {
      if (mood === shown) return;
      shown = mood;
      const parts = _parts(seed, { animate: 'always', expression: poses[mood] ?? poses.idle });
      // Only the class and the custom properties change, so the CSS morph runs and the idle loops keep their phase.
      root.setAttribute('class', parts.cls);
      for (const name of vars) svg.style.removeProperty(name);
      vars = Object.keys(parts.vars);
      for (const [name, value] of Object.entries(parts.vars)) svg.style.setProperty(name, value);
      if (speech) {
        speech.textContent = pick(LINES[mood] ?? LINES.idle);
        if (speech.animate && !calm()) speech.animate([{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1.08)', opacity: 1, offset: 0.6 }, { transform: 'none' }], { duration: 320, easing: 'ease-out' });
      }
    },
    poke() {
      feel(POKES[pokes++ % POKES.length], 1400);
      if (svg.animate && !calm()) {
        svg.animate([{ transform: 'none' }, { transform: 'scale(1.12, .86)', offset: 0.25 }, { transform: 'scale(.92, 1.1) translateY(-6%)', offset: 0.55 }, { transform: 'none' }], { duration: 520, easing: 'ease-out' });
      }
    },
    follow(on) {
      if (on && !driver) driver = gaze(svg, { target: 'pointer' });
      else if (!on && driver) { driver.stop(); driver = undefined; }
    },
  };
  buddies.add(buddy);
  buddy.show(mood());
  return buddy;
}

/** A short-lived reaction (happy, sad, love…) for every buddy, then back to the resting mood. */
export function feel(name, ms = 2200) {
  burst = name;
  clearTimeout(burstTimer);
  burstTimer = setTimeout(() => { burst = undefined; refresh(); }, ms);
  refresh();
}

/** Tracks AI jobs: buddies think while any is running and react when one finishes. */
export function jobUpdate(job) {
  if (job.status === 'running') running.add(job.id);
  else if (running.delete(job.id)) return feel(job.status === 'succeeded' ? 'happy' : 'sad', 2600);
  refresh();
}

/** A watcher stopped before its job finished: stop thinking about it, without a reaction. */
export function jobForgotten(job) {
  if (running.delete(job.id)) refresh();
}

/** Bedtime and wake-up: the header blob dozes off under a moon, or wakes to a burst of sunshine. */
document.addEventListener('themeswitch', ({ detail: { dark } }) => {
  clearTimeout(wakeTimer);
  if (dark) feel('sleepy', 3200);
  else { feel('surprised', 500); wakeTimer = setTimeout(() => feel('happy', 1800), 500); }
  // The theme sweeps in as a wave from the top-left, so wait for it to reach the header.
  if (!calm()) setTimeout(() => themePuff(dark), 380);
});

function themePuff(dark) {
  const avatar = [...buddies].find((buddy) => buddy.el.classList.contains('avatar') && buddy.el.isConnected)?.el;
  if (!avatar) return;
  const box = avatar.getBoundingClientRect();
  const puff = document.createElement('span');
  puff.className = `theme-puff ${dark ? 'night' : 'day'}`;
  puff.setAttribute('aria-hidden', 'true');
  puff.style.left = `${box.left + box.width / 2}px`; // CSSOM, since the CSP refuses style attributes
  puff.style.top = `${box.top + box.height / 2}px`;
  const bits = dark ? ['🌙', 'z', 'z', 'Z'] : ['☀️', '✦', '✧', '✦', '✧', '✦', '✧'];
  puff.append(...bits.map((text, i) => {
    const bit = document.createElement('span');
    bit.textContent = text;
    let frames;
    if (dark && i === 0) frames = [{ transform: 'translate(-26px, 22px) rotate(-30deg) scale(.2)', opacity: 0 }, { transform: 'translate(-30px, 18px) rotate(8deg) scale(1.15)', opacity: 1, offset: 0.35 }, { transform: 'translate(-30px, 18px) rotate(-6deg)', opacity: 1, offset: 0.8 }, { transform: 'translate(-30px, 14px)', opacity: 0 }];
    // The header sits at the top of the screen, so the z's drift left along it rather than up and away.
    else if (dark) frames = [{ transform: 'translate(-8px, -4px) scale(.4)', opacity: 0 }, { transform: `translate(${-22 - i * 10}px, ${-8 - i * 3}px) rotate(${i % 2 ? 10 : -10}deg)`, opacity: 1, offset: 0.4 }, { transform: `translate(${-40 - i * 16}px, ${-12 - i * 4}px) scale(1.25)`, opacity: 0 }];
    else if (i === 0) frames = [{ transform: 'translate(-34px, 0) rotate(-90deg) scale(.2)', opacity: 0 }, { transform: 'translate(-38px, -6px) rotate(20deg) scale(1.25)', opacity: 1, offset: 0.4 }, { transform: 'translate(-38px, -6px) rotate(60deg)', opacity: 1, offset: 0.8 }, { transform: 'translate(-38px, -10px) rotate(90deg) scale(.8)', opacity: 0 }];
    else {
      const angle = Math.PI * (0.15 + (1.7 * (i - 1)) / (bits.length - 2)), reach = 34 + (i % 2) * 10;
      frames = [{ transform: 'scale(.2)', opacity: 0 }, { transform: `translate(${Math.cos(angle) * reach * 0.7}px, ${Math.sin(angle) * reach * 0.7}px) scale(1.2)`, opacity: 1, offset: 0.45 }, { transform: `translate(${Math.cos(angle) * reach}px, ${Math.sin(angle) * reach}px) rotate(45deg) scale(.4)`, opacity: 0 }];
    }
    bit.animate(frames, { duration: dark ? 2000 : 1100, delay: dark ? i * 260 : i * 30, easing: 'ease-out', fill: 'both' });
    return bit;
  }));
  document.body.append(puff);
  avatar.animate(dark
    ? [{ transform: 'none' }, { transform: 'scale(1.06, .9) translateY(4%)', offset: 0.3 }, { transform: 'rotate(-8deg) translateY(3%)', offset: 0.7 }, { transform: 'none' }]
    : [{ transform: 'none' }, { transform: 'scale(.9, 1.12) translateY(-10%)', offset: 0.3 }, { transform: 'scale(1.06, .95)', offset: 0.65 }, { transform: 'none' }],
  { duration: dark ? 1400 : 650, easing: 'ease-in-out' });
  setTimeout(() => puff.remove(), dark ? 3200 : 1400);
}

function mood() {
  if (burst) return burst;
  if (running.size) return 'thinking';
  const hour = new Date().getHours();
  return hour >= 23 || hour < 6 ? 'sleepy' : 'idle';
}

function refresh() {
  const current = mood();
  for (const buddy of buddies) {
    if (buddy.el.isConnected) buddy.show(current);
    else { buddy.follow(false); buddies.delete(buddy); } // re-rendered away
  }
}
setInterval(refresh, 5 * 60 * 1000); // bedtime arrives on its own

/** Parses library markup, moving its inline styles into the CSSOM (parsing them would trip the CSP). */
function inertNodes(markup) {
  const safe = markup.replace(/ style="/g, ' data-style="');
  const doc = new DOMParser().parseFromString(`<svg xmlns="${SVG}">${safe}</svg>`, 'image/svg+xml');
  const nodes = [...doc.documentElement.childNodes].map((node) => document.adoptNode(node));
  for (const node of nodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    for (const el of [node, ...node.querySelectorAll('[data-style]')]) {
      const declarations = el.getAttribute('data-style');
      if (declarations === null) continue;
      el.removeAttribute('data-style');
      for (const declaration of declarations.split(';')) {
        const colon = declaration.indexOf(':');
        if (colon > 0) el.style.setProperty(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
      }
    }
  }
  return nodes;
}

function calm() {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function pick(lines) {
  return lines[Math.floor(Math.random() * lines.length)];
}
