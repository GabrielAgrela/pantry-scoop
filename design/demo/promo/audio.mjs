// Synthesises the promo soundtrack: a bouncy ukulele-and-glockenspiel tune that turns into a music
// box lullaby at night, plus sound effects placed on the stage's cues (timeline.json).
//
//   node design/demo/promo/audio.mjs <timeline.json> <out.wav>
import { readFileSync, writeFileSync } from 'node:fs';

const SR = 48000;
const timeline = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const LENGTH = timeline.total / 60;
const N = Math.ceil((LENGTH + 0.05) * SR);
const dry = [new Float32Array(N), new Float32Array(N)];
const wet = [new Float32Array(N), new Float32Array(N)];
const TAU = Math.PI * 2;
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function place(signal, time, { gain = 1, pan = 0, send = 0.18 } = {}) {
  const start = Math.round(time * SR);
  const l = gain * Math.cos(((pan + 1) * Math.PI) / 4), r = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < signal.length; i++) {
    const j = start + i;
    if (j < 0 || j >= N) continue;
    const v = signal[i];
    dry[0][j] += v * l; dry[1][j] += v * r;
    wet[0][j] += v * l * send; wet[1][j] += v * r * send;
  }
}
const make = (seconds, fn) => { const n = Math.round(seconds * SR), out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = fn(i / SR, i); return out; };
function fadeTail(sig, seconds = 0.03) { const n = Math.min(sig.length, Math.round(seconds * SR)); for (let i = 0; i < n; i++) sig[sig.length - 1 - i] *= i / n; return sig; }

// --- Instruments ------------------------------------------------------------------------------
/** Karplus–Strong pluck: a soft nylon ukulele. */
function pluck(freq, seconds, { bright = 0.5, decay = 0.9962 } = {}) {
  const n = Math.round(seconds * SR), out = new Float32Array(n), size = 8192, ring = new Float32Array(size);
  const period = SR / freq - 0.5, r = rng(Math.round(freq * 977)); // the averaging filter adds half a sample
  let lp = 0;
  const fill = Math.ceil(period) + 2;
  for (let i = 0; i < fill; i++) { lp += bright * (r() * 2 - 1 - lp); ring[i] = lp; }
  let w = fill, dc = 0;
  for (let i = 0; i < n; i++) {
    const rp = w - period, i0 = Math.floor(rp), f = rp - i0;
    const a = ring[(i0 + size) % size], b = ring[(i0 + 1 + size) % size], c = ring[(i0 - 1 + size) % size];
    const y = decay * 0.5 * (a + (b - a) * f + c + (a - c) * f);
    ring[w % size] = y; w++;
    dc += 0.002 * (y - dc);
    out[i] = (y - dc) * 1.6;
  }
  return fadeTail(out, 0.05);
}
/** FM bell: glockenspiel (ratio 3.5), kalimba (ratio 1), music box (ratio 5). */
function bell(freq, seconds, { ratio = 3.5, index = 1.8, decay = 3, attack = 0.002, drop = 0 } = {}) {
  let phase = 0;
  return fadeTail(make(seconds, (t) => {
    const f = freq * (1 + drop * Math.exp(-60 * t));
    phase += (TAU * f) / SR;
    const env = Math.min(1, t / attack) * Math.exp(-decay * t);
    return env * Math.sin(phase + index * Math.exp(-decay * 1.8 * t) * Math.sin(phase * ratio));
  }));
}
const glock = (m, s = 1.2) => bell(mtof(m), s, { ratio: 3.5, index: 1.4, decay: 3.4 });
const kalimba = (m, s = 0.8) => bell(mtof(m), s, { ratio: 1, index: 0.9, decay: 5.5, drop: 0.02 });
const musicBox = (m, s = 1.6) => bell(mtof(m), s, { ratio: 5.02, index: 0.7, decay: 2.2 });
function bass(m, seconds) {
  const f = mtof(m); let phase = 0;
  return fadeTail(make(seconds, (t) => { phase += (TAU * f) / SR; const env = Math.min(1, t / 0.006) * Math.exp(-3.2 * t); return Math.tanh(1.4 * (Math.sin(phase) + 0.3 * Math.sin(2 * phase))) * env; }), 0.04);
}
function pad(midis, seconds) {
  const voices = midis.flatMap((m) => [mtof(m) * 0.997, mtof(m) * 1.003]);
  const phases = voices.map(() => 0);
  return fadeTail(make(seconds, (t) => {
    const env = Math.min(1, t / 0.6) * Math.min(1, (seconds - t) / 0.5);
    let v = 0;
    voices.forEach((f, k) => { phases[k] += (TAU * f * (1 + 0.002 * Math.sin(TAU * 4.5 * t + k))) / SR; v += Math.sin(phases[k]) + 0.12 * Math.sin(3 * phases[k]); });
    return (v / voices.length) * env;
  }), 0.1);
}
function noise(seconds, seed, shape) { const r = rng(seed); return make(seconds, (t) => (r() * 2 - 1) * shape(t)); }
/** One-pole filters, in place. */
function lowpass(sig, cutoff) { const k = typeof cutoff === 'function' ? null : 1 - Math.exp((-TAU * cutoff) / SR); let y = 0; for (let i = 0; i < sig.length; i++) { const a = k ?? 1 - Math.exp((-TAU * cutoff(i / SR)) / SR); y += a * (sig[i] - y); sig[i] = y; } return sig; }
function highpass(sig, cutoff) { const a = 1 - Math.exp((-TAU * cutoff) / SR); let y = 0; for (let i = 0; i < sig.length; i++) { y += a * (sig[i] - y); sig[i] -= y; } return sig; }
function bandpass(sig, f) { return highpass(lowpass(sig, f * 1.6), f * 0.6); }

