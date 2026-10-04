// Packs tiles of different sizes into a mosaic on a column grid, leaving no holes.
// Each tile takes the best-scoring spot (see scorePlacement) and the tiles above stretch down to
// meet it. At the end the last tiles stretch so the bottom comes out flat.

export const TILE_COLUMNS = 6;
// Wider lists get more columns of about this width, so small tiles stay small on desktop.
const COLUMN_PX = 48;

// Shapes that suit a short tile, each just big enough for its text. The name picks one, so short
// names don't all come out alike and a tile keeps its shape between visits.
const SHORT_SHAPES = {
  tiny: [{ w: 2, h: 2 }, { w: 3, h: 2 }],
  short: [{ w: 3, h: 2 }, { w: 4, h: 2 }],
  medium: [{ w: 4, h: 2 }, { w: 3, h: 2 }],
  noted: [{ w: 3, h: 2 }, { w: 4, h: 2 }],
  described: [{ w: 3, h: 3 }, { w: 4, h: 2 }],
};

// Tile size in grid cells, from how much text the tile has to hold.
export function tileSpan(name, details = '') {
  const total = name.length + details.length;
  if (total > 70) return { w: 4, h: 4, minW: 4 };
  if (details.length > 40) return { w: 3, h: 4, minW: 3 };
  if (total > 30 || name.length > 16) return { w: total > 40 ? 6 : 4, h: 2, minW: 4 };
  const kind = details.length > 12 ? 'described' : details ? 'noted' : name.length <= 5 ? 'tiny' : name.length <= 8 ? 'short' : 'medium';
  const shapes = SHORT_SHAPES[kind];
  const shape = shapes[[...name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7) % shapes.length];
  // Longer names don't fit in a two-column tile on a small phone.
  return { ...shape, minW: name.length > 7 ? Math.min(3, shape.w) : 2 };
}

/**
 * `rowsFor(w)`, when given, is how many rows the tile's text needs at width w; otherwise `h`.
 * @param {{w: number, h: number, minW?: number, rowsFor?: (w: number) => number}[]} spans
 * @returns {{index: number, x: number, y: number, w: number, h: number}[]}
 */
export function packTiles(spans, columns = TILE_COLUMNS) {
  const tiles = spans.map((span, index) => ({ index, w: Math.min(span.w, columns), minW: Math.min(span.w, columns, span.minW ?? 2), rowsFor: span.rowsFor ?? (() => span.h) }));
  const area = (tile, w) => w * tile.rowsFor(w);
  // Greedy packing can paint itself into a corner, so try many tile orders and keep the layout
  // with the least stretching. Stretch counts squared against each tile's own height: a few rows
  // spread over several tiles go unnoticed, the same rows in one tile leave it visibly empty.
  // Earlier orders win ties, so the list order is kept when it packs as well as any other.
  let best = null;
  for (const order of tileOrders(tiles, area)) {
    for (const choose of [bestPlacement, lowestPlacement]) {
      const cells = pack(order, columns, choose);
      if (hasGaps(cells, columns) || cells.some((cell) => cell.w < tiles[cell.index].minW)) continue;
      const stretched = cells.reduce((sum, cell) => {
        const tile = tiles[cell.index], need = tile.rowsFor(Math.min(cell.w, tile.w));
        return sum + cell.w * (cell.h - need) ** 2 / need + Math.max(0, cell.w - tile.w) * need;
      }, 0);
      if (!best || stretched < best.stretched) best = { cells, stretched };
      if (stretched === 0) return cells;
    }
  }
  return best?.cells ?? pack(tiles, columns, lowestPlacement);
}

// The list order, biggest first, then shuffles from a fixed seed so a kitchen always gets the same layout.
function tileOrders(tiles, area) {
  const orders = [tiles, [...tiles].sort((a, b) => area(b, b.w) - area(a, a.w))];
  let seed = 1;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let n = 0; n < 40; n++) {
    const order = [...tiles];
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    orders.push(order);
  }
  return orders;
}

