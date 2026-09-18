import { describe, expect, it } from "vitest";
import type { Grid } from "./grid";
import type { ReelState } from "./presets";
import { DEFAULT_LYRICS } from "./lyrics";
import { addHistory, describeLook, lookSignature, matchingReel, type ReelRecord } from "./history";

const grid: Grid = { bpm: 140, offsetMs: 150, beatsPerBar: 4, halftime: true };
const base: ReelState = {
  scene: "void",
  mood: "moody",
  cutsEveryBars: 8,
  cutMarkers: true,
  leadMs: 0,
  fps: 30,
  show: { lanes: { rims: [{ t: 0.15, value: { gain: 1, color: [0.6, 0.03, 0.03] } }] } },
  lyrics: structuredClone(DEFAULT_LYRICS),
};

describe("lookSignature", () => {
  it("is the same for the same look and different when anything that shows changes", () => {
    const a = lookSignature(base, grid);
    expect(lookSignature(structuredClone(base), grid)).toBe(a);
    expect(lookSignature({ ...base, mood: "neon" }, grid)).not.toBe(a);
    expect(lookSignature({ ...base, cutsEveryBars: 4 }, grid)).not.toBe(a);
    const lyrics = structuredClone(base.lyrics);
    lyrics.defaults.style = "pop";
    expect(lookSignature({ ...base, lyrics }, grid)).not.toBe(a);
  });

  it("ignores the lyric lines and reads show cues in bars, so a nudged grid keeps the signature", () => {
    const withLines = structuredClone(base);
    withLines.lyrics.lines = [{ t: 1, tEnd: 2, text: "hello" }];
    expect(lookSignature(withLines, grid)).toBe(lookSignature(base, grid));
    const nudged: Grid = { ...grid, offsetMs: 170 };
    const shifted = structuredClone(base);
    shifted.show.lanes.rims![0]!.t = 0.17; // the same cue, on the nudged downbeat
    expect(lookSignature(shifted, nudged)).toBe(lookSignature(base, grid));
  });
});

describe("history", () => {
  const rec = (n: number, sig: string): ReelRecord => ({ when: 1000 + n, profile: "test", engine: "cycles", signature: sig, summary: `look ${n}` });

  it("keeps the newest first and caps the list", () => {
    let list: ReelRecord[] = [];
    for (let i = 0; i < 25; i++) list = addHistory(list, rec(i, `s${i}`), 20);
    expect(list).toHaveLength(20);
    expect(list[0]!.summary).toBe("look 24");
  });

  it("finds the earlier reel a look repeats, counted from the oldest", () => {
    const list = addHistory(addHistory(addHistory([], rec(1, "a")), rec(2, "b")), rec(3, "a"));
    expect(matchingReel(list, "a")).toEqual({ index: 1, record: expect.objectContaining({ summary: "look 1" }) });
    expect(matchingReel(list, "zzz")).toBeNull();
  });

  it("describes a look in a few words for the status line", () => {
    expect(describeLook(base)).toBe("void · moody · cuts every 8 bars · 1 lane · fade lyrics");
  });
});
