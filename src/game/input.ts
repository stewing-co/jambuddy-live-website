// Microphone input for the game: our own AnalyserNode + YIN, polled every
// animation frame (~60 Hz) with onset/re-articulation detection. This resolves
// fast notes and quick repeats with low latency — the chord engine's 90 ms
// cadence could not, so the game uses this dedicated detector exclusively.

import { yinPitch, rms } from './yin';

export interface PitchReadout {
  midi: number;
  note: string;
  cents: number;
  freq: number;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function readout(freq: number): PitchReadout {
  const midi = 69 + 12 * Math.log2(freq / 440);
  const nearest = Math.round(midi);
  return {
    midi: nearest,
    note: `${NOTE_NAMES[((nearest % 12) + 12) % 12]}${Math.floor(nearest / 12) - 1}`,
    cents: Math.round((midi - nearest) * 100),
    freq,
  };
}

export class MicInput {
  onNote: (midi: number) => void = () => {};
  onPitch: (p: PitchReadout | null) => void = () => {};
  onLevel: (rms: number) => void = () => {};
  onStatus: (status: string) => void = () => {};

  private static readonly FFT = 2048;
  private static readonly SILENCE = 0.012;
  private static readonly CLARITY_MIN = 0.35; // accept noisier pitch reads so fast playing isn't dropped
  private static readonly RISE_RATIO = 1.6; // volume jump that counts as a re-attack of the same note
  private static readonly REFRACTORY_MS = 60; // ~16 notes/sec ceiling — well above any session tempo
  /** Frames (~16 ms each) a pitch must hold before it commits as a note. Attack
   *  transients and YIN's octave slips rarely survive three frames, while 50 ms
   *  of settling still clears the fastest reel. Without this gate every wobble
   *  inside a single bowed/plucked note fired its own note. */
  private static readonly CONFIRM_FRAMES = 3;

  private running = false;
  private paused = false;
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private analyser?: AnalyserNode;
  private buf?: Float32Array;
  private raf = 0;

  // Note-gate state.
  private lastPc = -1;
  private lastCommitMs = 0;
  private prevRms = 0;
  // Pitch currently accumulating frames toward a commit, and how many it has held.
  private pendingPc = -1;
  private pendingFrames = 0;

  async start(): Promise<boolean> {
    if (this.running) return true;
    if (!window.isSecureContext) {
      this.onStatus('insecure-context');
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      this.onStatus('mic-denied');
      return false;
    }
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    await this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = MicInput.FFT;
    this.analyser.smoothingTimeConstant = 0;
    src.connect(this.analyser); // not to destination — avoid feedback
    this.buf = new Float32Array(this.analyser.fftSize);
    this.running = true;
    this.onStatus('listening');
    this.loop();
    return true;
  }

  stop(): void {
    if (!this.running) return;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.running = false;
    this.onStatus('stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Temporarily ignore input (without tearing down the stream) — used while the
   *  tune is being played through the speakers so it isn't heard as notes. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.onPitch(null);
  }

  private loop = (): void => {
    if (!this.running || !this.analyser || !this.buf || !this.ctx) return;
    if (this.paused) {
      this.raf = requestAnimationFrame(this.loop);
      return;
    }
    this.analyser.getFloatTimeDomainData(this.buf);
    const level = rms(this.buf);
    this.onLevel(level);
    const now = performance.now();

    if (level < MicInput.SILENCE) {
      this.onPitch(null);
      this.lastPc = -1; // silence re-arms repeats
      this.pendingPc = -1;
      this.pendingFrames = 0;
      this.prevRms = level;
      this.raf = requestAnimationFrame(this.loop);
      return;
    }

    const { freq, clarity } = yinPitch(this.buf, this.ctx.sampleRate);
    if (freq > 0 && clarity >= MicInput.CLARITY_MIN) {
      const r = readout(freq);
      this.onPitch(r);
      const pc = ((r.midi % 12) + 12) % 12;
      // A pitch has to hold for CONFIRM_FRAMES before it counts. A dropout frame
      // (low clarity) neither advances nor resets the streak, so one bad read
      // mid-note doesn't restart the wait.
      if (pc === this.pendingPc) this.pendingFrames++;
      else {
        this.pendingPc = pc;
        this.pendingFrames = 1;
      }
      const settled = this.pendingFrames >= MicInput.CONFIRM_FRAMES;
      const reattack = level > this.prevRms * MicInput.RISE_RATIO && level > MicInput.SILENCE * 1.5;
      const changed = pc !== this.lastPc;
      if (settled && (changed || reattack) && now - this.lastCommitMs >= MicInput.REFRACTORY_MS) {
        this.lastPc = pc;
        this.lastCommitMs = now;
        this.onNote(r.midi);
      }
    } else {
      this.onPitch(null);
    }
    this.prevRms = level;
    this.raf = requestAnimationFrame(this.loop);
  };
}
