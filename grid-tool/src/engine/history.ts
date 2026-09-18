// Excursion — reel history: what each render or export of a track looked like, so a new reel
// can be checked against the old ones instead of hoped to be different. A look is the
// template-able state (scene, mood, cuts, show cues in bars, lyric styling); the lyric lines
// and the grid itself are the track's, not the look's.

import { type Grid, barOf } from "./grid";
import type { ReelState } from "./presets";

export interface ReelRecord {
  /** ms since epoch */
  when: number;
  profile: string;
  engine: string;
  signature: string;
  summary: string;
}

const r3 = (x: number): number => Math.round(x * 1000) / 1000;

/** A short stable string for a look: same look, same signature; any visible change, a new one. */
export function lookSignature(s: ReelState, grid: Grid): string {
  const lanes = Object.entries(s.show.lanes)
    .filter(([, cues]) => cues?.length)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([lane, cues]) => `${lane}=` + cues!.map((c) => `${r3(barOf(grid, c.t))}:${JSON.stringify(c.value)}${c.fade !== undefined ? `~${r3(c.fade)}` : ""}`).join(","));
  const lyrics = JSON.stringify({ d: s.lyrics.defaults, s: s.lyrics.sections ?? {} });
  const parts = [s.scene, s.mood, `cuts${s.cutsEveryBars}${s.cutMarkers ? "+m" : ""}`, `lead${s.leadMs}`, `fps${s.fps}`, ...lanes, lyrics];
  // FNV-1a over the joined parts: short, stable, no dependency
  let h = 0x811c9dc5;
  const text = parts.join("|");
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** A few words for the status line and the history chips. */
export function describeLook(s: ReelState): string {
  const lanes = Object.values(s.show.lanes).filter((l) => l?.length).length;
  return [s.scene, s.mood, s.cutsEveryBars ? `cuts every ${s.cutsEveryBars} bars` : "no cuts", `${lanes} lane${lanes === 1 ? "" : "s"}`, `${s.lyrics.defaults.style} lyrics`].join(" · ");
}

/** Newest first, capped. */
export function addHistory(list: ReelRecord[], rec: ReelRecord, max = 20): ReelRecord[] {
  return [rec, ...list].slice(0, max);
}

/** The earliest reel with this signature: its 1-based number counted from the oldest, and the record. */
export function matchingReel(list: ReelRecord[], signature: string): { index: number; record: ReelRecord } | null {
  const oldestFirst = [...list].reverse();
  const i = oldestFirst.findIndex((r) => r.signature === signature);
  return i < 0 ? null : { index: i + 1, record: oldestFirst[i]! };
}
