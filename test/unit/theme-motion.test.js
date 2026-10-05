import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../public/js/theme.js', import.meta.url), 'utf8');
function themePage(width, height, { reduced = false, skipped = false } = {}) {
  const properties = new Map(), classes = new Set(), saved = new Map(), animations = [];
  let onReady, click, finish, capturedName;
  const button = { disabled: false, addEventListener: (_, action) => { click = action; }, setAttribute() {} };
  const body = { style: { viewTransitionName: '' } };
  const root = {
    dataset: {}, style: { setProperty: (k, v) => properties.set(k, v), removeProperty: k => properties.delete(k) },
    classList: { add: k => classes.add(k), remove: k => classes.delete(k) },
    animate: (frames, timing) => animations.push({ frames, timing }),
  };
  const document = {
    documentElement: root, body, querySelector: selector => selector === '.theme-toggle' ? button : null,
    addEventListener: (_, action) => { onReady = action; }, dispatchEvent() {},
    startViewTransition(update) {
      capturedName = body.style.viewTransitionName;
      update();
      return { ready: skipped ? Promise.reject(new Error('skipped')) : Promise.resolve(), finished: new Promise(resolve => { finish = resolve; }) };
    },
  };
  runInNewContext(source, {
    document, innerWidth: width, innerHeight: height,
    matchMedia: query => ({ matches: query.includes('reduced-motion') && reduced, addEventListener() {} }),
    localStorage: { getItem: k => saved.get(k), setItem: (k, v) => saved.set(k, v) },
    CustomEvent: class {},
  });
  onReady();
  return { root, body, button, properties, classes, animations, saved, click: () => click(), finish: () => finish(), captured: () => capturedName };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function inside([x, y], polygon) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) result = !result;
  }
  return result;
}
const translation = frame => frame.transform.match(/translate\(([-\d.]+)(?:px)?, ([-\d.]+)(?:px)?\)/).slice(1).map(Number);

describe('shared theme wave', () => {
  it('covers the viewport initially, clears it at the end, and keeps content stationary', async () => {
    for (const [width, height] of [[360, 800], [800, 360], [1440, 900], [2560, 1440]]) {
      const page = themePage(width, height);
      page.click(); await flush();
      assert.equal(page.captured(), 'theme-old');
      assert.equal(page.body.style.viewTransitionName, 'theme-new');
      assert.equal(page.animations.length, 2);
      const polygon = [...page.properties.get('--theme-wave-clip').matchAll(/([-\d.]+)px ([-\d.]+)px/g)].map(m => [Number(m[1]), Number(m[2])]);
      const movement = translation(page.animations[0].frames[1]);
      const counter = translation(page.animations[1].frames[1]);
      assert.deepEqual(movement.map((v, i) => v + counter[i]), [0, 0]);
      const final = polygon.map(([x, y]) => [x + movement[0], y + movement[1]]);
      for (const point of [[0, 0], [width, 0], [0, height], [width, height], [width / 2, height / 2]]) {
        assert.equal(inside(point, polygon), true, `initial coverage at ${point} in ${width}x${height}`);
        assert.equal(inside(point, final), false, `final clearance at ${point} in ${width}x${height}`);
      }
      for (const { frames } of page.animations) for (const frame of frames) assert.deepEqual(Object.keys(frame), ['transform']);
      page.finish(); await flush();
      assert.equal(page.button.disabled, false);
      assert.equal(page.body.style.viewTransitionName, '');
      assert.equal(page.properties.size, 0);
      assert.equal(page.classes.size, 0);
      assert.equal(page.saved.get('pantry-scoop-theme'), 'dark');
    }
  });
  it('cleans up a skipped transition and leaves the chosen theme usable', async () => {
    const page = themePage(392, 850, { skipped: true });
    page.click(); await flush(); page.finish(); await flush();
    assert.equal(page.root.dataset.theme, 'dark');
    assert.equal(page.animations.length, 0);
    assert.equal(page.button.disabled, false);
    assert.equal(page.body.style.viewTransitionName, '');
    assert.equal(page.properties.size, 0);
    assert.equal(page.classes.size, 0);
  });
  it('respects reduced motion and persists both theme choices', () => {
    const page = themePage(392, 850, { reduced: true });
    page.click(); assert.equal(page.root.dataset.theme, 'dark');
    page.click(); assert.equal(page.root.dataset.theme, 'light');
    assert.equal(page.saved.get('pantry-scoop-theme'), 'light');
    assert.equal(page.captured(), undefined);
    assert.equal(page.animations.length, 0);
    assert.equal(page.button.disabled, false);
  });
});