const kick = () => { let phase = 0; return make(0.32, (t) => { phase += (TAU * (48 + 120 * Math.exp(-28 * t))) / SR; return Math.sin(phase) * Math.exp(-9 * t) * 1.2 + (t < 0.003 ? 0.3 : 0); }); };
const snap = (seed) => { const s = bandpass(noise(0.12, seed, (t) => Math.exp(-38 * t)), 2200); return s.map((v, i) => v * 2.2 + Math.sin(TAU * 2600 * (i / SR)) * Math.exp(-90 * (i / SR)) * 0.25); };
const shaker = (seed, accent) => highpass(noise(0.06, seed, (t) => Math.min(1, t / 0.008) * Math.exp(-55 * t)), 6000).map((v) => v * (accent ? 0.9 : 0.55));

// --- The tune -----------------------------------------------------------------------------------
const BEAT = 0.5, BAR = 2, START = 1.0; // 120 bpm; bar 1 starts at 1.0 s, the groove at bar 2 (3.0 s)
const barTime = (bar) => START + (bar - 1) * BAR;
const CHORDS = {
  C: { uke: [67, 60, 64, 72], root: 48, fifth: 55, pad: [60, 64, 67, 72] },
  G: { uke: [67, 62, 71, 74], root: 43, fifth: 50, pad: [55, 62, 67, 71] },
  Am: { uke: [69, 60, 64, 72], root: 45, fifth: 52, pad: [57, 60, 64, 69] },
  F: { uke: [69, 60, 65, 69], root: 41, fifth: 48, pad: [53, 60, 65, 69] },
};
const CYCLE = ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'G'];
const MELODY = [
  [[0, 76], [0.5, 79], [1, 81], [1.5, 79], [2, 76], [3, 72], [3.5, 74]],
  [[0, 74], [0.5, 76], [1, 74], [1.5, 71], [2, 74], [3.5, 67]],
  [[0, 72], [0.5, 76], [1, 81], [1.5, 79], [2, 76], [3, 74], [3.5, 72]],
  [[0, 69], [0.5, 72], [1, 77], [2, 76], [2.5, 74], [3, 72]],
  [[0, 79], [0.5, 76], [1, 79], [1.5, 81], [2, 79], [2.5, 76], [3, 72]],
  [[0, 74], [0.5, 79], [1, 74], [1.5, 71], [2, 74]],
  [[0, 72], [0.5, 69], [1, 72], [1.5, 77], [2, 76], [2.5, 72], [3, 69]],
  [[0, 71], [0.5, 74], [1, 79], [2, 77], [2.5, 74], [3, 71], [3.5, 74]],
];
const nightBar = Math.floor((timeline.nightStart - START) / BAR) + 1; // the bar the wave starts in
const LAST_BAR = Math.floor((LENGTH - START) / BAR); // the final chord's bar

