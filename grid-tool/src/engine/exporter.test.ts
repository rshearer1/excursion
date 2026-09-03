import { describe, test, expect, beforeAll } from "vitest";
import { buildDrive, type DriveJson } from "./exporter";
import { extractFeatures } from "./features";
import { synthTestTrack } from "./synth";
import type { Grid } from "./grid";

const SR = 44100;
const BEAT = 60 / 140;
const grid: Grid = { bpm: 140, offsetMs: 150, beatsPerBar: 4, halftime: true };

let duration = 0;
let frameCount = 0;
let drive: DriveJson;

beforeAll(() => {
  const signal = synthTestTrack({ bpm: 140, offsetMs: 150, bars: 2, sampleRate: SR });
  duration = signal.length / SR;
  const features = extractFeatures(signal, SR, { fps: 30 });
  frameCount = features.frameCount;
  drive = buildDrive({
    fileName: "test.wav",
    sha1: "abc123",
    durationSec: duration,
    grid,
    fps: 30,
    mood: "void",
    features,
  });
});

describe("buildDrive", () => {
  test("carries audio, grid and mood metadata through", () => {
    expect(drive.audio).toEqual({ file: "test.wav", sha1: "abc123", duration });
    expect(drive.grid).toEqual({ bpm: 140, offsetMs: 150, beatsPerBar: 4, halftime: true });
    expect(drive.fps).toBe(30);
    expect(drive.mood).toBe("void");
  });

  test("emits one frame per feature frame, JSON-serialisable", () => {
    expect(drive.frames).toHaveLength(frameCount);
    const roundTrip = JSON.parse(JSON.stringify(drive));
    expect(roundTrip.frames).toHaveLength(frameCount);
    expect(typeof drive.frames[0]!.bass).toBe("number");
  });

  test("first beat is the downbeat offset and beats step by one beat", () => {
    expect(drive.beats[0]).toBeCloseTo(0.15, 6);
    expect(drive.beats.length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < drive.beats.length; i++) {
      expect(drive.beats[i]! - drive.beats[i - 1]!).toBeCloseTo(BEAT, 6);
    }
  });

  test("downbeats are a subset of beats, every beatsPerBar-th one", () => {
    expect(drive.downbeats[0]).toBeCloseTo(0.15, 6);
    for (const d of drive.downbeats) {
      expect(drive.beats.some((b) => Math.abs(b - d) < 1e-9)).toBe(true);
    }
    if (drive.downbeats.length >= 2) {
      expect(drive.downbeats[1]! - drive.downbeats[0]!).toBeCloseTo(4 * BEAT, 6);
    }
  });

  test("beatPhase stays in [0,1) on every frame", () => {
    for (const f of drive.frames) {
      expect(f.beatPhase).toBeGreaterThanOrEqual(0);
      expect(f.beatPhase).toBeLessThan(1);
    }
  });

  test("auto-gain drives the bass envelope up to a strong level", () => {
    const maxBass = Math.max(...drive.frames.map((f) => f.bass));
    expect(maxBass).toBeGreaterThanOrEqual(0.8);
    expect(maxBass).toBeLessThanOrEqual(1);
  });

  test("onset fires at the kick and stays quiet mid-bar", () => {
    const kickFrame = Math.round(0.15 * 30);
    const quietFrame = Math.round((0.15 + BEAT) * 30);
    expect(drive.frames[kickFrame]!.onset).toBe(1);
    expect(drive.frames[quietFrame]!.onset).toBe(0);
  });

  test("bass envelope releases gradually after the kick instead of dropping to zero", () => {
    const kickFrame = Math.round(0.15 * 30);
    const twoLater = drive.frames[kickFrame + 2]!.bass;
    const quiet = drive.frames[Math.round((0.15 + BEAT) * 30)]!.bass;
    expect(twoLater).toBeGreaterThan(2 * quiet);
  });
});
