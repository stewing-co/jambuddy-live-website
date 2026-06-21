// Live Detect tab UI — drives the shared JBDetectEngine and renders the
// current chord, confidence, inferred key, and a 12-bin chroma bar display.
(function () {
  'use strict';

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const QUALITIES = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10] };

  function chordTones(chord) {
    if (!chord) return new Set();
    const m = chord.match(/^([A-G][#b]?)(.*)$/);
    if (!m) return new Set();
    let root = NOTE_NAMES.indexOf(m[1].replace('Db', 'C#').replace('Eb', 'D#').replace('Gb', 'F#').replace('Ab', 'G#').replace('Bb', 'A#'));
    if (root < 0) root = NOTE_NAMES.indexOf(m[1][0]);
    if (root < 0) return new Set();
    const ivs = QUALITIES[m[2]] || QUALITIES[''];
    return new Set(ivs.map((iv) => (root + iv) % 12));
  }

  function init() {
    const toggle = document.getElementById('ld-toggle');
    const chordEl = document.getElementById('ld-chord');
    const confEl = document.getElementById('ld-confidence');
    const keyEl = document.getElementById('ld-key');
    const resetKeyBtn = document.getElementById('ld-reset-key');
    const chromaEl = document.getElementById('ld-chroma');
    const statusEl = document.getElementById('ld-status');
    if (!toggle || !chromaEl || toggle.dataset.ldInit === '1') return;
    toggle.dataset.ldInit = '1';

    // Build the 12 chroma bars once.
    const bars = [];
    NOTE_NAMES.forEach((name) => {
      const wrap = document.createElement('div');
      wrap.className = 'ld-bar-wrap';
      const bar = document.createElement('div');
      bar.className = 'ld-bar';
      const label = document.createElement('div');
      label.className = 'ld-bar-label';
      label.textContent = name;
      wrap.appendChild(bar);
      wrap.appendChild(label);
      chromaEl.appendChild(wrap);
      bars.push(bar);
    });

    const engine = window.JBDetectEngine;

    // Bars are sized in pixels (percentage heights collapse through the grid
    // cell's indefinite row height). 116px keeps room for the label in the
    // 140px column.
    const BAR_MAX_PX = 116;

    function onFrame(frame) {
      const tones = chordTones(frame.chord);
      const max = Math.max(0.0001, ...frame.chroma);
      frame.chroma.forEach((v, i) => {
        bars[i].style.height = Math.max(2, Math.round((v / max) * BAR_MAX_PX)) + 'px';
        bars[i].classList.toggle('is-chord-tone', tones.has(i));
      });
      chordEl.textContent = frame.chord || '—';
      confEl.textContent = frame.chord ? `confidence: ${Math.round(frame.confidence)}%` : (frame.active ? 'listening…' : 'silent');
      keyEl.textContent = frame.key || '—';
    }

    async function start() {
      if (!engine) { statusEl.textContent = 'Detection engine failed to load.'; return; }
      statusEl.textContent = 'Requesting microphone…';
      engine.addListener(onFrame);
      const ok = await engine.start();
      if (!ok) {
        engine.removeListener(onFrame);
        statusEl.textContent = 'Microphone unavailable: ' + (engine.lastError || 'permission denied') + '.';
        return;
      }
      toggle.textContent = '■ Stop listening';
      toggle.classList.add('tool-btn-active');
      statusEl.textContent = 'Listening… play chords near the mic.';
    }

    function stop() {
      if (engine) { engine.removeListener(onFrame); engine.stop(); }
      toggle.textContent = '🎤 Start listening';
      toggle.classList.remove('tool-btn-active');
      chordEl.textContent = '—';
      confEl.textContent = 'confidence: —';
      bars.forEach((b) => { b.style.height = '2px'; b.classList.remove('is-chord-tone'); });
    }

    toggle.addEventListener('click', () => (engine && engine.running ? stop() : start()));
    if (resetKeyBtn) resetKeyBtn.addEventListener('click', () => { if (engine) engine.resetKey(); keyEl.textContent = '—'; });

    // Release the mic when leaving this tab or unloading.
    document.addEventListener('jb-tab-change', (e) => {
      if (e.detail && e.detail.tab !== 'live' && engine && engine.running) {
        stop();
        statusEl.textContent = 'Microphone released (left Live Detect). Press start to resume.';
      }
    });
    window.addEventListener('pagehide', stop);
  }

  function boot() { try { init(); } catch (_) { /* no-op */ } }
  window.addEventListener('load', boot);
  document.addEventListener('astro:page-load', boot);
})();
