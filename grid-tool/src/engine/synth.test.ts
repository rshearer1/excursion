import { describe, test, expect } from "vitest";
import { synthTestTrack } from "./synth";

const SR = 44100;

function rmsAt(signal: Float32Array, tSec: number, windowSec = 0.03): number {
  const start = Math.max(0, Math.floor((tSec - windowSec / 2) * SR));
  const end = Math.min(signal.length, Math.floor((tSec + windowSec / 2) * SR));
  let sum = 0;
  for (let i = start; i < end; i++) sum += signal[i]! * signal[i]!;
  return Math.sqrt(sum / Math.max(1, end - start));
}

describe("synthTestTrack", () => {
  const opts = { bpm: 140, offsetMs: 150, bars: 2, sampleRate: SR };
  const BEAT = 60 / 140;

  test("length covers offset plus the requested bars", () => {
    const signal = synthTestTrack(opts);
    const expectedSec = 0.15 + 2 * 4 * BEAT;
    expect(signal.length).toBe(Math.ceil(expectedSec * SR));
  });

  test("is silent before the first downbeat", () => {
    const signal = synthTestTrack(opts);
    const preOffset = signal.subarray(0, Math.floor(0.14 * SR));
    expect(preOffset.every((s) => s === 0)).toBe(true);
  });

  test("kicks land on bar starts: loud at the downbeat, quiet just before it", () => {
    const signal = synthTestTrack(opts);
    const bar2 = 0.15 + 4 * BEAT;
    expect(rmsAt(signal, bar2 + 0.015)).toBeGreaterThan(5 * rmsAt(signal, bar2 - 0.1));
  });

  test("snare lands on beat 3 of the bar (halftime)", () => {
    const signal = synthTestTrack(opts);
    const snareT = 0.15 + 2 * BEAT;
    expect(rmsAt(signal, snareT + 0.015)).toBeGreaterThan(5 * rmsAt(signal, snareT - 0.1));
  });

  test("is deterministic", () => {
    const a = synthTestTrack(opts);
    const b = synthTestTrack(opts);
    expect(a).toEqual(b);
  });
});
