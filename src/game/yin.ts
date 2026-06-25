// Compact YIN monophonic pitch detector (de Cheveigné & Kawahara, 2002).
// Low-latency, run per animation frame on a small window — far finer temporal
// resolution than the chord engine's 90 ms cadence, so fast notes and quick
// repeats register.

const THRESHOLD = 0.12;
const MIN_FREQ = 70; // ~ C#2
const MAX_FREQ = 1600; // ~ G6

export interface YinResult {
  freq: number; // 0 if no pitch
  clarity: number; // 0..1
}

export function rms(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

export function yinPitch(buf: Float32Array, sampleRate: number): YinResult {
  const n = buf.length;
  let tauMax = Math.min(Math.floor(sampleRate / MIN_FREQ), Math.floor(n / 2));
  const tauMin = Math.max(1, Math.floor(sampleRate / MAX_FREQ));
  if (tauMax <= tauMin) return { freq: 0, clarity: 0 };

  // 1) Difference function.
  const diff = new Float32Array(tauMax);
  const lim = n - tauMax;
  for (let tau = 1; tau < tauMax; tau++) {
    let sum = 0;
    for (let j = 0; j < lim; j++) {
      const d = buf[j] - buf[j + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // 2) Cumulative mean normalized difference.
  const cmnd = new Float32Array(tauMax);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau < tauMax; tau++) {
    running += diff[tau];
    cmnd[tau] = running > 0 ? (diff[tau] * tau) / running : 1;
  }

  // 3) Absolute threshold: first local min below THRESHOLD.
  let tauEst = -1;
  for (let tau = tauMin; tau < tauMax; tau++) {
    if (cmnd[tau] < THRESHOLD) {
      while (tau + 1 < tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      tauEst = tau;
      break;
    }
  }
  if (tauEst === -1) return { freq: 0, clarity: 0 };

  // 4) Parabolic interpolation for sub-sample precision.
  let better = tauEst;
  if (tauEst > 0 && tauEst < tauMax - 1) {
    const a = cmnd[tauEst - 1];
    const b = cmnd[tauEst];
    const c = cmnd[tauEst + 1];
    const denom = 2 * (2 * b - a - c);
    if (Math.abs(denom) > 1e-6) better = tauEst + (c - a) / denom;
  }

  const freq = sampleRate / better;
  if (freq < MIN_FREQ || freq > MAX_FREQ) return { freq: 0, clarity: 0 };
  return { freq, clarity: Math.max(0, Math.min(1, 1 - cmnd[tauEst])) };
}
