import { describe, test, expect, beforeAll } from "vitest";
import { parseRig } from "./rig";
import { buildDrive, type DriveJson } from "./exporter";
import { extractFeatures } from "./features";
import { synthTestTrack } from "./synth";
import { coneMotion } from "./cone";
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
    scene: "void",
    mood: "smoke",
    features,
  });
});

describe("buildDrive", () => {
  test("carries per-frame cone motion when given, and omits it otherwise", () => {
    const signal = synthTestTrack({ bpm: 140, offsetMs: 150, bars: 1, sampleRate: SR });
    const features = extractFeatures(signal, SR, { fps: 30 });
    const cone = coneMotion(signal, SR, { fps: 30 });
    const base = {
      fileName: "t.wav",
      sha1: "x",
      durationSec: signal.length / SR,
      grid,
      fps: 30,
      scene: "void",
      mood: "smoke",
      features,
    };
    const withCone = buildDrive({ ...base, cone });
    expect(withCone.frames).toHaveLength(cone.length);
    for (const fr of withCone.frames) {
      expect(fr.cone).toHaveLength(2);
      for (const v of fr.cone!) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
    expect(withCone.frames.some((fr) => Math.abs(fr.cone![1] - fr.cone![0]) > 0.2)).toBe(true);
    expect(buildDrive(base).frames[0]).not.toHaveProperty("cone");
  });

  test("carries the rig inline when one is picked, and nothing otherwise", () => {
    const signal = synthTestTrack({ bpm: 140, offsetMs: 150, bars: 1, sampleRate: SR });
    const base = { fileName: "t.wav", sha1: "x", durationSec: signal.length / SR, grid, fps: 30, scene: "void-wide-pair", mood: "smoke", features: extractFeatures(signal, SR, { fps: 30 }) };
    expect(buildDrive(base)).not.toHaveProperty("rig");
    const rig = parseRig({ kind: "rig", name: "kick-floor", fixtures: [{ id: "can", role: "static", react: "kick" }] });
    const d = buildDrive({ ...base, rig });
    expect(d.rig?.fixtures[0]?.react).toBe("kick");
    expect(d.scene).toBe("void-wide-pair");
  });

  test("carries audio, grid, scene and mood metadata through", () => {
    expect(drive.audio).toEqual({ file: "test.wav", sha1: "abc123", duration });
    expect(drive.grid).toEqual({ bpm: 140, offsetMs: 150, beatsPerBar: 4, halftime: true });
    expect(drive.fps).toBe(30);
    expect(drive.scene).toBe("void");
    expect(drive.mood).toBe("smoke");
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

describe("buildDrive per-reel fields", () => {
  let d2: DriveJson;
  beforeAll(() => {
    const signal = synthTestTrack({ bpm: 140, offsetMs: 150, bars: 2, sampleRate: SR });
    const features = extractFeatures(signal, SR, { fps: 30 });
    d2 = buildDrive({
      fileName: "test.wav",
      sha1: "abc123",
      durationSec: signal.length / SR,
      grid,
      fps: 30,
      scene: "void",
      mood: "smoke",
      features,
      range: { start: 1.0, end: 3.0 },
      sections: [{ t: 2.0, kind: "drop" }],
      cuts: [0.15, 1.864],
      leadMs: 20,
    });
  });

  test("range passes through untouched (it is an audio trim, not a grid event)", () => {
    expect(d2.range).toEqual({ start: 1.0, end: 3.0 });
  });

  test("grid events shift earlier by leadMs: beats, downbeats, cuts, sections", () => {
    expect(d2.beats[0]).toBeCloseTo(0.13, 6);
    expect(d2.downbeats[0]).toBeCloseTo(0.13, 6);
    expect(d2.cuts).toHaveLength(2);
    expect(d2.cuts[0]).toBeCloseTo(0.13, 6);
    expect(d2.cuts[1]).toBeCloseTo(1.844, 6);
    expect(d2.sections[0]!.t).toBeCloseTo(1.98, 6);
    expect(d2.sections[0]!.kind).toBe("drop");
  });

  test("lead never pushes an event below zero", () => {
    const g0 = { ...grid, offsetMs: 5 };
    const signal = synthTestTrack({ bpm: 140, offsetMs: 5, bars: 1, sampleRate: SR });
    const features = extractFeatures(signal, SR, { fps: 30 });
    const d = buildDrive({
      fileName: "t.wav", sha1: "x", durationSec: signal.length / SR,
      grid: g0, fps: 30, scene: "void", mood: "smoke", features, leadMs: 20,
    });
    expect(d.beats[0]).toBeGreaterThanOrEqual(0);
  });

  test("fields default to empty/absent when not supplied", () => {
    expect(drive.range).toBeUndefined();
    expect(drive.cuts).toEqual([]);
    expect(drive.sections).toEqual([]);
  });
});
