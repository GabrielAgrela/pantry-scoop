// The promo's motion design. Every frame is a pure function of its index: renderFrame(n) draws
// output frame n (60 fps, 1080×1920) from the captured app footage and capture.json's events.
//
// It plays as a tutorial a first-time viewer can follow. A band at the top always says, in one
// sentence, what happens next, and each chapter opens there with its title. Before every step the
// footage pauses while a spotlight dims the screen around the button about to be tapped (or the
// result to look at). Then the step plays at real speed.

const FPS = 60;
const W = 1080, H = 1920;
const INTRO = 3.0, OUTRO = 3.9;
const PT = 640 / 390; // phone pixels per app point
const STATUS = 47; // status bar height in points; the app viewport sits below it
const PHONE_W = 690, PHONE_H = 1435, ORIGIN_X = PHONE_W / 2, ORIGIN_Y = PHONE_H / 2;
const BAND_H = 480; // the band at the top where every step is read
const ZOOM = 1.1; // phone scale during the show
const CY_TOP = BAND_H + 18 + ORIGIN_Y * ZOOM; // phone centre with its top just under the band
const CY_BOTTOM = H - 14 - ORIGIN_Y * ZOOM; // phone centre with its bottom at the foot of the frame
const PAUSE = { chapter: 1.75, tap: 0.95, swipe: 0.85, note: 1.15 }; // seconds the footage waits
const DAY = { ink: '#493442', hot: '#b64967', muted: '#6f5667', band: '#fffcf8', chip: '#fbe2e9', dot: '#f0dbe2', dotDone: '#e3a2b8' };
const NIGHT = { ink: '#fff2e9', hot: '#f7b6cd', muted: '#d8c1d3', band: '#2e2535', chip: '#4a3446', dot: '#4c3c4f', dotDone: '#a1708c' };
const ORDER = ['onboarding', 'scan', 'tidy', 'recipes', 'dark'];
const CHAPTERS = {
  onboarding: { emoji: '👋', words: ['Meet', '*Scoop*'], name: 'Meet Scoop', sub: 'your tiny kitchen chef' },
  scan: { emoji: '📸', words: ['Snap', 'your', '*groceries*'], name: 'Snap your groceries', sub: 'one photo fills your pantry' },
  tidy: { emoji: '✨', words: ['Keep', 'it', '*tidy*'], name: 'Keep it tidy', sub: 'restock and sort in a tap' },
  recipes: { emoji: '🍝', words: ['Cook', 'what', 'you', '*have*'], name: 'Cook what you have', sub: 'ideas made from your pantry' },
  dark: { emoji: '🌙', words: ['Cozy', '*night*', 'mode'], name: 'Cozy night mode', sub: 'sweet dreams, little pantry' },
};

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
const easeInOut = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };
const easeOut = (t) => 1 - (1 - clamp(t)) ** 3;
const easeIn = (t) => clamp(t) ** 3;
/** A damped spring from 0 to 1 (t in seconds); overshoots a little, settles in ~0.6 s. */
const spring = (t, k = 15, d = 7) => (t <= 0 ? 0 : 1 - Math.exp(-d * t) * Math.cos(k * t));
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const blend = (a, b, t) => a.map((v, i) => Math.round(lerp(v, b[i], t)));
const css = (c) => `rgb(${c.join(',')})`;

let cap, events, taps, drags, steps, beats, stepBeats, chapterBeats, srcTable, total, footageEnd, camera, tapTimes = [];
const ev = (type) => events.find((e) => e.type === type)?.t;
const focusRect = (label) => events.find((e) => e.type === 'focus' && e.label === label)?.rect;

// ---------------------------------------------------------------------------------------------
// Steps and timeline: every logged step gets a pause before it (a longer one opens each chapter),
// and the footage maps onto output time through those pauses and a few gently faster waits.
// ---------------------------------------------------------------------------------------------
function buildSteps() {
  let chapter = ORDER[0];
  steps = [];
  for (const e of events) {
    if (e.type === 'mark' && CHAPTERS[e.label]) chapter = e.label;
    if (!e.step) continue;
    const kind = e.type === 'swipe' ? 'swipe' : e.type === 'note' ? 'note' : 'tap';
    // A tap pauses just before the finger lands; a result pauses on the result.
    const point = Math.max(0, kind === 'tap' ? e.t - 0.2 : kind === 'swipe' ? e.t - 0.05 : e.t);
    const focus = e.rect ? e.rect.y + Math.min(e.rect.h, 420) / 2 : (e.y + e.y2) / 2;
    steps.push({ kind, chapter, text: e.step, point, focus, rect: e.rect, e });
  }
  for (const mark of ORDER) steps.filter((s) => s.chapter === mark).forEach((s, index, list) => Object.assign(s, { index, count: list.length }));
}

function buildTimeline() {
  footageEnd = cap.frames / FPS;
  const ramps = [
    [ev('photo') + 0.15, ev('review') - 0.1, 1.35], // Scoop reads the photo
    [ev('thinking') + 0.3, ev('ideas') - 0.1, 1.35], // Scoop thinks up ideas
  ];
  const speedAt = (s) => {
    let v = 1;
    for (const [a, b, k] of ramps) v += (k - 1) * smooth((s - a) / 0.2) * (1 - smooth((s - (b - 0.2)) / 0.2));
    return v;
  };
  const holds = [];
  for (const step of steps) {
    if (step.index === 0) holds.push({ kind: 'chapter', chapter: step.chapter, point: step.point, seconds: PAUSE.chapter });
    holds.push({ kind: step.kind, chapter: step.chapter, point: step.point, seconds: PAUSE[step.kind], step });
  }
  holds.sort((a, b) => a.point - b.point); // stable: a chapter's title comes before its first step
  srcTable = [];
  for (let n = 0; n < Math.round(INTRO * FPS); n++) srcTable.push(0);
  beats = [];
  let s = 0, next = 0;
  while (s < footageEnd - 1 / FPS) {
    while (next < holds.length && holds[next].point <= s + 1e-6) {
      const hold = holds[next++];
      s = Math.max(s, hold.point); // so outAt(point) finds the start of the pause
      const start = srcTable.length / FPS;
      for (let k = 0; k < Math.round(hold.seconds * FPS); k++) srcTable.push(s);
      beats.push({ ...hold, start, end: srcTable.length / FPS });
    }
    srcTable.push(s);
    s = Math.min(s + speedAt(s) / FPS, next < holds.length ? holds[next].point : Infinity);
  }
  for (let n = 0; n < Math.round(OUTRO * FPS); n++) srcTable.push(footageEnd - 1 / FPS);
  total = srcTable.length;
  beats.forEach((b, i) => { b.next = beats[i + 1]?.start ?? footageStop(); });
  stepBeats = beats.filter((b) => b.step);
  chapterBeats = beats.filter((b) => b.kind === 'chapter');
  // The spotlight lifts as a tap lands (the screen often changes right after) and soon after a
  // result plays on, and is gone before the next step.
  for (const b of stepBeats) {
    const e = b.step.e;
    const until = b.kind === 'tap' ? outAt(e.t) + e.hold / 1000 + 0.05 : b.kind === 'note' ? b.end + 0.5 : b.end;
    b.spotEnd = Math.max(b.end, Math.min(until, b.next - 0.25));
  }
}
const srcAt = (t) => srcTable[clamp(Math.round(t * FPS), 0, total - 1)];
let stopAt;
const footageStop = () => (stopAt ??= srcTable.findIndex((s, n) => n > INTRO * FPS && s >= footageEnd - 1.5 / FPS) / FPS);
/** Output time at which the footage reaches source time s. */
function outAt(s) {
  if (s <= 0) return INTRO;
  const n = srcTable.findIndex((v, i) => i >= INTRO * FPS && v >= s);
  return (n < 0 ? total : n) / FPS;
}
/** When a step's sentence arrives in the band, once the previous line (or the chapter's title) has left. */
const textAt = (b) => b.start + (b.step.index === 0 ? 0.28 : 0.13);
const TEXT_OUT = 0.15; // a sentence leaves this fast
const HERO_IN = 0.15; // a chapter's title waits this long for the last sentence to leave
/** 0…1 while a chapter title is up: the phone steps back and its screen softens. */
function veilAt(t) {
  let v = 0;
  for (const b of chapterBeats) v = Math.max(v, smooth((t - b.start + 0.1) / 0.3) * (1 - smooth((t - b.end + 0.25) / 0.3)));
  return v;
}

