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

/** Tunes usable as squares: have a key root and a full melody to play. */
export function playableTunes(tunes: Tune[]): Tune[] {
  return tunes.filter((t) => (t.melody?.length ?? 0) >= 8 && Number.isFinite(t.key_root));
}

export function generateGrid(seedValue: number, floorNum: number, tunes: Tune[]): TuneGrid {
  const pool = playableTunes(tunes);
  const size = Math.min(4 + floorNum, 7);
  const cells: Tune[][] = [];
  for (let y = 0; y < size; y++) {
    const row: Tune[] = [];
    for (let x = 0; x < size; x++) {
      row.push(pool[hash(seedValue, floorNum, x, y) % pool.length]);
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
