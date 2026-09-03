export interface AutoGainOptions {
  /** Which percentile of the input becomes the reference level (0..1). Default 0.95. */
  percentile?: number;
  /** Level the reference percentile is scaled to. Default 0.9. */
  target?: number;
  /** Manual multiplier applied on top of the computed gain. Default 1. */
  trim?: number;
}

/** Linear-interpolated percentile of the values (p in 0..1). Input is not mutated. */
export function percentile(values: ArrayLike<number>, p: number): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

/** Scale values so percentile(values, p) lands on target, clamped to [0, 1]. */
export function autoGain(values: ArrayLike<number>, options: AutoGainOptions = {}): Float32Array {
  const { percentile: p = 0.95, target = 0.9, trim = 1 } = options;
  const ref = percentile(values, p);
  const gain = ref > 0 ? (target / ref) * trim : 0;
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    out[i] = Math.min(1, values[i]! * gain);
  }
  return out;
}
