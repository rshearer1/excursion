import { describe, expect, it } from "vitest";
import { etaSeconds, formatDuration, parseProgressLine, slugify, totalFrames } from "./renderJob";

describe("slugify", () => {
  it("makes a job name from a track filename", () => {
    expect(slugify("MiXX-Repressed Emotion Instrumental 120bpm.wav")).toBe("mixx-repressed-emotion-instrumental-120bpm");
    expect(slugify("ALEX PEREZ.mp3")).toBe("alex-perez");
    expect(slugify("  .wav")).toBe("track");
  });
});

describe("totalFrames", () => {
  const drive = { fps: 30, frames: new Array(4080), audio: { file: "x.wav" } };
  it("is the whole drive without a range", () => {
    expect(totalFrames(drive)).toBe(4080);
  });
  it("is the trimmed window with one", () => {
    expect(totalFrames({ ...drive, range: { start: 64, end: 74 } })).toBe(300);
  });
});

describe("parseProgressLine", () => {
  it("reads a saved frame", () => {
    expect(parseProgressLine("00:12.875  render           | Saved: 'C:\\Users\\x\\frames\\re\\1921.png'")).toEqual({ frame: 1921 });
  });
  it("reads the finished reel", () => {
    expect(parseProgressLine("done: C:\\Users\\x\\out\\re.mp4")).toEqual({ reel: "C:\\Users\\x\\out\\re.mp4" });
  });
  it("flags failures and ignores the rest", () => {
    expect(parseProgressLine("Error: spawn blender ENOENT")).toEqual({ error: "Error: spawn blender ENOENT" });
    expect(parseProgressLine("Fra:1921 Mem:900M | Sample 12/32")).toBeNull();
  });
});

describe("eta", () => {
  it("extrapolates from the frames done so far", () => {
    expect(etaSeconds({ done: 10, total: 300, startedAt: 0 }, 30_000)).toBe(870);
    expect(etaSeconds({ done: 0, total: 300, startedAt: 0 }, 30_000)).toBeNull();
  });
  it("formats", () => {
    expect(formatDuration(42)).toBe("42 s");
    expect(formatDuration(870)).toBe("15 min");
    expect(formatDuration(3900)).toBe("1 h 05");
  });
});
