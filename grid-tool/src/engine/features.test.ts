import { describe, test, expect } from "vitest";
import { extractFeatures } from "./features";
import { synthTestTrack } from "./synth";

const SR = 44100;

function tone(freq: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.floor(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = 0.8 * Math.sin((2 * Math.PI * freq * i) / SR);
  return out;
}

function mean(xs: Float32Array): number {
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

describe("extractFeatures", () => {
  test("produces one frame per 1/fps of audio", () => {
    const f = extractFeatures(new Float32Array(SR), SR, { fps: 30 });
    expect(f.frameCount).toBe(30);
    expect(f.bass).toHaveLength(30);
    expect(f.mid).toHaveLength(30);
    expect(f.high).toHaveLength(30);
    expect(f.flux).toHaveLength(30);
  });

  test("a 60 Hz tone lands in the bass band, not the high band", () => {
    const f = extractFeatures(tone(60, 1), SR);
    expect(mean(f.bass)).toBeGreaterThan(10 * mean(f.high));
  });

  test("a 5 kHz tone lands in the high band, not the bass band", () => {
    const f = extractFeatures(tone(5000, 1), SR);
    expect(mean(f.high)).toBeGreaterThan(10 * mean(f.bass));
  });

  test("bass peaks at the kick and falls away between hits", () => {
    const signal = synthTestTrack({ bpm: 140, offsetMs: 150, bars: 2, sampleRate: SR });
    const f = extractFeatures(signal, SR, { fps: 30 });
    const BEAT = 60 / 140;
    const kickFrame = Math.round((0.15 + 0.02) * 30);
    const quietFrame = Math.round((0.15 + BEAT) * 30); // beat 2: nothing plays
    expect(f.bass[kickFrame]!).toBeGreaterThan(3 * f.bass[quietFrame]!);
  });

  test("spectral flux spikes at a hit and settles after it", () => {
    const signal = synthTestTrack({ bpm: 140, offsetMs: 150, bars: 2, sampleRate: SR });
    const f = extractFeatures(signal, SR, { fps: 30 });
    const BEAT = 60 / 140;
    const kickFrame = Math.round(0.15 * 30);
    const quietFrame = Math.round((0.15 + BEAT) * 30);
    expect(f.flux[kickFrame]!).toBeGreaterThan(3 * f.flux[quietFrame]!);
  });

  test("silence produces all-zero features", () => {
    const f = extractFeatures(new Float32Array(SR), SR);
    expect(mean(f.bass)).toBe(0);
    expect(mean(f.flux)).toBe(0);
  });
});
