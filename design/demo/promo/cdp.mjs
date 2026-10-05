// Minimal raw CDP client for Chrome's headless shell with BeginFrame control.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const SHELL = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';

export async function launchShell({ extraArgs = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'shell-'));
  const args = [
    '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-sandbox', '--no-first-run',
    '--deterministic-mode', '--enable-begin-frame-control', '--run-all-compositor-stages-before-draw',
    '--disable-new-content-rendering-timeout', '--disable-threaded-animation', '--disable-threaded-scrolling',
    '--disable-checker-imaging', '--disable-image-animation-resync', '--hide-scrollbars',
    '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ...extraArgs, 'about:blank',
  ];
  const proc = spawn(SHELL, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) resolve(m[1]);
    });
    proc.on('exit', (code) => reject(new Error(`shell exited ${code}: ${buf}`)));
  });
  const conn = await Connection.open(wsUrl);
  conn.proc = proc;
  return conn;
}

export class Connection {
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    return new Connection(ws);
  }
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(Object.assign(new Error(`${p.method}: ${msg.error.message}`), { data: msg.error }));
        else p.resolve(msg.result);
      } else {
        const key = `${msg.sessionId ?? ''}:${msg.method}`;
        for (const cb of this.listeners.get(key) ?? []) cb(msg.params);
      }
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }
  on(method, cb, sessionId) {
    const key = `${sessionId ?? ''}:${method}`;
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(cb);
    return () => this.listeners.get(key).delete(cb);
  }
  once(method, sessionId) {
    return new Promise((resolve) => { const off = this.on(method, (p) => { off(); resolve(p); }, sessionId); });
  }
  session(sessionId) {
    return {
      id: sessionId,
      send: (m, p) => this.send(m, p, sessionId),
      on: (m, cb) => this.on(m, cb, sessionId),
      once: (m) => this.once(m, sessionId),
    };
  }
  async close() { try { await this.send('Browser.close'); } catch {} this.ws.close(); this.proc?.kill(); }
}

export async function openPage(conn, { width, height, dpr = 1, mobile = false, touch = false }) {
  const { browserContextId } = await conn.send('Target.createBrowserContext');
  const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank', browserContextId, enableBeginFrameControl: true, width, height });
  const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
  const s = conn.session(sessionId);
  await s.send('Page.enable');
  await s.send('Runtime.enable');
  await s.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile, screenWidth: width, screenHeight: height });
  if (touch) await s.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  return s;
}
