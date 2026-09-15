import { describe, expect, it } from "vitest";
import { detectHits, expectedSlots, pickPeaks } from "./hits";
import { synthTestTrack } from "./synth";

const grid = { bpm: 140, offsetMs: 150, beatsPerBar: 4, halftime: true };

describe("expectedSlots", () => {
  it("puts kicks on the 1 and snares on the 3 in halftime", () => {
    const beat = 60 / 140;
    expect(expectedSlots(grid, "kick", 2)).toEqual([0.15, 0.15 + 4 * beat]);
    expect(expectedSlots(grid, "snare", 2)[0]).toBeCloseTo(0.15 + 2 * beat);
  });
});

describe("pickPeaks", () => {
  it("keeps the biggest of two peaks inside the gap", () => {
    const s = new Float32Array(200);
    s[50] = 1;
    s[54] = 2; // 40 ms later, bigger
    s[150] = 1.5;
    const peaks = pickPeaks(s, 0.01, 0.09);
    expect(peaks.map((p) => p.index)).toEqual([54, 150]);
  });
});

describe("detectHits on the synth track", () => {
  const sr = 44100;
  const pcm = synthTestTrack({ bpm: 140, offsetMs: 150, bars: 8, sampleRate: sr });
  const beat = 60 / 140;
  it("finds every kick within 20 ms and nothing else", () => {
    const { kick } = detectHits(pcm, sr, { grid });
    const strong = kick.filter((h) => h.conf >= 0.5);
    expect(strong).toHaveLength(8);
    strong.forEach((h, i) => expect(Math.abs(h.t - (0.15 + i * 4 * beat))).toBeLessThan(0.02));
    expect(strong.every((h) => h.onGrid)).toBe(true);
  });
  it("finds every snare on the 3", () => {
    const { snare } = detectHits(pcm, sr, { grid });
    const strong = snare.filter((h) => h.conf >= 0.5);
    expect(strong).toHaveLength(8);
    strong.forEach((h, i) => expect(Math.abs(h.t - (0.15 + 2 * beat + i * 4 * beat))).toBeLessThan(0.02));
  });
  it("works without a grid, at lower confidence", () => {
    const { kick } = detectHits(pcm, sr);
    expect(kick.filter((h) => h.conf >= 0.3).length).toBeGreaterThanOrEqual(8);
    expect(kick.every((h) => !h.onGrid)).toBe(true);
  });
});
