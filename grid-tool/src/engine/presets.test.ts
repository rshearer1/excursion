import { describe, expect, it } from "vitest";
import type { Grid } from "./grid";
import { barOf, secOf } from "./grid";
import type { Lyrics } from "./lyrics";
import type { Show } from "./show";
import {
  applyTemplate,
  blockToShow,
  lyricBlock,
  parsePreset,
  resolveTemplate,
  sceneBlock,
  showToBlock,
  type ReelState,
  type SceneBlock,
  type ShowBlock,
  type Template,
} from "./presets";

const grid: Grid = { bpm: 140, offsetMs: 150, beatsPerBar: 4, halftime: true };
const BAR = (60 / 140) * 4;

describe("bars", () => {
  it("bar 0 is the downbeat and bar 1 is one bar later", () => {
    expect(secOf(grid, 0)).toBeCloseTo(0.15, 9);
    expect(secOf(grid, 1)).toBeCloseTo(0.15 + BAR, 9);
    expect(barOf(grid, 0.15 + BAR)).toBeCloseTo(1, 9);
  });

  it("round-trips with a different beats-per-bar", () => {
    const g3: Grid = { ...grid, beatsPerBar: 3 };
    const t = 12.345;
    expect(secOf(g3, barOf(g3, t))).toBeCloseTo(t, 9);
  });
});

const show: Show = {
  lanes: {
    camera: [{ t: 0.15, value: { camera: "Cam1_Wide" } }, { t: 0.15 + 4 * BAR, value: { camera: "Cam3_Close" } }],
    key: [{ t: 0.15 + 2 * BAR, value: { gain: 0.6, color: [1, 0.2, 0.1] }, fade: 0.5 }],
  },
};

describe("show block", () => {
  it("stores cue times in bars from the downbeat and keeps values and fades", () => {
    const block = showToBlock(show, grid, "moody-cues");
    expect(block.kind).toBe("show");
    expect(block.name).toBe("moody-cues");
    expect(block.lanes.camera?.map((c) => c.bar)).toEqual([0, 4]);
    expect(block.lanes.key?.[0]).toEqual({ bar: 2, value: { gain: 0.6, color: [1, 0.2, 0.1] }, fade: 0.5 });
  });

  it("applies to another track's grid: the same bars land at that grid's seconds", () => {
    const block = showToBlock(show, grid, "x");
    const slow: Grid = { bpm: 120, offsetMs: 500, beatsPerBar: 4, halftime: true };
    const out = blockToShow(block, slow);
    expect(out.lanes.camera?.[1]?.t).toBeCloseTo(0.5 + 4 * 2, 5); // bar 4 at 120 BPM = 8 s after the downbeat
    expect(out.lanes.key?.[0]?.fade).toBe(0.5);
    expect("camera" in (out.lanes.camera?.[0]?.value ?? {})).toBe(true);
  });
});

const lyrics: Lyrics = {
  defaults: { anchor: "wall", style: "karaoke", color: "cyan", size: "L", attackMs: 50, releaseMs: 300, lightRoom: false },
  sections: { drop: { style: "pop" } },
  lines: [{ t: 1, tEnd: 2, text: "low end calling" }],
};

describe("lyric block", () => {
  it("carries defaults and sections but never lines", () => {
    const block = lyricBlock(lyrics, "wall-karaoke");
    expect(block.kind).toBe("lyrics");
    expect(block.defaults.style).toBe("karaoke");
    expect(block.sections).toEqual({ drop: { style: "pop" } });
    expect("lines" in block).toBe(false);
  });
});

describe("parsePreset", () => {
  it("rejects an unknown kind and a bad name", () => {
    expect(() => parsePreset(JSON.stringify({ kind: "banana", name: "x" }))).toThrow(/kind/);
    expect(() => parsePreset(JSON.stringify({ kind: "template", name: "Has Spaces" }))).toThrow(/name/);
  });

  it("accepts a template with block names", () => {
    const t = parsePreset(JSON.stringify({ kind: "template", name: "club-night", scene: "void-8bar", mood: "moody", show: "moody-cues", lyrics: "wall-karaoke" })) as Template;
    expect(t.kind).toBe("template");
    expect(t.show).toBe("moody-cues");
  });
});

const state: ReelState = {
  scene: "concrete",
  mood: "neon",
  cutsEveryBars: 16,
  cutMarkers: false,
  leadMs: 20,
  fps: 60,
  show: { lanes: { shells: [{ t: 3, value: { strength: 0.9 } }] } },
  lyrics,
};

describe("templates", () => {
  const scene: SceneBlock = { kind: "scene", name: "void-8bar", scene: "void", cutsEveryBars: 8, cutMarkers: true, leadMs: 0, fps: 30 };
  const showBlock: ShowBlock = showToBlock(show, grid, "moody-cues");
  const lyricsBlock = lyricBlock(lyrics, "wall-karaoke");
  const template: Template = { kind: "template", name: "club-night", scene: "void-8bar", mood: "moody", show: "moody-cues", lyrics: "wall-karaoke" };
  const library = { scenes: { "void-8bar": scene }, shows: { "moody-cues": showBlock }, lyrics: { "wall-karaoke": lyricsBlock }, moods: ["moody", "neon"] };

  it("resolves block names and reports the ones that are missing", () => {
    const ok = resolveTemplate(template, library);
    expect(ok.missing).toEqual([]);
    expect(ok.resolved.scene?.scene).toBe("void");
    const broken = resolveTemplate({ ...template, show: "nope", mood: "ghost" }, library);
    expect(broken.missing).toEqual(["show:nope", "mood:ghost"]);
    expect(broken.resolved.show).toBeUndefined();
  });

  it("applying sets the reel fields and leaves the track's lyric lines alone", () => {
    const { resolved } = resolveTemplate(template, library);
    const next = applyTemplate(resolved, state, grid);
    expect(next.scene).toBe("void");
    expect(next.mood).toBe("moody");
    expect(next.cutsEveryBars).toBe(8);
    expect(next.fps).toBe(30);
    expect(next.show.lanes.camera?.[1]?.t).toBeCloseTo(0.15 + 4 * BAR, 5); // cue seconds are stored to the microsecond
    expect(next.show.lanes.shells).toBeUndefined(); // the template's show replaces the desk
    expect(next.lyrics.defaults.style).toBe("karaoke");
    expect(next.lyrics.lines).toEqual(lyrics.lines);
    expect(state.scene).toBe("concrete"); // pure: the input is untouched
  });

  it("a partial template only touches the blocks it names", () => {
    const { resolved } = resolveTemplate({ kind: "template", name: "just-lights", show: "moody-cues" }, library);
    const next = applyTemplate(resolved, state, grid);
    expect(next.scene).toBe("concrete");
    expect(next.mood).toBe("neon");
    expect(next.lyrics).toEqual(lyrics);
    expect(next.show.lanes.key?.length).toBe(1);
  });

  it("sceneBlock captures the reel's scene settings", () => {
    const b = sceneBlock(state, "concrete-16");
    expect(b).toEqual({ kind: "scene", name: "concrete-16", scene: "concrete", cutsEveryBars: 16, cutMarkers: false, leadMs: 20, fps: 60 });
  });
});
