// Tune Trek — chord-tone navigation through a grid of tune-squares.
//
// Each square is a tune. Play its full melody to CLEAR it, then pick one of the
// three non-backward exits with a chord tone: root = forward, 3rd = left,
// 5th = right. Reach and clear the EXIT square to win the run, scored by
// accuracy then time. Options: pick one or both tune collections, play the
// current tune through the speakers, and Blind mode (future notes hidden) —
// each (collection selection, mode) has its own leaderboard.

import type { Tune, Cell } from './types';
import { MicInput, type PitchReadout } from './input';
import { SheetMusic, meterForType, type Melody } from './abc-render';
import { chordForTune, type Chord } from './chord';
import {
  generateGrid,
  forwardOf,
  leftOf,
  rightOf,
  inBounds,
  cellKey,
  cellEq,
  UP,
  type TuneGrid,
} from './tune-grid';
import { GridView, type DirTarget, type RelDir, type ViewState } from './grid-view';
import { submitToServer, type SubmitResult } from './submit';
import {
  fetchGlobalScores,
  rankScores,
  saveLocalScores,
  loadLocalScores,
  placement,
  formatTime,
  formatAccuracy,
  getTuneBest,
  recordTuneBest,
  type ScoreEntry,
  type GameMode,
} from './leaderboard';

const pc = (m: number): number => ((m % 12) + 12) % 12;

export const COLLECTIONS: Record<string, string> = { 'old-time': 'Old-Time', irish: 'Irish Session' };

interface HudEls {
  tune: HTMLElement | null;
  tuneBest: HTMLElement | null;
  status: HTMLElement | null;
  score: HTMLElement | null;
  live: HTMLElement | null;
}

export interface LeaderboardEls {
  title: HTMLElement | null;
  panel: HTMLElement | null;
  pb: HTMLElement | null;
  result: HTMLElement | null;
  nameInput: HTMLInputElement | null;
  submitBtn: HTMLButtonElement | null;
}

export type SubmitFn = (entry: ScoreEntry) => Promise<SubmitResult>;

export class Game {
  private input = new MicInput();
  private view: GridView;
  private sheet?: SheetMusic;

  private collections = new Set<string>(['old-time']); // one or more selected
  private collectionTunes: Tune[] = [];
  private tuneCache = new Map<string, Tune[]>();
  private blindOn = false;

  /** Notified when tune playback starts (true) / stops (false) — the UI uses it
   *  to update the Play button. */
  onPlaybackChange: (playing: boolean) => void = () => {};

  private grid!: TuneGrid;
  private pos: Cell = { x: 0, y: 0 };
  private heading: Cell = UP;
  private phase: 'playing' | 'choosing' = 'playing';
  private cleared = new Set<string>();
  private tune!: Tune;
  private chord!: Chord;
  private melody: Melody = []; // [pitch, duration] pairs for rendering
  private notes: number[] = []; // pitches only, for gameplay (1:1 with melody)
  private progress = 0;
  private floor = 1;
  private seed = 1;

  // Per-tune (per-square) performance.
  private tuneStartMs = 0;
  private tuneCorrect = 0;
  private tuneTotal = 0;

  // Scoring (run mode/collection are locked when the run starts).
  private runStartMs = 0;
  private runCorrect = 0;
  private runTotal = 0;
  private runComplete = false;
  private runCollection = 'old-time';
  private runMode: GameMode = 'normal';
  private globalScores: ScoreEntry[] = [];
  private pendingEntry: ScoreEntry | null = null;
  private toastTimer = 0;

  constructor(
    mapEl: HTMLElement,
    dpadEl: HTMLElement,
    private staffEl: HTMLElement | null,
    private hud: HudEls,
    private lb: LeaderboardEls,
    private submitFn: SubmitFn,
  ) {
    this.view = new GridView(mapEl, dpadEl);
    if (staffEl) this.sheet = new SheetMusic(staffEl);
    this.input.onNote = (m) => this.handleNote(m);
    this.input.onPitch = (p) => this.showLive(p);
    this.input.onStatus = (s) => this.showStatus(s);
    this.lb.submitBtn?.addEventListener('click', () => void this.submitScore());
    window.setInterval(() => this.updateScore(), 333);
  }

  private mode(): GameMode {
    return this.blindOn ? 'blind' : 'normal';
  }

  async load(): Promise<void> {
    this.globalScores = await fetchGlobalScores();
    await this.loadSelected();
    this.newFloor(1);
    this.renderLeaderboard();
  }