function strum(chord, time, { up = false, velocity = 1, bright = 0.5 } = {}) {
  const notes = up ? [...chord.uke].reverse().slice(0, 3) : chord.uke;
  notes.forEach((m, k) => place(pluck(mtof(m), 1.6, { bright: up ? bright * 0.8 : bright }), time + k * (up ? 0.008 : 0.011), { gain: 0.11 * velocity * (up ? 0.65 : 1), pan: -0.25 + k * 0.08, send: 0.16 }));
}

// Bar 1: a soft hello while Scoop lands and the name pops in.
strum(CHORDS.C, barTime(1), { velocity: 0.75, bright: 0.35 });
strum(CHORDS.G, barTime(1) + 1, { velocity: 0.7, bright: 0.35 });
[72, 76, 79, 84, 88].forEach((m, k) => place(glock(m, 1.4), barTime(1) + 1.5 + k * 0.1, { gain: 0.07, pan: 0.3, send: 0.35 }));

for (let bar = 2; bar <= LAST_BAR; bar++) {
  const t0 = barTime(bar);
  const night = bar > nightBar;
  if (bar === LAST_BAR) {
    // Goodnight: one warm chord, a music-box arpeggio up to the stars.
    strum(CHORDS.C, t0, { velocity: 0.9, bright: 0.4 });
    place(pad(CHORDS.C.pad, 2.4), t0, { gain: 0.09, send: 0.4 });
    place(bass(36, 2.2), t0, { gain: 0.16, send: 0.05 });
    [72, 76, 79, 84, 88, 91].forEach((m, k) => place(musicBox(m, 2.2), t0 + 0.06 + k * 0.09, { gain: 0.075, pan: 0.2 - k * 0.06, send: 0.45 }));
    continue;
  }
  if (night) {
    // Lullaby: pads and a music box, no drums.
    const name = bar === LAST_BAR - 1 ? 'G' : 'F';
    place(pad(CHORDS[name].pad, 2.1), t0, { gain: 0.08, send: 0.45 });
    place(bass(CHORDS[name].root - 12, 1.8), t0, { gain: 0.1, send: 0.05 });
    const line = name === 'F' ? [[0, 81], [1, 84], [2, 81], [2.5, 79], [3, 77]] : [[0, 79], [1, 83], [2, 86], [3, 83]];
    for (const [b, m] of line) place(musicBox(m, 1.8), t0 + b * BEAT, { gain: 0.07, pan: 0.25, send: 0.5 });
    continue;
  }
  const name = CYCLE[(bar - 2) % CYCLE.length];
  const chord = CHORDS[name];
  const quiet = bar === nightBar; // the wave starts here: the band tiptoes out
  // Ukulele: island strum D . D U . U D U
  for (const [b, up] of [[0, false], [1, false], [1.5, true], [2.5, true], [3, false], [3.5, true]]) {
    if (quiet && b >= 2) continue;
    strum(chord, t0 + b * BEAT, { up, velocity: b === 0 ? 1 : 0.8 });
  }
  // Bass: bouncy root, root, fifth pickup.
  place(bass(chord.root, 0.42), t0, { gain: 0.2, send: 0.04 });
  if (!quiet) place(bass(chord.root, 0.3), t0 + 2 * BEAT, { gain: 0.17, send: 0.04 });
  if (!quiet) place(bass(chord.fifth, 0.16), t0 + 3.5 * BEAT, { gain: 0.13, send: 0.04 });
  // Drums: soft kick, finger snaps, shaker.
  for (const b of quiet ? [0] : [0, 2]) place(kick(), t0 + b * BEAT, { gain: 0.32, send: 0.02 });
  for (const b of quiet ? [1] : [1, 3]) place(snap(bar * 10 + b), t0 + b * BEAT, { gain: 0.16, pan: 0.15, send: 0.2 });
  if (!quiet) for (let k = 0; k < 8; k++) place(shaker(bar * 100 + k, k % 2 === 1), t0 + k * BEAT / 2, { gain: 0.05, pan: 0.35, send: 0.05 });
  // Melody on the glockenspiel and kalimba: phrases with breathing room.
  const phrase = (bar - 2) % 8;
  const sing = !quiet && (bar - 2) % 6 < 4; // four bars on, two to breathe
  if (sing) for (const [b, m] of MELODY[phrase]) {
    place(kalimba(m, 0.9), t0 + b * BEAT, { gain: 0.1, pan: 0.18, send: 0.22 });
    place(glock(m + 12, 0.9), t0 + b * BEAT + 0.004, { gain: 0.022, pan: 0.3, send: 0.3 });
  }
}

