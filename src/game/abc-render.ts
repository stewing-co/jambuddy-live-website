// Renders the guide tune as sheet music with abcjs (window.ABCJS, the same
// library the Sheet Music tab uses) and highlights the next note.
//
// Preferred input is the tune's ORIGINAL ABC (attached to the tune at load),
// rendered as-is so repeats, chord symbols, beaming and bar structure look right
// — exactly like the Sheet Music page. The progress highlight maps the gameplay
// note sequence (one pass, from `melody`) positionally onto the rendered melody
// noteheads (`.abcjs-note`, grace notes excluded), which lines up because the
// melody is a single pass of the written notes.
//
// When a tune has no original ABC, we fall back to ABC reconstructed from the
// melody's [pitch, duration] pairs: real note values barred to a meter, one
// notehead per note (no rests/ties), so the same 1:1 mapping holds. Reconstructed
// pitches are spelled with sharps and no key signature, with per-measure natural
// cancellation, so any key renders. The current tune can also be played through
// the abcjs synth (see play()).

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// pitch class -> [natural letter, isSharp]
const PC_SPELL: Array<[string, boolean]> = [
  ['C', false], ['C', true], ['D', false], ['D', true], ['E', false], ['F', false],
  ['F', true], ['G', false], ['G', true], ['A', false], ['A', true], ['B', false],
];

/** A melody as [midiPitch, durationInWholeNotes] pairs (0.25 = quarter note). */
export type Melody = Array<[number, number]>;

const UNIT = 32; // 1/32 notes per whole note → ABC unit note length L:1/32

/** Measure length in 1/32 units for a meter like "4/4", "6/8", "3/4". */
function meterUnits(meter: string): number {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(meter.trim());
  if (!m) return UNIT; // default: one whole note per measure (4/4)
  return Math.round((Number(m[1]) / Number(m[2])) * UNIT);
}

/** Pick a sensible meter from a tune's free-text `type` (fallback 4/4). */
export function meterForType(type: string | undefined): string {
  const t = (type ?? '').toLowerCase();
  if (t.includes('jig') || t.includes('6/8')) return '6/8';
  if (t.includes('waltz') || t.includes('hambo')) return '3/4';
  if (t.includes('polka') || t.includes('march') || t.includes('two-step') || t.includes('2/4')) return '2/4';
  return '4/4';
}

/** ABC length suffix for a note `units` thirty-seconds long (1 → unit, no suffix). */
function lengthToken(units: number): string {
  return units === 1 ? '' : String(units);
}

// Minimal abcjs synth surface (from abcjs-basic) used for "play the tune" audio.
interface AbcSynth {
  init(opts: Record<string, unknown>): Promise<unknown>;
  prime(): Promise<unknown>;
  start(): void;
  stop(): void;
  duration?: number;
}
interface AbcSynthApi {
  CreateSynth: new () => AbcSynth;
  supportsAudio?: () => boolean;
}
interface AbcJsApi {
  renderAbc(target: HTMLElement | string, code: string, params?: Record<string, unknown>): unknown;
  synth?: AbcSynthApi;
}

declare global {
  interface Window {
    ABCJS?: AbcJsApi;
  }
}

function octaveToken(letter: string, midi: number): string {
  const naturalPc = LETTER_PC[letter];
  const octaveNumber = Math.floor((midi - naturalPc) / 12) - 1;
  if (octaveNumber >= 5) return letter.toLowerCase() + "'".repeat(octaveNumber - 5);
  return letter.toUpperCase() + ','.repeat(Math.max(0, 4 - octaveNumber));
}

function midiToken(midi: number, measureAcc: Record<string, number>): string {
  const pc = ((midi % 12) + 12) % 12;
  const [letter, isSharp] = PC_SPELL[pc];
  let prefix = '';
  const cur = measureAcc[letter] ?? 0;
  if (isSharp) {
    if (cur !== 1) {
      prefix = '^';
      measureAcc[letter] = 1;
    }
  } else if (cur !== 0) {
    prefix = '=';
    measureAcc[letter] = 0;
  }
  return prefix + octaveToken(letter, midi);
}