  /** Load one collection's tunes (cached). Each tune carries its original ABC,
   *  and the pool is restricted to tunes that actually belong to this
   *  collection's source ABC file — i.e. the ones we have ABC for. (If the ABC
   *  lookup couldn't be fetched, keep every tune rather than emptying the pool.) */
  private async loadCollection(key: string): Promise<Tune[]> {
    if (!this.tuneCache.has(key)) {
      const [data, abcMap] = await Promise.all([
        fetch(`/game/collections/${key}.json`).then((r) => r.json()),
        fetch(`/game/collections/${key}-abc.json`)
          .then((r) => (r.ok ? r.json() : {}))
          .catch(() => ({})) as Promise<Record<string, string>>,
      ]);
      const haveAbc = Object.keys(abcMap).length > 0;
      const tunes = (data.tunes as Tune[])
        .map((t) => ({ ...t, abc: abcMap[t.id] }))
        .filter((t) => !haveAbc || t.abc);
      this.tuneCache.set(key, tunes);
    }
    return this.tuneCache.get(key)!;
  }

  /** Rebuild the active pool as the union (deduped by id) of every selected
   *  collection. */
  private async loadSelected(): Promise<void> {
    const union: Tune[] = [];
    const seen = new Set<string>();
    for (const key of this.selectedKeys()) {
      for (const t of await this.loadCollection(key)) {
        if (!seen.has(t.id)) {
          seen.add(t.id);
          union.push(t);
        }
      }
    }
    this.collectionTunes = union;
  }

  startMic(): Promise<boolean> {
    return this.input.start();
  }

  // --- Option toggles ---

  /** Selected collection keys, sorted for a stable board identity. */
  private selectedKeys(): string[] {
    return [...this.collections].sort();
  }

  /** Stable board key for the current selection, e.g. 'old-time' or 'irish+old-time'. */
  private collectionKey(): string {
    return this.selectedKeys().join('+');
  }

  /** Human label, e.g. 'Old-Time' or 'Old-Time + Irish Session'. */
  private collectionLabel(): string {
    return this.selectedKeys().map((k) => COLLECTIONS[k] ?? k).join(' + ');
  }

  hasCollection(key: string): boolean {
    return this.collections.has(key);
  }

  /** Toggle a collection on/off (at least one must stay selected). The pool
   *  becomes the union of all selected collections. */
  async toggleCollection(key: string): Promise<void> {
    if (!(key in COLLECTIONS)) return;
    if (this.collections.has(key)) {
      if (this.collections.size === 1) return; // keep at least one selected
      this.collections.delete(key);
    } else {
      this.collections.add(key);
    }
    await this.loadSelected();
    this.renderLeaderboard();
    this.newFloor(1); // selection changes the board → fresh run
  }

  // --- Tune playback (abcjs synth) ---

  isPlaying(): boolean {
    return this.sheet?.isPlaying() ?? false;
  }

  /** Play the current square's tune through the speakers, pausing mic listening
   *  so the playback isn't heard as gameplay notes. */
  async playTune(): Promise<void> {
    if (!this.sheet || this.isPlaying()) return;
    this.input.setPaused(true);
    this.onPlaybackChange(true);
    this.showStatus(`▶ Playing ${this.tune.title} — listening paused`);
    const ok = await this.sheet.play(() => this.handlePlayEnded());
    if (!ok) {
      this.handlePlayEnded();
      this.flash('Playback unavailable');
    }
  }

  stopTune(): void {
    this.sheet?.stopPlay();
    this.handlePlayEnded();
  }

  private handlePlayEnded(): void {
    this.input.setPaused(false);
    this.onPlaybackChange(false);
    this.showStatus('');
  }

  setBlind(on: boolean): void {
    this.blindOn = on;
    this.staffEl?.classList.toggle('bg-staff-blind', on);
    this.renderLeaderboard();
    this.newFloor(1); // blind changes the board → fresh run
  }

  /** Re-render the current tune at the new width / tab setting (also on resize). */
  relayoutSheet(): void {
    if (!this.sheet || !this.tune) return;
    this.sheet.render(this.melody, {
      title: this.tune.title,
      meter: meterForType(this.tune.type),
      abc: this.tune.abc, // original notation when available; else built from melody
    });
    this.sheet.setProgress(this.progress);
  }

  // --- Floor / cell lifecycle ---

