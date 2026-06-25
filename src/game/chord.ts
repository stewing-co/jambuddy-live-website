// Derives the navigation chord (root / 3rd / 5th) from a tune's key. These three
// chord tones drive movement: root = forward, 3rd = left, 5th = right.

import type { Tune } from './types';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export interface Chord {
  root: number; // pitch class 0..11
  third: number;
  fifth: number;
  minor: boolean;
  name: string; // e.g. "D" or "Em"
  rootName: string;
  thirdName: string;
  fifthName: string;
}

const pc = (n: number): number => ((n % 12) + 12) % 12;

function isMinorKey(keyStr: string): boolean {
  const k = keyStr.toLowerCase();
  if (k.includes('maj')) return false;
  // minor / modal-minor keys take a minor 3rd
  return /min|m$|dor|aeol|phry|locr/.test(k);
}

export function chordForTune(tune: Tune): Chord {
  const root = pc(tune.key_root ?? 0);
  const minor = isMinorKey(tune.key ?? '');
  const third = pc(root + (minor ? 3 : 4));
  const fifth = pc(root + 7);
  return {
    root,
    third,
    fifth,
    minor,
    name: NOTE_NAMES[root] + (minor ? 'm' : ''),
    rootName: NOTE_NAMES[root],
    thirdName: NOTE_NAMES[third],
    fifthName: NOTE_NAMES[fifth],
  };
}
