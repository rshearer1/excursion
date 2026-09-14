import { describe, test, expect } from "vitest";
import { coneMotion, MID_DOME } from "./cone";

const SR = 48000;
const FPS = 30;

function sine(freq: number, amp: number, seconds: number, startSec = 0, totalSec = seconds): Float32Array {
  const out = new Float32Array(Math.round(totalSec * SR));
  const a = Math.round(startSec * SR);
  const b = Math.min(out.length, a + Math.round(seconds * SR));
  for (let i = a; i < b; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * (i - a)) / SR);
  return out;
}

/** Largest travel (max - min over each exposure) across frames in [f0, f1). */
function travel(frames: [number, number][], f0: number, f1: number): number {
  let m = 0;
  for (let f = f0; f < f1; f++) m = Math.max(m, Math.abs(frames[f]![1] - frames[f]![0]));
  return m;
}

describe("coneMotion", () => {
  test("one [first, second] pair per video frame", () => {
    const out = coneMotion(sine(50, 0.5, 2), SR, { fps: FPS });
    expect(out).toHaveLength(60);
    for (const pair of out) expect(pair).toHaveLength(2);
  });

  test("silence leaves the cone at rest", () => {
    const out = coneMotion(new Float32Array(SR), SR, { fps: FPS });
    for (const [a, b] of out) {
      expect(a).toBe(0);
      expect(b).toBe(0);
    }
  });

  test("like a real driver, bass moves the cone far more than treble at the same level", () => {
    const opts = { fps: FPS, normalize: false };
    const bass = coneMotion(sine(40, 0.5, 2), SR, opts);
    const treble = coneMotion(sine(400, 0.5, 2), SR, opts);
    // mass-controlled above resonance: travel falls ~12 dB/octave
    expect(travel(bass, 15, 60)).toBeGreaterThan(20 * travel(treble, 15, 60));
  });

  test("subsonic content is filtered instead of pinning the cone", () => {
    const opts = { fps: FPS, normalize: false };
    const subsonic = coneMotion(sine(5, 0.5, 4), SR, opts);
    const bass = coneMotion(sine(45, 0.5, 4), SR, opts);
    const peak = (fr: [number, number][]) => Math.max(...fr.slice(30).flat().map(Math.abs));
    expect(peak(subsonic)).toBeLessThan(0.25 * peak(bass));
  });

  test("a bass hit swings the cone, and it settles once the hit is over", () => {
    // 0.3 s burst of 50 Hz starting at 1 s, in 3 s of silence
    const out = coneMotion(sine(50, 0.8, 0.3, 1, 3), SR, { fps: FPS });
    expect(travel(out, 0, 29)).toBeLessThan(0.01);
    expect(travel(out, 31, 39)).toBeGreaterThan(0.5);
    expect(travel(out, 50, 90)).toBeLessThan(0.05);
  });

  test("normalised output stays within -1..1 and loud passages reach near full travel", () => {
    const out = coneMotion(sine(45, 0.9, 3), SR, { fps: FPS });
    const values = out.flat();
    expect(Math.max(...values.map(Math.abs))).toBeLessThanOrEqual(1);
    expect(Math.max(...values)).toBeGreaterThan(0.8);
  });

  test("the mid dome ignores bass and follows its own band", () => {
    const opts = { fps: FPS, normalize: false, ...MID_DOME };
    const bass = coneMotion(sine(50, 0.5, 2), SR, opts);
    const mid = coneMotion(sine(500, 0.5, 2), SR, opts);
    expect(travel(mid, 15, 60)).toBeGreaterThan(10 * travel(bass, 15, 60));
  });

  test("the pair is the exposure's extremes in time order", () => {
    // 50 Hz advances 2/3 of a cycle per 30 fps frame, so exposures catch it rising and falling
    const out = coneMotion(sine(50, 0.8, 2), SR, { fps: FPS, normalize: false });
    const rising = out.slice(15).filter(([a, b]) => b > a).length;
    const falling = out.slice(15).filter(([a, b]) => b < a).length;
    expect(rising).toBeGreaterThan(0);
    expect(falling).toBeGreaterThan(0);
  });
});