  newFloor(n: number): void {
    if (n === 1) {
      this.runStartMs = performance.now();
      this.runCorrect = 0;
      this.runTotal = 0;
      this.runComplete = false;
      this.pendingEntry = null;
      this.runCollection = this.collectionKey();
      this.runMode = this.mode();
      this.seed = Math.floor(Math.random() * 1e6) + 1;
      this.lb.result?.classList.add('hidden');
    }
    this.floor = n;
    this.grid = generateGrid(this.seed, n, this.collectionTunes);
    this.cleared = new Set();
    this.enterCell(this.grid.start, UP);
  }

  private enterCell(cell: Cell, heading: Cell): void {
    if (this.isPlaying()) this.stopTune(); // moving to a new tune ends playback
    this.pos = cell;
    this.heading = heading;
    this.tune = this.grid.cells[cell.y][cell.x];
    this.chord = chordForTune(this.tune);
    this.melody = this.tune.melody ?? [];
    this.notes = this.melody.map((nt) => nt[0]);
    const already = this.cleared.has(cellKey(cell));
    this.phase = already ? 'choosing' : 'playing';
    this.progress = already ? this.notes.length : 0;
    this.tuneStartMs = performance.now();
    this.tuneCorrect = 0;
    this.tuneTotal = 0;
    this.relayoutSheet();
    this.render();
    this.updateHud();
    this.updateTuneBest();
  }

  private targets(): DirTarget[] {
    const rels: Array<[RelDir, Cell]> = [
      ['forward', forwardOf(this.heading)],
      ['left', leftOf(this.heading)],
      ['right', rightOf(this.heading)],
    ];
    return rels.map(([dir, d]) => {
      const cell = { x: this.pos.x + d.x, y: this.pos.y + d.y };
      if (!inBounds(this.grid, cell)) return { dir, cell: null, tune: null };
      return { dir, cell, tune: this.grid.cells[cell.y][cell.x] };
    });
  }

  // --- Note handling ---

  handleNote(midi: number): void {
    if (this.runComplete) return;
    const played = pc(midi);
    if (this.phase === 'playing') {
      const expected = pc(this.notes[this.progress]);
      this.runTotal++;
      this.tuneTotal++;
      if (played === expected) {
        this.runCorrect++;
        this.tuneCorrect++;
        this.progress++;
        this.sheet?.setProgress(this.progress);
        if (this.progress >= this.notes.length) this.clearCurrent();
        else this.render();
      } else {
        this.flash('not the next note — try again');
      }
    } else {
      if (played === this.chord.root) this.tryMove('forward');
      else if (played === this.chord.third) this.tryMove('left');
      else if (played === this.chord.fifth) this.tryMove('right');
    }
    this.updateHud();
  }

  private clearCurrent(): void {
    this.cleared.add(cellKey(this.pos));
    this.phase = 'choosing';
    // Record this tune's personal best (accuracy first, then clear time).
    const perf = {
      accuracy: this.tuneTotal > 0 ? this.tuneCorrect / this.tuneTotal : 1,
      timeMs: performance.now() - this.tuneStartMs,
    };
    const { improved } = recordTuneBest(this.tune.id, perf);
    this.updateTuneBest(improved ? '★ new best!' : '');
    if (cellEq(this.pos, this.grid.exit)) {
      this.win();
      return;
    }
    this.toast(`♪ ${this.tune.title} ♪ cleared — pick a direction (root/3rd/5th)`);
    this.render();
  }

  private updateTuneBest(suffix = ''): void {
    if (!this.hud.tuneBest) return;
    const best = getTuneBest(this.tune.id);
    const tag = suffix ? `  ${suffix}` : '';
    this.hud.tuneBest.textContent = best
      ? `This tune's best: ${formatAccuracy(best.accuracy)} · ${formatTime(best.timeMs)}${tag}`
      : "This tune's best: not played yet";
  }

  private tryMove(rel: RelDir): void {
    const t = this.targets().find((x) => x.dir === rel);
    if (!t || !t.cell) {
      this.flash('no square that way');
      return;
    }
    const d = rel === 'forward' ? forwardOf(this.heading) : rel === 'left' ? leftOf(this.heading) : rightOf(this.heading);
    this.enterCell(t.cell, d);
  }

  private win(): void {
    this.completeRun();
  }

