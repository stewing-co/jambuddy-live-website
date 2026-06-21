// Chord transposer + capo calculator for the Chord Browser "Transposer" tab.
(function () {
  'use strict';

  const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  // Pitch classes that conventionally read as flats when auto-spelling.
  const AUTO_FLAT = new Set([1, 3, 6, 8, 10]);

  function rootToPc(root) {
    const letter = root[0].toUpperCase();
    let pc = LETTER_PC[letter];
    if (pc == null) return null;
    const acc = root.slice(1);
    if (acc === '#' || acc === '♯') pc += 1;
    else if (acc === 'b' || acc === '♭') pc -= 1;
    return ((pc % 12) + 12) % 12;
  }

  function pcToName(pc, spelling) {
    pc = ((pc % 12) + 12) % 12;
    if (spelling === 'flats') return FLAT[pc];
    if (spelling === 'sharps') return SHARP[pc];
    return AUTO_FLAT.has(pc) ? FLAT[pc] : SHARP[pc];
  }

  // Matches a leading note name (A–G + optional accidental) at the start of a token.
  const NOTE_RE = /^([A-Ga-g])(#|b|♯|♭)?(.*)$/;

  function transposeToken(token, steps, spelling) {
    // Leave non-chord tokens (bar lines, dashes, punctuation) untouched.
    if (!/[A-Ga-g]/.test(token[0] || '')) return token;
    const m = token.match(NOTE_RE);
    if (!m) return token;
    const root = m[1] + (m[2] || '');
    const rootPc = rootToPc(root);
    if (rootPc == null) return token;
    let rest = m[3] || '';

    // Handle a slash bass note (e.g. C/E).
    let bass = '';
    const slash = rest.indexOf('/');
    if (slash !== -1) {
      const after = rest.slice(slash + 1);
      const bm = after.match(NOTE_RE);
      if (bm) {
        const bassPc = rootToPc(bm[1] + (bm[2] || ''));
        if (bassPc != null) {
          bass = '/' + pcToName(bassPc + steps, spelling) + (bm[3] || '');
          rest = rest.slice(0, slash);
        }
      }
    }
    return pcToName(rootPc + steps, spelling) + rest + bass;
  }

  function transposeText(text, steps, spelling) {
    // Split on whitespace but keep the separators so layout is preserved.
    return text.split(/(\s+)/).map((part) => (/\s+/.test(part) || part === '' ? part : transposeToken(part, steps, spelling))).join('');
  }

  function init() {
    const input = document.getElementById('tr-input');
    const stepsSel = document.getElementById('tr-steps');
    const spellingSel = document.getElementById('tr-spelling');
    const output = document.getElementById('tr-output');
    const capoSel = document.getElementById('tr-capo');
    const capoResult = document.getElementById('tr-capo-result');
    const quickBtns = document.querySelectorAll('[data-tr-step]');
    if (!input || !stepsSel || input.dataset.trInit === '1') return;
    input.dataset.trInit = '1';

    for (let s = -11; s <= 11; s++) {
      const opt = document.createElement('option');
      opt.value = String(s);
      opt.textContent = s > 0 ? `+${s}` : String(s);
      if (s === 0) opt.selected = true;
      stepsSel.appendChild(opt);
    }
    for (let f = 0; f <= 11; f++) {
      const opt = document.createElement('option');
      opt.value = String(f);
      opt.textContent = f === 0 ? 'No capo' : `Fret ${f}`;
      capoSel.appendChild(opt);
    }

    function render() {
      const steps = Number(stepsSel.value) || 0;
      const spelling = spellingSel.value;
      const src = input.value.trim();
      const result = src ? transposeText(input.value, steps, spelling) : '';
      output.textContent = result || '—';

      // Capo: the transposed chords are what should SOUND; show the shapes to
      // play with the capo, which are those chords transposed down by the fret.
      const capo = Number(capoSel.value) || 0;
      if (src && capo > 0) {
        const shapes = transposeText(result, -capo, spelling);
        capoResult.textContent = `Capo on fret ${capo}: play ${shapes}  →  sounds like ${result}`;
      } else if (src) {
        capoResult.textContent = 'Pick a capo fret to see the easier shapes that produce the same sound.';
      } else {
        capoResult.textContent = '';
      }
    }

    input.addEventListener('input', render);
    stepsSel.addEventListener('change', render);
    spellingSel.addEventListener('change', render);
    capoSel.addEventListener('change', render);
    quickBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const delta = Number(btn.dataset.trStep) || 0;
        let next = (Number(stepsSel.value) || 0) + delta;
        next = Math.max(-11, Math.min(11, next));
        stepsSel.value = String(next);
        render();
      });
    });

    render();
  }

  function boot() { try { init(); } catch (_) { /* no-op */ } }
  window.addEventListener('load', boot);
  document.addEventListener('astro:page-load', boot);
})();
