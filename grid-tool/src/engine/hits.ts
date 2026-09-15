// Excursion — kick and snare tracking (phase 09). Band-split spectral flux at a 10 ms hop:
// a kick is a fast attack with a low thump (40–120 Hz), a snare is mid-band body (150–400 Hz)
// plus a broadband noise burst (2–8 kHz). Peaks over an adaptive threshold become hits with
// a confidence; with a grid, candidates near the expected slots (kick on the 1, snare on the
// 3 in halftime) are boosted, and hits far from any slot keep a lower confidence. Pure.
import { fftMag } from "./fft";
import { type Grid, beatDurationSec } from "./grid";

export interface Hit {
  /** seconds */
  t: number;
  /** 0..1, how far the peak stood above the local threshold (1 = well clear) */
  conf: number;
  /** true when the hit sits within the grid prior's window of an expected slot */
  onGrid: boolean;
}

export interface Hits {
  kick: Hit[];
  snare: Hit[];
}

export interface HitOptions {
  /** analysis hop in seconds (default 0.01) */
  hop?: number;
  fftSize?: number;
  /** minimum gap between two hits of the same kind, seconds (default 0.09) */
  minGap?: number;
  /** grid prior: expected slots get a boost, others a penalty */
  grid?: Grid;
  /** seconds either side of a slot that counts as on-grid (default 0.035) */
  slotWindow?: number;
}

/** Band flux series at the hop rate: positive magnitude change per hop in each band. */
export function bandFlux(pcm: Float32Array, sampleRate: number, bands: [number, number][], hop = 0.01, fftSize = 1024): Float32Array[] {
  const hopN = Math.max(1, Math.round(hop * sampleRate));
  const count = Math.ceil(pcm.length / hopN);
  const out = bands.map(() => new Float32Array(count));
  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  const binHz = sampleRate / fftSize;
  const ranges = bands.map(([lo, hi]) => [Math.max(1, Math.floor(lo / binHz)), Math.min(fftSize / 2, Math.ceil(hi / binHz))] as const);
  const scratch = new Float32Array(fftSize);
  let prev: Float32Array | null = null;
  for (let f = 0; f < count; f++) {
    const start = f * hopN - fftSize / 2;
    for (let i = 0; i < fftSize; i++) {
      const s = start + i;
      scratch[i] = (s >= 0 && s < pcm.length ? pcm[s]! : 0) * window[i]!;
    }
    const mags = fftMag(scratch);
    if (prev) {
      for (let b = 0; b < bands.length; b++) {
        const [lo, hi] = ranges[b]!;
        let sum = 0;
        for (let k = lo; k < hi; k++) {
          const d = mags[k]! - prev[k]!;
          if (d > 0) sum += d;
        }
        out[b]![f] = sum / (fftSize / 4) / Math.max(1, hi - lo);
      }
    }
    prev = mags;
  }
  return out;
}

/** Peaks above a running-median threshold, at least minGap apart. */
export function pickPeaks(series: Float32Array, hop: number, minGap: number, k = 2.2, floorFrac = 0.06): { index: number; ratio: number }[] {
  const n = series.length;
  const half = Math.round(0.25 / hop); // half a second of context
  let max = 0;
  for (let i = 0; i < n; i++) if (series[i]! > max) max = series[i]!;
  const floor = max * floorFrac;
  const peaks: { index: number; ratio: number }[] = [];
  const gapN = Math.round(minGap / hop);
  for (let i = 1; i < n - 1; i++) {
    const v = series[i]!;
    if (v <= floor || v < series[i - 1]! || v < series[i + 1]!) continue;
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half + 1);
    const ctx = Array.from(series.subarray(lo, hi)).sort((a, b) => a - b);
    const median = ctx[Math.floor(ctx.length / 2)] ?? 0;
    const thresh = Math.max(floor, median * k);
    if (v < thresh) continue;
    const ratio = thresh > 0 ? v / thresh : 1;
    const last = peaks[peaks.length - 1];
    if (last && i - last.index < gapN) {
      if (ratio > last.ratio) peaks[peaks.length - 1] = { index: i, ratio };
      continue;
    }
    peaks.push({ index: i, ratio });
  }
  return peaks;
}

