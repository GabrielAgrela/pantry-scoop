// Records one continuous session of real app use on a 390×797 phone viewport (plus the status
// bar and home indicator the edit draws around it). Writes JPEG frames and capture.json (taps,
// swipes, chapters and focus boxes) for the edit.
//
//   node --disable-warning=ExperimentalWarning design/demo/promo/capture.mjs [out-dir] [dpr]
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWorld } from './world.mjs';
import { Recorder } from './recorder.mjs';

const outDir = process.argv[2] ?? fileURLToPath(new URL('./build/frames', import.meta.url));
const dpr = Number(process.argv[3] ?? 3);
const photo = fileURLToPath(new URL('../../../public/assets/pantry-editorial.webp', import.meta.url));

const world = await createWorld({ port: 3290 });
const rec = await Recorder.open({ url: world.sessionUrl, width: 390, height: 797, dpr, outDir, insets: { top: 0, bottom: 21 } });
world.wait = (ms) => rec.delay(ms);
world.recipeMs = 2600; // finished just before the second 1.5 s poll
const started = Date.now();

/** Drags the pantry list up (as many times as needed) until the element's centre reaches targetY. */
async function swipeUntilVisible(selector, targetY, { x = 195, startY = 545 } = {}) {
  for (let i = 0; i < 6; i++) {
    const box = await rec.box(selector);
    const distance = box.y + box.h / 2 - targetY;
    if (distance < 30) return;
    const d = Math.min(distance, 440);
    await rec.drag('.stock-list', { x, y: startY }, { x, y: startY - d }, Math.round(300 + d * 0.55));
    await rec.wait(150);
  }
}
const progress = setInterval(() => console.log(`… ${rec.t.toFixed(1)} s recorded (${((Date.now() - started) / 1000).toFixed(0)} s)`), 30000);

try {
  // Fresh account: the kitchen guide opens with Scoop saying hello.
  await rec.until(`document.fonts.status === 'loaded' && !document.querySelector('.kitchen-guide')?.hidden && !document.querySelector('.scoop-bubble')?.hidden`, { timeout: 20000 });
  await rec.wait(250);
  await rec.start();

  rec.mark('onboarding');
  await rec.focus('scoop', '.scoop-companion');
  await rec.wait(1100);
  await rec.tap('.scoop-pet');
  await rec.wait(1300);
  await rec.tap('.guide-tool', 'Microwave');
  await rec.wait(1200);
  await rec.tap('.guide-actions button.primary', undefined, { dx: 0.3 });
  await rec.wait(1100);
  await rec.tap('.guide-actions button.primary', undefined, { dx: 0.25 }); // left of Scoop's bubble
  await rec.wait(2100);

  rec.mark('scan');
  await rec.tap('.pantry-actions button.primary');
  await rec.wait(1000);
  rec.nextFiles([photo]);
  await rec.tap('dialog.scan-source button', 'Choose photos');
  rec.log('photo');
  await rec.until(`document.querySelector('dialog.scan-review .scan-photos img')`, { timeout: 6000 });
  rec.log('review');
  await rec.wait(1500);
  await rec.focus('found', 'dialog.scan-review .scan-overview');
  await rec.drag('dialog.scan-review .review-scroll', { x: 195, y: 620 }, { x: 195, y: 330 }, 550);
  await rec.wait(900);
  await rec.tap('dialog.scan-review .review-actions button.primary');
  rec.log('added');
  await rec.wait(1900);

  rec.mark('tidy');
  await rec.tap('.item', 'Avocados', { inner: '.stock-toggle' });
  await rec.wait(1300);
  await swipeUntilVisible('.classify-button', 430);
  await rec.wait(350);
  await rec.focus('sort', '.classify-button');
  await rec.tap('.classify-button');
  await rec.wait(2700);

  rec.mark('recipes');
  await rec.tap('.tabbar [data-tab="recipes"]');
  await rec.wait(1000);
  await rec.tap('.compose-toggle');
  await rec.wait(900);
  await rec.tap('.craving-input input');
  await rec.wait(200);
  await rec.type('something cozy', { perChar: 55 });
  await rec.wait(350);
  // Sideways drags on the wheel stall the headless shell; a tap on a number is just as real.
  await rec.tap('#view-recipes .recipe-basic-fields .wheel-item', '3');
  await rec.wait(700);
  await rec.tap('.recipe-options > summary');
  await rec.wait(750);
  await rec.focus('hats', '.difficulty-picker');
  await rec.tap('.hat-choice.difficulty-easy');
  await rec.wait(1000);
  await rec.tap('.recipe-options > summary');
  await rec.wait(650);
  await rec.tap('.recipe-suggest');
  rec.log('thinking');
  await rec.wait(800);
  // Fold the composer while Scoop thinks, so the ideas land in view.
  await rec.tap('.compose-toggle');
  await rec.until(`document.querySelector('.suggestion-grid .recipe-card.idea-fresh')`, { timeout: 8000 });
  rec.log('ideas');
  await rec.focus('ideas', '.suggestion-grid');
  await rec.wait(1700);
  await rec.tap('.suggestion-grid .recipe-open');
  await rec.wait(1500);
  await rec.tap('.recipe-next');
  await rec.wait(1300);
  await rec.focus('save', '.recipe-save');
  await rec.tap('.recipe-save');
  rec.log('saved');
  await rec.wait(1100);
  await rec.tap('.recipe-sheet-header button.icon');
  await rec.wait(1100);

  rec.mark('dark');
  await rec.tap('.tabbar [data-tab="profile"]');
  await rec.wait(1100);
  await rec.focus('avatar', '.header-end .avatar');
  await rec.tap('.theme-toggle');
  rec.log('night');
  await rec.wait(2900);
  rec.stop();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  clearInterval(progress);
  writeFileSync(`${outDir}/../capture.json`, JSON.stringify(rec.manifest(), null, 1));
  console.log(`Recorded ${rec.frame} frames (${rec.t.toFixed(2)} s) in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  await rec.close();
  await world.app.close();
}
