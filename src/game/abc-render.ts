// Renders the guide tune and the obstacle phrase as sheet music with abcjs
// (window.ABCJS, the same library the Sheet Music tab uses) and highlights the
// next note.
//
// The ABC is generated from the exact play-sequence (one note each, uniform
// duration) so the Nth rendered note maps 1:1 to the Nth gameplay note — that's
// what keeps the "next note" highlight correct. Durations are intentionally
// uniform (they don't affect gameplay). Pitches are spelled with sharps and no
// key signature, with per-measure natural cancellation, so any note renders
// correctly regardless of key.

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// pitch class -> [natural letter, isSharp]
const PC_SPELL: Array<[string, boolean]> = [
  ['C', false], ['C', true], ['D', false], ['D', true], ['E', false], ['F', false],
  ['F', true], ['G', false], ['G', true], ['A', false], ['A', true], ['B', false],
];

const NOTES_PER_MEASURE = 4;

interface AbcJsApi {
  renderAbc(target: HTMLElement | string, code: string, params?: Record<string, unknown>): unknown;
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

export function notesToAbc(notes: number[], title = ''): string {
  let body = '';
  let measureAcc: Record<string, number> = {};
  notes.forEach((n, i) => {
    if (i > 0 && i % NOTES_PER_MEASURE === 0) {
      body += '| ';
      measureAcc = {}; // accidentals reset at each barline
    }
    body += midiToken(n, measureAcc) + ' ';
  });
  body = body.trim() + ' |]';
  return `X:1\n${title ? `T:${title}\n` : ''}M:none\nL:1/4\nK:C\n${body}`;
}

/** A staff that renders a note sequence and can highlight progress. */
export class SheetMusic {
  private noteEls: Element[] = [];

  constructor(private el: HTMLElement) {}

  render(midiNotes: number[], opts: { title?: string; scale?: number; tablature?: string } = {}): void {
    if (!window.ABCJS || !this.el) return;
    const abc = notesToAbc(midiNotes, opts.title ?? '');
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
    if (opts.tablature) params.tablature = [{ instrument: opts.tablature }];
    window.ABCJS.renderAbc(this.el, abc, params);
    // The melody noteheads (used for progress highlight) live on the main staff.
    this.noteEls = Array.from(this.el.querySelectorAll('.abcjs-note'));
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
    // view still so it doesn't hop on every note.
    if (n.top >= c.top + margin && n.bottom <= c.bottom - margin) return;
    // Bring it to roughly the top third, leaving room for upcoming notes, so we
    // scroll in occasional smooth chunks rather than nudging each note.
    const target = this.el.scrollTop + (n.top - c.top) - this.el.clientHeight * 0.33;
    this.el.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }
}
