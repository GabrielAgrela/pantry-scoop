// Frame-exact recording of a page in Chrome's headless shell. Virtual time and BeginFrames advance
// together one frame at a time, so CSS animations, Web Animations, timers and smooth scrolling are
// captured at a perfect 60 fps however long each frame takes to render. Taps are real CDP touch
// events (pointer, touch and click events fire as on a phone); taps and drags are logged for the edit.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchShell, openPage } from './cdp.mjs';

/** Fails loudly instead of hanging when the browser stops answering. */
function watch(promise, label, ms = 20000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Browser stalled: ${label}`)), ms); })]).finally(() => clearTimeout(timer));
}

export class Recorder {
  // The virtual clock starts in the daytime: after 11 pm the header blob dozes off.
  static async open({ url, width = 390, height = 844, dpr = 3, fps = 60, outDir, quality = 90, insets, startTime = Date.UTC(2026, 9, 4, 11, 30) }) {
    // BeginFrame screenshots use the window's own scale factor, not the emulated one.
    const conn = await launchShell({ extraArgs: [`--force-device-scale-factor=${dpr}`] });
    const page = await openPage(conn, { width, height, dpr, mobile: true, touch: true });
    const rec = new Recorder(conn, page, { width, height, dpr, fps, outDir, quality });
    await page.send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Lisbon' });
    if (insets) await page.send('Emulation.setSafeAreaInsetsOverride', { insets });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', platform: 'iPhone' });
    // Random speech lines and blob glances repeat identically on every run.
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'Math.random=(()=>{let s=20261004;return()=>((s=Math.imul(s^s>>>15,1|s)+0x6d2b79f5|0,((s^s>>>7)>>>0)%1e9)/1e9)})();' });
    await page.send('Page.setInterceptFileChooserDialog', { enabled: true });
    page.on('Page.fileChooserOpened', (event) => rec.chooser?.(event));
    page.on('Runtime.exceptionThrown', (event) => console.warn('[page error]', event.exceptionDetails.exception?.description ?? event.exceptionDetails.text));
    page.on('Runtime.consoleAPICalled', (event) => { if (event.type === 'error' || event.type === 'warning') console.warn('[console]', ...event.args.map((a) => a.value ?? a.description)); });
    await page.send('Emulation.setVirtualTimePolicy', { policy: 'pause', initialVirtualTime: startTime / 1000 });
    await page.send('Page.navigate', { url });
    return rec;
  }

  constructor(conn, page, { width, height, dpr, fps, outDir, quality }) {
    Object.assign(this, { conn, page, width, height, dpr, fps, outDir, quality });
    this.interval = 1000 / fps;
    this.ticks = Number(process.hrtime.bigint() / 1000000n);
    this.vt = 0; // virtual ms since the page opened
    this.epoch = Date.now() / 1000;
    this.frame = 0; // recorded frames
    this.recording = false;
    this.events = [];
    this.waiters = [];
    if (outDir) mkdirSync(outDir, { recursive: true });
  }

  /** A promise that resolves after `ms` of virtual time (fake AI work uses this). */
  delay(ms) {
    return new Promise((resolve) => this.waiters.push({ at: this.vt + ms, resolve }));
  }

  get t() { return this.frame / this.fps; } // seconds of recorded footage

  async step() {
    const expired = this.page.once('Emulation.virtualTimeBudgetExpired');
    await watch(this.page.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: this.interval }), `virtual time policy at ${Math.round(this.vt)}ms`);
    await watch(expired, `virtual time budget at ${Math.round(this.vt)}ms`);
    this.vt += this.interval;
    this.ticks += this.interval;
    const shot = this.recording ? { screenshot: { format: 'jpeg', quality: this.quality } } : {};
    const result = await watch(this.page.send('HeadlessExperimental.beginFrame', { frameTimeTicks: this.ticks, interval: this.interval, noDisplayUpdates: false, ...shot }), `BeginFrame at ${Math.round(this.vt)}ms`);
    if (this.recording) {
      if (!result.screenshotData) throw new Error(`No screenshot for frame ${this.frame}`);
      writeFileSync(join(this.outDir, `${String(this.frame).padStart(5, '0')}.jpg`), Buffer.from(result.screenshotData, 'base64'));
      this.frame++;
    }
    const due = this.waiters.filter((w) => w.at <= this.vt);
    this.waiters = this.waiters.filter((w) => w.at > this.vt);
    for (const w of due) w.resolve();
    // Let in-process HTTP handlers run between frames.
    await new Promise((resolve) => setImmediate(resolve));
  }

  async wait(ms) {
    const end = this.vt + ms - 0.01;
    while (this.vt < end) await this.step();
  }

  async eval(expression) {
    const { result, exceptionDetails } = await watch(this.page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }), `evaluate ${expression.slice(0, 80)}`);
    if (exceptionDetails) throw new Error(`eval failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}\n${expression}`);
    return result.value;
  }

  /** Steps frames until the expression is truthy. */
  async until(expression, { timeout = 15000, label = expression } = {}) {
    const end = this.vt + timeout;
    while (!(await this.eval(expression))) {
      if (this.vt > end) throw new Error(`Timed out waiting for ${label}`);
      await this.step();
    }
  }

  /** Box of the first element matching a selector (optionally containing text, optionally a child of it), in CSS pixels. */
  async box(selector, text, inner) {
    const box = await this.eval(`(() => {
      const all = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((el) => el.getClientRects().length);
      let el = ${text === undefined ? 'all[0]' : `all.find((el) => el.textContent.includes(${JSON.stringify(text)}))`};
      ${inner ? `el = el?.querySelector(${JSON.stringify(inner)});` : ''}
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })()`);
    if (!box) throw new Error(`No element for ${selector}${text ? ` with "${text}"` : ''}${inner ? ` > ${inner}` : ''}`);
    return box;
  }

  async point(target, text, { dx = 0.5, dy = 0.5, inner } = {}) {
    if (typeof target === 'object') return target;
    const b = await this.box(target, text, inner);
    return { x: b.x + b.w * dx, y: b.y + b.h * dy };
  }

  log(type, data = {}) { this.events.push({ type, t: this.t, frame: this.frame, ...data }); }
  mark(label, data = {}) { this.log('mark', { label, ...data }); }
  async focus(label, selector, text, inner) { this.log('focus', { label, rect: await this.box(selector, text, inner) }); }

  touch(type, points) {
    // Gives up waiting after 250 ms: some touch events are only acknowledged once frames keep coming.
    // Virtual timestamps: tap versus long press then follows the footage, not the render speed.
    const sent = this.page.send('Input.dispatchTouchEvent', { type, timestamp: this.epoch + this.vt / 1000, touchPoints: points.map(({ x, y }) => ({ x, y, radiusX: 9, radiusY: 9, force: 1, id: 0 })) }).catch((e) => console.warn('touch', type, e.message));
    return Promise.race([sent, new Promise((resolve) => setTimeout(resolve, 250))]);
  }

  /** A finger tap: down, a short hold, up. */
  async tap(target, text, { hold = 90, after = 0, ...offset } = {}) {
    const p = await this.point(target, text, offset);
    this.log('tap', { x: p.x, y: p.y, hold });
    await this.touch('touchStart', [p]);
    await this.wait(hold);
    await this.touch('touchEnd', []);
    await this.wait(after);
    return p;
  }

  /**
   * A finger drag that scrolls `scroller` along an ease-in-out path, one frame at a time. Scrolling
   * is applied to the real scroll container (its scroll listeners fire as usual), because touch
   * drags in the headless shell either lose movement to touch coalescing or stall BeginFrame once a
   * release starts a momentum fling. The edit draws the finger from the logged path.
   */
  async drag(scroller, from, to, ms = 450) {
    const a = await this.point(from), b = await this.point(to);
    this.log('swipe', { x: a.x, y: a.y, x2: b.x, y2: b.y, ms });
    const start = await this.eval(`(() => { const el = document.querySelector(${JSON.stringify(scroller)}); return [el.scrollLeft, el.scrollTop]; })()`);
    await this.step();
    const n = Math.max(2, Math.round(ms / this.interval));
    for (let i = 1; i <= n; i++) {
      const k = i / n, e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const left = start[0] - (b.x - a.x) * e, top = start[1] - (b.y - a.y) * e;
      await this.eval(`document.querySelector(${JSON.stringify(scroller)}).scrollTo(${left}, ${top})`);
      await this.step();
    }
    await this.step();
  }

  async type(text, { perChar = 60 } = {}) {
    this.log('type', { text, perChar });
    for (const ch of text) {
      await this.page.send('Input.insertText', { text: ch });
      await this.wait(perChar);
    }
  }

  /** Answers the next file chooser with these files. */
  nextFiles(files) {
    this.chooser = async ({ backendNodeId }) => {
      this.chooser = undefined;
      await this.page.send('DOM.setFileInputFiles', { files, backendNodeId });
    };
  }

  async start() { this.recording = true; this.log('start'); }
  stop() { this.recording = false; this.log('stop'); }

  manifest() {
    return { fps: this.fps, width: this.width, height: this.height, dpr: this.dpr, frames: this.frame, events: this.events };
  }

  async close() { await this.conn.close(); }
}