export function notesToAbc(melody: Melody, title = '', meter = '4/4'): string {
  const measure = meterUnits(meter);
  let body = '';
  let measureAcc: Record<string, number> = {};
  let pos = 0; // 1/32 units already filled in the current measure
  for (const [midi, dur] of melody) {
    const units = Math.max(1, Math.round(dur * UNIT));
    body += midiToken(midi, measureAcc) + lengthToken(units) + ' ';
    pos += units;
    if (pos >= measure) {
      // Bar at the measure boundary; carry any overshoot into the next measure so
      // long-run alignment holds. Notes are never split, so each stays one notehead.
      body += '| ';
      pos -= measure;
      measureAcc = {}; // accidentals reset at each barline
    }
  }
  body = body.trim();
  if (body.endsWith('|')) body = body.slice(0, -1).trim();
  body += ' |]';
  return `X:1\n${title ? `T:${title}\n` : ''}M:${meter}\nL:1/${UNIT}\nK:C\n${body}`;
}

/** Strip repeats and first endings from an ABC tune for the game's "play it
 *  straight through" rendering: `|:` / `:|` / `::` become plain barlines, and a
 *  first ending (from a `|1`/`[1` volta up to and including the matching
 *  `|2`/`[2`) is removed so only the second ending remains.
 *
 *  Returns the cleaned ABC plus `drop` — the indices, in notehead order, of the
 *  removed first-ending notes — and `total`, the notehead count of the ORIGINAL
 *  abc. Callers can compare `total` against the gameplay melody length: when they
 *  match, the abc and melody are the same transcription, so `drop` can be applied
 *  to the melody to keep it aligned with the trimmed notation. */
export function prepareGameAbc(rawAbc: string): { abc: string; drop: number[]; total: number } {
  const drop: number[] = [];
  let noteIndex = -1;
  let inFirst = false;

  const lines = rawAbc.split('\n').map((line) => {
    if (/^[a-zA-Z]:/.test(line)) return line; // info field — leave alone
    let res = '';
    let i = 0;
    const emit = (s: string): void => {
      if (!inFirst) res += s;
    };

    while (i < line.length) {
      const c = line[i];

      if (c === '"') {
        // chord symbol / annotation
        let j = i + 1;
        while (j < line.length && line[j] !== '"') j++;
        emit(line.slice(i, j + 1));
        i = j + 1;
        continue;
      }
      if (c === '!') {
        // decoration, e.g. !trill!
        let j = i + 1;
        while (j < line.length && line[j] !== '!') j++;
        emit(line.slice(i, j + 1));
        i = j + 1;
        continue;
      }
      if (c === '{') {
        // grace notes — decorative, never counted as noteheads
        let j = i + 1;
        while (j < line.length && line[j] !== '}') j++;
        emit(line.slice(i, j + 1));
        i = j + 1;
        continue;
      }
      if (c === '[') {
        const nx = line[i + 1];
        if (nx && /[A-Za-z]/.test(nx) && line[i + 2] === ':') {
          // inline field, e.g. [K:G]
          let j = i + 1;
          while (j < line.length && line[j] !== ']') j++;
          emit(line.slice(i, j + 1));
          i = j + 1;
          continue;
        }
        if (nx && /\d/.test(nx)) {
          // bracketed volta: [1 starts a first ending, [2 ends it
          if (nx === '1' && !inFirst) inFirst = true;
          else if (inFirst) inFirst = false;
          i += 2;
          continue;
        }
        // chord [CEG] renders as a single notehead
        let j = i + 1;
        while (j < line.length && line[j] !== ']') j++;
        noteIndex++;
        if (inFirst) drop.push(noteIndex);
        emit(line.slice(i, j + 1));
        i = j + 1;
        continue;
      }
      if (c === '|' || c === ':' || c === ']') {
        // a run of barline characters, optionally followed by a volta digit
        let j = i;
        while (j < line.length && (line[j] === '|' || line[j] === ':' || line[j] === ']')) j++;
        const bars = line.slice(i, j);
        let volta: string | null = null;
        if (j < line.length && /\d/.test(line[j])) {
          volta = line[j];
          j++;
        }
        if (volta === '1' && !inFirst) {
          inFirst = true;
          res += '|'; // keep a barline before the (removed) first ending
        } else if (volta && inFirst) {
          inFirst = false; // reached the second ending — stop dropping
        } else if (!inFirst) {
          if (bars.includes(']')) res += '|]';
          else if (bars === '||') res += '||';
          else res += '|'; // normalize repeats (|: :| ::) to a plain barline
        }
        i = j;
        continue;
      }
      if (/[A-Ga-g]/.test(c)) {
        // a notehead (accidentals/octave/length around it are plain chars)
        noteIndex++;
        if (inFirst) drop.push(noteIndex);
        emit(c);
        i++;
        continue;
      }
      // rests (z/x/Z), accidentals, octave marks, lengths, ties, slurs, spaces…
      emit(c);
      i++;
    }
    return res;
  });

  return { abc: lines.join('\n'), drop, total: noteIndex + 1 };
}

