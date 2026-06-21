// Metronome for the Chord Browser "Metronome" tab.
// Web Audio lookahead scheduler + the JamBuddy app strum patterns.
(function () {
  'use strict';

  // grid: string of D (accent/down), U (up), x (mute) evenly spaced across one
  // measure; or 'straight' = one click per beat (adapts to time signature).
  const PATTERNS = [
    { label: 'Straight beats', grid: 'straight' },
    { label: 'All Down (DDDD)', grid: 'DDDD' },
    { label: 'Ending Up (DDDU)', grid: 'DDDU' },
    { label: 'Basic Eighth (DDUDDUDD)', grid: 'DDUDDUDD' },
    { label: 'Down-Up 8th (DUDUDUDU)', grid: 'DUDUDUDU' },
    { label: 'All Down 8th', grid: 'DDDDDDDD' },
    { label: 'Triplet feel (DUDUDU)', grid: 'DUDUDU' },
    { label: 'Simple Reggae (DxUx)', grid: 'DxUx' },
    { label: 'Reggae Skank (DxUDxUDx)', grid: 'DxUDxUDx' },
    { label: 'Folk (DDUxUDU)', grid: 'DDUxUDU' },
    { label: 'Syncopated (DxDUxUDU)', grid: 'DxDUxUDU' },
    { label: 'Complex Sync (DUxUDUxU)', grid: 'DUxUDUxU' }
  ];

  function init() {
    const slider = document.getElementById('metro-slider');
    const bpmValue = document.getElementById('metro-bpm-value');
    const beatsDots = document.getElementById('metro-beats');
    const beatsPerSel = document.getElementById('metro-beats-per');
    const patternSel = document.getElementById('metro-pattern');
    const toggle = document.getElementById('metro-toggle');
    const upBtn = document.getElementById('metro-up');
    const downBtn = document.getElementById('metro-down');
    const tapBtn = document.getElementById('metro-tap');
    if (!slider || !toggle || slider.dataset.metroInit === '1') return;
    slider.dataset.metroInit = '1';

    const state = {
      bpm: 120,
      beats: 4,
      patternIdx: 0,
      running: false,
      ctx: null,
      nextNoteTime: 0,
      stepIndex: 0,
      timer: null,
      queue: [],
      tapTimes: []
    };

    PATTERNS.forEach((p, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = p.label;
      patternSel.appendChild(opt);
    });

    function gridFor() {
      const g = PATTERNS[state.patternIdx].grid;
      if (g === 'straight') return 'D'.repeat(state.beats);
      return g;
    }

    function renderDots(activeBeat) {
      beatsDots.innerHTML = '';
      for (let b = 0; b < state.beats; b++) {
        const dot = document.createElement('div');
        dot.className = 'metro-dot' + (b === 0 ? ' is-accent' : ' is-beat') + (b === activeBeat ? ' is-active' : '');
        beatsDots.appendChild(dot);
      }
    }

    function setBpm(v) {
      state.bpm = Math.max(40, Math.min(240, Math.round(v)));
      slider.value = String(state.bpm);
      bpmValue.textContent = String(state.bpm);
    }

    function click(time, symbol, isDownbeat) {
      if (symbol === 'x') return;
      const ctx = state.ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      // Accent the measure downbeat and D strokes; U strokes are lighter/higher.
      const accent = isDownbeat;
      const freq = accent ? 1500 : symbol === 'U' ? 1100 : 900;
      const peak = accent ? 0.5 : symbol === 'U' ? 0.22 : 0.32;
      osc.frequency.value = freq;
      osc.type = 'square';
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(peak, time + 0.001);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
      osc.connect(gain).connect(ctx.destination);
      osc.start(time);
      osc.stop(time + 0.06);
    }

    function scheduler() {
      const ctx = state.ctx;
      const grid = gridFor();
      const len = grid.length;
      while (state.nextNoteTime < ctx.currentTime + 0.12) {
        const step = state.stepIndex;
        const symbol = grid[step] || 'x';
        const beat = Math.floor((step * state.beats) / len);
        const isDownbeat = step === 0;
        click(state.nextNoteTime, symbol, isDownbeat);
        state.queue.push({ time: state.nextNoteTime, beat });
        const measureDur = state.beats * (60 / state.bpm);
        state.nextNoteTime += measureDur / len;
        state.stepIndex = (state.stepIndex + 1) % len;
      }
    }

    function drawLoop() {
      if (!state.running) return;
      const now = state.ctx.currentTime;
      let current = null;
      while (state.queue.length && state.queue[0].time <= now) {
        current = state.queue.shift();
      }
      if (current) renderDots(current.beat);
      requestAnimationFrame(drawLoop);
    }

    function start() {
      if (state.running) return;
      if (!state.ctx) state.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (state.ctx.state === 'suspended') state.ctx.resume();
      state.running = true;
      state.stepIndex = 0;
      state.queue = [];
      state.nextNoteTime = state.ctx.currentTime + 0.05;
      state.timer = setInterval(scheduler, 25);
      requestAnimationFrame(drawLoop);
      toggle.textContent = '■ Stop';
      toggle.classList.add('tool-btn-active');
    }

    function stop() {
      state.running = false;
      if (state.timer) clearInterval(state.timer);
      state.timer = null;
      toggle.textContent = '▶ Start';
      toggle.classList.remove('tool-btn-active');
      renderDots(-1);
    }

    setBpm(120);
    renderDots(-1);

    slider.addEventListener('input', () => setBpm(Number(slider.value)));
    upBtn.addEventListener('click', () => setBpm(state.bpm + 1));
    downBtn.addEventListener('click', () => setBpm(state.bpm - 1));
    beatsPerSel.addEventListener('change', () => { state.beats = Number(beatsPerSel.value) || 4; renderDots(-1); });
    patternSel.addEventListener('change', () => { state.patternIdx = Number(patternSel.value) || 0; });
    toggle.addEventListener('click', () => (state.running ? stop() : start()));

    tapBtn.addEventListener('click', () => {
      const now = performance.now();
      state.tapTimes = state.tapTimes.filter((t) => now - t < 2500);
      state.tapTimes.push(now);
      if (state.tapTimes.length >= 2) {
        const diffs = [];
        for (let i = 1; i < state.tapTimes.length; i++) diffs.push(state.tapTimes[i] - state.tapTimes[i - 1]);
        const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
        if (avg > 0) setBpm(60000 / avg);
      }
    });

    // Release audio + stop when leaving the metronome tab or unloading.
    document.addEventListener('jb-tab-change', (e) => {
      if (e.detail && e.detail.tab !== 'metronome') stop();
    });
    window.addEventListener('pagehide', stop);
  }

  function boot() { try { init(); } catch (_) { /* no-op */ } }
  window.addEventListener('load', boot);
  document.addEventListener('astro:page-load', boot);
})();
