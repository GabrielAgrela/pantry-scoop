// The promo's motion design. Every frame is a pure function of its index: renderFrame(n) draws
// output frame n (60 fps, 1080×1920) from the captured app footage and capture.json's events.
//
// Built to be easy to follow: each chapter opens on a wide shot with its caption while the footage
// pauses, then the camera moves in until the phone fills the frame and follows each step, with a
// label beside the finger saying what is happening.

const FPS = 60;
const W = 1080, H = 1920;
const INTRO = 3.0, OUTRO = 3.9;
const PT = 640 / 390; // phone pixels per app point
const STATUS = 47; // status bar height in points; the app viewport sits below it
const PHONE_W = 690, PHONE_H = 1435, ORIGIN_X = PHONE_W / 2, ORIGIN_Y = PHONE_H / 2;
const BASE = { x: 540, y: 1122 };
const FOLLOW = 1.5; // phone scale while following the action: the screen fills the frame
const DAY = { ink: '#493442', hot: '#b64967', muted: '#6f5667' };
const NIGHT = { ink: '#fff2e9', hot: '#f7b6cd', muted: '#d8c1d3' };

const $ = (id) => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
const easeInOut = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };
const easeOut = (t) => 1 - (1 - clamp(t)) ** 3;
const easeIn = (t) => clamp(t) ** 3;
/** A damped spring from 0 to 1 (t in seconds); overshoots a little, settles in ~0.6 s. */
const spring = (t, k = 15, d = 7) => (t <= 0 ? 0 : 1 - Math.exp(-d * t) * Math.cos(k * t));
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, t) => { const x = hex(a), y = hex(b); return `rgb(${x.map((v, i) => Math.round(lerp(v, y[i], t))).join(',')})`; };

let cap, events, taps, drags, notes, srcTable, total, footageEnd, tapTimes = [], holdWindows = [], camera = [];
const LEAD = 0.22; // a chapter's pause starts this long before its first tap, before the finger appears
const at = (label, type = 'mark') => events.find((e) => (e.label ?? e.type) === label && (type === 'any' || e.type === type))?.t;
const ev = (type) => events.find((e) => e.type === type)?.t;
/** Output time of a chapter's pause (its caption and sticker set arrive with it). */
const pauseAt = (label) => outAt(at(label) - LEAD);
/** 0…1 while the footage holds for a caption: the phone steps back and the screen softens. */
const holdAmount = (t) => Math.max(0, ...holdWindows.map(([a, b]) => smooth((t - a) / 0.3) * (1 - smooth((t - b + 0.32) / 0.32))));

