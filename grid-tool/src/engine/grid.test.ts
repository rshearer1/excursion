import { describe, test, expect } from "vitest";
import {
  type Grid,
  beatDurationSec,
  beatPosition,
  beatIndexAt,
  beatPhaseAt,
  beatTimes,
  nudged,
  pulseIndexAt,
} from "./grid";

const grid140: Grid = { bpm: 140, offsetMs: 132, beatsPerBar: 4, halftime: false };
const BEAT = 60 / 140; // 0.428571...

describe("beatDurationSec", () => {
  test("140 BPM beat lasts 60/140 seconds", () => {
    expect(beatDurationSec(grid140)).toBeCloseTo(BEAT, 10);
  });
});

describe("beatPosition / beatIndexAt / beatPhaseAt", () => {
  test("at the downbeat offset, position is exactly 0", () => {
    expect(beatPosition(grid140, 0.132)).toBeCloseTo(0, 10);
    expect(beatIndexAt(grid140, 0.132)).toBe(0);
    expect(beatPhaseAt(grid140, 0.132)).toBeCloseTo(0, 10);
  });

  test("one beat after the offset, index is 1 with phase 0", () => {
    const t = 0.132 + BEAT;
    expect(beatIndexAt(grid140, t)).toBe(1);
    expect(beatPhaseAt(grid140, t)).toBeCloseTo(0, 6);
  });

  test("halfway through beat 2, phase is 0.5", () => {
    const t = 0.132 + 2 * BEAT + BEAT / 2;
    expect(beatIndexAt(grid140, t)).toBe(2);
    expect(beatPhaseAt(grid140, t)).toBeCloseTo(0.5, 6);
  });

  test("before the offset, position is negative but phase stays in [0,1)", () => {
    expect(beatPosition(grid140, 0)).toBeLessThan(0);
    expect(beatIndexAt(grid140, 0)).toBe(-1);
    const phase = beatPhaseAt(grid140, 0);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(1);
    expect(phase).toBeCloseTo(1 - 0.132 / BEAT, 6);
  });
});

describe("beatTimes", () => {
  test("lists every beat in [0, duration) for a small window", () => {
    const beats = beatTimes(grid140, 2.0);
    const expected = [0.132, 0.132 + BEAT, 0.132 + 2 * BEAT, 0.132 + 3 * BEAT, 0.132 + 4 * BEAT];
    expect(beats).toHaveLength(5);
    beats.forEach((b, i) => expect(b.t).toBeCloseTo(expected[i]!, 6));
    expect(beats.map((b) => b.index)).toEqual([0, 1, 2, 3, 4]);
  });

  test("extends the grid backwards when the offset is later than one beat", () => {
    const g: Grid = { ...grid140, offsetMs: 1000 };
    const beats = beatTimes(g, 1.2);
    // backwards from 1.0: 0.5714, 0.1428 are >= 0; -0.2857 is excluded
    expect(beats.map((b) => b.index)).toEqual([-2, -1, 0]);
    expect(beats[0]!.t).toBeCloseTo(1.0 - 2 * BEAT, 6);
    expect(beats[2]!.t).toBeCloseTo(1.0, 6);
  });

  test("flags downbeats every beatsPerBar beats, including negative indices", () => {
    const g: Grid = { ...grid140, offsetMs: 2000 };
    const beats = beatTimes(g, 2.1);
    for (const b of beats) {
      const expectDownbeat = ((b.index % 4) + 4) % 4 === 0;
      expect(b.downbeat).toBe(expectDownbeat);
    }
    expect(beats.some((b) => b.downbeat)).toBe(true);
    expect(beats.some((b) => !b.downbeat)).toBe(true);
  });

  test("returns empty for zero duration", () => {
    expect(beatTimes(grid140, 0)).toEqual([]);
  });
});

describe("nudged", () => {
  test("shifts the offset by the given milliseconds", () => {
    expect(nudged(grid140, 10).offsetMs).toBe(142);
    expect(nudged(grid140, -1).offsetMs).toBe(131);
  });

  test("leaves every other field untouched", () => {
    const g = nudged(grid140, 10);
    expect(g.bpm).toBe(140);
    expect(g.beatsPerBar).toBe(4);
    expect(g.halftime).toBe(false);
  });

  test("does not mutate the original grid", () => {
    nudged(grid140, 25);
    expect(grid140.offsetMs).toBe(132);
  });
});

describe("pulseIndexAt (halftime)", () => {
  const half: Grid = { ...grid140, halftime: true };

  test("straight time: pulse index equals beat index", () => {
    const t = 0.132 + 3 * BEAT;
    expect(pulseIndexAt(grid140, t)).toBe(3);
  });

  test("halftime: pulse advances every two beats", () => {
    expect(pulseIndexAt(half, 0.132)).toBe(0);
    expect(pulseIndexAt(half, 0.132 + BEAT)).toBe(0);
    expect(pulseIndexAt(half, 0.132 + 2 * BEAT)).toBe(1);
    expect(pulseIndexAt(half, 0.132 + 3 * BEAT)).toBe(1);
    expect(pulseIndexAt(half, 0.132 + 4 * BEAT)).toBe(2);
  });
});
