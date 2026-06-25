// Submits a score to the serverless leaderboard (Netlify Function + Blobs).
// No backend to run, no manual merges — the function persists it and returns
// the updated boards.

import type { ScoreEntry } from './leaderboard';

export interface SubmitResult {
  message: string;
  scores?: ScoreEntry[];
  rank?: number | null;
}

export async function submitToServer(entry: ScoreEntry): Promise<SubmitResult> {
  const res = await fetch('/api/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error(`submit failed (${res.status})`);
  const data = (await res.json()) as { scores?: ScoreEntry[]; rank?: number | null };
  const place = data.rank ? ` You're #${data.rank} on the board!` : '';
  return { message: `Submitted to the global leaderboard.${place}`, scores: data.scores, rank: data.rank };
}
