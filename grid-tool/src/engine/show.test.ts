import { describe, expect, it } from "vitest";
import { cueCount, laneAt, lanesFromMood, setCue } from "./show";

describe("laneAt", () => {
  const cues = [
    { t: 2, value: { gain: 1, color: [1, 0, 0] as [number, number, number] }, fade: 1 },
    { t: 6, value: { gain: 0.5, color: [0, 0, 1] as [number, number, number] }, fade: 1 },
  ];
  const fallback = { gain: 0, color: [0, 0, 0] as [number, number, number] };
  it("falls back before the first cue and holds after", () => {
    expect(laneAt(cues, 1, fallback)).toEqual(fallback);
    expect(laneAt(cues, 4, fallback)).toEqual(cues[0]!.value);
    expect(laneAt(cues, 10, fallback)).toEqual(cues[1]!.value);
  });
  it("crossfades numbers and colours over the fade", () => {
    const v = laneAt(cues, 6.5, fallback) as { gain: number; color: number[] };
    expect(v.gain).toBeCloseTo(0.75);
    expect(v.color).toEqual([0.5, 0, 0.5]);
  });
  it("switches cameras hard", () => {
    expect(laneAt([{ t: 3, value: { camera: "Cam2_Woofers" }, fade: 2 }], 3.1, { camera: "Cam1_Wide" })).toEqual({ camera: "Cam2_Woofers" });
  });
});

describe("setCue", () => {
  it("replaces a cue at the same time and keeps order", () => {
    let lane = setCue(undefined, { t: 5, value: { gain: 1 } });
    lane = setCue(lane, { t: 2, value: { gain: 0.5 } });
    lane = setCue(lane, { t: 5.01, value: { gain: 0.2 } });
    expect(lane.map((c) => [c.t, (c.value as { gain: number }).gain])).toEqual([
      [2, 0.5],
      [5.01, 0.2],
    ]);
  });
});

describe("lanesFromMood", () => {
  it("steps the mood's cues on downbeats every cue_bars bars", () => {
    const lanes = lanesFromMood(
      {
        key: { color: [1, 0.8, 0.6], gain: 0.9 },
        cues: [
          { rim: [1, 0, 0], trace: [1, 0, 0] },
          { rim: [0, 0, 1], trace: [0, 0, 1], back_gain: 2 },
        ],
        cue_bars: 2,
        cue_fade: 6,
        smoke: { density_gain: 1.2 },
        shells: { strength: 0.3 },
      },
      [0, 2, 4, 6, 8],
    );
    expect(lanes.rims!.map((c) => c.t)).toEqual([0, 4, 8]);
    expect((lanes.rims![1]!.value as { color: number[] }).color).toEqual([0, 0, 1]);
    expect((lanes.dustback![1]!.value as { gain: number }).gain).toBe(2);
    expect(lanes.rims![0]!.fade).toBeCloseTo(0.2);
    expect(cueCount(lanes)).toBe(12);
  });
});
