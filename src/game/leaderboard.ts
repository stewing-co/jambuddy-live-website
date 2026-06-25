// High-score leaderboard. Global scores live in a repo-committed JSON served
// statically (/game/highscores.json); a personal copy is mirrored to
// localStorage as an offline fallback. Ranking: accuracy (% correct) first,
// then time — so 100% beats 99%, and among equal accuracy the fastest wins.

export type GameMode = 'normal' | 'blind';

export interface ScoreEntry {
  name: string;
  accuracy: number; // 0..1, fraction of correct notes
  timeMs: number; // total run time
  floors: number; // floors cleared this run
  date: string; // ISO date
  collection: string; // which tune collection (e.g. 'old-time', 'irish')
  mode: GameMode; // normal play vs blind mode
}

const SCORES_URL = '/api/scores';
const LOCAL_KEY = 'bluegrass-highscores';
export const MAX_SCORES = 10;

const modeOf = (s: ScoreEntry): GameMode => (s.mode === 'blind' ? 'blind' : 'normal');
const collOf = (s: ScoreEntry): string => s.collection || 'old-time';
export const boardKey = (collection: string, mode: GameMode): string => `${collection}:${mode}`;

/** Top scores, optionally restricted to one board (collection + mode). */
export function rankScores(scores: ScoreEntry[], collection?: string, mode?: GameMode): ScoreEntry[] {
  return [...scores]
    .filter((s) => (collection ? collOf(s) === collection : true) && (mode ? modeOf(s) === mode : true))
    .sort((a, b) => b.accuracy - a.accuracy || a.timeMs - b.timeMs)
    .slice(0, MAX_SCORES);
}

/** Top-10 of every (collection, mode) board, concatenated (bounds stored/served lists). */
export function topPerBoard(scores: ScoreEntry[]): ScoreEntry[] {
  const boards = new Map<string, ScoreEntry[]>();
  for (const s of scores) {
    const k = boardKey(collOf(s), modeOf(s));
    (boards.get(k) ?? boards.set(k, []).get(k)!).push(s);
  }
  const out: ScoreEntry[] = [];
  for (const list of boards.values()) out.push(...rankScores(list));
  return out;
}

export async function fetchGlobalScores(): Promise<ScoreEntry[]> {
  try {
    const res = await fetch(SCORES_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    return topPerBoard((data.scores ?? []) as ScoreEntry[]);
  } catch {
    return loadLocalScores();
  }
}

export function loadLocalScores(): ScoreEntry[] {
  try {
    return (JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as ScoreEntry[]).map((s) => ({
      ...s,
      mode: modeOf(s),
      collection: collOf(s),
    }));
  } catch {
    return [];
  }
}

export function saveLocalScores(scores: ScoreEntry[]): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(topPerBoard(scores)));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

/** Where would `entry` land within its own board? rank is 1-based, or null if outside the top. */
export function placement(existing: ScoreEntry[], entry: ScoreEntry): { rank: number | null; top: ScoreEntry[] } {
  const merged = rankScores([...existing, entry], collOf(entry), modeOf(entry));
  const idx = merged.indexOf(entry);
  return { rank: idx >= 0 ? idx + 1 : null, top: merged };
}

// --- Per-tune personal bests (each square's tune) ---

export interface TunePerf {
  accuracy: number;
  timeMs: number;
}

const TUNE_KEY = 'bluegrass-tune-bests';

function loadTuneBests(): Record<string, TunePerf> {
  try {
    return JSON.parse(localStorage.getItem(TUNE_KEY) ?? '{}') as Record<string, TunePerf>;
  } catch {
    return {};
  }
}

export function getTuneBest(id: string): TunePerf | null {
  return loadTuneBests()[id] ?? null;
}

/** Record a clear of one tune; keeps the best (accuracy first, then time). */
export function recordTuneBest(id: string, perf: TunePerf): { best: TunePerf; improved: boolean } {
  const all = loadTuneBests();
  const cur = all[id];
  const improved =
    !cur || perf.accuracy > cur.accuracy || (perf.accuracy === cur.accuracy && perf.timeMs < cur.timeMs);
  if (improved) {
    all[id] = perf;
    try {
      localStorage.setItem(TUNE_KEY, JSON.stringify(all));
    } catch {
      /* ignore */
    }
  }
  return { best: improved ? perf : cur, improved };
}

export function formatTime(ms: number): string {
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = (totalSec % 60).toFixed(1);
  return m > 0 ? `${m}:${s.padStart(4, '0')}` : `${s}s`;
}

export function formatAccuracy(acc: number): string {
  return `${(acc * 100).toFixed(1)}%`;
}