// ---------------------------------------------------------------------------------------------
// Stickers: emoji with a thick white outline and a soft plum shadow, baked once.
// ---------------------------------------------------------------------------------------------
const stickerCache = new Map();
function sticker(symbol, size) {
  const key = `${symbol}@${size}`;
  if (stickerCache.has(key)) return stickerCache.get(key);
  const outline = Math.max(5, Math.round(size * 0.075)), pad = outline + 24, dim = size + pad * 2;
  const make = () => { const c = document.createElement('canvas'); c.width = c.height = dim; return c; };
  const glyph = make(), g = glyph.getContext('2d');
  g.font = `${Math.round(size * 0.84)}px "Noto Color Emoji"`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(symbol, dim / 2, dim / 2 + size * 0.05);
  const tint = (color) => { const c = make(), x = c.getContext('2d'); x.drawImage(glyph, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, dim, dim); return c; };
  const white = tint('#ffffff'), plum = tint('#6b3552');
  const out = make(), o = out.getContext('2d');
  o.filter = `blur(${Math.round(size * 0.06)}px)`; o.globalAlpha = 0.22;
  for (let a = 0; a < 12; a++) o.drawImage(plum, Math.cos(a / 12 * Math.PI * 2) * outline, Math.sin(a / 12 * Math.PI * 2) * outline + size * 0.07);
  o.filter = 'none'; o.globalAlpha = 1;
  for (let a = 0; a < 20; a++) o.drawImage(white, Math.cos(a / 20 * Math.PI * 2) * outline, Math.sin(a / 20 * Math.PI * 2) * outline);
  o.drawImage(glyph, 0, 0);
  stickerCache.set(key, out);
  return out;
}
function drawSticker(ctx, symbol, size, x, y, { scale = 1, rot = 0, alpha = 1 } = {}) {
  if (scale <= 0.01 || alpha <= 0.01) return;
  const img = sticker(symbol, size);
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(rot * Math.PI / 180); ctx.scale(scale, scale);
  ctx.drawImage(img, -img.width / 2, -img.height / 2); ctx.restore();
}
function star4(ctx, x, y, r, color, rot = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = color; ctx.beginPath();
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * 0.32 : r; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); }
  ctx.closePath(); ctx.fill(); ctx.restore();
}
function heart(ctx, x, y, s, color) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s / 32, s / 32); ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(0, 10); ctx.bezierCurveTo(-26, -8, -12, -30, 0, -14); ctx.bezierCurveTo(12, -30, 26, -8, 0, 10); ctx.fill(); ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// The world behind the phone: pastel day, starry night, swept over by the app's own theme wave.
// ---------------------------------------------------------------------------------------------
const bg = $('bg').getContext('2d');
const STARS = (() => { const r = rng(7); return Array.from({ length: 90 }, () => ({ x: r() * W, y: r() * H, s: 1 + r() * 2.6, p: r() * 6.28, k: 0.6 + r() * 1.6 })); })();
function world(ctx, night, t) {
  const top = night ? '#30243a' : '#fff6ef', bottom = night ? '#1b1522' : '#fde9ef';
  const grad = ctx.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, top); grad.addColorStop(1, bottom);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  const blobs = night
    ? [['#4a2f57', 160, 360, 520], ['#5c2f4b', 960, 900, 560], ['#20383d', 120, 1500, 520], ['#3b2d5c', 900, 1700, 480]]
    : [['#ffd3e0', 130, 330, 560], ['#ece0fb', 980, 880, 600], ['#d8f1e2', 110, 1520, 560], ['#fff0c6', 960, 1660, 520]];
  blobs.forEach(([color, x, y, r], i) => {
    const bx = x + Math.sin(t * 0.35 + i * 1.7) * 60, by = y + Math.cos(t * 0.3 + i * 2.3) * 50, br = r * (1 + Math.sin(t * 0.5 + i) * 0.06);
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    g.addColorStop(0, color); g.addColorStop(1, color + '00');
    ctx.fillStyle = g; ctx.fillRect(bx - br, by - br, br * 2, br * 2);
  });
  // The app's dotted paper, drifting very slowly.
  ctx.fillStyle = night ? 'rgba(255, 220, 240, .07)' : 'rgba(182, 73, 103, .09)';
  const off = (t * 9) % 38;
  for (let y = -38 + off; y < H; y += 38) for (let x = (Math.floor(y / 38) % 2) * 19 - 38 + off * 0.5; x < W; x += 38) { ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 6.283); ctx.fill(); }
  if (night) for (const s of STARS) {
    const a = 0.35 + 0.65 * Math.abs(Math.sin(t * s.k + s.p));
    ctx.globalAlpha = a; star4(ctx, s.x, s.y, s.s * 2.2, s.s > 2.6 ? '#ffe7a8' : '#fff4fa', s.p); ctx.globalAlpha = 1;
  }
}
/** The app's diagonal theme wave (public/js/theme.js), as a clip polygon over the whole stage. */
function wavePath(ctx, p) {
  const len = Math.hypot(W, H), nx = H / len, ny = W / len, tx = -ny, ty = nx;
  const amp = Math.min(W, H) * 0.04 + 12, k = (2 * Math.PI) / Math.max(180, len / 5);
  const from = -(W * W) / len - amp * 2, to = (H * H) / len + amp * 2, points = Math.ceil((to - from) / 12), behind = len * 2;
  const r = -amp * 2 + ((2 * W * H) / len + amp * 4) * p, swell = amp * (Math.sin(Math.PI * p) + 0.35), phase = p * Math.PI * 3;
  ctx.beginPath();
  let first, last;
  for (let i = 0; i <= points; i++) {
    const s = from + ((to - from) * i) / points;
    const d = r + swell * (Math.sin(k * s + phase) + 0.35 * Math.sin(2.3 * k * s - 1.7 * phase));
    const x = nx * d + tx * s, y = ny * d + ty * s;
    if (!i) { ctx.moveTo(x, y); first = [x, y]; } else ctx.lineTo(x, y);
    last = [x, y];
  }
  ctx.lineTo(last[0] - nx * behind, last[1] - ny * behind); ctx.lineTo(first[0] - nx * behind, first[1] - ny * behind); ctx.closePath();
}