// Drop ABC info-header lines we don't want shown on the game staff — title (T),
// composer (C), author/area (A), notes (N), rhythm (R), source (S) and tempo (Q).
// The musically-required fields (X, M, L, K, …) and the tune body are left intact.
function stripInfoHeaders(abc: string): string {
  return abc
    .split('\n')
    .filter((line) => !/^\s*[TCANRSQ]:/.test(line))
    .join('\n');
}

// Local soundfont path (same as the Sheet Music viewer). One mp3 per note.
const soundFont = (filename: string): string =>
  '/abcjs/soundfonts/FluidR3_GM/acoustic_grand_piano-mp3/' + filename;

/** A staff that renders a note sequence and can highlight progress. */
export class SheetMusic {
  private noteEls: Element[] = [];
  private lineHeight = 0; // vertical distance between rendered staff systems (px)
  private visualObj: unknown; // abcjs tune object for the current render (for synth)
  private synth?: AbcSynth;
  private audioCtx?: AudioContext;
  private endTimer = 0;

  constructor(private el: HTMLElement) {}

  render(
    melody: Melody,
    opts: { title?: string; scale?: number; meter?: string; abc?: string } = {},
  ): void {
    if (!window.ABCJS || !this.el) return;
    // Prefer the original ABC (real repeats/chords/beaming, like the Sheet Music
    // page); fall back to ABC reconstructed from the melody when none is attached.
    const abc = stripInfoHeaders(opts.abc ?? notesToAbc(melody, opts.title ?? '', opts.meter ?? '4/4'));
    // Fixed, readable note size — wrap to multiple lines (the container scrolls)
    // rather than shrinking a long tune to fit the width.
    const width = Math.max(320, (this.el.clientWidth || 760) - 16);
    const params: Record<string, unknown> = {
      add_classes: true,
      scale: opts.scale ?? 1.5,
      staffwidth: width,
      wrap: { minSpacing: 1.6, maxSpacing: 2.4, preferredMeasuresPerLine: 4 },
      paddingtop: 6,
      paddingbottom: 6,
    };
    let vobj = window.ABCJS.renderAbc(this.el, abc, params);
    this.noteEls = this.collectNoteEls();
    // Safety net: the progress highlight maps gameplay notes onto noteheads by
    // position, which only works when the counts match. If the original ABC has a
    // different notehead count (chords, ties, multiple voices…), fall back to the
    // melody-built ABC for this tune so the highlight stays correct.
    if (opts.abc && melody.length && this.noteEls.length !== melody.length) {
      vobj = window.ABCJS.renderAbc(this.el, stripInfoHeaders(notesToAbc(melody, opts.title ?? '', opts.meter ?? '4/4')), params);
      this.noteEls = this.collectNoteEls();
    }
    this.visualObj = Array.isArray(vobj) ? vobj[0] : vobj;
    this.lineHeight = this.measureLineHeight();
  }