function pack(tiles, columns, choose) {
  const heights = Array(columns).fill(0);
  const owner = Array(columns).fill(null);
  const placed = [];
  for (const tile of tiles) {
    const spot = choose(heights, owner, tile) ?? lowestPlacement(heights, owner, tile);
    for (const cell of spot.stretch) {
      cell.h = spot.y - cell.y;
      for (let c = cell.x; c < cell.x + cell.w; c++) heights[c] = spot.y;
    }
    const cell = { index: tile.index, x: spot.x, y: spot.y, w: spot.w, h: tile.rowsFor(spot.w) };
    placed.push(cell);
    for (let c = cell.x; c < cell.x + cell.w; c++) { heights[c] = cell.y + cell.h; owner[c] = cell; }
  }
  flattenBottom(heights, owner, placed);
  return placed.sort((a, b) => a.y - b.y || a.x - b.x);
}

function hasGaps(cells, columns) {
  const bottom = Math.max(0, ...cells.map((cell) => cell.y + cell.h));
  return cells.reduce((area, cell) => area + cell.w * cell.h, 0) !== bottom * columns;
}

function lowestPlacement(heights, owner, tile) {
  const { x, width } = lowestRun(heights);
  let w = Math.min(tile.w, width);
  if (width - w < 2) w = width;
  return { x, w, y: heights[x], stretch: [] };
}

function bestPlacement(heights, owner, tile) {
  let best = null;
  for (let w = tile.w; w >= tile.minW; w--) {
    for (let x = 0; x + w <= heights.length; x++) {
      const option = scorePlacement(heights, owner, x, w, tile.rowsFor(w), tile.w);
      if (option && (!best || option.score < best.score)) best = { ...option, x, w };
    }
  }
  return best;
}

// Lower is better. Prefers low spots that need no stretching (a stretched tile is mostly empty)
// and whose edges don't line up with the tile above, so seams wander instead of running straight
// down. Returns null if it would leave a hole.
function scorePlacement(heights, owner, x, w, h, desired) {
  const columns = heights.length;
  const y = Math.max(...heights.slice(x, x + w));
  const stretch = new Set();
  for (let c = x; c < x + w; c++) {
    if (heights[c] === y) continue;
    const above = owner[c];
    // Only a tile with nothing beneath it can grow down into the step, and only a little.
    if (!above || owner.some((o, k) => k >= above.x && k < above.x + above.w && o !== above)) return null;
    if (y - heights[c] > Math.max(3, above.h / 4)) return null;
    stretch.add(above);
  }
  const after = heights.slice();
  let waste = 0;
  for (const cell of stretch) for (let c = cell.x; c < cell.x + cell.w; c++) { waste += y - after[c]; after[c] = y; }
  for (let c = x; c < x + w; c++) after[c] = y + h;
  // No tile is narrower than two columns, so a one-column pit could never be filled.
  if (after.some((v, c) => v < (after[c - 1] ?? Infinity) && v < (after[c + 1] ?? Infinity))) return null;
  const sameEdge = (edge, cell) => cell && (cell.x === edge || cell.x + cell.w === edge);
  const seams = (x > 0 && sameEdge(x, owner[x]) ? 1 : 0) + (x + w < columns && sameEdge(x + w, owner[x + w - 1]) ? 1 : 0);
  return { y, stretch: [...stretch], score: y * 8 + waste * 12 + seams * 25 + (desired - w) * 15 + x };
}

function lowestRun(heights) {
  const low = Math.min(...heights);
  const x = heights.indexOf(low);
  let width = 1;
  while (x + width < heights.length && heights[x + width] === low) width++;
  return { x, width };
}