// Stickers frame the title cards only: groceries around the hello, a night sky around goodnight.
const SLOTS = [[96, 560, 104, -8], [986, 640, 98, 10], [76, 905, 90, 6], [1004, 975, 108, -6], [100, 1255, 100, 9], [980, 1330, 94, -10], [82, 1610, 108, -4], [1000, 1690, 96, 7], [176, 1850, 84, 12], [902, 1862, 90, -9], [74, 112, 72, -12], [1006, 104, 76, 12]];
const INTRO_SET = ['🍋', '🍅', '🌿', '🧁', '🥑', '🍓', '🥕', '🧀', '🍯', '🫖', '✨', '💗'];
const NIGHT_SET = ['🌙', '⭐', '☁️', '💤', '🌟', '✨', '🫖', '🍪', '⭐', '🌙', '💫', '✨'];
function drawSlots(ctx, t, nightP) {
  const outroAt = footageStop() + 0.25;
  if (t > INTRO + 0.3 && t < outroAt) return;
  SLOTS.forEach(([x, y, size, rot], i) => {
    const bob = Math.sin((t / 3.4 + i * 0.37) * Math.PI * 2) * 10, wob = Math.sin((t / 4.6 + i * 0.21) * Math.PI * 2) * 7;
    const intro = t <= INTRO + 0.3;
    const scale = intro
      ? spring(t - 0.15 - i * 0.05, 14, 7) * (1 - easeIn((t - (INTRO - 0.6) - i * 0.02) / 0.3)) // they pop away as the phone arrives
      : spring(t - outroAt - i * 0.04, 16, 8);
    drawSticker(ctx, intro ? INTRO_SET[i] : NIGHT_SET[i], size, x, y + bob, { scale, rot: rot + wob, alpha: lerp(0.92, 0.82, nightP) });
  });
}
function drawBackground(t) {
  const night = nightProgress(t);
  world(bg, false, t);
  if (night > 0) { bg.save(); wavePath(bg, night); bg.clip(); world(bg, true, t); bg.restore(); }
  drawSlots(bg, t, night);
}
function nightProgress(t) {
  const p = clamp((t - outAt(ev('night') + 0.12)) / 1.05);
  return p <= 0 ? 0 : p >= 1 ? 1 : bezier(0.45, 0, 0.2, 1, p);
}
/** cubic-bezier easing, solved numerically (same curve as the app's wave). */
function bezier(x1, y1, x2, y2, x) {
  const f = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (f(x1, x2, mid) < x) lo = mid; else hi = mid; }
  return f(y1, y2, (lo + hi) / 2);
}