// --- Sound effects on the stage's cues ----------------------------------------------------------
const PENTA = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96];
function sweep(seconds, f0, f1, shape, seed = 1) { let phase = 0; return make(seconds, (t) => { phase += (TAU * (f0 + (f1 - f0) * Math.min(1, t / seconds))) / SR; return Math.sin(phase) * shape(t); }); }
const FX = {
  tap: (c, k) => { const s = sweep(0.09, 520 + (k % 3) * 40, 980, (t) => Math.min(1, t / 0.002) * Math.exp(-42 * t)); place(s, c.t, { gain: 0.16, send: 0.12 }); },
  bloop: (c) => place(kalimba(PENTA[c.i % PENTA.length], 0.5), c.t, { gain: 0.085, pan: -0.1 + (c.i % 5) * 0.05, send: 0.25 }),
  pop: (c, k) => { const s = sweep(0.07, 320 + ((c.i ?? k) % 4) * 60, 1250, (t) => Math.exp(-50 * t)); place(s, c.t, { gain: 0.14, send: 0.15 }); },
  label: (c, k) => place(sweep(0.08, 760 + (k % 3) * 60, 1180, (t) => Math.min(1, t / 0.003) * Math.exp(-38 * t)), c.t, { gain: 0.07, pan: 0.15, send: 0.2 }),
  tick: (c) => place(bandpass(noise(0.03, 300 + c.i, (t) => Math.exp(-160 * t)), 3200 + (c.i % 4) * 400), c.t, { gain: 0.35, pan: 0.1, send: 0.05 }),
  swish: (c, k) => { const d = Math.max(0.25, c.dur); place(lowpass(noise(d + 0.15, 500 + k, (t) => Math.sin(Math.PI * Math.min(1, t / (d + 0.15))) ** 2), (t) => 900 + 2200 * Math.sin(Math.PI * Math.min(1, t / d))), c.t, { gain: 0.1, pan: -0.2, send: 0.1 }); },
  whoosh: (c, k) => { const d = c.dur ?? 0.6; place(lowpass(noise(d, 700 + k, (t) => Math.sin(Math.PI * t / d) ** 2), (t) => 300 + 3800 * Math.sin(Math.PI * t / d) ** 2), c.t, { gain: 0.22, send: 0.25 }); },
  zoom: (c, k) => place(lowpass(noise(0.45, 900 + k, (t) => Math.sin(Math.PI * t / 0.45) ** 2), (t) => 400 + 1600 * t / 0.45), c.t, { gain: 0.07, send: 0.2 }),
  sparkle: (c) => [88, 91, 93, 96, 100].forEach((m, k) => place(glock(m, 1), c.t + k * 0.045, { gain: 0.055, pan: -0.3 + k * 0.15, send: 0.45 })),
  magic: (c) => [96, 93, 91, 88, 91, 93, 96, 100].forEach((m, k) => place(glock(m, 1.2), c.t + k * 0.055, { gain: 0.05, pan: Math.sin(k) * 0.4, send: 0.5 })),
  twinkle: (c) => [91, 96, 88, 93, 100, 95].forEach((m, k) => place(glock(m, 1.2), c.t + k * 0.09, { gain: 0.04, pan: Math.sin(k * 2) * 0.5, send: 0.5 })),
  confetti: (c) => {
    place(bandpass(noise(0.12, 77, (t) => Math.exp(-30 * t)), 1400), c.t, { gain: 0.5, send: 0.2 });
    for (let k = 0; k < 14; k++) place(bandpass(noise(0.02, 80 + k, (t) => Math.exp(-200 * t)), 4000 + k * 300), c.t + 0.08 + k * 0.035, { gain: 0.18, pan: Math.sin(k * 1.7) * 0.6, send: 0.2 });
    [84, 88, 91, 96].forEach((m, k) => place(glock(m, 1.1), c.t + 0.1 + k * 0.06, { gain: 0.05, pan: 0.2, send: 0.45 }));
  },
  hearts: (c) => { place(kalimba(79, 0.7), c.t, { gain: 0.13, send: 0.3 }); place(kalimba(84, 0.9), c.t + 0.12, { gain: 0.13, send: 0.3 }); [91, 96].forEach((m, k) => place(glock(m, 1.2), c.t + 0.25 + k * 0.08, { gain: 0.04, send: 0.5 })); },
  night: (c) => {
    [100, 96, 93, 91, 88, 84, 81, 79].forEach((m, k) => place(musicBox(m, 2.4), c.t + k * 0.11, { gain: 0.05, pan: 0.5 - k * 0.12, send: 0.6 }));
    place(lowpass(noise(1.2, 33, (t) => Math.sin(Math.PI * t / 1.2) ** 2), (t) => 200 + 900 * Math.sin(Math.PI * t / 1.2)), c.t, { gain: 0.16, send: 0.35 });
  },
  zzz: (c) => [0, 0.42, 0.84].forEach((d, k) => place(musicBox([88, 86, 84][k], 1.2), c.t + d, { gain: 0.035, pan: 0.4, send: 0.6 })),
  boing: (c) => { const small = !!c.small; let phase = 0; place(make(small ? 0.35 : 0.55, (t) => { phase += (TAU * (small ? 340 : 190) * (1 + 0.45 * Math.exp(-6 * t) * Math.sin(TAU * 13 * t)) * (1 + 0.6 * t)) / SR; return Math.sin(phase) * Math.exp(-5 * t) * Math.min(1, t / 0.004); }), c.t, { gain: small ? 0.12 : 0.18, send: 0.15 }); },
  swap: (c, k) => [0, 0.06, 0.12].forEach((d, j) => place(sweep(0.06, 380 + j * 90, 1100 + j * 120, (t) => Math.exp(-55 * t)), c.t + d + 0.22, { gain: 0.06, pan: -0.4 + j * 0.4, send: 0.15 })),
  tada: (c) => {
    [84, 88, 91, 96].forEach((m, k) => place(glock(m, 1.6), c.t + k * 0.05, { gain: 0.06, pan: -0.2 + k * 0.13, send: 0.5 }));
    place(highpass(noise(1.4, 55, (t) => Math.min(1, t / 0.01) * Math.exp(-3.2 * t)), 7000), c.t, { gain: 0.06, pan: 0.2, send: 0.3 });
  },
};
timeline.cues.forEach((c, k) => FX[c.type]?.(c, k));

