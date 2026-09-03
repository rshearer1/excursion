import { describe, test, expect } from "vitest";
import { percentile, autoGain } from "./autogain";

const arr = (xs: Iterable<number>) => Array.from(xs);

describe("percentile", () => {
  test("p=1 is the max, p=0 the min, regardless of input order", () => {
    expect(percentile([1, 3, 2], 1)).toBe(3);
    expect(percentile([1, 3, 2], 0)).toBe(1);
  });

  test("interpolates linearly between ranks", () => {
    expect(percentile([0, 10], 0.5)).toBeCloseTo(5, 6);
  });

  test("single value is every percentile", () => {
    expect(percentile([5], 0.95)).toBe(5);
  });

  test("does not mutate the input", () => {
    const values = [3, 1, 2];
    percentile(values, 0.5);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("autoGain", () => {
  test("scales so the reference percentile hits the target level", () => {
    const out = arr(autoGain([0.1, 0.2, 0.45], { percentile: 1, target: 0.9 }));
    expect(out[0]).toBeCloseTo(0.2, 6);
    expect(out[1]).toBeCloseTo(0.4, 6);
    expect(out[2]).toBeCloseTo(0.9, 6);
  });

  test("clamps scaled values to 1", () => {
    const out = arr(autoGain([0.1, 0.5, 1.0], { percentile: 0.5, target: 0.9 }));
    expect(out[1]).toBeCloseTo(0.9, 6);
    expect(out[2]).toBe(1);
  });

  test("silence stays silence (no divide-by-zero)", () => {
    expect(arr(autoGain([0, 0, 0], { percentile: 1, target: 0.9 }))).toEqual([0, 0, 0]);
  });

  test("trim multiplies the computed gain", () => {
    const out = arr(autoGain([0.1, 0.2, 0.45], { percentile: 1, target: 0.9, trim: 0.5 }));
    expect(out[0]).toBeCloseTo(0.1, 6);
    expect(out[2]).toBeCloseTo(0.45, 6);
  });
});
