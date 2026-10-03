// Watches the app sources and redeploys the Compose container whenever they change.
// Each deploy: wait for edits to settle, check (typecheck + tests + front-end syntax), rebuild,
// then roll back to the previous image if the new container does not become healthy.
// Run as a systemd user service: npm run autodeploy:install
import { execFile } from 'node:child_process';
import { watch } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SETTLE_MS = 4000;
const HEALTH_TIMEOUT_MS = 90_000;
const CONTAINER = 'pantry-scoop';
const IMAGE = 'pantry-scoop:latest';
const PREVIOUS = 'pantry-scoop:previous';
// Everything that goes into the image (see Dockerfile).
const WATCHED_DIRS = ['src', 'public'];
const WATCHED_FILES = new Set(['package.json', 'package-lock.json', 'Dockerfile', 'docker-compose.yml']);

const log = (message) => console.log(`${new Date().toISOString()} ${message}`);
let timer;
let deploying = false;
let pending = false;

function schedule(reason) {
  clearTimeout(timer);
  timer = setTimeout(() => deploy(reason), SETTLE_MS);
}

async function sh(cmd, args, options = {}) {
  return run(cmd, args, { cwd: root, maxBuffer: 32 * 1024 * 1024, ...options });
}

async function frontEndFiles(dir) {
  const entries = await readdir(join(root, dir), { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith('.js')).map((e) => join(e.parentPath, e.name));
}

async function health() {
  const { stdout } = await sh('docker', ['inspect', CONTAINER, '--format', '{{.State.Health.Status}}']);
  return stdout.trim();
}

async function waitHealthy() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  await new Promise((r) => setTimeout(r, 3000));
  while (Date.now() < deadline) {
    const status = await health().catch(() => 'missing');
    if (status === 'healthy') return true;
    if (status === 'unhealthy') return false;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function deploy(reason) {
  if (deploying) {
    pending = true;
    return;
  }
  deploying = true;
  log(`change detected (${reason}); checking`);
  try {
    try {
      for (const file of await frontEndFiles('public')) await sh(process.execPath, ['--check', file]);
      await sh('npm', ['run', '-s', 'check']);
    } catch (error) {
      log(`checks failed, not deploying:\n${(error.stdout ?? '').slice(-3000)}${error.stderr ?? error.message}`);
      return;
    }
    await sh('docker', ['tag', IMAGE, PREVIOUS]).catch(() => {});
    log('checks passed; rebuilding container');
    await sh('docker-compose', ['up', '-d', '--build']);
    if (await waitHealthy()) {
      log('deployed: container healthy');
      return;
    }
    log('new container is not healthy; rolling back to the previous image');
    await sh('docker', ['tag', PREVIOUS, IMAGE]);
    await sh('docker-compose', ['up', '-d', '--no-build', '--force-recreate']);
    log((await waitHealthy()) ? 'rolled back: previous image healthy' : 'ROLLBACK ALSO UNHEALTHY — needs attention');
  } catch (error) {
    log(`deploy failed: ${error.stderr ?? error.message}`);
  } finally {
    deploying = false;
    if (pending) {
      pending = false;
      schedule('changes during last deploy');
    }
  }
}

for (const dir of WATCHED_DIRS) {
  watch(join(root, dir), { recursive: true }, (_, file) => schedule(`${dir}/${file ?? ''}`));
}
watch(root, (_, file) => {
  if (WATCHED_FILES.has(file)) schedule(file);
});
log(`watching ${[...WATCHED_DIRS, ...WATCHED_FILES].join(', ')} in ${root}`);
// Catch up on anything changed while the watcher was not running.
schedule('startup');