// --- Room, master and file ----------------------------------------------------------------------
function reverb(input, offset) {
  const combs = [1557, 1617, 1491, 1422, 1277, 1356].map((d) => ({ buf: new Float32Array(Math.round((d + offset) * SR / 44100)), i: 0, lp: 0 }));
  const alls = [556, 441, 341].map((d) => ({ buf: new Float32Array(Math.round((d + offset) * SR / 44100)), i: 0 }));
  const out = new Float32Array(input.length);
  for (let n = 0; n < input.length; n++) {
    let s = 0;
    for (const c of combs) { const y = c.buf[c.i]; c.lp = y * 0.72 + c.lp * 0.28; c.buf[c.i] = input[n] + c.lp * 0.8; c.i = (c.i + 1) % c.buf.length; s += y; }
    s /= combs.length;
    for (const a of alls) { const b = a.buf[a.i]; const y = -s + b; a.buf[a.i] = s + b * 0.5; a.i = (a.i + 1) % a.buf.length; s = y; }
    out[n] = s;
  }
  return out;
}
const room = [reverb(wet[0], 0), reverb(wet[1], 23)];
const mix = [0, 1].map((ch) => dry[ch].map((v, i) => v + room[ch][i] * 0.9));
for (const ch of mix) { highpass(ch, 28); for (let i = 0; i < ch.length; i++) { const t = i / SR; ch[i] *= Math.min(1, t / 0.15) * Math.min(1, (LENGTH - t) / 0.9); } }
let peak = 0;
for (const ch of mix) for (const v of ch) peak = Math.max(peak, Math.abs(v));
const gain = 1.08 / peak; // a touch of soft limiting: about -15 LUFS
const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) for (let ch = 0; ch < 2; ch++) pcm.writeInt16LE(Math.round(Math.tanh(mix[ch][i] * gain * 1.05) * 32767), (i * 2 + ch) * 2);
const header = Buffer.alloc(44);
header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
writeFileSync(process.argv[3], Buffer.concat([header, pcm]));
console.log(`Wrote ${process.argv[3]}: ${LENGTH.toFixed(2)} s, ${timeline.cues.length} cues, peak gain ${gain.toFixed(2)}`);
