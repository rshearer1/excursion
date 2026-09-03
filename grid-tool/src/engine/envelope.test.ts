import { describe, test, expect } from "vitest";
import { envelopeFollow } from "./envelope";

const arr = (xs: Iterable<number>) => Array.from(xs);

describe("envelopeFollow", () => {
  test("instant attack tracks rises exactly", () => {
    const out = envelopeFollow([0, 1, 0, 0], 1, 0.5);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(1, 6);
  });

  test("release decays geometrically after a pulse", () => {
    const out = arr(envelopeFollow([0, 1, 0, 0], 1, 0.5));
    expect(out).toHaveLength(4);
    expect(out[1]).toBeCloseTo(1, 6);
    expect(out[2]).toBeCloseTo(0.5, 6);
    expect(out[3]).toBeCloseTo(0.25, 6);
  });

  test("partial attack smooths rises", () => {
    const out = arr(envelopeFollow([0, 1, 1], 0.5, 0.5));
    expect(out[1]).toBeCloseTo(0.5, 6);
    expect(out[2]).toBeCloseTo(0.75, 6);
  });

  test("empty input gives empty output", () => {
    expect(envelopeFollow([], 0.5, 0.5)).toHaveLength(0);
  });

  test("accepts Float32Array input", () => {
    const out = arr(envelopeFollow(new Float32Array([0, 1, 0]), 1, 0.5));
    expect(out[2]).toBeCloseTo(0.5, 6);
  });
});
