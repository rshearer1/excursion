// Excursion — the lyric lane (phase 10): timed lines with optional word times, the styles the
// Blender side keys, .lrc import (plain and enhanced word tags), tapping lines in on playback,
// and quantising word onsets to the 16th grid. Pure functions; main.ts owns the UI.
import { type Grid, beatDurationSec } from "./grid";

export type LyricStyle = "fade" | "karaoke" | "pop" | "pulse" | "typewriter";
export type LyricSize = "S" | "M" | "L";

export const LYRIC_STYLES: { value: LyricStyle; label: string; hint: string }[] = [
  { value: "fade", label: "fade", hint: "glows in at the line's start, out at its end" },
  { value: "karaoke", label: "karaoke", hint: "words light up one by one as they are sung" },
  { value: "pop", label: "pop", hint: "each word flashes on its onset, then settles" },
  { value: "pulse", label: "pulse", hint: "the whole line breathes with the bass" },
  { value: "typewriter", label: "typewriter", hint: "letters appear on the 16th grid" },
];

/** Anchors each scene offers; the Blender scene carries an empty per name (Lyric_<anchor>). */
export const LYRIC_ANCHORS: Record<string, string[]> = {
  void: ["behind", "front-low", "wall"],
  concrete: ["wall-left", "wall-right", "wall-top"],
  macro: [],
  stack: ["behind"],
};

export const LYRIC_COLORS = ["accent", "cyan", "white", "red"];

export interface LyricWord {
  t: number;
  w: string;
}

export interface LyricLine {
  t: number;
  tEnd: number;
  text: string;
  words?: LyricWord[];
  anchor?: string;
  style?: LyricStyle;
  color?: string;
  size?: LyricSize;
}

export interface LyricDefaults {
  anchor: string;
  style: LyricStyle;
  color: string;
  size: LyricSize;
  attackMs: number;
  releaseMs: number;
  lightRoom: boolean;
}

export interface Lyrics {
  defaults: LyricDefaults;
  /** Per-section style overrides by marker kind, e.g. { drop: { style: "pop" } }. */
  sections?: Record<string, Partial<Pick<LyricLine, "style" | "color" | "size" | "anchor">>>;
  lines: LyricLine[];
}

export const DEFAULT_LYRICS: Lyrics = {
  defaults: { anchor: "behind", style: "fade", color: "accent", size: "M", attackMs: 80, releaseMs: 400, lightRoom: true },
  sections: { drop: { style: "pop", color: "white", size: "L" } },
  lines: [],
};

const TAG = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
const WORD_TAG = /<(\d+):(\d+(?:\.\d+)?)>/g;
const toSec = (m: string, s: string): number => Number(m) * 60 + Number(s);

/** Parse an .lrc file: "[mm:ss.xx] line", several tags per line allowed, enhanced "<mm:ss.xx>word"
 *  word tags kept as word times. Lines without a tag are ignored; untimed ends get filled. */
export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const times: number[] = [];
    let rest = raw.replace(TAG, (_m, mm: string, ss: string) => {
      times.push(toSec(mm, ss));
      return "";
    });
    if (!times.length) continue;
    const words: LyricWord[] = [];
    if (WORD_TAG.test(rest)) {
      WORD_TAG.lastIndex = 0;
      const parts = rest.split(WORD_TAG); // [lead, mm, ss, word, mm, ss, word, ...]
      for (let i = 1; i + 2 < parts.length + 1; i += 3) {
        const w = (parts[i + 2] ?? "").trim();
        if (w) words.push({ t: toSec(parts[i]!, parts[i + 1]!), w });
      }
      rest = words.map((w) => w.w).join(" ");
    }
    const textOut = rest.trim();
    if (!textOut) continue;
    for (const t of times) {
      lines.push({ t, tEnd: t, text: textOut, ...(words.length ? { words: words.map((w) => ({ ...w })) } : {}) });
    }
  }
  return fillEnds(lines.sort((a, b) => a.t - b.t));
}

/** Give every line an end: the next line's start, capped at maxHold seconds, or start + maxHold. */
export function fillEnds(lines: LyricLine[], maxHold = 4): LyricLine[] {
  const sorted = [...lines].sort((a, b) => a.t - b.t);
  return sorted.map((line, i) => {
    if (line.tEnd > line.t) return line;
    const next = sorted[i + 1];
    const end = next ? Math.min(next.t, line.t + maxHold) : line.t + maxHold;
    return { ...line, tEnd: Math.max(line.t + 0.3, end) };
  });
}

/** Plain typed lines (one per row) become untimed lines to tap in; t = -1 marks "not yet". */
export function linesFromText(text: string): LyricLine[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({ t: -1, tEnd: -1, text: s }));
}

/** Tap: stamp the first untimed line at t (and close the previous line there). */
export function tapLine(lines: LyricLine[], t: number): LyricLine[] {
  const idx = lines.findIndex((l) => l.t < 0);
  if (idx < 0) return lines;
  const out = lines.map((l) => ({ ...l }));
  out[idx]!.t = t;
  out[idx]!.tEnd = t;
  const prev = out[idx - 1];
  if (prev && prev.t >= 0 && prev.tEnd <= prev.t) prev.tEnd = Math.max(prev.t + 0.3, t);
  return out;
}

/** Nearest 16th-note grid time. */
export function quantiseTime(t: number, grid: Grid, division = 4): number {
  const step = beatDurationSec(grid) / division;
  const offset = grid.offsetMs / 1000;
  return offset + Math.round((t - offset) / step) * step;
}

/** Snap line starts and word onsets to 16ths; ends move with their starts. */
export function quantiseLyrics(lines: LyricLine[], grid: Grid): LyricLine[] {
  return lines.map((l) => {
    if (l.t < 0) return l;
    const t = quantiseTime(l.t, grid);
    const shift = t - l.t;
    return {
      ...l,
      t,
      tEnd: l.tEnd > l.t ? l.tEnd + shift : t,
      ...(l.words ? { words: l.words.map((w) => ({ ...w, t: quantiseTime(w.t, grid) })) } : {}),
    };
  });
}

/** Lines in time order with an end, ready for drive.json; untimed lines are left out. */
export function exportLyrics(lyrics: Lyrics): Lyrics {
  return { ...lyrics, lines: fillEnds(lyrics.lines.filter((l) => l.t >= 0 && l.text.trim())) };
}

/** Which line is live at time t, for the lane and the preview. */
export function lineAt(lines: LyricLine[], t: number): LyricLine | null {
  return lines.find((l) => l.t >= 0 && t >= l.t && t < l.tEnd) ?? null;
}