/** Expected slot times for a kind under the grid prior: kicks on the 1 (and 3 when not halftime), snares on the 3 (2 and 4 when not halftime). */
export function expectedSlots(grid: Grid, kind: "kick" | "snare", durationSec: number): number[] {
  const beat = beatDurationSec(grid);
  const bar = beat * grid.beatsPerBar;
  const offset = grid.offsetMs / 1000;
  const inBar = kind === "kick" ? (grid.halftime ? [0] : [0, 2]) : grid.halftime ? [2] : [1, 3];
  const out: number[] = [];
  for (let b = Math.floor(-offset / bar) - 1; ; b++) {
    const t0 = offset + b * bar;
    if (t0 > durationSec) break;
    for (const s of inBar) {
      const t = t0 + s * beat;
      if (t >= 0 && t <= durationSec) out.push(t);
    }
  }
  return out;
}

function toHits(peaks: { index: number; ratio: number }[], hop: number, slots: number[] | null, slotWindow: number): Hit[] {
  return peaks.map((p) => {
    const t = p.index * hop;
    let onGrid = false;
    if (slots) {
      // slots are sorted; binary search the nearest
      let lo = 0;
      let hi = slots.length - 1;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (slots[m]! < t) lo = m + 1;
        else hi = m;
      }
      const near = Math.min(Math.abs((slots[lo] ?? Infinity) - t), Math.abs((slots[lo - 1] ?? -Infinity) - t));
      onGrid = near <= slotWindow;
    }
    const base = Math.min(1, (p.ratio - 1) / 2); // ratio 1 -> 0, ratio 3 -> 1
    const conf = slots ? Math.min(1, onGrid ? base * 0.6 + 0.4 : base * 0.7) : base;
    return { t: Math.round(t * 1000) / 1000, conf: Math.round(conf * 100) / 100, onGrid };
  });
}

/** Kick and snare hits from mono PCM, with confidences; grid optional. */
export function detectHits(pcm: Float32Array, sampleRate: number, options: HitOptions = {}): Hits {
  const { hop = 0.01, fftSize = 2048, minGap = 0.09, grid, slotWindow = 0.035 } = options;
  const [kickFlux, bodyFlux, noiseFlux] = bandFlux(pcm, sampleRate, [[40, 120], [150, 400], [2000, 8000]], hop, fftSize) as [Float32Array, Float32Array, Float32Array];
  // a snare is body AND noise together: geometric mean keeps a bare hat or a bare bass note out
  const snareFlux = new Float32Array(bodyFlux.length);
  for (let i = 0; i < snareFlux.length; i++) snareFlux[i] = Math.sqrt(bodyFlux[i]! * noiseFlux[i]!);
  const near = (arr: Float32Array, i: number): number => Math.max(arr[i - 1] ?? 0, arr[i]!, arr[i + 1] ?? 0);
  // cross-band rules: a kick's energy is in the lows with next to no noise burst; a snare's
  // burst is real. Without these a snare's body leaks into the kick band and a kick's click
  // into the snare band.
  const kickPeaks = pickPeaks(kickFlux, hop, minGap).filter((p) => near(kickFlux, p.index) > 5 * near(noiseFlux, p.index) && near(kickFlux, p.index) > 1.5 * near(bodyFlux, p.index));
  const snarePeaks = pickPeaks(snareFlux, hop, minGap).filter((p) => near(noiseFlux, p.index) > 0.1 * near(bodyFlux, p.index) && near(noiseFlux, p.index) > 0.05 * near(kickFlux, p.index));
  const duration = pcm.length / sampleRate;
  const kickSlots = grid ? expectedSlots(grid, "kick", duration) : null;
  const snareSlots = grid ? expectedSlots(grid, "snare", duration) : null;
  return {
    kick: toHits(kickPeaks, hop, kickSlots, slotWindow),
    snare: toHits(snarePeaks, hop, snareSlots, slotWindow),
  };
}
