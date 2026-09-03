import { describe, test, expect } from "vitest";
import { fftMag } from "./fft";

describe("fftMag", () => {
  test("DC signal puts all magnitude in bin 0", () => {
    const N = 8;
    const mags = fftMag(new Float32Array(N).fill(1));
    expect(mags).toHaveLength(N / 2);
    expect(mags[0]).toBeCloseTo(N, 4);
    for (let k = 1; k < N / 2; k++) expect(mags[k]).toBeCloseTo(0, 4);
  });

  test("a sine at bin k shows magnitude N/2 at bin k and ~0 elsewhere", () => {
    const N = 64;
    const k = 4;
    const x = new Float32Array(N);
    for (let n = 0; n < N; n++) x[n] = Math.sin((2 * Math.PI * k * n) / N);
    const mags = fftMag(x);
    expect(mags[k]).toBeCloseTo(N / 2, 3);
    expect(mags[k - 1]).toBeCloseTo(0, 3);
    expect(mags[k + 1]).toBeCloseTo(0, 3);
    expect(mags[0]).toBeCloseTo(0, 3);
  });

  test("a cosine at bin k has the same magnitude as the sine", () => {
    const N = 64;
    const k = 7;
    const x = new Float32Array(N);
    for (let n = 0; n < N; n++) x[n] = Math.cos((2 * Math.PI * k * n) / N);
    const mags = fftMag(x);
    expect(mags[k]).toBeCloseTo(N / 2, 3);
  });

  test("rejects non-power-of-two lengths", () => {
    expect(() => fftMag(new Float32Array(48))).toThrow();
  });
});
