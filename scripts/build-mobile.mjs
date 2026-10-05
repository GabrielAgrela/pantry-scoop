import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(await readFile(new URL('../mobile/config.json', import.meta.url), 'utf8'));
const server = new URL(process.env.MOBILE_SERVER_URL || config.serverUrl);
if (server.protocol !== 'https:' || server.username || server.password || server.pathname !== '/' || server.search || server.hash) {
  throw new Error('MOBILE_SERVER_URL must be an HTTPS origin (no credentials, path, query or fragment).');
}
const out = new URL('../dist/mobile/', import.meta.url);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(new URL('../public/', import.meta.url), out, { recursive: true });
// Bundle only the native adapter. Every screen and stylesheet is copied from the web source.
await build({
  absWorkingDir: root,
  entryPoints: ['mobile/native.js'],
  outfile: fileURLToPath(new URL('js/native.js', out)),
  bundle: true, format: 'esm', target: 'chrome110',
  external: ['/js/*'],
  define: { PANTRY_SERVER_URL: JSON.stringify(server.origin) },
});
const index = await readFile(new URL('index.html', out), 'utf8');
await writeFile(new URL('index.html', out), index.replace('<script type="module" src="/js/main.js"></script>',
  '<script type="module" src="/js/native.js"></script>'));
console.log(`Shared frontend packaged for Android → ${server.origin}`);
