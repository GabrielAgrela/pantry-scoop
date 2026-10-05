// Renders the promo: serves the stage page, steps it frame by frame in the headless shell and pipes
// the frames to ffmpeg.
//
//   node design/demo/promo/render.mjs <capture-dir> <out.mp4> [--audio track.wav] [--stills dir --at 0,90,…] [--from n] [--to n]
//
// <capture-dir> holds capture.json and frames/ from capture.mjs.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchShell, openPage } from './cdp.mjs';

const [captureDir, out, ...flags] = process.argv.slice(2);
const flag = (name) => { const i = flags.indexOf(`--${name}`); return i < 0 ? undefined : flags[i + 1]; };
const here = fileURLToPath(new URL('.', import.meta.url));
const roots = { '/compose/': join(here, 'compose'), '/app/': join(here, '../../../public'), '/frames/': join(captureDir, 'frames') };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.png': 'image/png' };

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file;
  if (path === '/capture.json') file = join(captureDir, 'capture.json');
  else for (const [prefix, dir] of Object.entries(roots)) if (path.startsWith(prefix)) file = join(dir, normalize(path.slice(prefix.length)).replace(/^(\.\.[/\\])+/, ''));
  if (!file || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const conn = await launchShell({ extraArgs: ['--force-device-scale-factor=1'] });
const page = await openPage(conn, { width: 1080, height: 1920, dpr: 1 });
page.on('Runtime.exceptionThrown', (e) => console.error('[stage error]', e.exceptionDetails.exception?.description ?? e.exceptionDetails.text));
page.on('Runtime.consoleAPICalled', (e) => console.log('[stage]', ...e.args.map((a) => a.value ?? a.description)));
const evaluate = async (expression) => {
  const { result, exceptionDetails } = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
};
let ticks = Number(process.hrtime.bigint() / 1000000n);
const frame = async (screenshot) => {
  ticks += 1000 / 60;
  const r = await page.send('HeadlessExperimental.beginFrame', { frameTimeTicks: ticks, interval: 1000 / 60, noDisplayUpdates: false, ...(screenshot ? { screenshot } : {}) });
  return r.screenshotData && Buffer.from(r.screenshotData, 'base64');
};

const loaded = page.once('Page.loadEventFired');
await page.send('Page.navigate', { url: `${origin}/compose/index.html` });
let isLoaded = false; loaded.then(() => { isLoaded = true; });
while (!isLoaded) await frame();
const ready = evaluate('window.ready.then(() => window.totalFrames)');
let total; ready.then((v) => { total = v; });
while (total === undefined) await frame();
const timeline = await evaluate('window.timeline');
writeFileSync(join(captureDir, 'timeline.json'), JSON.stringify(timeline, null, 1));
console.log(`Stage ready: ${total} frames (${(total / 60).toFixed(2)} s)`);

const stills = flag('stills');
if (stills) {
  mkdirSync(stills, { recursive: true });
  for (const n of flag('at').split(',').map(Number)) {
    await evaluate(`renderFrame(${n})`);
    writeFileSync(join(stills, `${String(n).padStart(5, '0')}.png`), await frame({ format: 'png' }));
    console.log('still', n);
  }
} else {
  const from = Number(flag('from') ?? 0), to = Number(flag('to') ?? total);
  const audio = flag('audio');
  const ffmpeg = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', '-f', 'image2pipe', '-framerate', '60', '-c:v', 'mjpeg', '-i', '-',
    ...(audio ? ['-ss', String(from / 60), '-i', audio] : []),
    '-c:v', 'libx264', '-preset', flag('preset') ?? 'slow', '-crf', flag('crf') ?? '16', '-pix_fmt', 'yuv420p', '-r', '60',
    ...(audio ? ['-c:a', 'aac', '-b:a', '192k', '-shortest'] : ['-an']), '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const finished = new Promise((resolve, reject) => ffmpeg.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));
  const started = Date.now();
  for (let n = from; n < to; n++) {
    await evaluate(`renderFrame(${n})`);
    const jpeg = await frame({ format: 'jpeg', quality: 95 });
    if (!ffmpeg.stdin.write(jpeg)) await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
    if (n % 300 === 0) console.log(`frame ${n}/${to} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  }
  ffmpeg.stdin.end();
  await finished;
  console.log(`Wrote ${out} in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
await conn.close();
server.close();