  isPlaying(): boolean {
    return !!this.synth;
  }

  /** Play the current tune through the abcjs synth (the same MIDI pathway the
   *  Sheet Music page uses). Calls `onEnd` when playback finishes or fails.
   *  Returns false if audio isn't available. */
  async play(onEnd: () => void): Promise<boolean> {
    const api = window.ABCJS?.synth;
    if (!api?.CreateSynth || !this.visualObj) return false;
    if (api.supportsAudio && !api.supportsAudio()) return false;
    this.stopPlay();
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = this.audioCtx ?? new Ctx();
      await this.audioCtx.resume();
      const synth = new api.CreateSynth();
      await synth.init({
        visualObj: this.visualObj,
        audioContext: this.audioCtx,
        options: { soundFont, gain: 0.7 },
      });
      await synth.prime();
      this.synth = synth;
      synth.start();
      // CreateSynth has no end event, so end after its known duration (+margin).
      const durMs = (Number(synth.duration) || 0) * 1000;
      this.endTimer = window.setTimeout(() => {
        this.stopPlay();
        onEnd();
      }, durMs + 300);
      return true;
    } catch {
      this.stopPlay();
      return false;
    }
  }

  stopPlay(): void {
    window.clearTimeout(this.endTimer);
    try {
      this.synth?.stop();
    } catch {
      /* ignore */
    }
    this.synth = undefined;
  }

  /** Melody noteheads on the main staff, in play order. Grace notes are
   *  decorative and not in the play sequence, so they're excluded to keep the
   *  1:1 mapping with gameplay notes. */
  private collectNoteEls(): Element[] {
    return Array.from(this.el.querySelectorAll('.abcjs-note')).filter(
      (n) => !n.classList.contains('abcjs-grace'),
    );
  }

  /** Distance between consecutive staff systems (lines). abcjs draws one
   *  `.abcjs-staff` per system, whose vertical position is fixed regardless of
   *  the pitches on it — so the median gap between them is one line's height. */
  private measureLineHeight(): number {
    const tops = Array.from(this.el.querySelectorAll('.abcjs-staff'))
      .map((s) => s.getBoundingClientRect().top)
      .sort((a, b) => a - b);
    if (tops.length < 2) return 0;
    const gaps = tops.slice(1).map((t, i) => t - tops[i]).sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)];
  }

  /** Past notes grey, current note highlighted, future notes black. Also scrolls
   *  the current note into view within the (scrollable) staff container. */
  setProgress(index: number): void {
    this.noteEls.forEach((n, i) => {
      n.classList.toggle('bg-note-done', i < index);
      n.classList.toggle('bg-note-current', i === index);
    });
    this.scrollToCurrent(index);
  }

  private scrollToCurrent(index: number): void {
    const cur = this.noteEls[index];
    if (!cur || !this.el) return;
    const c = this.el.getBoundingClientRect();
    const n = cur.getBoundingClientRect();
    const margin = 48;
    // Only scroll when the current note nears the edge — otherwise leave the
    // view still so it doesn't hop on every note. Reserve an extra line's height
    // at the bottom so we scroll once the note reaches the second-to-last visible
    // line (not the last), keeping the next line in view ahead of time.
    const bottomMargin = margin + this.lineHeight;
    if (n.top >= c.top + margin && n.bottom <= c.bottom - bottomMargin) return;
    // Bring it to roughly the top third, leaving room for upcoming notes, so we
    // scroll in occasional smooth chunks rather than nudging each note.
    const target = this.el.scrollTop + (n.top - c.top) - this.el.clientHeight * 0.33;
    this.el.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }
}