  private completeRun(): void {
    this.runComplete = true;
    const accuracy = this.runTotal > 0 ? this.runCorrect / this.runTotal : 1;
    const timeMs = performance.now() - this.runStartMs;
    const name = (this.lb.nameInput?.value || 'Player').slice(0, 24);
    const entry: ScoreEntry = {
      name,
      accuracy,
      timeMs,
      floors: 1,
      date: new Date().toISOString().slice(0, 10),
      collection: this.runCollection,
      mode: this.runMode,
    };
    const { rank } = placement(this.displayScores(this.runCollection, this.runMode), entry);
    this.pendingEntry = entry;
    this.toast(`Run complete! ${formatAccuracy(accuracy)} in ${formatTime(timeMs)}`);
    this.renderResult(rank, entry);
    this.updateScore();
  }

  // --- Keyboard fallback ---

  handleKey(code: string): void {
    if (this.runComplete && code !== 'KeyR') return;
    if (this.phase === 'playing') {
      if (code === 'Space') this.handleNote(this.notes[this.progress]);
    } else {
      if (code === 'ArrowUp' || code === 'KeyW') this.handleNote(60 + this.chord.root);
      else if (code === 'ArrowLeft' || code === 'KeyA') this.handleNote(60 + this.chord.third);
      else if (code === 'ArrowRight' || code === 'KeyD') this.handleNote(60 + this.chord.fifth);
    }
    if (code === 'KeyN' || code === 'KeyR') this.newFloor(1);
  }

  // --- Rendering / HUD ---

  private displayScores(collection = this.collectionKey(), mode = this.mode()): ScoreEntry[] {
    return rankScores([...this.globalScores, ...loadLocalScores()], collection, mode);
  }

  private render(): void {
    const state: ViewState = {
      grid: this.grid,
      pos: this.pos,
      cleared: this.cleared,
      phase: this.phase,
      chord: this.chord,
      targets: this.targets(),
    };
    this.view.render(state);
  }

  private updateHud(): void {
    if (this.hud.tune) {
      const verb = this.phase === 'playing' ? 'Play' : 'Cleared';
      this.hud.tune.textContent = `${verb}: ${this.tune.title}  (key ${this.tune.key})`;
    }
    this.updateScore();
  }

  private updateScore(): void {
    if (!this.hud.score || this.runStartMs === 0) return;
    const acc = this.runTotal > 0 ? this.runCorrect / this.runTotal : 1;
    const time = this.runComplete ? '' : ` · ${formatTime(performance.now() - this.runStartMs)}`;
    this.hud.score.textContent = `Accuracy ${formatAccuracy(acc)}${time}`;
  }

  private boardLabel(): string {
    return `${this.collectionLabel()}${this.blindOn ? ' · Blind' : ''}`;
  }

  private renderLeaderboard(): void {
    if (this.lb.title) this.lb.title.textContent = `Top 10 — ${this.boardLabel()}`;
    if (this.lb.pb) {
      const best = rankScores(loadLocalScores(), this.collectionKey(), this.mode())[0];
      this.lb.pb.textContent = best
        ? `Your best: ${formatAccuracy(best.accuracy)} · ${formatTime(best.timeMs)}`
        : 'Your best: not yet — play a run!';
    }
    if (!this.lb.panel) return;
    const scores = this.displayScores();
    this.lb.panel.innerHTML = scores.length
      ? scores
          .map(
            (s, i) =>
              `<div class="flex justify-between gap-3 py-0.5 text-sm"><span class="truncate">${i + 1}. ${escapeHtml(s.name)}</span><span class="font-mono whitespace-nowrap">${formatAccuracy(s.accuracy)} · ${formatTime(s.timeMs)}</span></div>`,
          )
          .join('')
      : '<div class="text-gray-500 text-sm">No scores yet — be the first!</div>';
  }

  private renderResult(rank: number | null, entry: ScoreEntry): void {
    const r = this.lb.result;
    if (!r) return;
    r.classList.remove('hidden');
    const head = r.querySelector('[data-result-head]');
    if (head) head.textContent = `Run complete — ${formatAccuracy(entry.accuracy)} correct in ${formatTime(entry.timeMs)}`;
    const sub = r.querySelector('[data-result-sub]');
    if (sub)
      sub.textContent = rank
        ? `That's #${rank} on the ${this.boardLabel()} board! Add your name and submit.`
        : `Not in the top 10 for ${this.boardLabel()} — press R to try again.`;
    if (this.lb.submitBtn) {
      this.lb.submitBtn.disabled = !rank;
      this.lb.submitBtn.textContent = 'Submit score';
    }
    const msg = r.querySelector('[data-result-msg]');
    if (msg) msg.textContent = '';
  }

