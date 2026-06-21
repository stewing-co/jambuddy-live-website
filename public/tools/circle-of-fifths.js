// Circle of Fifths visualization for the Chord Browser "Circle of Fifths" tab.
// Self-contained ES module: builds its own SVG wheel and chord list, no deps.
(function () {
  'use strict';

  const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

  // Pitch classes laid out clockwise by perfect fifths, starting at the top (C).
  const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]; // C G D A E B F# C# G# D# A# F

  // Major scale and natural-minor scale degrees + triad qualities.
  const MAJOR = { steps: [0, 2, 4, 5, 7, 9, 11], qual: ['', 'm', 'm', '', '', 'm', 'dim'], roman: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'] };
  const MINOR = { steps: [0, 2, 3, 5, 7, 8, 10], qual: ['m', 'dim', '', 'm', 'm', '', ''], roman: ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'] };

  // Roots that conventionally spell with flats (covers majors + their relative minors).
  const FLAT_PCS = new Set([5, 10, 3, 8, 1]); // F, Bb, Eb, Ab, Db

  function useFlats(rootPc, mode) {
    const majorPc = mode === 'minor' ? (rootPc + 3) % 12 : rootPc;
    return FLAT_PCS.has(majorPc) || majorPc === 6; // Gb side prefers flats
  }

  function noteName(pc, flats) {
    return (flats ? FLAT : SHARP)[((pc % 12) + 12) % 12];
  }

  function diatonicChords(rootPc, mode) {
    const scale = mode === 'minor' ? MINOR : MAJOR;
    const flats = useFlats(rootPc, mode);
    return scale.steps.map((step, i) => {
      const name = noteName(rootPc + step, flats) + scale.qual[i];
      return { name, roman: scale.roman[i] };
    });
  }

  function polar(cx, cy, r, deg) {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  }

  // Annular sector path between two radii across an angular wedge.
  function sector(cx, cy, rInner, rOuter, startDeg, endDeg) {
    const [ox1, oy1] = polar(cx, cy, rOuter, startDeg);
    const [ox2, oy2] = polar(cx, cy, rOuter, endDeg);
    const [ix2, iy2] = polar(cx, cy, rInner, endDeg);
    const [ix1, iy1] = polar(cx, cy, rInner, startDeg);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return [
      `M ${ox1} ${oy1}`,
      `A ${rOuter} ${rOuter} 0 ${large} 1 ${ox2} ${oy2}`,
      `L ${ix2} ${iy2}`,
      `A ${rInner} ${rInner} 0 ${large} 0 ${ix1} ${iy1}`,
      'Z'
    ].join(' ');
  }

  const SVGNS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, text) {
    const node = document.createElementNS(SVGNS, name);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (text != null) node.textContent = text;
    return node;
  }

  function init() {
    const svg = document.getElementById('cof-svg');
    const keySel = document.getElementById('cof-key');
    const modeSel = document.getElementById('cof-mode');
    const diatonicEl = document.getElementById('cof-diatonic');
    const summaryEl = document.getElementById('cof-summary');
    if (!svg || !keySel || !modeSel || svg.dataset.cofInit === '1') return;
    svg.dataset.cofInit = '1';

    const state = { rootPc: 0, mode: 'major' };

    function populateKeys() {
      const flats = state.mode === 'minor';
      keySel.innerHTML = '';
      // List keys in fifths order so the dropdown matches the wheel.
      FIFTHS.forEach((pc) => {
        const useF = useFlats(pc, state.mode);
        const label = noteName(pc, useF) + (state.mode === 'minor' ? 'm' : '');
        const opt = document.createElement('option');
        opt.value = String(pc);
        opt.textContent = label;
        keySel.appendChild(opt);
      });
      keySel.value = String(state.rootPc);
      void flats;
    }

    function render() {
      const cx = 200, cy = 200;
      const rOut = 190, rMid = 130, rIn = 78;
      const flats = useFlats(state.rootPc, state.mode);

      // Base index on the wheel: the position of the (relative) major key.
      const majorPc = state.mode === 'minor' ? (state.rootPc + 3) % 12 : state.rootPc;
      const base = FIFTHS.indexOf(majorPc);

      const related = new Set([(base + 11) % 12, base, (base + 1) % 12]); // IV, I, V neighbourhood
      const tonicIsOuter = state.mode === 'major';

      svg.innerHTML = '';
      for (let i = 0; i < 12; i++) {
        const pc = FIFTHS[i];
        const start = i * 30 - 15;
        const end = i * 30 + 15;
        const inRing = related.has(i);
        const isTonicOuter = i === base && tonicIsOuter;
        const isTonicInner = i === base && !tonicIsOuter;

        // Outer ring = major key, inner ring = relative minor.
        const outer = el('path', {
          d: sector(cx, cy, rMid, rOut, start, end),
          fill: isTonicOuter ? 'rgba(16,185,129,0.55)' : inRing ? 'rgba(59,130,246,0.28)' : 'rgba(15,23,42,0.65)',
          stroke: 'rgba(148,163,184,0.35)', 'stroke-width': '1', class: 'cof-seg', 'data-pc': String(pc), 'data-mode': 'major', style: 'cursor:pointer'
        });
        const inner = el('path', {
          d: sector(cx, cy, rIn, rMid, start, end),
          fill: isTonicInner ? 'rgba(16,185,129,0.55)' : inRing ? 'rgba(59,130,246,0.18)' : 'rgba(15,23,42,0.5)',
          stroke: 'rgba(148,163,184,0.3)', 'stroke-width': '1', class: 'cof-seg', 'data-pc': String(pc), 'data-mode': 'minor', style: 'cursor:pointer'
        });
        svg.appendChild(outer);
        svg.appendChild(inner);

        const [ox, oy] = polar(cx, cy, (rMid + rOut) / 2, i * 30);
        const [ix, iy] = polar(cx, cy, (rIn + rMid) / 2, i * 30);
        svg.appendChild(el('text', { x: ox, y: oy, fill: '#ecfeff', 'font-size': '15', 'font-weight': '700', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'pointer-events': 'none' }, noteName(pc, useFlats(pc, 'major'))));
        svg.appendChild(el('text', { x: ix, y: iy, fill: '#cbd5e1', 'font-size': '11', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'pointer-events': 'none' }, noteName((pc + 9) % 12, useFlats((pc + 9) % 12, 'minor')) + 'm'));
      }

      // Click a wedge to jump to that key/mode.
      svg.querySelectorAll('.cof-seg').forEach((seg) => {
        seg.addEventListener('click', () => {
          const segPc = Number(seg.dataset.pc);
          if (seg.dataset.mode === 'minor') {
            state.mode = 'minor';
            state.rootPc = (segPc + 9) % 12; // relative minor of the labelled major
          } else {
            state.mode = 'major';
            state.rootPc = segPc;
          }
          modeSel.value = state.mode;
          populateKeys();
          render();
        });
      });

      // Diatonic chord chips.
      const chords = diatonicChords(state.rootPc, state.mode);
      diatonicEl.innerHTML = '';
      chords.forEach((c) => {
        const chip = document.createElement('div');
        chip.className = 'cof-chip';
        chip.innerHTML = `${c.name}<small>${c.roman}</small>`;
        diatonicEl.appendChild(chip);
      });
      const keyName = noteName(state.rootPc, flats) + (state.mode === 'minor' ? ' minor' : ' major');
      summaryEl.textContent = `${keyName}: I–IV–V (and relatives) are highlighted on the wheel; adjacent keys are the closest related keys.`;
    }

    keySel.addEventListener('change', () => { state.rootPc = Number(keySel.value); render(); });
    modeSel.addEventListener('change', () => { state.mode = modeSel.value === 'minor' ? 'minor' : 'major'; populateKeys(); render(); });

    populateKeys();
    render();
  }

  function boot() { try { init(); } catch (_) { /* no-op */ } }
  window.addEventListener('load', boot);
  document.addEventListener('astro:page-load', boot);
})();
