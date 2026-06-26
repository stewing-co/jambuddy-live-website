// Shared types for Tune Trek.

/** A game-ready tune exported from JamBuddy ABC (see grass_the_game/tools/export_tunes.py). */
export interface Tune {
  id: string;
  title: string;
  key: string;
  key_root: number;
  bpm: number;
  type: string;
  midi_min: number;
  midi_max: number;
  note_count: number;
  /** Full melody as [midiPitch, durationInBeats] pairs. */
  melody: Array<[number, number]>;
  /** Short opening lick used as a phrase "obstacle". */
  signature_phrase: number[];
  collection?: string;
  /** Original ABC notation source (attached at load from <collection>-abc.json),
   *  rendered on the staff so repeats/chords/beaming look right. Absent for the
   *  few tunes with no ABC match — those fall back to ABC generated from melody. */
  abc?: string;
}

export interface TuneFile {
  count: number;
  tunes: Tune[];
}

/** A short "hot lick" used as an obstacle (public/game/licks.json). */
export interface Lick {
  id: string;
  name: string;
  source: string;
  notes: number[];
}

export interface LickFile {
  description: string;
  licks: Lick[];
}

export interface Cell {
  x: number;
  y: number;
}