// Bring each low stretch of columns down to the bottom. Preferably the tiles stacked in those
// columns share the extra height in proportion, so no single tile turns into empty space.
// Otherwise one tile stretches down, or a side neighbour that starts level with the gap widens.
function flattenBottom(heights, owner, placed) {
  const bottom = Math.max(...heights);
  const fill = (cell, from, to) => { for (let c = from; c < to; c++) { heights[c] = bottom; owner[c] = cell; } };
  while (Math.min(...heights) < bottom) {
    const { x, width } = lowestRun(heights);
    const y = heights[x];
    if (spreadSlack(placed, x, x + width, y, bottom)) { fill(null, x, x + width); continue; }
    const above = owner[x];
    const left = owner[x - 1], right = owner[x + width];
    const reachesFrom = (cell) => cell && cell.y === y && cell.y + cell.h === bottom;
    if (above && owner.every((o, c) => c < above.x || c >= above.x + above.w || o === above)) {
      above.h = bottom - above.y;
      fill(above, above.x, above.x + above.w);
    } else if (reachesFrom(left) && left.x + left.w === x) {
      left.w += width;
      fill(left, x, x + width);
    } else if (reachesFrom(right) && right.x === x + width) {
      right.x = x; right.w += width;
      fill(right, x, x + width);
    } else return; // Rare: leave the small gap rather than overlap tiles.
  }
}

// Columns [from, to) all end at `y`. Below the last tile that also reaches outside them, every tile
// sits within these columns, so their edges can be spread out to `bottom` without overlapping.
function spreadSlack(placed, from, to, y, bottom) {
  const overlaps = (cell) => cell.x < to && cell.x + cell.w > from;
  const top = Math.max(0, ...placed.filter((cell) => overlaps(cell) && (cell.x < from || cell.x + cell.w > to)).map((cell) => cell.y + cell.h));
  if (top >= y) return false;
  const move = (edge) => edge <= top ? edge : top + Math.round((edge - top) * (bottom - top) / (y - top));
  for (const cell of placed.filter(overlaps)) {
    if (cell.y + cell.h <= top) continue;
    const end = move(cell.y + cell.h);
    cell.y = move(cell.y);
    cell.h = end - cell.y;
  }
  return true;
}

// Fine rows let each tile end within a few pixels of its text. Tiles carry an 8px bottom margin
// as the vertical gap, since the grid has no row gap.
const ROW_PX = 4;
const GAP_PX = 8;

/**
 * Lays tiles out in `list`, a grid of 4px rows and 6 to 12 columns depending on its width. Each
 * tile's height comes from its real text at each width it could take, so no tile is taller than it needs.
 * `shapeFor(index, w)` returns the class that styles a tile at that width.
 * @param {HTMLElement} list @param {HTMLElement[]} tiles
 * @param {{w: number, h: number, minW?: number}[]} spans @param {(index: number, w: number) => string} shapeFor
 */
export function arrangeMosaic(list, tiles, spans, shapeFor) {
  if (!list.clientWidth) return; // Hidden view: measure once it is shown.
  const columns = Math.min(12, Math.max(TILE_COLUMNS, Math.floor((list.clientWidth + GAP_PX) / (COLUMN_PX + GAP_PX))));
  list.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  // Feature tiles keep their share of a wider list; everything else keeps its size.
  const sized = spans.map((span) => span.h >= 4 ? { ...span, w: Math.max(span.w, Math.round(columns * 0.6)), minW: Math.max(span.minW ?? 2, Math.round(columns * 0.5)) } : span);
  list.classList.add('measuring');
  const rows = tiles.map((tile, index) => {
    const byWidth = [];
    for (let w = 2; w <= columns; w++) {
      tile.className = `appliance ${shapeFor(index, w)}`;
      tile.style.gridArea = `1 / 1 / span 1 / span ${w}`;
      byWidth[w] = Math.ceil((tile.offsetHeight + GAP_PX) / ROW_PX);
    }
    return byWidth;
  });
  list.classList.remove('measuring');
  for (const { index, x, y, w, h } of packTiles(sized.map((span, index) => ({ ...span, rowsFor: (w) => rows[index][w] })), columns)) {
    tiles[index].className = `appliance ${shapeFor(index, w)}`;
    tiles[index].style.gridArea = `${y + 1} / ${x + 1} / span ${h} / span ${w}`;
  }
}
