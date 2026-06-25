// Tune Trek leaderboard — serverless, no manual merges.
// Stores scores in Netlify Blobs; GET returns the boards, POST submits a run.
// Scores are kept as top-10 per (collection, mode) board.
//
// Routed at /api/scores (see config.path below).
import { getStore } from '@netlify/blobs';

const STORE = 'tunetrek-scores';
const KEY = 'scores';
const MAX = 10;

const modeOf = (s) => (s.mode === 'blind' ? 'blind' : 'normal');
const collOf = (s) => (typeof s.collection === 'string' && s.collection ? s.collection : 'old-time');

function isValid(s) {
  return (
    s &&
    typeof s.name === 'string' &&
    s.name.trim().length > 0 &&
    typeof s.accuracy === 'number' &&
    s.accuracy >= 0 &&
    s.accuracy <= 1 &&
    typeof s.timeMs === 'number' &&
    s.timeMs > 500 && // reject impossibly fast runs
    s.timeMs < 3_600_000 &&
    Number.isFinite(s.floors)
  );
}

function sanitize(s) {
  return {
    name: String(s.name).slice(0, 24).replace(/[<>]/g, ''),
    accuracy: Math.max(0, Math.min(1, s.accuracy)),
    timeMs: Math.round(s.timeMs),
    floors: s.floors | 0,
    date: typeof s.date === 'string' ? s.date.slice(0, 10) : new Date().toISOString().slice(0, 10),
    collection: collOf(s).slice(0, 32),
    mode: modeOf(s),
  };
}

function topPerBoard(scores) {
  const boards = new Map();
  for (const s of scores) {
    const k = `${collOf(s)}:${modeOf(s)}`;
    if (!boards.has(k)) boards.set(k, []);
    boards.get(k).push(s);
  }
  const out = [];
  for (const list of boards.values()) {
    list.sort((a, b) => b.accuracy - a.accuracy || a.timeMs - b.timeMs);
    out.push(...list.slice(0, MAX));
  }
  return out;
}

export default async (req) => {
  const store = getStore(STORE);

  if (req.method === 'GET') {
    const scores = (await store.get(KEY, { type: 'json' })) || [];
    return Response.json({ scores });
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response('Bad JSON', { status: 400 });
    }
    if (!isValid(body)) return new Response('Invalid score', { status: 400 });

    const entry = sanitize(body);
    const existing = (await store.get(KEY, { type: 'json' })) || [];
    const top = topPerBoard([...existing, entry]);
    await store.setJSON(KEY, top);

    const board = top.filter((s) => collOf(s) === entry.collection && modeOf(s) === entry.mode);
    const idx = board.findIndex(
      (s) => s.name === entry.name && s.timeMs === entry.timeMs && s.accuracy === entry.accuracy,
    );
    return Response.json({ scores: top, rank: idx >= 0 ? idx + 1 : null });
  }

  return new Response('Method not allowed', { status: 405 });
};

export const config = { path: '/api/scores' };
