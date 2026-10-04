import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

type Span = { w: number; h: number; minW?: number; rowsFor?: (w: number) => number };
type Cell = { index: number; x: number; y: number; w: number; h: number };
// Browser module without type declarations: load it dynamically and describe its shape here.
const { packTiles, tileSpan } = (await import(new URL('../../public/js/tile-layout.js', import.meta.url).href)) as {
  packTiles: (spans: Span[], columns?: number) => Cell[];
  tileSpan: (name: string, details?: string) => Span;
};

const names = ['Oven', 'Stove', 'Wok', 'Freezer', 'Blender', 'Kettle', 'Microwave', 'Air fryer', 'Bread maker', 'Sous vide stick', 'KitchenAid Artisan stand mixer', 'Cecotec Gelacy 1200 Touch ice-cream machine'];
const details = ['', '', '', '10l', '200°C max', 'Max 750 g loaf, 13 h delay timer', 'Compressor, 1.2 L bowl. Total mix before churning must be 700–850 ml. Churn 60m'];

function coverage(cells: Cell[], columns = 6) {
  const bottom = Math.max(...cells.map((cell) => cell.y + cell.h));
  const grid = Array.from({ length: bottom }, () => Array<number>(columns).fill(0));
  for (const cell of cells) for (let y = cell.y; y < cell.y + cell.h; y++) for (let x = cell.x; x < cell.x + cell.w; x++) grid[y]![x]! += 1;
  return grid.flat();
}

describe('appliance tile layout', () => {
  it('fills the grid without holes or overlaps, keeping every tile', () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let run = 0; run < 500; run++) {
      const set = Array.from({ length: 1 + Math.floor(random() * 12) }, () => tileSpan(names[Math.floor(random() * names.length)]!, details[Math.floor(random() * details.length)]!));
      const cells = packTiles(set);
      assert.deepEqual(cells.map((cell) => cell.index).sort((a, b) => a - b), set.map((_, index) => index));
      assert.ok(coverage(cells).every((count) => count === 1), `run ${run} left a hole or overlap`);
    }
  });

  it('stays gap-free with measured heights in fine rows on wider grids', () => {
    let seed = 11;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const columns of [6, 9, 12]) {
      for (let run = 0; run < 200; run++) {
        // Heights in 4px rows, shrinking as a tile gets wider, like real text does.
        const set = Array.from({ length: 1 + Math.floor(random() * 12) }, () => {
          const span = tileSpan(names[Math.floor(random() * names.length)]!, details[Math.floor(random() * details.length)]!);
          const base = 24 + Math.floor(random() * 8);
          return { ...span, rowsFor: (w: number) => Math.round(base + span.h * 32 / w) };
        });
        const cells = packTiles(set, columns);
        assert.equal(cells.length, set.length);
        assert.ok(coverage(cells, columns).every((count) => count === 1), `${columns} columns, run ${run} left a hole or overlap`);
        for (const cell of cells) assert.ok(cell.h >= set[cell.index]!.rowsFor(cell.w), 'a tile is shorter than its text');
      }
    }
  });

  it('sizes tiles by their text and keeps the same shape for the same name', () => {
    const big = tileSpan('Cecotec Gelacy 1200 Touch ice-cream machine', 'Compressor, 1.2 L bowl. Total mix before churning must be 700–850 ml. Churn 60m');
    const small = tileSpan('Oven');
    assert.ok(big.w * big.h > small.w * small.h);
    assert.equal(small.h, 2);
    assert.deepEqual(tileSpan('Microwave'), tileSpan('Microwave'));
  });

  it('packs the kitchen from the redesign without stretching any tile', () => {
    const kitchen = [
      tileSpan('Cecotec Gelacy 1200 Touch ice-cream machine', 'Compressor, 1.2 L bowl. Total mix before churning must be 700–850 ml. Churn 60m'),
      ...['Freezer', 'Oven', 'Blender'].map((name) => tileSpan(name)),
      tileSpan('Air fryer', '10l'),
      ...['Stove', 'Microwave'].map((name) => tileSpan(name)),
    ];
    // Narrowing a tile to fit is fine; growing it into empty space is not.
    for (const cell of packTiles(kitchen)) assert.ok(cell.w * cell.h <= kitchen[cell.index]!.w * kitchen[cell.index]!.h);
  });
});