// ---------------------------------------------------------------------------------------------
// Timeline: output time → footage time, with a pause at every chapter and gently faster waits.
// ---------------------------------------------------------------------------------------------
function buildTimeline() {
  const ramps = [
    [ev('photo') + 0.15, ev('review') - 0.1, 1.4], // scanning…
    [at('sort', 'focus') - 2.4, at('sort', 'focus') - 0.15, 1.6], // scrolling to the strays
    [ev('thinking') + 0.3, ev('ideas') - 0.1, 1.4], // Scoop thinks
  ];
  const holds = [[0, 1.5], [at('scan') - LEAD, 1.45], [at('tidy') - LEAD, 1.45], [at('recipes') - LEAD, 1.45], [at('dark') - LEAD, 1.35]];
  const speedAt = (s) => {
    let v = 1;
    for (const [a, b, k] of ramps) v += (k - 1) * smooth((s - a) / 0.2) * (1 - smooth((s - (b - 0.2)) / 0.2));
    return v;
  };
  footageEnd = cap.frames / FPS;
  srcTable = [];
  for (let n = 0; n < Math.round(INTRO * FPS); n++) srcTable.push(0);
  let s = 0, next = 0;
  holdWindows = [];
  while (s < footageEnd - 1 / FPS) {
    while (next < holds.length && holds[next][0] <= s + 1e-6) {
      const [point, seconds] = holds[next++];
      s = Math.max(s, point); // so outAt(point) finds the start of the pause
      holdWindows.push([srcTable.length / FPS, srcTable.length / FPS + seconds]);
      for (let k = 0; k < Math.round(seconds * FPS); k++) srcTable.push(s);
    }
    srcTable.push(s);
    s = Math.min(s + speedAt(s) / FPS, next < holds.length ? holds[next][0] : Infinity);
  }
  for (let n = 0; n < Math.round(OUTRO * FPS); n++) srcTable.push(footageEnd - 1 / FPS);
  total = srcTable.length;
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

// Sticker slots around the phone in the wide shots; each chapter swaps in its own set.
const SLOTS = [[96, 560, 104, -8], [986, 640, 98, 10], [76, 905, 90, 6], [1004, 975, 108, -6], [100, 1255, 100, 9], [980, 1330, 94, -10], [82, 1610, 108, -4], [1000, 1690, 96, 7], [176, 1850, 84, 12], [902, 1862, 90, -9], [74, 112, 72, -12], [1006, 104, 76, 12]];
const SETS = {
  intro: ['🍋', '🍅', '🌿', '🧁', '🥑', '🍓', '🥕', '🧀', '🍯', '🫖', '✨', '💗'],
  onboarding: ['🍳', '🧊', '🍟', '♨️', '❄️', '🫖', '🥄', '🍽️', '🧂', '🍴', '✨', '💗'],
  scan: ['🍅', '🧄', '🍋', '🌿', '🍞', '🫒', '🥬', '🧅', '🛍️', '📸', '✨', '🌼'],
  tidy: ['🫘', '🍫', '🍿', '🥑', '🥚', '🧀', '🍯', '🌾', '🫙', '🧺', '✨', '💗'],
  recipes: ['🍝', '🥪', '🍨', '🧁', '🍳', '🥗', '🍲', '🍰', '🍪', '🥤', '✨', '💗'],
  night: ['🌙', '⭐', '☁️', '💤', '🌟', '✨', '🫖', '🍪', '⭐', '🌙', '💫', '✨'],
};
let chapters;
function stickerSet(t) {
  chapters ??= [[0, 'intro'], [INTRO - 0.35, 'onboarding'], [pauseAt('scan'), 'scan'], [pauseAt('tidy'), 'tidy'], [pauseAt('recipes'), 'recipes'], [outAt(ev('night') + 0.5), 'night']];
  let i = 0;
  while (i + 1 < chapters.length && t >= chapters[i + 1][0]) i++;
  return { cur: chapters[i], prev: chapters[i - 1] ?? null };
}
function drawSlots(ctx, t, nightP, follow) {
  if (follow > 0.98) return; // the phone fills the frame
  const { cur, prev } = stickerSet(t);
  SLOTS.forEach(([x, y, size, rot], i) => {
    const bob = Math.sin((t / 3.4 + i * 0.37) * Math.PI * 2) * 10, wob = Math.sin((t / 4.6 + i * 0.21) * Math.PI * 2) * 7;
    const since = t - cur[0] - i * 0.035;
    let symbol = SETS[cur[1]][i], scale = 1;
    if (prev && since < 0.22) { symbol = SETS[prev[1]][i]; scale = 1 - easeIn(since / 0.22); }
    else if (prev) scale = spring(since - 0.22, 16, 8);
    // The top corners belong to the captions once the show starts.
    if (i >= 10 && cur[1] !== 'intro') { if (prev?.[1] !== 'intro' || since >= 0.22) return; }
    if (cur[1] === 'intro') scale = spring(t - 0.15 - i * 0.05, 14, 7);
    if (i < 2) scale *= 1 - easeIn((t - footageStop()) / 0.3);
    drawSticker(ctx, symbol, size, x, y + bob, { scale, rot: rot + wob, alpha: lerp(0.92, 0.82, nightP) * (1 - follow) });
  });
}
function drawBackground(t, follow) {
  const night = nightProgress(t);
  world(bg, false, t);
  if (night > 0) { bg.save(); wavePath(bg, night); bg.clip(); world(bg, true, t); bg.restore(); }
  drawSlots(bg, t, night, follow);
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
// Captions: one bouncy line per chapter, shown on the chapter's wide shot while the footage waits.
// ---------------------------------------------------------------------------------------------
const TITLES = [];
function buildTitles() {
  const holdEnd = (i) => holdWindows[i][1];
  const defs = [
    { from: INTRO - 0.12, until: holdEnd(0) - 0.05, words: ['Meet', '*Scoop*'], emoji: '👋', sub: 'your tiny kitchen chef' },
    { from: pauseAt('scan'), until: holdEnd(1) - 0.05, words: ['Snap', 'your', '*groceries*'], emoji: '📸', sub: 'one photo fills your pantry' },
    { from: pauseAt('tidy'), until: holdEnd(2) - 0.05, words: ['Tidy,', 'all', '*by itself*'], emoji: '✨', sub: 'restock in a tap · sort with ChatGPT' },
    { from: pauseAt('recipes'), until: holdEnd(3) - 0.05, words: ['Cook', 'what', 'you', '*have*'], emoji: '🍝', sub: 'recipe ideas from your pantry' },
    { from: pauseAt('dark'), until: footageStop() + 0.05, words: ['Cozy', '*night*', 'mode'], emoji: '🌙', sub: 'sweet dreams, little pantry' },
  ];
  const root = $('titles');
  for (const def of defs) {
    const line = document.createElement('div'); line.className = 'copy title';
    const words = def.words.map((w) => {
      const span = document.createElement('span'); span.className = 'word';
      if (w.startsWith('*')) {
        span.classList.add('hot'); span.textContent = w.slice(1, -1);
        span.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 200 30" preserveAspectRatio="none"><path d="M4 18 C 40 6, 70 26, 104 15 S 168 8, 196 16"/></svg>');
      } else span.textContent = w;
      line.append(span); return span;
    });
    const emoji = document.createElement('span'); emoji.className = 'sticker'; emoji.textContent = def.emoji; line.append(emoji);
    const sub = document.createElement('div'); sub.className = 'copy sub';
    sub.innerHTML = `<span>${def.sub}</span>`;
    root.append(line, sub);
    const path = line.querySelector('.hot path'); const length = 200;
    path.style.strokeDasharray = `${length}`;
    TITLES.push({ ...def, line, sub, words, emoji, path, length });
  }
}
function drawTitles(t, follow) {
  const night = nightProgress(t);
  const stage = $('stage').style;
  stage.setProperty('--ink', mix(DAY.ink, NIGHT.ink, smooth(night * 1.5 - 0.25)));
  stage.setProperty('--hot', mix(DAY.hot, NIGHT.hot, smooth(night * 1.5 - 0.25)));
  stage.setProperty('--muted', mix(DAY.muted, NIGHT.muted, smooth(night * 1.5 - 0.25)));
  const groupAlpha = 1 - smooth((follow - 0.1) / 0.35);
  for (const title of TITLES) {
    const local = t - title.from, leaving = t - title.until;
    const visible = local > -0.05 && leaving < 0.5 && groupAlpha > 0.01;
    title.line.style.display = title.sub.style.display = visible ? '' : 'none';
    if (!visible) continue;
    title.words.forEach((word, i) => {
      const k = spring(local - i * 0.075, 16, 7.5);
      const out = easeIn((leaving - i * 0.03) / 0.22);
      const scale = Math.max(0, (0.35 + 0.65 * k) * (1 - out * 0.6));
      const rot = (1 - k) * (i % 2 ? 9 : -9);
      word.style.transform = `translateY(${(1 - k) * 46 + out * -30}px) rotate(${rot}deg) scale(${scale})`;
      word.style.opacity = String(clamp(local / 0.12 - i * 0.5) * (1 - out) * groupAlpha);
    });
    const e = spring(local - title.words.length * 0.075 - 0.08, 14, 6);
    const eOut = easeIn((leaving - 0.08) / 0.22);
    const wiggle = Math.sin((local - 0.4) * 9) * 14 * Math.exp(-Math.max(0, local - 0.4) * 2.2) + Math.sin(local * 2.6) * 6;
    title.emoji.style.transform = `rotate(${(1 - e) * -40 + wiggle}deg) scale(${Math.max(0, e * (1 - eOut))})`;
    title.emoji.style.opacity = String(groupAlpha);
    title.path.style.strokeDashoffset = String(title.length * (1 - easeOut((local - 0.35) / 0.45)));
    title.path.style.opacity = String(1 - easeIn(leaving / 0.2));
    const s = easeOut((local - 0.32) / 0.4), sOut = easeIn(leaving / 0.25);
    title.sub.style.opacity = String(s * (1 - sOut) * groupAlpha);
    title.sub.firstChild.style.transform = `translateY(${(1 - s) * 24 + sOut * -16}px)`;
  }
}

// ---------------------------------------------------------------------------------------------
// Camera: wide for captions and the finale; otherwise the phone fills the frame and glides to
// wherever the next step happens. Precomputed with critically damped springs, frame by frame.
// ---------------------------------------------------------------------------------------------
const local = (x, y) => [25 + x * PT, 25 + (STATUS + y) * PT]; // app point → phone element px
function buildCamera() {
  const wide = [[0, holdWindows[0][1]], ...holdWindows.slice(1, -1).map(([a, b]) => [a - 0.05, b]), [pauseAt('dark') - 0.05, Infinity]];
  const isWide = (t) => wide.some(([a, b]) => t >= a && t < b);
  const points = [
    ...taps.map((e) => ({ t: e.t, y: e.y })),
    ...drags.map((e) => ({ t: e.t, y: (e.y + e.y2) / 2 })),
    ...notes.map((e) => ({ t: e.t, y: e.rect.y + Math.min(e.rect.h, 160) / 2 })),
  ].map((p) => ({ out: outAt(p.t), y: p.y })).sort((a, b) => a.out - b.out);
  const followY = (fy) => clamp(1010 - (local(0, fy)[1] - ORIGIN_Y) * FOLLOW, H - ORIGIN_Y * FOLLOW + 4, ORIGIN_Y * FOLLOW - 4);
  const w = 6.2, dt = 1 / FPS;
  let focus = 420, y = BASE.y, s = 1, vy = 0, vs = 0;
  camera = [];
  for (let n = 0; n < total; n++) {
    const t = n / FPS;
    const next = points.find((p) => p.out >= t - 0.35);
    if (next && next.out <= t + 1.4) focus = next.y;
    const target = isWide(t) ? { y: BASE.y, s: 1 } : { y: followY(focus), s: FOLLOW };
    vy += (w * w * (target.y - y) - 2 * w * vy) * dt; y += vy * dt;
    vs += (w * w * (target.s - s) - 2 * w * vs) * dt; s += vs * dt;
    camera.push({ y, s, follow: clamp((s - 1) / (FOLLOW - 1)) });
  }
}
function phonePose(t) {
  const cam = camera[clamp(Math.round(t * FPS), 0, total - 1)];
  let x = BASE.x, y = cam.y, s = cam.s, rx = 0, ry = 0, rz = 0;
  const idle = 1 - cam.follow; // steady while following the action
  y += Math.sin((t / 4.2) * Math.PI * 2) * 7 * idle;
  rz += Math.sin((t / 5.3) * Math.PI * 2) * 0.55 * idle;
  ry += Math.sin((t / 6.1) * Math.PI * 2 + 1) * 2.4 * idle;
  rx += Math.sin((t / 4.7) * Math.PI * 2 + 2) * 1.5 * idle;
  // Entrance: springs up from below with a tilt.
  const enter = spring(t - (INTRO - 0.8), 10, 5.5);
  y += (1 - enter) * 1500; rx += (1 - enter) * 26; rz += (1 - enter) * -9; s *= lerp(0.88, 1, clamp(enter));
  // Ending: steps back and down so the title card can take over.
  const end = easeInOut((t - footageStop()) / 0.95);
  y = lerp(y, 1540, end); s *= lerp(1, 0.6, end); rz += -5 * end; ry += 9 * end;
  const hold = holdAmount(t);
  s *= 1 - 0.035 * hold; y += 18 * hold;
  // Each tap gives the phone a tiny squish, as if it felt the finger.
  for (const tapAt of tapTimes) { const d = t - tapAt; if (d > -0.05 && d < 0.3) s *= 1 - 0.006 * idle * Math.sin(clamp((d + 0.05) / 0.35) * Math.PI); }
  return { x, y, s, rx, ry, rz, follow: cam.follow };
}
let phoneMatrix;
function placePhone(pose) {
  const list = `translate(${pose.x - ORIGIN_X}px, ${pose.y - ORIGIN_Y}px) perspective(2600px) rotateX(${pose.rx}deg) rotateY(${pose.ry}deg) rotateZ(${pose.rz}deg) scale(${pose.s})`;
  $('phone').style.transform = list;
  phoneMatrix = new DOMMatrix().translate(ORIGIN_X, ORIGIN_Y).multiply(new DOMMatrix(list)).translate(-ORIGIN_X, -ORIGIN_Y);
  const shadow = $('shadow');
  shadow.style.transform = `translate(${pose.x - 380}px, ${pose.y + ORIGIN_Y * pose.s - 40}px) scale(${pose.s})`;
  shadow.style.opacity = String(clamp(1 - Math.abs(pose.y - BASE.y) / 1400) * (1 - pose.follow));
}
/** Stage position of an app point, through the phone's 3D pose. */
function project(x, y) {
  const [lx, ly] = local(x, y);
  const p = phoneMatrix.transformPoint(new DOMPoint(lx, ly, 0, 1));
  return [p.x / p.w, p.y / p.w];
}

// ---------------------------------------------------------------------------------------------
// The phone screen: captured frame + status bar + home indicator + the finger.
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
  drawFinger(g, s, dark);
  const veil = holdAmount(t);
  if (veil > 0) { g.fillStyle = dark ? `rgba(34,27,40,${0.3 * veil})` : `rgba(255,250,243,${0.3 * veil})`; g.fillRect(0, 0, 1170, 2532); }
  return dark;
}

// ---------------------------------------------------------------------------------------------
// Step labels: what each tap does, and what just happened, right next to it.
// ---------------------------------------------------------------------------------------------
let LABELS = [];
function buildLabels() {
  const items = events.filter((e) => e.label && (e.type === 'tap' || e.type === 'note')).map((e) => {
    const tap = e.type === 'tap';
    const start = outAt(e.t) - (tap ? 0.55 : 0.05);
    return { text: tap ? e.label : `✓ ${e.label}`, tap, point: tap ? [e.x, e.y] : [e.rect.x + e.rect.w / 2, e.rect.y], start, end: start + (tap ? 2.0 : 2.2) };
  }).sort((a, b) => a.start - b.start);
  items.forEach((label, i) => {
    if (items[i + 1]) label.end = Math.min(label.end, items[i + 1].start - 0.06);
    const pause = holdWindows.find(([a]) => a > label.start); // a chapter's caption gets the stage to itself
    if (pause) label.end = Math.min(label.end, pause[0] - 0.08);
  });
  LABELS = items;
}
function drawLabels(t, dark) {
  fx.font = '800 50px Nunito'; fx.textAlign = 'center'; fx.textBaseline = 'middle';
  for (const label of LABELS) {
    const d = t - label.start, gone = t - label.end;
    if (d < 0 || gone > 0.22) continue;
    const k = spring(d, 16, 8), out = easeIn(gone / 0.22);
    const [px, py] = project(...label.point);
    const w = fx.measureText(label.text).width + 74, h = 96, gap = label.tap ? 128 : 80;
    const below = py - gap - h / 2 < 60;
    const cy = below ? py + gap : py - gap;
    const cx = clamp(px, w / 2 + 24, W - w / 2 - 24);
    const bgColor = label.tap ? (dark ? '#fff2e9' : '#3f2c39') : (dark ? '#f3b5cc' : '#b64967');
    const ink = label.tap ? (dark ? '#3d2133' : '#fff7f1') : (dark ? '#3d2133' : '#fff7f1');
    fx.save();
    fx.globalAlpha = clamp(d / 0.12) * (1 - out);
    fx.translate(cx, cy); fx.scale((0.72 + 0.28 * k) * (1 - 0.12 * out), (0.72 + 0.28 * k) * (1 - 0.12 * out));
    fx.shadowColor = 'rgba(60, 25, 45, .28)'; fx.shadowBlur = 26; fx.shadowOffsetY = 10;
    fx.fillStyle = bgColor;
    fx.beginPath(); fx.roundRect(-w / 2, -h / 2, w, h, h / 2); fx.fill();
    // A little pointer toward the finger (or the thing that changed).
    const tipX = clamp(px - cx, -w / 2 + 46, w / 2 - 46), dir = below ? -1 : 1;
    fx.beginPath(); fx.moveTo(tipX - 18, dir * (h / 2 - 2)); fx.lineTo(tipX, dir * (h / 2 + 18)); fx.lineTo(tipX + 18, dir * (h / 2 - 2)); fx.fill();
    fx.shadowColor = 'transparent';
    fx.fillStyle = ink; fx.fillText(label.text, 0, 2);
    fx.restore();
  }
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
  const save = events.find((e) => e.type === 'focus' && e.label === 'save')?.rect;
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
  const avatar = events.find((e) => e.type === 'focus' && e.label === 'avatar')?.rect;
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
  const el = document.createElement('div'); el.className = `copy ${className}`; el.style.top = `${top}px`;
  if (className.includes('wordmark')) for (const ch of text) { const s = document.createElement('span'); s.textContent = ch === ' ' ? ' ' : ch; el.append(s); }
  else el.innerHTML = text;
  return el;
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
  for (const [el, delay] of [[outro.tag, 1.05], [outro.pill, 1.3], [outro.url, 1.5]]) {
    const p = easeOut((d - delay) / 0.45);
    el.style.opacity = String(p); el.style.transform = `translateY(${(1 - p) * 28}px)`;
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
  for (const title of TITLES) {
    title.words.forEach((_, i) => cue(title.from + i * 0.075, 'bloop', { i: i + 2 }));
    cue(title.from + title.words.length * 0.075 + 0.08, 'pop');
  }
  for (const [time, name] of [[pauseAt('scan'), 'scan'], [pauseAt('tidy'), 'tidy'], [pauseAt('recipes'), 'recipes'], [outAt(ev('night') + 0.5), 'night']]) cue(time, 'swap', { name });
  for (const [, end] of holdWindows.slice(0, -1)) cue(end - 0.05, 'zoom'); // the camera moves in
  for (const label of LABELS) cue(label.start, label.tap ? 'label' : 'sparkle');
  for (const tap of taps) cue(outAt(tap.t), 'tap');
  for (const drag of drags) { const a = outAt(drag.t); cue(a, 'swish', { dur: outAt(drag.t + drag.ms / 1000) - a }); }
  for (const typed of events.filter((e) => e.type === 'type')) [...typed.text].forEach((ch, i) => { if (ch !== ' ') cue(outAt(typed.t + (i * typed.perChar) / 1000), 'tick', { i }); });
  const tp = outAt(ev('photo')) + 0.02;
  cue(tp + 0.25, 'whoosh', { dur: 0.6 });
  cue(outAt(ev('ideas')) + 0.15, 'confetti');
  cue(outAt(ev('saved')) + 0.1, 'hearts');
  cue(outAt(ev('night') + 0.12), 'night');
  cue(outAt(ev('night')) + 0.7, 'zzz');
  const end = footageStop();
  cue(end, 'whoosh', { dur: 0.9 });
  cue(end + 0.35, 'boing', { small: true });
  [...'PantryScoop'].forEach((_, i) => cue(end + 0.15 + 0.5 + (i + (i > 5 ? 1 : 0)) * 0.04, 'bloop', { i }));
  cue(end + 1.2, 'tada');
  return cues.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------------------------
async function setup() {
  cap = await (await fetch('/capture.json')).json();
  events = cap.events;
  taps = events.filter((e) => e.type === 'tap');
  drags = events.filter((e) => e.type === 'swipe');
  notes = events.filter((e) => e.type === 'note');
  buildTimeline();
  scoopSvg = (await (await fetch('/app/assets/scoop-guide.svg')).text()).replace(/<style>[\s\S]*?<\/style>/, '');
  photoImg = await createImageBitmap(await (await fetch('/app/assets/pantry-editorial.webp')).blob());
  await Promise.all([document.fonts.load('900 80px Nunito'), document.fonts.load('800 40px Nunito'), document.fonts.load('80px "Noto Color Emoji"', '🍋')]);
  $('phone').style.width = `${PHONE_W}px`; $('phone').style.height = `${PHONE_H}px`;
  tapTimes = taps.map((tap) => outAt(tap.t));
  buildTitles(); buildCamera(); buildLabels(); buildCards();
  // Warm the sticker cache so the first frames do not stall.
  for (const set of Object.values(SETS)) SLOTS.forEach(([, , size], i) => sticker(set[i], size));
  await loadFrame(0);
  window.totalFrames = total;
  window.timeline = {
    total, intro: INTRO, footageStop: footageStop(), nightStart: outAt(ev('night') + 0.12), cues: buildCues(),
    chapters: { onboarding: INTRO - 0.12, ...Object.fromEntries(['scan', 'tidy', 'recipes', 'dark'].map((m) => [m, pauseAt(m)])) },
    labels: LABELS.map(({ text, start, end }) => ({ text, start, end })),
  };
}

window.renderFrame = async (n) => {
  const t = n / FPS, s = srcAt(t);
  const pose = phonePose(t);
  drawBackground(t, pose.follow);
  placePhone(pose);
  const dark = await drawScreen(s, t);
  drawTitles(t, pose.follow);
  drawFx(t);
  drawLabels(t, dark);
  drawIntro(t);
  drawOutro(t);
};
window.ready = setup();
