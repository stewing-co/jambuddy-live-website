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

/** How many squares the exit always sits from the start (Manhattan distance —
 *  one square per forward/left/right move). */
export const EXIT_DISTANCE = 7;

export function generateGrid(seedValue: number, floorNum: number, tunes: Tune[]): TuneGrid {
  const pool = playableTunes(tunes);
  // Need at least a 6×6 grid for a square to sit EXIT_DISTANCE (7) away from the
  // bottom-centre start; a 5×5 only reaches distance 6.
  const size = Math.min(Math.max(4 + floorNum, 6), 7);
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
  // Start bottom-centre (facing up into the grid). The exit is always exactly
  // EXIT_DISTANCE squares away; which of those squares it lands on is seeded, so
  // it moves around each game. (Falls back to the farthest in-bounds square if a
  // grid is ever too small to have one at the exact distance.)
  const start: Cell = { x: Math.floor(size / 2), y: size - 1 };
  let best: Cell = start;
  let bestDist = -1;
  const atExactDistance: Cell[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.abs(x - start.x) + Math.abs(y - start.y);
      if (dist === EXIT_DISTANCE) atExactDistance.push({ x, y });
      if (dist > bestDist) {
        bestDist = dist;
        best = { x, y };
      }
    }
  }
  const exit = atExactDistance.length
    ? atExactDistance[hash(seedValue, floorNum, 99) % atExactDistance.length]
    : best;
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
