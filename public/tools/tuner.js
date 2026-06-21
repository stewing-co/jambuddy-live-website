// Chromatic tuner for the Chord Browser "Tuner" tab.
// Microphone via getUserMedia + autocorrelation pitch detection (no ML).
(function () {
  'use strict';

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // Time-domain autocorrelation with parabolic interpolation.
  function autoCorrelate(buf, sampleRate) {
    const SIZE = buf.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return { freq: -1, rms };

    // Trim near-silent ends to cut the work and sharpen the result.
    let r1 = 0, r2 = SIZE - 1;
    const thres = 0.2;
    for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i; break; }
    for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
    const b = buf.slice(r1, r2);
    const n = b.length;
    if (n < 8) return { freq: -1, rms };

    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) c[i] += b[j] * b[j + i];

    let d = 0;
    while (d < n - 1 && c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < n; i++) if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
    let T0 = maxpos;
    if (T0 <= 0) return { freq: -1, rms };

    const x1 = c[T0 - 1] || 0, x2 = c[T0], x3 = c[T0 + 1] || 0;
    const a = (x1 + x3 - 2 * x2) / 2;
    const bb = (x3 - x1) / 2;
    if (a) T0 = T0 - bb / (2 * a);
    return { freq: sampleRate / T0, rms };
  }

  function freqToNote(freq) {
    const midi = 69 + 12 * Math.log2(freq / 440);
    const nearest = Math.round(midi);
    const cents = Math.round((midi - nearest) * 100);
    const name = NOTE_NAMES[((nearest % 12) + 12) % 12];
    const octave = Math.floor(nearest / 12) - 1;
    return { name, octave, cents };
  }

  function init() {
    const toggle = document.getElementById('tuner-toggle');
    const noteEl = document.getElementById('tuner-note');
    const needle = document.getElementById('tuner-needle');
    const centsEl = document.getElementById('tuner-cents');
    const freqEl = document.getElementById('tuner-freq');
    const levelBar = document.getElementById('tuner-level-bar');
    const statusEl = document.getElementById('tuner-status');
    if (!toggle || !noteEl || toggle.dataset.tunerInit === '1') return;
    toggle.dataset.tunerInit = '1';

    const state = { ctx: null, analyser: null, stream: null, buf: null, raf: null, running: false, smoothFreq: 0 };

    function reset() {
      noteEl.textContent = '—';
      noteEl.className = 'tuner-note';
      needle.style.left = '50%';
      needle.classList.remove('in-tune');
      centsEl.textContent = 'cents: —';
      freqEl.textContent = '— Hz';
      levelBar.style.width = '0%';
    }

    function update() {
      if (!state.running) return;
      state.analyser.getFloatTimeDomainData(state.buf);
      const { freq, rms } = autoCorrelate(state.buf, state.ctx.sampleRate);
      levelBar.style.width = Math.min(100, Math.round(rms * 400)) + '%';

      if (freq > 20 && freq < 5000) {
        // Light smoothing so the readout doesn't jitter.
        state.smoothFreq = state.smoothFreq ? state.smoothFreq * 0.8 + freq * 0.2 : freq;
        const { name, octave, cents } = freqToNote(state.smoothFreq);
        noteEl.textContent = name + octave;
        freqEl.textContent = state.smoothFreq.toFixed(1) + ' Hz';
        centsEl.textContent = (cents > 0 ? '+' : '') + cents + ' cents';
        const pos = Math.max(-50, Math.min(50, cents));
        needle.style.left = (50 + pos) + '%';
        const inTune = Math.abs(cents) <= 5;
        noteEl.className = 'tuner-note ' + (inTune ? 'in-tune' : 'off');
        needle.classList.toggle('in-tune', inTune);
      } else {
        noteEl.textContent = '—';
        noteEl.className = 'tuner-note';
        centsEl.textContent = 'cents: —';
        freqEl.textContent = '— Hz';
        state.smoothFreq = 0;
      }
      state.raf = requestAnimationFrame(update);
    }

    async function start() {
      try {
        if (!window.isSecureContext) {
          statusEl.textContent = 'Microphone needs a secure context — open this over https:// or http://localhost (not file:// or a LAN IP).';
          return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          statusEl.textContent = 'This browser/context does not expose microphone access (getUserMedia unavailable).';
          return;
        }
        statusEl.textContent = 'Requesting microphone…';
        state.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false }
        });
        state.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (state.ctx.state === 'suspended') await state.ctx.resume();
        const src = state.ctx.createMediaStreamSource(state.stream);
        state.analyser = state.ctx.createAnalyser();
        state.analyser.fftSize = 2048;
        state.buf = new Float32Array(state.analyser.fftSize);
        src.connect(state.analyser);
        state.running = true;
        toggle.textContent = '■ Stop';
        toggle.classList.add('tool-btn-active');
        statusEl.textContent = 'Listening… play a single sustained note.';
        update();
      } catch (err) {
        statusEl.textContent = 'Microphone unavailable: ' + (err && err.message ? err.message : 'permission denied') + '.';
        stop();
      }
    }

    function stop() {
      state.running = false;
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = null;
      if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; }
      if (state.ctx) { try { state.ctx.close(); } catch (_) {} state.ctx = null; }
      state.analyser = null;
      state.smoothFreq = 0;
      toggle.textContent = '🎤 Start microphone';
      toggle.classList.remove('tool-btn-active');
      reset();
    }

    reset();
    toggle.addEventListener('click', () => (state.running ? stop() : start()));

    // Always release the mic when leaving the tuner tab or unloading the page.
    document.addEventListener('jb-tab-change', (e) => {
      if (e.detail && e.detail.tab !== 'tuner' && state.running) {
        stop();
        statusEl.textContent = 'Microphone released (left tuner tab). Press start to resume.';
      }
    });
    window.addEventListener('pagehide', stop);
  }

  function boot() { try { init(); } catch (_) { /* no-op */ } }
  window.addEventListener('load', boot);
  document.addEventListener('astro:page-load', boot);
})();
