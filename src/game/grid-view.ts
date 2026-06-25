// Renders the tune-square map as a DOM grid (so tune names are readable) and
// the chord-tone d-pad in the corner.

import type { Tune, Cell } from './types';
import type { TuneGrid } from './tune-grid';
import { cellKey, cellEq } from './tune-grid';
import type { Chord } from './chord';

export type RelDir = 'forward' | 'left' | 'right';

export interface DirTarget {
  dir: RelDir;
  cell: Cell | null;
  tune: Tune | null;
}

export interface ViewState {
  grid: TuneGrid;
  pos: Cell;
  cleared: Set<string>;
  phase: 'playing' | 'choosing';
  chord: Chord;
  targets: DirTarget[];
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

export class GridView {
  constructor(
    private mapEl: HTMLElement,
    private dpadEl: HTMLElement,
  ) {}

  render(s: ViewState): void {
    this.renderMap(s);
    this.renderDpad(s);
  }

  private renderMap(s: ViewState): void {
    const { grid, pos, cleared, phase, targets } = s;
    const targetKeys = new Map<string, RelDir>();
    if (phase === 'choosing') {
      for (const t of targets) if (t.cell) targetKeys.set(cellKey(t.cell), t.dir);
    }
    const arrow: Record<RelDir, string> = { forward: '↑', left: '←', right: '→' };

    this.mapEl.style.display = 'grid';
    this.mapEl.style.gridTemplateColumns = `repeat(${grid.size}, 1fr)`;
    this.mapEl.style.gap = '4px';

    let html = '';
    for (let y = 0; y < grid.size; y++) {
      for (let x = 0; x < grid.size; x++) {
        const c = { x, y };
        const k = cellKey(c);
        const tune = grid.cells[y][x];
        const classes = ['bg-cell'];
        if (cellEq(c, pos)) classes.push('bg-cell-current');
        else if (cleared.has(k)) classes.push('bg-cell-cleared');
        if (cellEq(c, grid.exit)) classes.push('bg-cell-exit');
        const tgt = targetKeys.get(k);
        if (tgt) classes.push('bg-cell-reachable');
        const tag = tgt ? `<span class="bg-cell-arrow">${arrow[tgt]}</span>` : '';
        const exitTag = cellEq(c, grid.exit) ? '<span class="bg-cell-exit-tag">EXIT</span>' : '';
        html += `<div class="${classes.join(' ')}">${tag}${exitTag}<span class="bg-cell-name">${esc(tune.title)}</span></div>`;
      }
    }
    this.mapEl.innerHTML = html;
  }

  private renderDpad(s: ViewState): void {
    const { chord, phase, targets } = s;
    const byDir = (d: RelDir): DirTarget | undefined => targets.find((t) => t.dir === d);
    const slot = (d: RelDir, interval: string, note: string): string => {
      const t = byDir(d);
      const avail = !!t?.cell;
      const name = t?.tune ? esc(t.tune.title) : '—';
      return (
        `<div class="bg-dpad-slot bg-dpad-${d} ${avail ? '' : 'bg-dpad-blocked'} ${phase === 'choosing' && avail ? 'bg-dpad-active' : ''}">` +
        `<div class="bg-dpad-note">${note}</div>` +
        `<div class="bg-dpad-int">${interval}</div>` +
        `<div class="bg-dpad-dest">${name}</div>` +
        `</div>`
      );
    };
    this.dpadEl.innerHTML =
      `<div class="bg-dpad-chord">Chord: <strong>${chord.name}</strong></div>` +
      `<div class="bg-dpad-grid">` +
      `<div class="bg-dpad-cell bg-dpad-up">${slot('forward', 'root · fwd', chord.rootName)}</div>` +
      `<div class="bg-dpad-cell bg-dpad-leftc">${slot('left', '3rd · left', chord.thirdName)}</div>` +
      `<div class="bg-dpad-cell bg-dpad-mid">${phase === 'choosing' ? 'pick a<br>direction' : 'play the<br>tune'}</div>` +
      `<div class="bg-dpad-cell bg-dpad-rightc">${slot('right', '5th · right', chord.fifthName)}</div>` +
      `</div>`;
  }
}