  private async submitScore(): Promise<void> {
    if (!this.pendingEntry) return;
    saveLocalScores([...loadLocalScores(), this.pendingEntry]);
    this.renderLeaderboard();
    const btn = this.lb.submitBtn;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Submitting…';
    }
    let message = 'Saved to this browser.';
    try {
      const result = await this.submitFn(this.pendingEntry);
      message = result.message;
      if (result.scores) {
        this.globalScores = result.scores;
        this.renderLeaderboard();
      }
    } catch {
      message = 'Saved locally — could not reach the leaderboard.';
    }
    const out = this.lb.result?.querySelector('[data-result-msg]');
    if (out) out.textContent = message;
    if (btn) btn.textContent = 'Submitted';
  }

  private showLive(p: PitchReadout | null): void {
    if (!this.hud.live) return;
    this.hud.live.textContent = p
      ? `♪ ${p.note} ${Math.abs(p.cents) < 15 ? '●' : p.cents < 0 ? '♭' : '♯'}`
      : '♪ —';
  }

  private showStatus(s: string): void {
    if (this.hud.status) this.hud.status.textContent = s;
  }

  private flash(msg: string): void {
    this.showStatus(msg);
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.showStatus(''), 1200);
  }

  private toast(msg: string): void {
    this.showStatus(msg);
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.showStatus(''), 3200);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

export async function initGame(): Promise<void> {
  const mapEl = document.getElementById('bg-map');
  const dpadEl = document.getElementById('bg-dpad');
  if (!mapEl || !dpadEl) return;
  const hud: HudEls = {
    tune: document.getElementById('bg-tune'),
    tuneBest: document.getElementById('bg-tune-best'),
    status: document.getElementById('bg-status'),
    score: document.getElementById('bg-score'),
    live: document.getElementById('bg-live'),
  };
  const lb: LeaderboardEls = {
    title: document.getElementById('bg-lb-title'),
    panel: document.getElementById('bg-leaderboard'),
    pb: document.getElementById('bg-pb'),
    result: document.getElementById('bg-result'),
    nameInput: document.getElementById('bg-name') as HTMLInputElement | null,
    submitBtn: document.getElementById('bg-submit') as HTMLButtonElement | null,
  };
  const game = new Game(mapEl, dpadEl, document.getElementById('bg-staff'), hud, lb, (e) =>
    submitToServer(e),
  );
  await game.load();

  const startBtn = document.getElementById('bg-start') as HTMLButtonElement | null;
  startBtn?.addEventListener('click', async () => {
    startBtn.disabled = true;
    startBtn.textContent = 'Starting…';
    const ok = await game.startMic();
    startBtn.disabled = ok;
    startBtn.textContent = ok ? '🎤 Listening — play!' : '🎤 Enable microphone';
  });

  // Collection selector (multi-select: one or both collections).
  const collBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-collection]'));
  const syncCollBtns = () =>
    collBtns.forEach((b) => b.classList.toggle('bg-opt-active', game.hasCollection(b.dataset.collection ?? '')));
  collBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      await game.toggleCollection(btn.dataset.collection ?? 'old-time');
      syncCollBtns(); // reflect actual state (a no-op toggle leaves it unchanged)
    });
  });

  // Play-tune button (abcjs synth; pauses listening while it plays).
  const playBtn = document.getElementById('bg-play') as HTMLButtonElement | null;
  game.onPlaybackChange = (playing) => {
    if (playBtn) playBtn.textContent = playing ? '■ Stop' : '▶ Play tune';
    playBtn?.classList.toggle('bg-opt-active', playing);
  };
  playBtn?.addEventListener('click', () => {
    if (game.isPlaying()) game.stopTune();
    else void game.playTune();
  });

  // Blind toggle.
  const blindBtn = document.getElementById('bg-blind') as HTMLButtonElement | null;
  let blindOn = false;
  blindBtn?.addEventListener('click', () => {
    blindOn = !blindOn;
    blindBtn.classList.toggle('bg-opt-active', blindOn);
    game.setBlind(blindOn);
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => game.relayoutSheet(), 200);
  });

  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const codes = ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyD', 'Space', 'KeyN', 'KeyR'];
    if (codes.includes(e.code)) {
      e.preventDefault();
      game.handleKey(e.code);
    }
  });
}
