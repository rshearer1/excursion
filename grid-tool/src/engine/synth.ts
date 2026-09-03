export interface TestTrackOptions {
  bpm: number;
  offsetMs: number;
  bars: number;
  sampleRate: number;
}

/** Deterministic PRNG so the test track is bit-identical between runs. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic 4/4 halftime test pattern: kick on beat 1, snare on beat 3
 * of every bar, starting at offsetMs. Ground truth for grid and hit tests,
 * and the "demo track" button in the UI.
 */
export function synthTestTrack(opts: TestTrackOptions): Float32Array {
  const { bpm, offsetMs, bars, sampleRate } = opts;
  const beat = 60 / bpm;
  const durationSec = offsetMs / 1000 + bars * 4 * beat;
  const out = new Float32Array(Math.ceil(durationSec * sampleRate));
  const rand = mulberry32(0xc0ffee);

  const addKick = (tSec: number) => {
    const start = Math.round(tSec * sampleRate);
    const dur = Math.floor(0.15 * sampleRate);
    let phase = 0;
    for (let i = 0; i < dur && start + i < out.length; i++) {
      const t = i / sampleRate;
      const freq = 50 + 100 * Math.exp(-t * 60); // pitch drop ~150 -> 50 Hz
      phase += (2 * Math.PI * freq) / sampleRate;
      out[start + i]! += 0.9 * Math.exp(-t * 18) * Math.sin(phase);
    }
  };

  const addSnare = (tSec: number) => {
    const start = Math.round(tSec * sampleRate);
    const dur = Math.floor(0.12 * sampleRate);
    let phase = 0;
    for (let i = 0; i < dur && start + i < out.length; i++) {
      const t = i / sampleRate;
      phase += (2 * Math.PI * 180) / sampleRate;
      const noise = (rand() * 2 - 1) * 0.5 * Math.exp(-t * 35);
      const body = 0.3 * Math.exp(-t * 30) * Math.sin(phase);
      out[start + i]! += noise + body;
    }
  };

  const offsetSec = offsetMs / 1000;
  for (let bar = 0; bar < bars; bar++) {
    const barStart = offsetSec + bar * 4 * beat;
    addKick(barStart); // beat 1
    addSnare(barStart + 2 * beat); // beat 3 (halftime)
  }
  return out;
}
