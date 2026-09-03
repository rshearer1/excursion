import { describe, test, expect } from "vitest";
import { computeCuts } from "./cuts";
import type { Grid } from "./grid";

const BEAT = 60 / 140;
const BAR = 4 * BEAT;
const grid: Grid = { bpm: 140, offsetMs: 150, beatsPerBar: 4, halftime: true };
const duration = 0.15 + 8 * BAR; // exactly 8 bars after the downbeat

describe("computeCuts", () => {
  test("every N bars: cuts at the downbeat and each Nth bar inside the track", () => {
    const cuts = computeCuts(grid, duration, { everyBars: 4 });
    expect(cuts).toHaveLength(2);
    expect(cuts[0]).toBeCloseTo(0.15, 6);
    expect(cuts[1]).toBeCloseTo(0.15 + 4 * BAR, 6);
  });

  test("no cadence and no markers gives no cuts", () => {
    expect(computeCuts(grid, duration, {})).toEqual([]);
  });

  test("marker cuts snap to the nearest beat", () => {
    const cuts = computeCuts(grid, duration, { markerTimes: [3.0] });
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toBeCloseTo(0.15 + 7 * BEAT, 6); // 3.15 is the closest beat to 3.0
  });

  test("cadence and marker cuts merge, dedupe and sort", () => {
    const cuts = computeCuts(grid, duration, { everyBars: 4, markerTimes: [0.152, 3.0] });
    // marker 0.152 snaps onto the 0.15 downbeat cut — deduped
    expect(cuts).toHaveLength(3);
    expect(cuts[0]).toBeCloseTo(0.15, 6);
    expect(cuts[1]).toBeCloseTo(0.15 + 7 * BEAT, 6);
    expect(cuts[2]).toBeCloseTo(0.15 + 4 * BAR, 6);
  });

  test("cuts outside [0, duration) are dropped", () => {
    const cuts = computeCuts(grid, 1.0, { everyBars: 4, markerTimes: [5.0] });
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toBeCloseTo(0.15, 6);
  });
});
