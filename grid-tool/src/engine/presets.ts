// Excursion — templates and presets (spec: docs/superpowers/specs/2026-09-18-templates-and-presets-design.md).
//
// A reel's look is saved as blocks and reused on other tracks: a show block (cue lanes, times in
// bars from the downbeat), a lyric block (defaults and section styles, never lines), a scene
// block (scene, cut cadence, lead, fps) and, on the Blender side, a mood file. A template names
// one block of each kind. Fixed recipes: applying reproduces exactly what was saved.
// Pure functions; main.ts and track-job own the files and the DOM.

import { type Grid, barOf, secOf } from "./grid";
import type { Lyrics } from "./lyrics";
import { type Rig, parseRig } from "./rig";
import { type Room, parseRoom } from "./room";
import type { CueValue, LaneName, Lanes, Show } from "./show";

export type PresetKind = "show" | "lyrics" | "scene" | "template" | "room" | "rig";

export interface BarCue {
  /** bars from the downbeat, fractional */
  bar: number;
  value: CueValue;
  /** crossfade in, seconds */
  fade?: number;
}

export interface ShowBlock {
  kind: "show";
  name: string;
  lanes: Partial<Record<LaneName, BarCue[]>>;
}

export interface LyricBlock {
  kind: "lyrics";
  name: string;
  defaults: Lyrics["defaults"];
  sections?: Lyrics["sections"];
}

export interface SceneBlock {
  kind: "scene";
  name: string;
  scene: string;
  cutsEveryBars: number;
  cutMarkers: boolean;
  leadMs: number;
  fps: number;
}

export interface Template {
  kind: "template";
  name: string;
  /** block names; any may be omitted */
  scene?: string;
  mood?: string;
  show?: string;
  lyrics?: string;
  /** a rig in presets/rigs/ */
  rig?: string;
}

export type Preset = ShowBlock | LyricBlock | SceneBlock | Template | Room | Rig;

/** The slice of per-track state a template sets. Everything else (grid, markers, hits, stems, lines) stays with the track. */
export interface ReelState {
  scene: string;
  mood: string;
  cutsEveryBars: number;
  cutMarkers: boolean;
  leadMs: number;
  fps: number;
  show: Show;
  lyrics: Lyrics;
  /** the rig the reel lights with (absent or "" = the room's own default) */
  rig?: string;
}

export interface Library {
  scenes: Record<string, SceneBlock>;
  shows: Record<string, ShowBlock>;
  lyrics: Record<string, LyricBlock>;
  /** mood names known to the Blender side (blender/moods/*.json) */
  moods: string[];
  /** rigs in presets/rigs/ (optional: older callers leave it out) */
  rigs?: Record<string, Rig>;
}

export interface ResolvedTemplate {
  scene?: SceneBlock;
  mood?: string;
  show?: ShowBlock;
  lyrics?: LyricBlock;
  rig?: string;
}

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KINDS: PresetKind[] = ["show", "lyrics", "scene", "template", "room", "rig"];

