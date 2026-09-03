import { type Grid, beatDurationSec, beatPosition } from "./grid";

export interface CutOptions {
  /** Emit a cut at the downbeat and every N bars after it. Omit or 0 for none. */
  everyBars?: number;
  /** User-placed marker times (seconds); each snaps to its nearest beat. */
  markerTimes?: number[];
}

const EPS = 1e-9;
const MERGE_TOLERANCE = 0.001; // cuts closer than 1 ms collapse into one

/**
 * Camera-cut times in seconds: bar-cadence cuts from the grid plus
 * beat-snapped marker cuts, merged, deduped and sorted, all within [0, duration).
 */
export function computeCuts(grid: Grid, durationSec: number, options: CutOptions): number[] {
  const { everyBars = 0, markerTimes = [] } = options;
  const beatDur = beatDurationSec(grid);
  const offsetSec = grid.offsetMs / 1000;
  const cuts: number[] = [];

  if (everyBars > 0) {
    const step = everyBars * grid.beatsPerBar * beatDur;
    for (let k = Math.ceil(-offsetSec / step - EPS); ; k++) {
      const t = offsetSec + k * step;
      if (t >= durationSec - EPS) break;
      if (t >= -EPS) cuts.push(Math.max(0, t));
    }
  }

  for (const m of markerTimes) {
    const snapped = offsetSec + Math.round(beatPosition(grid, m)) * beatDur;
    if (snapped >= -EPS && snapped < durationSec - EPS) cuts.push(Math.max(0, snapped));
  }

  cuts.sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of cuts) {
    if (out.length === 0 || t - out[out.length - 1]! > MERGE_TOLERANCE) out.push(t);
  }
  return out;
}