// ---------------------------------------------------------------------------------------------
// The band: a chapter's title while the footage waits, then the chapter's name, one sentence for
// the current step and a dot per step, always in the same place.
// ---------------------------------------------------------------------------------------------
const band = {};
function buildBand() {
  const root = $('band');
  ORDER.forEach((mark, i) => {
    const def = CHAPTERS[mark];
    const hero = el('div', 'hero'), num = el('div', 'hero-num', `Part ${i + 1} of ${ORDER.length}`), title = el('div', 'hero-title'), sub = el('div', 'hero-sub', def.sub);
    const words = def.words.map((w) => {
      const span = el('span', 'word');
      if (!w.startsWith('*')) { span.textContent = w; return span; }
      span.classList.add('hot'); span.textContent = w.slice(1, -1);
      span.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 200 30" preserveAspectRatio="none"><path d="M4 18 C 40 6, 70 26, 104 15 S 168 8, 196 16"/></svg>');
      return span;
    });
    const emoji = el('span', 'sticker', def.emoji);
    title.append(...words, emoji);
    hero.append(num, title, sub);
    const head = el('div', 'head');
    head.append(el('span', 'num', `${i + 1}/${ORDER.length}`), el('span', '', def.name), el('span', 'emo', def.emoji));
    const own = stepBeats.filter((b) => b.chapter === mark);
    const dots = el('div', 'dots'), dotEls = own.map(() => dots.appendChild(el('div', 'dot')));
    root.append(hero, head, dots);
    // A long title shrinks to fit.
    title.style.display = 'inline-block';
    const width = title.offsetWidth;
    title.style.display = '';
    if (width > 980) title.style.fontSize = `${Math.floor((96 * 980) / width)}px`;
    const path = title.querySelector('.hot path');
    path.style.strokeDasharray = '200';
    const k = chapterBeats.findIndex((b) => b.chapter === mark), beat = chapterBeats[k];
    band[mark] = {
      hero, num, words, emoji, sub, path, head, dots, dotEls,
      from: i === 0 ? INTRO - 0.2 : beat.start, until: beat.end, next: chapterBeats[k + 1]?.start ?? footageStop(), stepStarts: own.map((b) => b.start),
    };
  });
  for (const b of stepBeats) root.append((b.el = el('div', `step-text${b.kind === 'note' ? ' result' : ''}`, b.step.text)));
}
function drawChapter(t, c, pal) {
  // The title, while the footage waits at the start of the chapter.
  const local = t - c.from - HERO_IN, leaving = t - c.until;
  const heroOn = local > -0.05 && leaving < 0.3;
  c.hero.style.display = heroOn ? '' : 'none';
  if (heroOn) {
    const n = easeOut(local / 0.3), nOut = easeIn(leaving / 0.16);
    c.num.style.opacity = String(n * (1 - nOut));
    c.num.style.transform = `translateY(${(1 - n) * 18 - nOut * 30}px)`;
    c.words.forEach((word, i) => {
      const k = spring(local - 0.06 - i * 0.075, 16, 7.5);
      const out = easeIn((leaving - i * 0.025) / 0.16);
      const scale = Math.max(0, (0.35 + 0.65 * k) * (1 - out * 0.6));
      word.style.transform = `translateY(${(1 - k) * 46 - out * 60}px) rotate(${(1 - k) * (i % 2 ? 9 : -9)}deg) scale(${scale})`;
      word.style.opacity = String(clamp((local - 0.06) / 0.12 - i * 0.5) * (1 - out));
    });
    const e = spring(local - 0.06 - c.words.length * 0.075 - 0.08, 14, 6), eOut = easeIn((leaving - 0.04) / 0.16);
    const wiggle = Math.sin((local - 0.5) * 9) * 14 * Math.exp(-Math.max(0, local - 0.5) * 2.2) + Math.sin(local * 2.6) * 6;
    c.emoji.style.transform = `rotate(${(1 - e) * -40 + wiggle}deg) scale(${Math.max(0, e * (1 - eOut))})`;
    c.path.style.strokeDashoffset = String(200 * (1 - easeOut((local - 0.4) / 0.45)));
    c.path.style.opacity = String(1 - easeIn(leaving / 0.14));
    const s = easeOut((local - 0.38) / 0.4), sOut = easeIn(leaving / 0.16);
    c.sub.style.opacity = String(s * (1 - sOut));
    c.sub.style.transform = `translateY(${(1 - s) * 24 - sOut * 20}px)`;
  }
  // The chapter's name and its progress dots, through its steps.
  const h = t - c.until - 0.2, hOut = t - c.next; // after the title's 'Part n of 5' has gone
  const headOn = h > 0 && hOut < TEXT_OUT;
  c.head.style.display = c.dots.style.display = headOn ? '' : 'none';
  if (!headOn) return;
  const k = easeOut(h / 0.35), o = 1 - easeIn(hOut / TEXT_OUT);
  c.head.style.opacity = c.dots.style.opacity = String(k * o);
  c.head.style.transform = `translateY(${(1 - k) * -18}px)`;
  c.dotEls.forEach((dot, j) => {
    const s0 = c.stepStarts[j], s1 = c.stepStarts[j + 1] ?? c.next;
    const now = easeOut((t - s0) / 0.3) * (1 - easeOut((t - s1) / 0.3));
    dot.style.width = `${20 + 32 * now}px`;
    dot.style.background = css(blend(t >= s1 ? pal.dotDone : pal.dot, pal.hot, now));
  });
}
function drawBand(t) {
  const night = smooth(nightProgress(t) * 1.5 - 0.25);
  const pal = Object.fromEntries(Object.keys(DAY).map((k) => [k, blend(rgb(DAY[k]), rgb(NIGHT[k]), night)]));
  const stage = $('stage').style;
  for (const [k, v] of Object.entries(pal)) stage.setProperty(`--${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`, css(v));
  const enter = spring(t - (INTRO - 0.45), 12, 7), leave = easeInOut((t - footageStop()) / 0.55);
  const root = $('band');
  root.style.display = enter <= 0.001 || leave >= 1 ? 'none' : '';
  root.style.transform = `translateY(${(1 - enter) * -560 - leave * 580}px)`;
  for (const mark of ORDER) drawChapter(t, band[mark], pal);
  for (const b of stepBeats) {
    const d = t - textAt(b), out = t - b.next;
    const on = d > 0 && out < TEXT_OUT;
    b.el.style.display = on ? '' : 'none';
    if (!on) continue;
    const k = spring(d, 15, 8), o = easeIn(out / TEXT_OUT);
    b.el.style.opacity = String(clamp(d / 0.14) * (1 - o));
    b.el.style.transform = `translateY(${(1 - k) * 44 - o * 36}px) scale(${(0.92 + 0.08 * k) * (1 - 0.04 * o)})`;
  }
}

// ---------------------------------------------------------------------------------------------
// Camera: the phone stays put while a step plays and glides only during the pause before the
// next one, so that step's button (or result) sits in view under the band.
// ---------------------------------------------------------------------------------------------
const local = (x, y) => [25 + x * PT, 25 + (STATUS + y) * PT]; // app point → phone element px
const camTarget = (focus) => clamp((BAND_H + H) / 2 - (local(0, focus)[1] - ORIGIN_Y) * ZOOM, CY_BOTTOM, CY_TOP);
function buildCamera() {
  camera = new Float32Array(total);
  let from = camTarget(steps[0].focus), to = from, moveStart = 0, moveDur = 1, i = 0;
  for (let n = 0; n < total; n++) {
    const t = n / FPS;
    while (i < stepBeats.length && stepBeats[i].start <= t + 1e-6) {
      const b = stepBeats[i++];
      from = lerp(from, to, easeInOut((t - moveStart) / moveDur));
      to = camTarget(b.step.focus); moveStart = b.start; moveDur = Math.min(0.62, b.end - b.start);
    }
    camera[n] = lerp(from, to, easeInOut((t - moveStart) / moveDur));
  }
}
function phonePose(t) {
  let x = 540, y = camera[clamp(Math.round(t * FPS), 0, total - 1)], s = ZOOM, rx = 0, ry = 0, rz = 0;
  // While a chapter title is up, the phone steps back a touch and sways.
  const v = veilAt(t);
  s *= 1 - 0.03 * v; y += 10 * v;
  ry += Math.sin((t / 6.1) * Math.PI * 2 + 1) * 2.2 * v; rx += Math.sin((t / 4.7) * Math.PI * 2 + 2) * 1.2 * v;
  // Entrance: springs up from below with a tilt, as the band drops in.
  const enter = spring(t - (INTRO - 0.8), 10, 5.5);
  y += (1 - enter) * 1500; rx += (1 - enter) * 26; rz += (1 - enter) * -9; s *= lerp(0.88, 1, clamp(enter));
  // Ending: steps back and down so the title card can take over.
  const end = easeInOut((t - footageStop()) / 0.95);
  y = lerp(y, 1540, end); s = lerp(s, 0.66, end); rz += -5 * end; ry += 9 * end;
  // Each tap gives the phone a tiny squish, as if it felt the finger.
  for (const tapAt of tapTimes) { const d = t - tapAt; if (d > -0.05 && d < 0.3) s *= 1 - 0.005 * Math.sin(clamp((d + 0.05) / 0.35) * Math.PI); }
  return { x, y, s, rx, ry, rz };
}
let phoneMatrix;
function placePhone(pose) {
  const list = `translate(${pose.x - ORIGIN_X}px, ${pose.y - ORIGIN_Y}px) perspective(2600px) rotateX(${pose.rx}deg) rotateY(${pose.ry}deg) rotateZ(${pose.rz}deg) scale(${pose.s})`;
  $('phone').style.transform = list;
  phoneMatrix = new DOMMatrix().translate(ORIGIN_X, ORIGIN_Y).multiply(new DOMMatrix(list)).translate(-ORIGIN_X, -ORIGIN_Y);
  const shadow = $('shadow');
  shadow.style.transform = `translate(${pose.x - 380}px, ${pose.y + ORIGIN_Y * pose.s - 40}px) scale(${pose.s})`;
  shadow.style.opacity = String(clamp(1 - Math.abs(pose.y - 1200) / 1400));
}
/** Stage position of an app point, through the phone's 3D pose. */
function project(x, y) {
  const [lx, ly] = local(x, y);
  const p = phoneMatrix.transformPoint(new DOMPoint(lx, ly, 0, 1));
  return [p.x / p.w, p.y / p.w];
}

