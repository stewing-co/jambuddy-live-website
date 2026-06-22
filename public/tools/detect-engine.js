// JamBuddy live detection engine (web port of the Android AudioProcessor).
// Pure FFT -> chroma -> chord-template -> key pipeline (no neural model).
// Melody pitch uses the classical YIN path the app blends in. Exposed as
// window.JBDetectEngine — a singleton with start()/stop() and frame listeners.
(function (global) {
  'use strict';
  if (global.JBDetectEngine) return;

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // Faithful constants from the Android engine.
  const N_FFT = 4096;
  const CHROMA_FREQ_LOW = 30;
  const CHROMA_FREQ_HIGH = 5000;
  const RMS_SILENCE_THRESHOLD = 0.01;
  const SIGNAL_GATE_MULTIPLIER = 2.0;
  const CONFIDENCE_THRESHOLD = 0.05;
  const STABILITY_FRAMES = 3;
  const WEAK_NOTE_THRESHOLD = 0.30;
  const FRAME_MS = 90; // ~ the app's ~93 ms (4096 / 44.1k) cadence
  const CHORD_CLEAR_MS = 2000;

  // Chord qualities: suffix -> intervals (semitones from root).
  const QUALITIES = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10] };

  function l2(vec) {
    let s = 0;
    for (let i = 0; i < vec.length; i++) s += vec[i] * vec[i];
    const n = Math.sqrt(s) || 1e-9;
    return vec.map((v) => v / n);
  }

  // Build the 12 roots x 4 qualities template bank, each L2-normalized.
  function buildTemplates() {
    const out = [];
    for (let root = 0; root < 12; root++) {
      for (const suffix in QUALITIES) {
        const t = new Array(12).fill(0);
        QUALITIES[suffix].forEach((iv) => { t[(root + iv) % 12] = 1; });
        out.push({ name: NOTE_NAMES[root] + suffix, root, suffix, chroma: l2(t), seventh: suffix.indexOf('7') !== -1 });
      }
    }
    return out;
  }
  const TEMPLATES = buildTemplates();

  function dot(a, b) { let s = 0; for (let i = 0; i < 12; i++) s += a[i] * b[i]; return s; }

  function seventhInterval(suffix) {
    if (suffix.indexOf('maj7') !== -1) return 11;
    if (suffix.indexOf('dim7') !== -1) return 9;
    if (suffix.indexOf('7') !== -1) return 10;
    return null;
  }
  function thirdInterval(suffix) { return (suffix.startsWith('m') && !suffix.startsWith('maj')) ? 3 : 4; }
  function fifthInterval(suffix) { return suffix.startsWith('dim') ? 6 : suffix.startsWith('aug') ? 8 : 7; }

  // Require real energy on the 7th before accepting a seventh chord.
  function hasSeventhEvidence(cand, chroma) {
    const sev = seventhInterval(cand.suffix);
    if (sev == null) return true;
    const r = chroma[cand.root];
    const th = chroma[(cand.root + thirdInterval(cand.suffix)) % 12];
    const fi = chroma[(cand.root + fifthInterval(cand.suffix)) % 12];
    const se = chroma[(cand.root + sev) % 12];
    const triadAvg = (r + th + fi) / 3;
    const rel = Math.min(0.9, Math.max(0.45, 1 - WEAK_NOTE_THRESHOLD));
    const required = Math.max(0.08, triadAvg * rel);
    return se >= required;
  }

  function choosePreferred(simple, seventh) {
    if (!simple) return seventh;
    if (!seventh) return simple;
    const sameRoot = simple.root === seventh.root;
    const gap = seventh.score - simple.score;
    if (sameRoot && gap <= 0.015) return simple;
    if (sameRoot && gap < 0.020) return simple;
    return seventh.score > simple.score ? seventh : simple;
  }

  // ---- Chroma from a linear magnitude spectrum (AnalyserNode FFT) ----
  function computeChroma(mags, sampleRate) {
    const chroma = new Array(12).fill(0);
    const n = mags.length; // = N_FFT / 2
    for (let k = 1; k < n - 1; k++) {
      const f = (k * sampleRate) / N_FFT;
      if (f < CHROMA_FREQ_LOW || f > CHROMA_FREQ_HIGH) continue;
      const mag = mags[k];
      if (mag <= 0) continue;
      const midi = 69 + 12 * Math.log2(f / 440);
      const bin = ((Math.round(midi) % 12) + 12) % 12;
      chroma[bin] += mag;
    }
    return l2(chroma);
  }

  // ---- YIN monophonic pitch (for melody/tuner reuse) ----
  function yin(frame, sampleRate) {
    const decim = 4;
    const n = Math.floor(frame.length / decim);
    if (n < 16) return { freq: 0, conf: 0 };
    let mean = 0;
    for (let i = 0; i < n; i++) mean += frame[i * decim];
    mean /= n;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = frame[i * decim] - mean;
    const sr = sampleRate / decim;
    const tauMin = Math.max(2, Math.floor(sr / 1000));
    const tauMax = Math.min(n - 2, Math.floor(sr / 30));
    const d = new Float64Array(tauMax + 1);
    for (let tau = tauMin; tau <= tauMax; tau++) {
      let sum = 0;
      for (let i = 0; i < n - tau; i++) { const diff = x[i] - x[i + tau]; sum += diff * diff; }
      d[tau] = sum;
    }
    const cmnd = new Float64Array(tauMax + 1);
    cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) { running += d[tau]; cmnd[tau] = d[tau] === 0 ? 1 : (d[tau] * tau) / running; }
    const thresh = 0.15;
    let tauBest = tauMin;
    let minv = Infinity;
    for (let tau = tauMin; tau <= tauMax; tau++) if (cmnd[tau] < minv) { minv = cmnd[tau]; tauBest = tau; }
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (cmnd[tau] < thresh && cmnd[tau] <= (cmnd[tau - 1] || cmnd[tau]) && cmnd[tau] <= (cmnd[tau + 1] || cmnd[tau])) { tauBest = tau; break; }
    }
    const y1 = cmnd[tauBest - 1] || cmnd[tauBest];
    const y2 = cmnd[tauBest];
    const y3 = cmnd[tauBest + 1] || cmnd[tauBest];
    const a = (y1 - 2 * y2 + y3) / 2;
    const b = (y3 - y1) / 2;
    const off = Math.abs(a) > 1e-10 ? -b / (2 * a) : 0;
    const tauRef = Math.max(1, tauBest + off);
    return { freq: sr / tauRef, conf: Math.max(0, Math.min(1, 1 - y2)) };
  }

  function freqToNote(freq) {
    const midi = 69 + 12 * Math.log2(freq / 440);
    const nearest = Math.round(midi);
    return {
      midi: nearest,
      name: NOTE_NAMES[((nearest % 12) + 12) % 12],
      octave: Math.floor(nearest / 12) - 1,
      cents: Math.round((midi - nearest) * 100)
    };
  }

  function extractRoot(chord) {
    if (!chord) return null;
    const m = chord.match(/^([A-G][#b]?)/);
    return m ? m[1] : null;
  }

  const Engine = {
    running: false,
    ctx: null,
    stream: null,
    analyser: null,
    freqBuf: null,
    timeBuf: null,
    timer: null,
    listeners: [],
    useCrepe: false,
    // onset (attack/fall-off) detection state
    _prevRms: 0,
    _peak: 0,
    _armed: true,
    _lastOnset: 0,
    // detection state
    lastDetectedChord: null,
    stableCount: 0,
    reportedChord: null,
    chordHistogram: {},
    detectedKey: null,
    lastChordTime: 0,

    addListener(fn) { if (typeof fn === 'function' && this.listeners.indexOf(fn) === -1) this.listeners.push(fn); },
    removeListener(fn) { this.listeners = this.listeners.filter((f) => f !== fn); },

    resetKey() { this.chordHistogram = {}; this.detectedKey = null; },

    updateKey() {
      const entries = Object.entries(this.chordHistogram);
      if (entries.length < 2) return;
      let major = 0, minor = 0;
      const roots = {};
      entries.forEach(([chord, w]) => {
        const root = extractRoot(chord);
        if (!root) return;
        roots[root] = (roots[root] || 0) + w;
        if (chord.indexOf('m') !== -1 && chord.indexOf('maj') === -1) minor += w; else major += w;
      });
      let bestRoot = null, bestW = -1;
      for (const r in roots) if (roots[r] > bestW) { bestW = roots[r]; bestRoot = r; }
      if (bestRoot) this.detectedKey = bestRoot + (minor > major ? ' minor' : ' major');
    },

    detectChord(chroma) {
      let simple = null, seventh = null;
      for (const tpl of TEMPLATES) {
        const score = dot(tpl.chroma, chroma);
        const cand = { name: tpl.name, score, root: tpl.root, suffix: tpl.suffix, seventh: tpl.seventh };
        if (cand.seventh) {
          if (!hasSeventhEvidence(cand, chroma)) continue;
          if (!seventh || cand.score > seventh.score) seventh = cand;
        } else if (!simple || cand.score > simple.score) simple = cand;
      }
      return choosePreferred(simple, seventh);
    },

    process() {
      if (!this.running) return;
      const sr = this.ctx.sampleRate;
      // RMS from time domain.
      this.analyser.getFloatTimeDomainData(this.timeBuf);
      let rms = 0;
      for (let i = 0; i < this.timeBuf.length; i++) rms += this.timeBuf[i] * this.timeBuf[i];
      rms = Math.sqrt(rms / this.timeBuf.length);

      // Linear magnitude spectrum from the analyser's FFT (dB -> linear).
      this.analyser.getFloatFrequencyData(this.freqBuf);
      const mags = new Float64Array(this.freqBuf.length);
      for (let i = 0; i < this.freqBuf.length; i++) {
        const db = this.freqBuf[i];
        mags[i] = db <= -180 ? 0 : Math.pow(10, db / 20);
      }
      const chroma = computeChroma(mags, sr);

      const now = performance.now();
      const active = rms >= RMS_SILENCE_THRESHOLD;

      // Onset detection: model attack + fall-off so a re-struck/re-picked note
      // of the SAME pitch registers as a new note. Fire on a sharp energy rise
      // while "armed"; only re-arm after the level decays below 60% of the
      // attack peak (the fall-off), so a sustained note doesn't re-trigger.
      let onset = false;
      const ONSET_MIN = RMS_SILENCE_THRESHOLD * 2;
      if (rms >= ONSET_MIN && this._armed && rms >= this._prevRms * 1.6 && (now - this._lastOnset) > 110) {
        onset = true;
        this._armed = false;
        this._peak = rms;
        this._lastOnset = now;
      }
      if (!this._armed) {
        this._peak = Math.max(this._peak, rms);
        if (rms < this._peak * 0.6 || rms < ONSET_MIN) this._armed = true;
      }
      this._prevRms = rms;
      let chord = this.reportedChord;
      let confidence = 0;

      if (rms >= RMS_SILENCE_THRESHOLD * SIGNAL_GATE_MULTIPLIER) {
        const best = this.detectChord(chroma);
        if (best && best.score >= CONFIDENCE_THRESHOLD) {
          confidence = Math.min(1, best.score) * 100;
          if (best.name === this.lastDetectedChord) this.stableCount++;
          else { this.stableCount = 0; this.lastDetectedChord = best.name; }
          if (this.stableCount >= STABILITY_FRAMES || this.reportedChord == null) {
            if (this.reportedChord !== best.name) {
              this.reportedChord = best.name;
              this.chordHistogram[best.name] = (this.chordHistogram[best.name] || 0) + 1;
              this.updateKey();
            }
            chord = best.name;
            this.lastChordTime = now;
          }
        }
      } else if (this.reportedChord && now - this.lastChordTime > CHORD_CLEAR_MS) {
        // Clear the chord after a sustained gap of silence.
        this.reportedChord = null;
        chord = null;
      }

      // Melody pitch for transcription consumers. Classical YIN by default;
      // when CREPE is enabled and loaded, blend the two 50/50 (geometric mean
      // of frequency) exactly as the Android engine does.
      let pitch = null;
      if (active) {
        const yres = yin(this.timeBuf, sr);
        let f = yres.freq, c = yres.conf;
        if (this.useCrepe && global.JBCrepe && global.JBCrepe.ready) {
          const cr = global.JBCrepe.process(this.timeBuf, sr);
          if (cr && cr.freq > 0) {
            if (f > 0) { f = Math.exp(0.5 * Math.log(cr.freq) + 0.5 * Math.log(f)); c = Math.min(1, 0.5 * cr.conf + 0.5 * c); }
            else { f = cr.freq; c = cr.conf; }
          }
        }
        if (f > 30 && f < 2000 && c > 0.25) {
          const note = freqToNote(f);
          pitch = { freq: f, conf: c, note: note.name + note.octave, midi: note.midi, cents: note.cents };
        }
      }

      const frame = { time: now, rms, active, chroma, chord, confidence, key: this.detectedKey, pitch, onset };
      for (const fn of this.listeners) { try { fn(frame); } catch (_) {} }
    },

    async start() {
      if (this.running) return true;
      // getUserMedia is only exposed in a secure context (https:// or
      // http://localhost). On file:// or a LAN IP it's undefined and would
      // throw before any permission prompt appears.
      if (!global.isSecureContext) {
        this.lastError = 'microphone needs a secure context — open this over https:// or http://localhost (not file:// or a LAN IP address).';
        return false;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.lastError = 'this browser/context does not expose microphone access (getUserMedia unavailable).';
        return false;
      }
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false }
        });
        this.ctx = new (global.AudioContext || global.webkitAudioContext)();
        if (this.ctx.state === 'suspended') await this.ctx.resume();
        const src = this.ctx.createMediaStreamSource(this.stream);
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = N_FFT;
        this.analyser.smoothingTimeConstant = 0.3;
        this.freqBuf = new Float32Array(this.analyser.frequencyBinCount);
        this.timeBuf = new Float32Array(this.analyser.fftSize);
        src.connect(this.analyser);
        this.running = true;
        this.lastDetectedChord = null;
        this.stableCount = 0;
        this.reportedChord = null;
        this._prevRms = 0;
        this._peak = 0;
        this._armed = true;
        this._lastOnset = 0;
        this.timer = setInterval(() => this.process(), FRAME_MS);
        return true;
      } catch (err) {
        const name = err && err.name ? err.name : '';
        if (name === 'NotAllowedError' || /denied|not allowed/i.test((err && err.message) || '')) {
          this.lastError = 'permission denied. Fix: (1) use a real browser tab, NOT an embedded preview (e.g. VS Code Simple Browser blocks the mic); (2) click the lock/ⓘ icon in the address bar → Site settings → Microphone → Allow, then reload; (3) enable mic for your browser in the OS privacy settings (macOS: System Settings → Privacy & Security → Microphone), then fully restart the browser.';
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          this.lastError = 'no microphone was found on this device.';
        } else if (name === 'NotReadableError' || name === 'TrackStartError') {
          this.lastError = 'the microphone is already in use by another app.';
        } else {
          this.lastError = (err && err.message) ? err.message : String(err);
        }
        this.stop();
        return false;
      }
    },

    stop() {
      this.running = false;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
      if (this.ctx) { try { this.ctx.close(); } catch (_) {} this.ctx = null; }
      this.analyser = null;
    }
  };

  Engine.NOTE_NAMES = NOTE_NAMES;
  Engine.freqToNote = freqToNote;
  global.JBDetectEngine = Engine;
})(window);
