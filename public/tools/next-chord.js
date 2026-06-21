// Next-chord predictor for the Chord Browser "Next Chord" tab.
// Suggests likely follow-on chords using common functional-harmony weights.
(function () {
  'use strict';

  const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
  const FLAT_PCS = new Set([5, 10, 3, 8, 1]);

  const MAJOR = { steps: [0, 2, 4, 5, 7, 9, 11], qual: ['', 'm', 'm', '', '', 'm', 'dim'], roman: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'] };
  const MINOR = { steps: [0, 2, 3, 5, 7, 8, 10], qual: ['m', 'dim', '', 'm', 'm', '', ''], roman: ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'] };

  // Transition weights between scale degrees (by roman numeral).
  const WEIGHTS = {
    major: {
      I: { IV: 3, V: 3, vi: 2, ii: 2, iii: 1 },
      ii: { V: 4, 'vii°': 1, IV: 1 },
      iii: { vi: 3, IV: 2, ii: 1 },
      IV: { V: 4, I: 2, ii: 2, 'vii°': 1 },
      V: { I: 5, vi: 3, IV: 1 },
      vi: { ii: 3, IV: 2, V: 2, iii: 1 },
      'vii°': { I: 4, iii: 1 }
    },
    minor: {
      i: { iv: 3, v: 2, VI: 2, III: 2, VII: 2 },
      'ii°': { v: 4, VII: 1 },
      III: { VI: 3, iv: 2, VII: 1 },
      iv: { v: 3, i: 2, VII: 2 },
      v: { i: 4, VI: 2 },
      VI: { 'ii°': 2, iv: 2, III: 2, VII: 2 },
      VII: { III: 3, i: 2 }
    }
  };

  function useFlats(rootPc, mode) {
    const majorPc = mode === 'minor' ? (rootPc + 3) % 12 : rootPc;
    return FLAT_PCS.has(majorPc) || majorPc === 6;
  }
  function noteName(pc, flats) { return (flats ? FLAT : SHARP)[((pc % 12) + 12) % 12]; }

  function diatonic(rootPc, mode) {
    const scale = mode === 'minor' ? MINOR : MAJOR;
    const flats = useFlats(rootPc, mode);
    return scale.steps.map((step, i) => ({
      name: noteName(rootPc + step, flats) + scale.qual[i],
      roman: scale.roman[i]
    }));
  }

  function init() {
    const keySel = document.getElementById('next-key');
    const modeSel = document.getElementById('next-mode');
    const currentSel = document.getElementById('next-current');
    const suggestionsEl = document.getElementById('next-suggestions');
    const progressionEl = document.getElementById('next-progression');
    const clearBtn = document.getElementById('next-clear');
    if (!keySel || !currentSel || keySel.dataset.nextInit === '1') return;
    keySel.dataset.nextInit = '1';

    const state = { rootPc: 0, mode: 'major', currentRoman: 'I', progression: [] };

    function populateKeys() {
      keySel.innerHTML = '';
      FIFTHS.forEach((pc) => {
        const opt = document.createElement('option');
        opt.value = String(pc);
        opt.textContent = noteName(pc, useFlats(pc, state.mode)) + (state.mode === 'minor' ? 'm' : '');
        keySel.appendChild(opt);
      });
      keySel.value = String(state.rootPc);
    }

    function populateCurrent() {
      const chords = diatonic(state.rootPc, state.mode);
      currentSel.innerHTML = '';
      chords.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.roman;
        opt.textContent = `${c.name}  (${c.roman})`;
        currentSel.appendChild(opt);
      });
      if (!chords.some((c) => c.roman === state.currentRoman)) {
        state.currentRoman = chords[0].roman;
      }
      currentSel.value = state.currentRoman;
    }

    function romanToName(roman) {
      const c = diatonic(state.rootPc, state.mode).find((x) => x.roman === roman);
      return c ? c.name : roman;
    }

    function renderProgression() {
      progressionEl.innerHTML = '';
      state.progression.forEach((name) => {
        const span = document.createElement('span');
        span.textContent = name;
        progressionEl.appendChild(span);
      });
    }

    function renderSuggestions() {
      const table = WEIGHTS[state.mode][state.currentRoman] || {};
      const entries = Object.entries(table).sort((a, b) => b[1] - a[1]);
      const max = entries.length ? entries[0][1] : 1;
      suggestionsEl.innerHTML = '';
      if (!entries.length) {
        suggestionsEl.innerHTML = '<p class="tool-hint">No strong diatonic move from here — try any chord.</p>';
        return;
      }
      entries.forEach(([roman, weight]) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'next-card';
        card.innerHTML = `<div class="next-name">${romanToName(roman)}</div><div class="next-roman">${roman}</div><div class="next-bar" style="width:${Math.round((weight / max) * 100)}%"></div>`;
        card.addEventListener('click', () => {
          state.progression.push(romanToName(roman));
          state.currentRoman = roman;
          currentSel.value = roman;
          renderProgression();
          renderSuggestions();
        });
        suggestionsEl.appendChild(card);
      });
    }

    function refreshAll() { populateCurrent(); renderSuggestions(); }

    keySel.addEventListener('change', () => { state.rootPc = Number(keySel.value); refreshAll(); });
    modeSel.addEventListener('change', () => {
      state.mode = modeSel.value === 'minor' ? 'minor' : 'major';
      state.currentRoman = state.mode === 'minor' ? 'i' : 'I';
      populateKeys();
      refreshAll();
    });
    currentSel.addEventListener('change', () => {
      state.currentRoman = currentSel.value;
      // Starting fresh from a picked chord seeds the progression with it.
      state.progression = [romanToName(state.currentRoman)];
      renderProgression();
      renderSuggestions();
    });
    if (clearBtn) clearBtn.addEventListener('click', () => { state.progression = []; renderProgression(); });

    populateKeys();
    refreshAll();
  }

  function boot() { try { init(); } catch (_) { /* no-op */ } }
  window.addEventListener('load', boot);
  document.addEventListener('astro:page-load', boot);
})();
