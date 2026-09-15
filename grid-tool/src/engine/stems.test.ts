import { describe, expect, it } from "vitest";
import { stemChannel, stemNameOf, wooferStem } from "./stems";
import { synthTestTrack } from "./synth";

describe("stemNameOf", () => {
  it("maps Ableton export names to channels", () => {
    expect(stemNameOf("03 Kick.wav")).toBe("kick");
    expect(stemNameOf("Clap 909.wav")).toBe("snare");
    expect(stemNameOf("Sub Bass.wav")).toBe("bass");
    expect(stemNameOf("Lead Vox dry.wav")).toBe("vocal");
    expect(stemNameOf("Drum Break.wav")).toBe("drums");
    expect(stemNameOf("Weird Thing.wav")).toBe("weird-thing");
  });
});

describe("stemChannel", () => {
  it("peaks on the hits and sits near zero between them", () => {
    const sr = 44100;
    const pcm = synthTestTrack({ bpm: 140, offsetMs: 150, bars: 2, sampleRate: sr });
    const ch = stemChannel(pcm, sr, 30);
    const at = (t: number): number => ch[Math.round(t * 30)]!;
    expect(at(0.16)).toBeGreaterThan(0.5); // the first kick
    expect(at(1.4)).toBeLessThan(0.15); // between hits
    expect(ch.length).toBe(Math.ceil((pcm.length / sr) * 30));
  });
});

describe("wooferStem", () => {
  it("prefers kick, then drums, then bass", () => {
    expect(wooferStem(["bass", "drums", "kick"])).toBe("kick");
    expect(wooferStem(["bass", "drums"])).toBe("drums");
    expect(wooferStem(["vocal"])).toBeNull();
  });
});
