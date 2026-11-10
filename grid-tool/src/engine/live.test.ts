import { describe, expect, it } from "vitest";
import { liveLanes } from "./live";
import type { Show } from "./show";

describe("live lanes", () => {
  const show: Show = { lanes: { rims: [{ t: 1, value: { gain: 0.5, color: [1, 0, 0] }, fade: 0 }, { t: 2, value: { gain: 1.5, color: [0, 0, 1] }, fade: 1 }] } };

  it("plays a lane's cues at the playhead, crossfades included", () => {
    expect(liveLanes(show, {}, 1.5).rims).toEqual({ gain: 0.5, color: [1, 0, 0] });
    const mid = liveLanes(show, {}, 2.5).rims as { gain: number };
    expect(mid.gain).toBeCloseTo(1.0);
    expect(liveLanes(show, {}, 0).rims).toEqual({ gain: 0.5, color: [1, 0, 0] }); // before the first cue: the first cue
  });

  it("sends a touched fader for a lane with no cues and leaves untouched lanes out", () => {
    const out = liveLanes(show, { key: { gain: 2, color: [1, 1, 1] } }, 1);
    expect(out.key).toEqual({ gain: 2, color: [1, 1, 1] });
    expect(out).not.toHaveProperty("wall");
    expect(out).not.toHaveProperty("camera");
  });
});
