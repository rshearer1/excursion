export interface Grid {
  bpm: number;
  offsetMs: number;
  beatsPerBar: number;
  halftime: boolean;
}

export interface Beat {
  t: number;
  index: number;
  downbeat: boolean;
}

/** Tolerance in beats (~0.4 ns at 140 BPM) so exact beat boundaries round to the beat. */
const EPS = 1e-9;

export function beatDurationSec(grid: Grid): number {
  return 60 / grid.bpm;
}

/** Continuous beat position relative to the downbeat offset (may be negative). */
export function beatPosition(grid: Grid, tSec: number): number {
  return (tSec - grid.offsetMs / 1000) / beatDurationSec(grid);
}

export function beatIndexAt(grid: Grid, tSec: number): number {
  return Math.floor(beatPosition(grid, tSec) + EPS);
}

/** Fractional part of the beat position, always in [0, 1). */
export function beatPhaseAt(grid: Grid, tSec: number): number {
  const pos = beatPosition(grid, tSec);
  const phase = pos - Math.floor(pos + EPS);
  return phase < 0 ? 0 : phase;
}

/** Every beat with 0 <= t < durationSec, grid extended backwards before the offset. */
export function beatTimes(grid: Grid, durationSec: number): Beat[] {
  const beatDur = beatDurationSec(grid);
  const offsetSec = grid.offsetMs / 1000;
  // + 0 normalises Math.ceil's possible -0 to +0 (IEEE 754: -0 + 0 === +0)
  const firstIndex = Math.ceil(-offsetSec / beatDur - EPS) + 0;
  const beats: Beat[] = [];
  for (let i = firstIndex; ; i++) {
    const t = offsetSec + i * beatDur;
    if (t >= durationSec - EPS * beatDur) break;
    const downbeat = ((i % grid.beatsPerBar) + grid.beatsPerBar) % grid.beatsPerBar === 0;
    beats.push({ t, index: i, downbeat });
  }
  return beats;
}

export function nudged(grid: Grid, deltaMs: number): Grid {
  return { ...grid, offsetMs: grid.offsetMs + deltaMs };
}

/** Effect pulse counter: every beat in straight time, every 2 beats in halftime. */
export function pulseIndexAt(grid: Grid, tSec: number): number {
  const pos = beatPosition(grid, tSec);
  const divided = grid.halftime ? pos / 2 : pos;
  return Math.floor(divided + EPS);
}