/** A file-safe preset name from anything typed: lower-case, dashes. */
export function slugName(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const round = (x: number): number => Math.round(x * 1e6) / 1e6;

export function showToBlock(show: Show, grid: Grid, name: string): ShowBlock {
  const lanes: ShowBlock["lanes"] = {};
  for (const [lane, cues] of Object.entries(show.lanes) as [LaneName, Show["lanes"][LaneName]][]) {
    if (!cues?.length) continue;
    lanes[lane] = cues.map((c) => ({ bar: round(barOf(grid, c.t)), value: c.value, ...(c.fade !== undefined ? { fade: c.fade } : {}) }));
  }
  return { kind: "show", name, lanes };
}

export function blockToShow(block: ShowBlock, grid: Grid): Show {
  const lanes: Lanes = {};
  for (const [lane, cues] of Object.entries(block.lanes) as [LaneName, BarCue[] | undefined][]) {
    if (!cues?.length) continue;
    lanes[lane] = cues
      .map((c) => ({ t: round(secOf(grid, c.bar)), value: c.value, ...(c.fade !== undefined ? { fade: c.fade } : {}) }))
      .sort((a, b) => a.t - b.t);
  }
  return { lanes };
}

export function lyricBlock(lyrics: Lyrics, name: string): LyricBlock {
  return { kind: "lyrics", name, defaults: { ...lyrics.defaults }, ...(lyrics.sections ? { sections: structuredClone(lyrics.sections) } : {}) };
}

export function sceneBlock(state: Pick<ReelState, "scene" | "cutsEveryBars" | "cutMarkers" | "leadMs" | "fps">, name: string): SceneBlock {
  return { kind: "scene", name, scene: state.scene, cutsEveryBars: state.cutsEveryBars, cutMarkers: state.cutMarkers, leadMs: state.leadMs, fps: state.fps };
}

/** Parse and validate a preset file. Throws with a message naming the problem. */
export function parsePreset(json: string): Preset {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const kind = raw["kind"];
  if (typeof kind !== "string" || !KINDS.includes(kind as PresetKind)) throw new Error(`preset kind must be one of ${KINDS.join(", ")}`);
  const name = raw["name"];
  if (typeof name !== "string" || !NAME_RE.test(name)) throw new Error("preset name must be lower-case letters, digits and dashes");
  switch (kind as PresetKind) {
    case "show":
      if (typeof raw["lanes"] !== "object" || raw["lanes"] === null) throw new Error("show block needs lanes");
      return raw as unknown as ShowBlock;
    case "lyrics":
      if (typeof raw["defaults"] !== "object" || raw["defaults"] === null) throw new Error("lyric block needs defaults");
      return raw as unknown as LyricBlock;
    case "scene":
      if (typeof raw["scene"] !== "string") throw new Error("scene block needs a scene");
      return raw as unknown as SceneBlock;
    case "template":
      return raw as unknown as Template;
    case "room":
      return parseRoom(raw);
    case "rig":
      return parseRig(raw);
  }
}

/** Look every named block up in the library; unknown names are listed, not thrown. */
export function resolveTemplate(t: Template, lib: Library): { resolved: ResolvedTemplate; missing: string[] } {
  const resolved: ResolvedTemplate = {};
  const missing: string[] = [];
  if (t.scene !== undefined) {
    const b = lib.scenes[t.scene];
    if (b) resolved.scene = b;
    else missing.push(`scene:${t.scene}`);
  }
  if (t.show !== undefined) {
    const b = lib.shows[t.show];
    if (b) resolved.show = b;
    else missing.push(`show:${t.show}`);
  }
  if (t.mood !== undefined) {
    if (lib.moods.includes(t.mood)) resolved.mood = t.mood;
    else missing.push(`mood:${t.mood}`);
  }
  if (t.lyrics !== undefined) {
    const b = lib.lyrics[t.lyrics];
    if (b) resolved.lyrics = b;
    else missing.push(`lyrics:${t.lyrics}`);
  }
  if (t.rig !== undefined) {
    if (lib.rigs?.[t.rig]) resolved.rig = t.rig;
    else missing.push(`rig:${t.rig}`);
  }
  return { resolved, missing };
}

/** A new reel state with the template's blocks applied; untouched fields come through unchanged. Pure. */
export function applyTemplate(r: ResolvedTemplate, state: ReelState, grid: Grid): ReelState {
  const next: ReelState = { ...state, show: { lanes: { ...state.show.lanes } }, lyrics: { ...state.lyrics, lines: state.lyrics.lines } };
  if (r.scene) {
    next.scene = r.scene.scene;
    next.cutsEveryBars = r.scene.cutsEveryBars;
    next.cutMarkers = r.scene.cutMarkers;
    next.leadMs = r.scene.leadMs;
    next.fps = r.scene.fps;
  }
  if (r.mood !== undefined) next.mood = r.mood;
  if (r.rig !== undefined) next.rig = r.rig;
  if (r.show) next.show = blockToShow(r.show, grid);
  if (r.lyrics) {
    next.lyrics = { ...state.lyrics, defaults: { ...r.lyrics.defaults }, lines: state.lyrics.lines };
    if (r.lyrics.sections) next.lyrics.sections = structuredClone(r.lyrics.sections);
    else delete next.lyrics.sections;
  }
  return next;
}

/** Folder per kind under presets/ (moods stay under blender/moods). */
export const PRESET_DIRS: Record<Exclude<PresetKind, never>, string> = {
  show: "shows",
  lyrics: "lyrics",
  scene: "scenes",
  template: "templates",
  room: "rooms",
  rig: "rigs",
};
