// A floor is a grid of squares, each square a tune. You clear a square by
// playing its tune (signature phrase), then choose one of the three non-backward
// exits with a chord tone. Reach and clear the exit square to descend.

import type { Tune, Cell } from './types';

export interface TuneGrid {
  size: number;
  cells: Tune[][]; // cells[y][x]
  start: Cell;
  exit: Cell;
  floor: number;
}

const hash = (...xs: number[]): number => {
  let h = 2166136261;
  for (const x of xs) {
    h ^= x;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** Tunes usable as squares: have a key root and a full melody to play, deduped
 *  by id (the source data has a few duplicate entries). */
export function playableTunes(tunes: Tune[]): Tune[] {
  const seen = new Set<string>();
  return tunes.filter((t) => {
    if ((t.melody?.length ?? 0) < 8 || !Number.isFinite(t.key_root) || seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

export function generateGrid(seedValue: number, floorNum: number, tunes: Tune[]): TuneGrid {
  const pool = playableTunes(tunes);
  const size = Math.min(4 + floorNum, 7);
  // Fill the grid with DISTINCT tunes so the same tune doesn't appear in several
  // squares (and you never navigate onto one you've already played). Deterministic
  // seeded shuffle of the pool, then assigned in order — only repeats if the pool
  // is smaller than the grid.
  const order = pool.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = hash(seedValue, floorNum, i) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const cells: Tune[][] = [];
  let k = 0;
  for (let y = 0; y < size; y++) {
    const row: Tune[] = [];
    for (let x = 0; x < size; x++) {
      row.push(pool[order[k % order.length]]);
      k++;
    }
    cells.push(row);
  }
  // Start bottom-centre (facing up into the grid); exit at a top corner.
  const start: Cell = { x: Math.floor(size / 2), y: size - 1 };
  const exitLeft = hash(seedValue, floorNum, 99) % 2 === 0;
  const exit: Cell = { x: exitLeft ? 0 : size - 1, y: 0 };
  return { size, cells, start, exit, floor: floorNum };
}

// --- Heading-relative directions (screen coords, y down) ---

export const UP: Cell = { x: 0, y: -1 };

export function forwardOf(h: Cell): Cell {
  return { x: h.x, y: h.y };
}
export function leftOf(h: Cell): Cell {
  return { x: h.y, y: -h.x };
}
export function rightOf(h: Cell): Cell {
  return { x: -h.y, y: h.x };
}

export function inBounds(grid: TuneGrid, c: Cell): boolean {
  return c.x >= 0 && c.x < grid.size && c.y >= 0 && c.y < grid.size;
}

export const cellKey = (c: Cell): string => `${c.x},${c.y}`;
export const cellEq = (a: Cell, b: Cell): boolean => a.x === b.x && a.y === b.y;
