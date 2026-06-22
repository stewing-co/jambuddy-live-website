// CREPE neural pitch tracker (web port of CrepePitchTracker.kt).
// Opt-in & lazy: loads TF.js + tfjs-tflite + the 85 MB model only when the user
// enables it. Exposed as window.JBCrepe. Used to refine monophonic melody/tuner
// pitch (blended 50/50 with YIN, as the app does) — never used for chords.
(function (global) {
  'use strict';
  if (global.JBCrepe) return;

  const FRAME = 1024;
  const BINS = 360;
  const TARGET_RATE = 16000;
  const VITERBI_STRENGTH = 0.85;
  const TF_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
  const TFLITE_BASE = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-tflite@0.0.1-alpha.10/dist/';

  // Hann window and bin->frequency table, identical to the Kotlin tracker.
  const WINDOW = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) WINDOW[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  const BIN_FREQ = new Float32Array(BINS);
  for (let i = 0; i < BINS; i++) BIN_FREQ[i] = 10 * Math.pow(2, i / 48);

  // The CREPE model is large (~85 MB), so it is NOT bundled. Configure where to
  // fetch it from, in priority order:
  //   1. an explicit url passed to load(onStatus, url)
  //   2. window.JB_CREPE_MODEL_URL (set a <script> before this one)
  //   3. the data-crepe-model="..." attribute on the #tx-crepe button
  // Returns '' if none is configured.
  function resolveModelUrl(override) {
    if (override) return override;
    if (global.JB_CREPE_MODEL_URL) return global.JB_CREPE_MODEL_URL;
    const btn = document.getElementById('tx-crepe');
    if (btn && btn.dataset && btn.dataset.crepeModel) return btn.dataset.crepeModel;
    return '';
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  const Crepe = {
    ready: false,
    loading: false,
    error: null,
    model: null,
    modelUrl: null,
    prevBest: null,
    _ds: new Float32Array(0),

    async load(onStatus, urlOverride) {
      if (this.ready) return true;
      if (this.loading) return false;
      const url = resolveModelUrl(urlOverride);
      if (!url) {
        this.error = 'no model URL configured — set window.JB_CREPE_MODEL_URL or the #tx-crepe data-crepe-model attribute to the hosted crepe_full.tflite.';
        if (onStatus) onStatus('CREPE not configured: ' + this.error);
        return false;
      }
      this.modelUrl = url;
      this.loading = true;
      this.error = null;
      try {
        if (onStatus) onStatus('Loading TensorFlow…');
        if (!global.tf) await loadScript(TF_URL);
        if (onStatus) onStatus('Loading TFLite runtime…');
        if (!global.tflite) await loadScript(TFLITE_BASE + 'tf-tflite.min.js');
        try { global.tflite.setWasmPath(TFLITE_BASE); } catch (_) {}
        if (onStatus) onStatus('Downloading CREPE model (~85 MB)…');
        this.model = await global.tflite.loadTFLiteModel(url);
        this.ready = true;
        if (onStatus) onStatus('CREPE ready.');
        return true;
      } catch (err) {
        this.error = err && err.message ? err.message : String(err);
        if (onStatus) onStatus('CREPE failed: ' + this.error);
        return false;
      } finally {
        this.loading = false;
      }
    },

    // Downsample a source-rate float frame to 16 kHz (linear interpolation).
    _downsample(buf, srcRate) {
      const step = srcRate / TARGET_RATE;
      const outLen = Math.floor(buf.length / step);
      if (outLen < FRAME) return null;
      if (this._ds.length !== outLen) this._ds = new Float32Array(outLen);
      const ds = this._ds;
      let cursor = 0;
      for (let i = 0; i < outLen; i++) {
        const idx = Math.floor(cursor);
        const next = idx + 1 < buf.length ? idx + 1 : idx;
        const frac = cursor - idx;
        ds[i] = Math.max(-1, Math.min(1, buf[idx] + (buf[next] - buf[idx]) * frac));
        cursor += step;
      }
      return ds;
    },

    _viterbi(act) {
      const prev = this.prevBest;
      if (prev == null || VITERBI_STRENGTH <= 0) return;
      const sigma = 3 + (1 - VITERBI_STRENGTH) * 20;
      const inv = 1 / (2 * sigma * sigma);
      for (let i = 0; i < act.length; i++) {
        const diff = i - prev;
        const penalty = Math.exp(-diff * diff * inv);
        act[i] *= (1 - VITERBI_STRENGTH) + VITERBI_STRENGTH * penalty;
      }
    },

    // buf: Float32Array time-domain at srcRate. Returns {freq, conf} or null.
    process(buf, srcRate) {
      if (!this.ready || !this.model || !global.tf) return null;
      const ds = this._downsample(buf, srcRate);
      if (!ds) return null;
      const start = ds.length - FRAME; // most recent 1024 samples
      const frame = new Float32Array(FRAME);
      for (let i = 0; i < FRAME; i++) frame[i] = ds[start + i] * WINDOW[i];

      let act;
      try {
        act = global.tf.tidy(() => {
          const input = global.tf.tensor(frame, [1, FRAME]);
          const out = this.model.predict(input);
          return out.dataSync().slice(0, BINS);
        });
      } catch (_) { return null; }

      this._viterbi(act);
      let sum = 0, bestVal = -Infinity, bestIdx = 0;
      for (let i = 0; i < BINS; i++) { sum += act[i]; if (act[i] > bestVal) { bestVal = act[i]; bestIdx = i; } }
      if (sum <= 0) { this.prevBest = null; return null; }
      let freq = 0;
      for (let i = 0; i < BINS; i++) freq += act[i] * BIN_FREQ[i];
      freq /= sum;
      this.prevBest = bestIdx;
      return { freq: Math.max(0, freq), conf: Math.max(0, Math.min(1, bestVal)) };
    }
  };

  global.JBCrepe = Crepe;
})(window);
