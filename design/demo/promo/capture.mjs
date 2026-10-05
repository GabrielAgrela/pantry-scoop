// Records one continuous session of real app use on a 390×797 phone viewport (plus the status
// bar and home indicator the edit draws around it). Writes JPEG frames and capture.json for the
// edit: every step carries the sentence the edit shows for it and the box it points at.
//
// The story keeps to steps a first-time viewer can follow, with time to see each result.
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
async function swipeUntilVisible(selector, targetY, { x = 195, startY = 545, step } = {}) {
  for (let i = 0; i < 6; i++) {
    const box = await rec.box(selector);
    const distance = box.y + box.h / 2 - targetY;
    if (distance < 30) return;
    const d = Math.min(distance, 440);
    await rec.drag('.stock-list', { x, y: startY }, { x, y: startY - d }, Math.round(320 + d * 0.6), { step: i === 0 ? step : undefined });
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
  await rec.note('Scoop, your tiny chef, says hi', '.scoop-companion', '.scoop-bubble');
  await rec.wait(1500);
  await rec.tap('.scoop-pet', undefined, { step: 'Tap Scoop any time for a tip' });
  await rec.wait(1900);
  await rec.tap('.guide-actions button.primary', undefined, { dx: 0.3, step: 'Your usual tools are picked. Tap Next' });
  await rec.wait(1500);
  await rec.tap('.guide-actions button.primary', undefined, { dx: 0.25, step: 'Check the defaults and finish' }); // left of Scoop's bubble
  await rec.wait(2300);

  rec.mark('scan');
  await rec.tap('.pantry-actions button.primary', undefined, { step: 'Tap Scan groceries' });
  await rec.wait(1200);
  rec.nextFiles([photo]);
  await rec.tap('dialog.scan-source button', 'Choose photos', { step: 'Pick a photo of your shopping' });
  rec.log('photo');
  await rec.wait(650);
  await rec.note('Scoop reads the photo…', '#scan-progress');
  await rec.until(`document.querySelector('dialog.scan-review .scan-photos img')`, { timeout: 6000 });
  rec.log('review');
  await rec.wait(700);
  await rec.note('It found 8 ingredients', 'dialog.scan-review .scan-overview');
  await rec.wait(1800);
  await rec.drag('dialog.scan-review .review-scroll', { x: 195, y: 620 }, { x: 195, y: 360 }, 700, { step: 'Check them, edit anything' });
  await rec.wait(1100);
  await rec.tap('dialog.scan-review .review-actions button.primary', undefined, { step: 'Add them to your pantry' });
  rec.log('added');
  await rec.wait(900);
  await rec.note('Each one lands on the right shelf', ['.category', 'Produce']);
  await rec.wait(1900);

  rec.mark('tidy');
  await rec.tap('.item', 'Avocados', { inner: '.stock-toggle', step: 'Ran out? One tap moves it to restock' });
  await rec.wait(1900);
  await swipeUntilVisible('.classify-button', 430, { step: 'Scroll down to the Other shelf' });
  await rec.wait(400);
  await rec.focus('sort', '.classify-button');
  await rec.tap('.classify-button', undefined, { step: 'Ask ChatGPT to sort the strays' });
  await rec.wait(2100);
  await rec.note('They find their own shelves', ['.category', 'Chocolate'], ['.category', 'Snacks']);
  await rec.wait(1900);

  rec.mark('recipes');
  await rec.tap('.tabbar [data-tab="recipes"]', undefined, { step: 'Open Recipes' });
  await rec.wait(1200);
  await rec.tap('.compose-toggle', undefined, { step: 'Tap “What shall we cook?”' });
  await rec.wait(1100);
  await rec.tap('.craving-input input', undefined, { step: 'Type what you’re craving' });
  await rec.wait(250);
  await rec.type('something cozy', { perChar: 75 });
  await rec.wait(700);
  await rec.tap('.recipe-suggest', undefined, { step: 'Find recipe ideas' });
  rec.log('thinking');
  await rec.wait(900);
  // Fold the composer while Scoop thinks, so the ideas land in view.
  await rec.tap('.compose-toggle');
  await rec.wait(350);
  await rec.note('Scoop thinks up ideas…', '#recipe-progress');
  await rec.until(`document.querySelector('.suggestion-grid .recipe-card.idea-fresh')`, { timeout: 8000 });
  rec.log('ideas');
  await rec.wait(1100); // the cards finish arriving
  await rec.note('3 ideas, all from your pantry', '.suggestion-grid');
  await rec.wait(1500);
  await rec.tap('.suggestion-grid .recipe-open', undefined, { step: 'Open one' });
  await rec.wait(1800);
  await rec.tap('.recipe-next', undefined, { step: 'See the ingredients' });
  await rec.wait(1300);
  await rec.note('Everything is already in your pantry', '.recipe-detail .recipe-ingredients');
  await rec.wait(1500);
  await rec.focus('save', '.recipe-save');
  await rec.tap('.recipe-save', undefined, { step: 'Save it to your recipe box' });
  rec.log('saved');
  await rec.wait(1600);
  await rec.tap('.recipe-sheet-header button.icon');
  await rec.wait(1300);

  rec.mark('dark');
  await rec.tap('.tabbar [data-tab="profile"]', undefined, { step: 'Open your kitchen' });
  await rec.wait(1300);
  await rec.focus('avatar', '.header-end .avatar');
  await rec.tap('.theme-toggle', undefined, { step: 'Tap the moon for night mode' });
  rec.log('night');
  await rec.wait(3200);
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
