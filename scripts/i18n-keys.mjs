// Lists every English sentence the interface can show, so each language's dictionary can be
// checked for gaps: t()/tn() literals in the browser code, data-i18n markers in
// HTML, and the server's error messages (shown to the user as they arrive).
// Usage: node scripts/i18n-keys.mjs  → JSON array on stdout.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const files = (dir, pattern) => readdirSync(join(root, dir)).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(join(root, path)).isDirectory()) return name === 'locales' ? [] : files(path, pattern);
  return pattern.test(name) ? [path] : [];
});
const literal = String.raw`'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"`;
const unescape = (text) => text.replace(/\\(.)/g, '$1');
const keys = new Set();
const add = (text) => { if (text && text.trim()) keys.add(text); };

for (const file of files('public/js', /\.js$/)) {
  const source = readFileSync(join(root, file), 'utf8');
  for (const match of source.matchAll(new RegExp(String.raw`\bt\(\s*(?:${literal})`, 'g'))) add(unescape(match[1] ?? match[2]));
  for (const match of source.matchAll(/(?<!function )\btn\(/g)) {
    const rest = source.slice(match.index);
    const strings = [...rest.matchAll(new RegExp(literal, 'g'))].slice(0, 2);
    strings.forEach((found) => add(unescape(found[1] ?? found[2])));
  }
}
for (const file of ['public/index.html', ...files('src/http', /\.ts$/)]) {
  const source = readFileSync(join(root, file), 'utf8');
  for (const match of source.matchAll(/data-i18n(?:-[\w-]+)?="([^"$]+)"/g)) add(match[1]);
}
// Server errors reach the screen as messages; their fixed text is translated, and messages built
// with values are matched by the dictionary's `{placeholder}` sentences instead.
for (const file of files('src', /\.ts$/)) {
  const source = readFileSync(join(root, file), 'utf8');
  for (const call of source.matchAll(/new \w*Error\(([\s\S]*?)\);/g)) {
    for (const found of call[1].matchAll(new RegExp(literal, 'g'))) {
      const text = unescape(found[1] ?? found[2]);
      // Startup configuration errors are for the owner's terminal, not the interface.
      if (/^[A-Z“"].* .*[.!?…)]$/u.test(text) && !/^(?:[A-Z]+_[A-Z_]+|TokenCipher)\b/.test(text)) add(text);
    }
  }
}
// Labels the classic theme script builds before modules load.
['Switch to light theme', 'Switch to dark theme'].forEach(add);

process.stdout.write(JSON.stringify([...keys].sort(), null, 1) + '\n');
