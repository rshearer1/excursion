/**
 * Woofer cone motion straight from the audio, the way a real driver moves.
 *
 * A moving-coil driver's displacement is the drive signal through a 2nd-order low-pass at its
 * resonance: below fs the cone follows the signal, above it mass dominates and travel falls
 * ~12 dB/octave. A subsonic high-pass in front keeps DC and rumble from pinning the cone, as
 * an amplifier or port would. The result is simulated at audio rate.
 *
 * Video can't show a 50 Hz cone at 30 fps, so each frame reports the cone's two extreme
 * positions during the camera exposure (shutter fraction of the frame, centred on its time),
 * in the order they happened. Keyed at the start and end of the exposure with motion blur on,
 * the cone smears across its real travel: big swings on bass hits, still when it's quiet.
 */

export interface ConeOptions {
  fps?: number;
  /** Band the driver is fed (Hz). Default 20 (a subsonic high-pass): the woofer. */
  bandLowHz?: number;
  /** Driver resonance in Hz (default 45). */
  resonanceHz?: number;
  /** Resonance Q (default 0.7, a well-damped sealed box). */
  q?: number;
  /** @deprecated alias of bandLowHz. */
  subsonicHz?: number;
  /** Exposure as a fraction of the frame, like a 180-degree shutter (default 0.5). */
  shutter?: number;
  /** Scale so the loudest ~1 % of exposures reach full travel, clamped to -1..1 (default true). */
  normalize?: boolean;
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** RBJ cookbook low/high-pass coefficients, normalised by a0. */
function biquad(kind: "low" | "high", freq: number, q: number, sampleRate: number): Biquad {
  const w = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b1 = kind === "low" ? 1 - cos : -(1 + cos);
  const b0 = kind === "low" ? (1 - cos) / 2 : (1 + cos) / 2;
  return { b0: b0 / a0, b1: b1 / a0, b2: b0 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

function filter(input: Float32Array, c: Biquad): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i]!;
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

/** Cone displacement at audio rate, in units of the input signal (DC gain 1 in the passband). */
export function coneDisplacement(pcm: Float32Array, sampleRate: number, options: ConeOptions = {}): Float32Array {
  const { resonanceHz = 45, q = 0.7 } = options;
  const low = options.bandLowHz ?? options.subsonicHz ?? 20;
  const hp = filter(pcm, biquad("high", low, 0.707, sampleRate));
  return filter(hp, biquad("low", resonanceHz, q, sampleRate));
}

/** The PMC-style 75 mm soft-dome mid: fed above the crossover, resonance well up the band. */
export const MID_DOME: ConeOptions = { bandLowHz: 300, resonanceHz: 700, q: 0.9 };

/** Per video frame: [first, second] extreme cone positions within the exposure, time-ordered. */
export function coneMotion(
  pcm: Float32Array,
  sampleRate: number,
  options: ConeOptions = {},
): [number, number][] {
  const { fps = 30, shutter = 0.5, normalize = true } = options;
  const x = coneDisplacement(pcm, sampleRate, options);
  const frameCount = Math.ceil((pcm.length / sampleRate) * fps);
  const half = (shutter / fps / 2) * sampleRate;

  const frames: [number, number][] = [];
  for (let f = 0; f < frameCount; f++) {
    const centre = (f / fps) * sampleRate;
    const a = Math.max(0, Math.floor(centre - half));
    const b = Math.min(x.length - 1, Math.ceil(centre + half));
    let lo = Infinity;
    let hi = -Infinity;
    let loAt = a;
    let hiAt = a;
    for (let i = a; i <= b; i++) {
      const v = x[i]!;
      if (v < lo) {
        lo = v;
        loAt = i;
      }
      if (v > hi) {
        hi = v;
        hiAt = i;
      }
    }
    if (a > b) {
      frames.push([0, 0]);
    } else {
      frames.push(loAt <= hiAt ? [lo, hi] : [hi, lo]);
    }
  }

  if (!normalize) return frames;
  const mags = frames.flatMap(([p, n]) => [Math.abs(p), Math.abs(n)]).sort((m, n) => m - n);
  const ref = mags.length ? mags[Math.floor(0.99 * (mags.length - 1))]! : 0;
  const gain = ref > 0 ? 0.95 / ref : 0;
  const clamp = (v: number): number => Math.max(-1, Math.min(1, v * gain)) + 0; // + 0: no -0
  return frames.map(([p, n]) => [clamp(p), clamp(n)]);
}
