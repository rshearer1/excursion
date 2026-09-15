import { describe, expect, it } from "vitest";
import { exportLyrics, fillEnds, lineAt, linesFromText, parseLrc, quantiseLyrics, tapLine, DEFAULT_LYRICS } from "./lyrics";

const grid = { bpm: 120, offsetMs: 0, beatsPerBar: 4, halftime: false };

describe("parseLrc", () => {
  it("reads plain timed lines and fills the ends", () => {
    const lines = parseLrc("[ti:x]\n[00:12.43] low end calling\n[00:15.10] under the floor\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ t: 12.43, tEnd: 15.1, text: "low end calling" });
    expect(lines[1]!.tEnd).toBeCloseTo(19.1);
  });
  it("keeps enhanced word tags", () => {
    const [line] = parseLrc("[00:12.43] <00:12.43>low <00:12.71>end <00:13.20>calling");
    expect(line!.text).toBe("low end calling");
    expect(line!.words).toEqual([
      { t: 12.43, w: "low" },
      { t: 12.71, w: "end" },
      { t: 13.2, w: "calling" },
    ]);
  });
  it("repeats a line for several tags", () => {
    const lines = parseLrc("[00:01.00][00:09.00] again");
    expect(lines.map((l) => l.t)).toEqual([1, 9]);
  });
});

describe("tapping", () => {
  it("stamps untimed lines in order and closes the previous one", () => {
    let lines = linesFromText("one\ntwo\n\nthree");
    expect(lines).toHaveLength(3);
    lines = tapLine(lines, 4);
    lines = tapLine(lines, 6.5);
    expect(lines[0]).toMatchObject({ t: 4, tEnd: 6.5 });
    expect(lines[1]).toMatchObject({ t: 6.5, tEnd: 6.5 });
    expect(lines[2]!.t).toBe(-1);
    expect(exportLyrics({ ...DEFAULT_LYRICS, lines }).lines).toHaveLength(2);
  });
});

describe("quantise", () => {
  it("snaps starts and words to 16ths at 120 bpm (125 ms)", () => {
    const [l] = quantiseLyrics([{ t: 1.06, tEnd: 2.06, text: "x", words: [{ t: 1.06, w: "x" }] }], grid);
    expect(l!.t).toBeCloseTo(1.0);
    expect(l!.tEnd).toBeCloseTo(2.0);
    expect(l!.words![0]!.t).toBeCloseTo(1.0);
  });
});

describe("lineAt", () => {
  it("finds the live line", () => {
    const lines = fillEnds([
      { t: 1, tEnd: 0, text: "a" },
      { t: 3, tEnd: 0, text: "b" },
    ]);
    expect(lineAt(lines, 2)?.text).toBe("a");
    expect(lineAt(lines, 3.5)?.text).toBe("b");
    expect(lineAt(lines, 9)).toBeNull();
  });
});