// ---------------------------------------------------------------------------------------------
// The phone screen: captured frame + status bar + home indicator + spotlight + the finger.
// ---------------------------------------------------------------------------------------------
const screen = $('screen').getContext('2d', { willReadFrequently: true });
const SCALE = 3;
const frames = new Map();
function frameUrl(i) { return `/frames/${String(i).padStart(5, '0')}.jpg`; }
function loadFrame(i) {
  i = clamp(i, 0, cap.frames - 1);
  if (!frames.has(i)) frames.set(i, fetch(frameUrl(i)).then((r) => r.blob()).then((b) => createImageBitmap(b)));
  return frames.get(i);
}
function evict(keepFrom) { for (const [i, p] of frames) if (i < keepFrom - 2) { p.then((b) => b.close()); frames.delete(i); } }

function statusBar(color) {
  const g = screen; g.save(); g.scale(SCALE, SCALE); g.fillStyle = color; g.strokeStyle = color;
  g.font = '800 17px Nunito'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('9:41', 66, 25);
  for (let i = 0; i < 4; i++) { const h = 4 + i * 2.6; g.beginPath(); g.roundRect(287 + i * 5, 30 - h, 3.4, h, 1); g.fill(); }
  g.lineWidth = 2.1; g.lineCap = 'round';
  for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(318, 30.5, 3 + i * 3.6, -Math.PI * 0.76, -Math.PI * 0.24); g.stroke(); }
  g.beginPath(); g.arc(318, 30, 1.2, 0, 6.283); g.fill();
  g.lineWidth = 1.2; g.globalAlpha = 0.45; g.beginPath(); g.roundRect(333, 19.5, 25, 12, 3.6); g.stroke(); g.globalAlpha = 1;
  g.beginPath(); g.roundRect(335, 21.5, 19.5, 8, 2.2); g.fill();
  g.globalAlpha = 0.45; g.beginPath(); g.roundRect(359, 23.5, 2, 4.5, 1); g.fill(); g.restore();
}
const lum = ([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

/** Dims the screen around the step's button (or result) with a pulsing ring, from its pause on. */
function drawSpotlight(g, t, dark) {
  let b = null;
  for (const beat of stepBeats) { if (beat.start > t + 1e-6) break; b = beat; }
  if (!b?.step.rect) return;
  const amount = easeOut((t - b.start) / 0.25) * (1 - easeIn((t - b.spotEnd) / 0.22));
  if (amount <= 0.003) return;
  const r = b.step.rect, pad = 7;
  const x = (r.x - pad) * SCALE, y = (r.y + STATUS - pad) * SCALE, w = (r.w + pad * 2) * SCALE, h = (r.h + pad * 2) * SCALE;
  const radius = Math.min(22 * SCALE, w / 2, h / 2);
  g.save();
  g.fillStyle = dark ? `rgba(12, 7, 16, ${0.6 * amount})` : `rgba(58, 34, 50, ${0.5 * amount})`;
  g.beginPath(); g.rect(0, 0, 1170, 2532); g.roundRect(x, y, w, h, radius); g.fill('evenodd');
  const ring = dark ? '#f7b6cd' : '#f08aa8';
  const grow = (1 - spring(t - b.start, 14, 7)) * 16 * SCALE; // the ring lands with a little bounce
  g.strokeStyle = ring; g.globalAlpha = amount; g.lineWidth = 3.6 * SCALE;
  g.beginPath(); g.roundRect(x - grow, y - grow, w + grow * 2, h + grow * 2, radius + grow); g.stroke();
  const p = ((t - b.start) % 1.1) / 1.1, e = easeOut(p) * 15 * SCALE;
  g.globalAlpha = amount * (1 - p) * 0.75; g.lineWidth = 2.6 * SCALE * (1 - p * 0.5);
  g.beginPath(); g.roundRect(x - e, y - e, w + e * 2, h + e * 2, radius + e); g.stroke();
  g.restore();
}
/** Before a swipe: a dotted track with an arrowhead and a ghost finger showing the way. */
function drawSwipeHint(g, t, dark) {
  const ring = dark ? '#f7b6cd' : '#c04f72';
  for (const b of stepBeats) {
    if (b.kind !== 'swipe' || t < b.start || t > b.end + 0.4) continue;
    const a = easeOut((t - b.start) / 0.25) * (1 - easeIn((t - b.end - 0.1) / 0.3));
    const { x, y, y2 } = b.step.e, X = x * SCALE, Y1 = (y + STATUS) * SCALE, Y2 = (y2 + STATUS) * SCALE, dir = Math.sign(Y2 - Y1);
    g.save(); g.globalAlpha = a; g.strokeStyle = ring; g.lineCap = 'round'; g.lineJoin = 'round';
    g.lineWidth = 6 * SCALE; g.setLineDash([0.01, 16 * SCALE]);
    g.beginPath(); g.moveTo(X, Y1); g.lineTo(X, Y2 - dir * 20 * SCALE); g.stroke(); g.setLineDash([]);
    g.lineWidth = 5 * SCALE;
    g.beginPath(); g.moveTo(X - 17 * SCALE, Y2 - dir * 4 * SCALE); g.lineTo(X, Y2 + dir * 13 * SCALE); g.lineTo(X + 17 * SCALE, Y2 - dir * 4 * SCALE); g.stroke();
    const p = ((t - b.start) % 1.1) / 1.1, fy = lerp(Y1, Y2, easeInOut(p));
    g.globalAlpha = a * Math.sin(p * Math.PI);
    g.fillStyle = dark ? 'rgba(255,240,246,.4)' : 'rgba(255,255,255,.7)';
    g.beginPath(); g.arc(X, fy, 20 * SCALE, 0, 6.283); g.fill();
    g.lineWidth = 3.2 * SCALE; g.stroke();
    g.restore();
  }
}
function drawFinger(g, s, night) {
  const ring = night ? '#f7b6cd' : '#c04f72';
  const fill = night ? 'rgba(255,240,246,.38)' : 'rgba(255,255,255,.62)';
  const toPx = (x, y) => [x * SCALE, (y + STATUS) * SCALE];
  for (const tap of taps) {
    const d = s - tap.t, hold = tap.hold / 1000;
    if (d < -0.14 || d > hold + 0.6) continue;
    const [x, y] = toPx(tap.x, tap.y);
    const R = 23 * SCALE;
    if (d < hold + 0.12) {
      const appear = easeOut((d + 0.14) / 0.14), press = d >= 0 && d <= hold ? 1 : 0;
      const r = R * lerp(1.45, 1, appear) * (press ? 0.86 : 1);
      const fade = d > hold ? 1 - (d - hold) / 0.12 : 1;
      g.globalAlpha = appear * fade; g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
      g.lineWidth = 3.2 * SCALE; g.strokeStyle = ring; g.stroke(); g.globalAlpha = 1;
    }
    const after = d - hold;
    if (after > 0) {
      const p = easeOut(after / 0.5);
      g.globalAlpha = (1 - p) * 0.8; g.lineWidth = 2.6 * SCALE * (1 - p * 0.6); g.strokeStyle = ring;
      g.beginPath(); g.arc(x, y, R * lerp(0.9, 1.9, p), 0, 6.283); g.stroke(); g.globalAlpha = 1;
    }
  }
  for (const drag of drags) {
    const dur = drag.ms / 1000, d = s - drag.t;
    if (d < -0.16 || d > dur + 0.34) continue;
    const path = (u) => { const k = clamp((u - 1 / FPS) / dur), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; return toPx(lerp(drag.x, drag.x2, e), lerp(drag.y, drag.y2, e)); };
    const alpha = easeOut((d + 0.16) / 0.16) * (1 - easeIn((d - dur - 0.04) / 0.3));
    for (let j = 7; j >= 1; j--) {
      const [x, y] = path(d - j * 0.028);
      g.globalAlpha = alpha * (1 - j / 8) * 0.22; g.fillStyle = ring; g.beginPath(); g.arc(x, y, (17 - j * 1.7) * SCALE, 0, 6.283); g.fill();
    }
    const [x, y] = path(d);
    g.globalAlpha = alpha; g.fillStyle = fill; g.beginPath(); g.arc(x, y, 21 * SCALE, 0, 6.283); g.fill();
    g.lineWidth = 3.2 * SCALE; g.strokeStyle = ring; g.stroke(); g.globalAlpha = 1;
  }
}

async function drawScreen(s, t) {
  const index = Math.round(s * FPS);
  const img = await loadFrame(index);
  for (let k = 1; k <= 4; k++) loadFrame(index + k);
  evict(index);
  const g = screen;
  g.drawImage(img, 0, 0, img.width, 1, 0, 0, 1170, STATUS * SCALE); // the status bar takes the page's top colour
  g.drawImage(img, 0, STATUS * SCALE, 1170, img.height * (1170 / img.width));
  const top = g.getImageData(585, 4, 1, 1).data, bottom = g.getImageData(585, 2528, 1, 1).data;
  const dark = lum(top) < 0.45;
  statusBar(dark ? '#fdf6f8' : '#20161c');
  g.fillStyle = lum(bottom) < 0.45 ? 'rgba(255,255,255,.75)' : 'rgba(30,20,26,.82)';
  g.beginPath(); g.roundRect(585 - 201, 2532 - 24 - 15, 402, 15, 7.5); g.fill();
  drawSpotlight(g, t, dark);
  drawSwipeHint(g, t, dark);
  drawFinger(g, s, dark);
  const veil = veilAt(t);
  if (veil > 0) { g.fillStyle = dark ? `rgba(34,27,40,${0.34 * veil})` : `rgba(255,250,243,${0.34 * veil})`; g.fillRect(0, 0, 1170, 2532); }
}

// ---------------------------------------------------------------------------------------------
// Foreground effects: the photo dropping in, confetti for new ideas, hearts for saving, sleepy z's.
// ---------------------------------------------------------------------------------------------
const fx = $('fx').getContext('2d');
let photoImg;
function burst(ctx, x, y, d, { n = 10, reach = 140, colors = ['#e0b260', '#f08aa8', '#c9a7f2', '#8fd3a8'], seed = 1, size = 16 } = {}) {
  if (d < 0 || d > 0.9) return;
  const r = rng(seed), p = easeOut(d / 0.9);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283 + r() * 0.5, dist = reach * (0.55 + r() * 0.6) * p;
    ctx.globalAlpha = 1 - easeIn(d / 0.9);
    star4(ctx, x + Math.cos(a) * dist, y + Math.sin(a) * dist + p * p * 30, size * (0.6 + r() * 0.6) * (1 - p * 0.5), colors[i % colors.length], p * 4 + i);
  }
  ctx.globalAlpha = 1;
}
function drawFx(t) {
  fx.clearRect(0, 0, W, H);
  // The grocery photo drops into the phone.
  const tp = outAt(ev('photo')) + 0.02, dp = t - tp;
  if (dp > 0 && dp < 1.1) {
    const [ex, ey] = project(195, 330);
    const fly = easeInOut((dp - 0.3) / 0.6), pop = spring(dp, 15, 7);
    const x = lerp(820, ex, fly) + Math.sin(fly * Math.PI) * 120, y = lerp(1500, ey, fly) - Math.sin(fly * Math.PI) * 160;
    const sc = lerp(1, 0.22, fly) * (0.6 + 0.4 * pop), rot = lerp(13, -6, fly);
    fx.save(); fx.globalAlpha = 1 - easeIn((dp - 0.82) / 0.1); fx.translate(x, y); fx.rotate(rot * Math.PI / 180); fx.scale(sc, sc);
    fx.shadowColor = 'rgba(90,40,64,.28)'; fx.shadowBlur = 30; fx.shadowOffsetY = 14;
    fx.fillStyle = '#fffdf8'; fx.beginPath(); fx.roundRect(-170, -150, 340, 330, 16); fx.fill(); fx.shadowColor = 'transparent';
    fx.drawImage(photoImg, 280, 0, 840, 840 * 0.82, -150, -130, 300, 246);
    fx.fillStyle = '#b64967'; fx.font = '800 30px Nunito'; fx.textAlign = 'center'; fx.textBaseline = 'alphabetic'; fx.fillText('today’s shop ♡', 0, 158);
    fx.restore();
  }
  if (dp > 0.92 && dp < 1.9) { const [ex, ey] = project(195, 330); burst(fx, ex, ey, dp - 0.92, { seed: 3, reach: 160 }); }
  // Fresh ideas: confetti.
  const ti = outAt(ev('ideas')) + 0.15, di = t - ti;
  if (di > 0 && di < 2.2) {
    const r = rng(42), [cx, cy] = project(195, 420);
    for (let i = 0; i < 46; i++) {
      const a = -Math.PI / 2 + (r() - 0.5) * 2.6, v = 520 + r() * 640, spin = (r() - 0.5) * 14;
      const x = cx + Math.cos(a) * v * di, y = cy + Math.sin(a) * v * di + 900 * di * di;
      const c = ['#f08aa8', '#e0b260', '#c9a7f2', '#8fd3a8', '#b64967', '#ffd27f'][i % 6];
      fx.save(); fx.globalAlpha = 1 - easeIn((di - 1.4) / 0.8); fx.translate(x, y); fx.rotate(spin * di);
      if (i % 3 === 0) star4(fx, 0, 0, 16, c); else if (i % 3 === 1) { fx.fillStyle = c; fx.fillRect(-11, -6, 22, 12); } else heart(fx, 0, 0, 22, c);
      fx.restore();
    }
  }
  // Saved: hearts float up out of the button.
  const save = focusRect('save');
  const th = outAt(ev('saved')) + 0.1, dh = t - th;
  if (save && dh > 0 && dh < 2.2) {
    const [hx, hy] = project(save.x + save.w / 2, save.y + save.h / 2);
    const r = rng(77);
    for (let i = 0; i < 11; i++) {
      const d = dh - i * 0.07; if (d <= 0) continue;
      const p = d / 1.7, sway = Math.sin(d * 5 + i) * 34;
      const x = hx + (r() - 0.5) * 220 + sway, y = hy - p * (520 + r() * 300);
      fx.globalAlpha = (1 - easeIn((p - 0.6) / 0.4)) * easeOut(d / 0.15);
      heart(fx, x, y, (30 + r() * 30) * lerp(0.5, 1.15, easeOut(p * 3)), ['#f08aa8', '#b64967', '#ffffff', '#ffb3c7'][i % 4]);
    }
    fx.globalAlpha = 1;
  }
  // Night: sleepy z's drift up from the blob in the header.
  const avatar = focusRect('avatar');
  const tz = outAt(ev('night')) + 0.7, dz = t - tz;
  if (avatar && dz > 0 && t < footageStop() + 0.4) {
    const [ax, ay] = project(avatar.x + avatar.w / 2, avatar.y + avatar.h / 2);
    for (let i = 0; i < 6; i++) {
      const d = (dz - i * 0.42) % 2.5; if (dz - i * 0.42 < 0) continue;
      const p = d / 2.5;
      fx.save(); fx.globalAlpha = Math.sin(p * Math.PI) * (1 - easeIn((t - footageStop()) / 0.4));
      fx.font = `900 ${lerp(34, 74, p)}px Nunito`; fx.fillStyle = i % 2 ? '#f7b6cd' : '#fff2e9'; fx.textAlign = 'center'; fx.textBaseline = 'alphabetic';
      fx.translate(ax + 40 + p * 150 + Math.sin(p * 7) * 18, ay - 30 - p * 260); fx.rotate(-0.25 + Math.sin(p * 5) * 0.2);
      fx.fillText(i % 3 === 2 ? 'Z' : 'z', 0, 0); fx.restore();
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Title cards: Scoop drops in to open the show and waves goodnight at the end.
// ---------------------------------------------------------------------------------------------
let scoopSvg;
function scoopElement(id, width) {
  const box = document.createElement('div'); box.id = id; box.className = 'scoop'; box.style.position = 'absolute'; box.style.left = '0'; box.style.top = '0';
  box.style.width = `${width}px`; box.style.height = `${width * 170 / 160}px`; box.style.transformOrigin = '50% 100%';
  box.innerHTML = scoopSvg; return box;
}
function poseScoop(box, { wave = 0, blink = false } = {}) {
  box.querySelector('.wave')?.setAttribute('transform', `rotate(${wave} 121 106)`);
  box.querySelector('.eyes')?.setAttribute('transform', blink ? 'translate(0 98) scale(1 .12) translate(0 -98)' : '');
}
function textBlock(className, text, top) {
  const node = document.createElement('div'); node.className = `copy ${className}`; node.style.top = `${top}px`;
  if (className.includes('wordmark')) for (const ch of text) { const s = document.createElement('span'); s.textContent = ch === ' ' ? ' ' : ch; node.append(s); }
  else node.innerHTML = text;
  return node;
}
let intro, outro;
function buildCards() {
  intro = { scoop: scoopElement('scoop-intro', 400), word: textBlock('wordmark', 'Pantry Scoop', 1000), tag: textBlock('tagline', 'your pantry’s tiny chef', 1160) };
  $('intro').append(intro.scoop, intro.word, intro.tag);
  outro = {
    scoop: scoopElement('scoop-outro', 250),
    word: textBlock('wordmark', 'Pantry Scoop', 476),
    tag: textBlock('tagline', 'Your pantry, a little happier.', 636),
    pill: textBlock('pillrow', '<span class="pill">📸 scan · 🧺 sort · 🍝 cook</span>', 726),
    url: textBlock('url', 'open source · github.com/GabrielAgrela/pantry-scoop', 832),
  };
  outro.url.style.cssText += 'font-weight:800;font-size:31px;';
  $('outro').append(outro.scoop, outro.word, outro.tag, outro.pill, outro.url);
}
function drawIntro(t) {
  $('intro').style.display = t < INTRO + 0.2 ? '' : 'none';
  if (t >= INTRO + 0.2) return;
  const land = 0.52, landY = 940;
  const exit = easeInOut((t - 1.95) / 0.55);
  let y, sx = 1, sy = 1;
  if (t < land) { const p = t / land; y = lerp(-520, landY, p * p); sy = 1.06; sx = 0.95; }
  else { const d = t - land; y = landY; const sq = Math.exp(-8 * d) * Math.cos(17 * d); sy = 1 - 0.2 * sq; sx = 1 + 0.15 * sq; }
  const sc = lerp(1, 0.55, exit);
  intro.scoop.style.transform = `translate(${540 - 200}px, ${y - 425 - exit * 520}px) scale(${sx * sc}, ${sy * sc})`;
  intro.scoop.style.opacity = String(1 - exit);
  poseScoop(intro.scoop, { wave: t > 0.95 && t < 2.2 ? Math.sin((t - 0.95) * 11) * 16 * Math.exp(-(t - 0.95) * 0.9) - 6 : 0, blink: t > 1.9 && t < 2.0 });
  [...intro.word.children].forEach((ch, i) => {
    const k = spring(t - 0.72 - i * 0.045, 15, 7);
    ch.style.transform = `translateY(${(1 - k) * 60 - exit * 420}px) rotate(${(1 - k) * (i % 2 ? 12 : -12)}deg) scale(${Math.max(0, k) * lerp(1, 0.7, exit)})`;
    ch.style.opacity = String(clamp((t - 0.72 - i * 0.045) / 0.1) * (1 - exit));
  });
  const tg = easeOut((t - 1.3) / 0.45);
  intro.tag.style.opacity = String(tg * (1 - exit));
  intro.tag.style.transform = `translateY(${(1 - tg) * 30 - exit * 380}px)`;
  if (t > land && t < land + 1) burst(fx, 540, landY - 30, t - land, { seed: 5, reach: 260, n: 12, size: 22 });
}
function drawOutro(t) {
  const d = t - (footageStop() + 0.15);
  $('outro').style.display = d > 0 ? '' : 'none';
  if (d <= 0) return;
  const k = spring(d - 0.2, 12, 6);
  outro.scoop.style.transform = `translate(${540 - 125}px, ${168 + (1 - k) * 80}px) scale(${Math.max(0, k)})`;
  poseScoop(outro.scoop, { wave: Math.sin(d * 7) * 15 - 4, blink: (d % 3.1) > 2.95 });
  [...outro.word.children].forEach((ch, i) => {
    const c = spring(d - 0.5 - i * 0.04, 15, 7);
    ch.style.transform = `translateY(${(1 - c) * 50}px) rotate(${(1 - c) * (i % 2 ? 10 : -10)}deg) scale(${Math.max(0, c)})`;
    ch.style.opacity = String(clamp((d - 0.5 - i * 0.04) / 0.1));
  });
  for (const [node, delay] of [[outro.tag, 1.05], [outro.pill, 1.3], [outro.url, 1.5]]) {
    const p = easeOut((d - delay) / 0.45);
    node.style.opacity = String(p); node.style.transform = `translateY(${(1 - p) * 28}px)`;
  }
  // Hearts and sparkles stay in the margins and around Scoop, never on the words.
  const r = rng(99);
  for (let i = 0; i < 14; i++) {
    const zone = i % 3, u = r(), v = r();
    const x = zone === 0 ? 40 + u * 120 : zone === 1 ? 920 + u * 120 : 330 + u * 420;
    const y0 = zone === 2 ? 150 + v * 260 : 260 + v * 760, sp = 0.6 + r() * 0.8, life = (d * sp + r() * 3) % 3;
    fx.globalAlpha = Math.sin((life / 3) * Math.PI) * 0.9 * clamp(d / 0.6);
    if (i % 2) heart(fx, x + Math.sin(life * 2) * 20, y0 - life * 60, 22 + r() * 18, ['#f7b6cd', '#fff2e9', '#c9a7f2'][i % 3]);
    else star4(fx, x, y0 - life * 40, 10 + r() * 12, ['#ffe7a8', '#fff4fa'][i % 2], life);
  }
  fx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------------------------
// Sound cues: the same timings as the pictures, for audio.mjs.
// ---------------------------------------------------------------------------------------------
function buildCues() {
  const cues = [];
  const cue = (t, type, extra = {}) => cues.push({ t: Math.round(t * 1000) / 1000, type, ...extra });
  cue(0.15, 'twinkle');
  cue(0.52, 'boing');
  [...'PantryScoop'].forEach((_, i) => cue(0.72 + (i + (i > 5 ? 1 : 0)) * 0.045, 'bloop', { i }));
  cue(INTRO - 0.95, 'whoosh', { dur: 0.75 });
  for (const mark of ORDER) {
    const c = band[mark];
    c.words.forEach((_, i) => cue(c.from + HERO_IN + 0.06 + i * 0.075, 'bloop', { i: i + 2 }));
    cue(c.from + HERO_IN + 0.06 + c.words.length * 0.075 + 0.08, 'pop');
  }
  for (const b of stepBeats) cue(textAt(b), b.kind === 'note' ? 'sparkle' : 'label');
  for (const tap of taps) cue(outAt(tap.t), 'tap');
  for (const drag of drags) { const a = outAt(drag.t); cue(a, 'swish', { dur: outAt(drag.t + drag.ms / 1000) - a }); }
  for (const typed of events.filter((e) => e.type === 'type')) [...typed.text].forEach((ch, i) => { if (ch !== ' ') cue(outAt(typed.t + (i * typed.perChar) / 1000), 'tick', { i }); });
  cue(outAt(ev('photo')) + 0.27, 'whoosh', { dur: 0.6 });
  cue(outAt(ev('ideas')) + 0.15, 'confetti');
  cue(outAt(ev('saved')) + 0.1, 'hearts');
  cue(outAt(ev('night') + 0.12), 'night');
  cue(outAt(ev('night')) + 0.7, 'zzz');
  const end = footageStop();
  cue(end, 'whoosh', { dur: 0.9 });
  cue(end + 0.35, 'boing', { small: true });
  [...'PantryScoop'].forEach((_, i) => cue(end + 0.65 + (i + (i > 5 ? 1 : 0)) * 0.04, 'bloop', { i }));
  cue(end + 1.2, 'tada');
  return cues.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------------------------
async function setup() {
  cap = await (await fetch('/capture.json')).json();
  events = cap.events;
  taps = events.filter((e) => e.type === 'tap');
  drags = events.filter((e) => e.type === 'swipe');
  buildSteps();
  buildTimeline();
  scoopSvg = (await (await fetch('/app/assets/scoop-guide.svg')).text()).replace(/<style>[\s\S]*?<\/style>/, '');
  photoImg = await createImageBitmap(await (await fetch('/app/assets/pantry-editorial.webp')).blob());
  await Promise.all([document.fonts.load('900 80px Nunito'), document.fonts.load('800 40px Nunito'), document.fonts.load('80px "Noto Color Emoji"', '🍋👋📸✨🍝🌙')]);
  $('phone').style.width = `${PHONE_W}px`; $('phone').style.height = `${PHONE_H}px`;
  tapTimes = taps.map((tap) => outAt(tap.t));
  buildBand(); buildCamera(); buildCards();
  // Warm the sticker cache so the first frames do not stall.
  for (const set of [INTRO_SET, NIGHT_SET]) SLOTS.forEach(([, , size], i) => sticker(set[i], size));
  await loadFrame(0);
  window.totalFrames = total;
  window.timeline = {
    total, intro: INTRO, footageStop: footageStop(), nightStart: outAt(ev('night') + 0.12), cues: buildCues(),
    chapters: ORDER.map((mark) => ({ mark, name: CHAPTERS[mark].name, start: band[mark].from })),
    steps: stepBeats.map((b) => ({ chapter: b.chapter, text: b.step.text, start: textAt(b) })),
  };
}

window.renderFrame = async (n) => {
  const t = n / FPS, s = srcAt(t);
  const pose = phonePose(t);
  drawBackground(t);
  placePhone(pose);
  await drawScreen(s, t);
  drawBand(t);
  drawFx(t);
  drawIntro(t);
  drawOutro(t);
};
window.ready = setup();
