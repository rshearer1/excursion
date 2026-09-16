import { type Grid, beatTimes, beatPhaseAt } from "./grid";
import type { FrameFeatures } from "./features";
import { envelopeFollow } from "./envelope";
import { autoGain } from "./autogain";
import type { Lyrics } from "./lyrics";
import type { Hits } from "./hits";
import type { Show } from "./show";

export interface DriveFrame {
  bass: number;
  mid: number;
  high: number;
  onset: 0 | 1;
  beatPhase: number;
  /** Woofer cone extremes during this frame's exposure, time-ordered, -1..1 (see cone.ts). */
  cone?: [number, number];
  /** Mid dome extremes, same convention, from the mid band through MID_DOME. */
  dome?: [number, number];
}

export interface DriveJson {
  audio: { file: string; sha1: string; duration: number };
  grid: { bpm: number; offsetMs: number; beatsPerBar: number; halftime: boolean };
  fps: number;
  scene: string;
  mood: string;
  beats: number[];
  downbeats: number[];
  /** Camera-cut times (seconds); empty when no cadence or markers were set. */
  cuts: number[];
  /** User-placed markers (drop/break), lead-shifted like all grid events. */
  sections: { t: number; kind: string }[];
  /** Render/audio trim window in seconds; absent = whole track. */
  range?: { start: number; end: number };
  /** Timed lyric lines for the scene's anchors (phase 10); absent when the lane is empty. */
  lyrics?: Lyrics;
  /** Kick and snare hit times in seconds (phase 09), lead-shifted; absent when not tracked. */
  events?: { kick: number[]; snare: number[] };
  /** Per-stem envelopes (phase 08), one value per frame, 0..1; a mood's routing picks targets. */
  channels?: Record<string, number[]>;
  /** The desk's cue lanes (phase 12), lead-shifted; a lane present here overrides the mood's cues. */
  show?: Show;
  frames: DriveFrame[];
}

export interface DriveTuning {
  /** Envelope attack factor per frame (default 0.6). */
  attack?: number;
  /** Envelope release for mid/high (default 0.3). */
  release?: number;
  /** Slower release for bass so subs breathe (default 0.12). */
  bassRelease?: number;
  /** Normalised flux level above which a frame counts as an onset (default 0.5). */
  onsetThreshold?: number;
  /** Manual gain trim multiplier (default 1). */
  trim?: number;
}

export interface BuildDriveInput {
  fileName: string;
  sha1: string;
  durationSec: number;
  grid: Grid;
  fps: number;
  scene: string;
  mood: string;
  features: FrameFeatures;
  /** Per-frame cone motion from coneMotion(); frames carry it as `cone` when given. */
  cone?: [number, number][];
  /** Per-frame mid-dome motion from coneMotion(pcm, sr, MID_DOME); frames carry it as `dome`. */
  dome?: [number, number][];
  range?: { start: number; end: number };
  sections?: { t: number; kind: string }[];
  cuts?: number[];
  /** Shift grid events (beats, cuts, sections) this many ms EARLY, for visual anticipation. */
  leadMs?: number;
  tuning?: DriveTuning;
  lyrics?: Lyrics;
  /** Tracked hits; only those at or above minConf are exported. */
  hits?: Hits;
  minConf?: number;
  channels?: Record<string, number[]>;
  show?: Show;
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const round4 = (x: number): number => Math.round(x * 1e4) / 1e4 + 0;

/** Assemble the drive.json payload the Blender side consumes. */
export function buildDrive(input: BuildDriveInput): DriveJson {
  const {
    fileName,
    sha1,
    durationSec,
    grid,
    fps,
    scene,
    mood,
    features,
    cone,
    dome,
    range,
    sections = [],
    cuts = [],
    leadMs = 0,
    tuning = {},
    lyrics,
    hits,
    minConf = 0.5,
    channels,
    show,
  } = input;
  const {
    attack = 0.6,
    release = 0.3,
    bassRelease = 0.12,
    onsetThreshold = 0.5,
    trim = 1,
  } = tuning;

  const gain = { percentile: 0.95, target: 0.9, trim };
  const bass = autoGain(envelopeFollow(features.bass, attack, bassRelease), gain);
  const mid = autoGain(envelopeFollow(features.mid, attack, release), gain);
  const high = autoGain(envelopeFollow(features.high, attack, release), gain);
  const fluxNorm = autoGain(features.flux, gain);

  const lead = leadMs / 1000;
  const shift = (t: number): number => Math.max(0, t - lead);

  const beats = beatTimes(grid, durationSec);
  const frames: DriveFrame[] = [];
  for (let f = 0; f < features.frameCount; f++) {
    const phase = round6(beatPhaseAt(grid, f / fps));
    frames.push({
      bass: round6(bass[f]!),
      mid: round6(mid[f]!),
      high: round6(high[f]!),
      onset: fluxNorm[f]! > onsetThreshold ? 1 : 0,
      beatPhase: phase >= 1 ? 0.999999 : phase,
      ...(cone?.[f] ? { cone: [round4(cone[f]![0]), round4(cone[f]![1])] as [number, number] } : {}),
      ...(dome?.[f] ? { dome: [round4(dome[f]![0]), round4(dome[f]![1])] as [number, number] } : {}),
    });
  }

  return {
    audio: { file: fileName, sha1, duration: durationSec },
    grid: {
      bpm: grid.bpm,
      offsetMs: grid.offsetMs,
      beatsPerBar: grid.beatsPerBar,
      halftime: grid.halftime,
    },
    fps,
    scene,
    mood,
    beats: beats.map((b) => shift(b.t)),
    downbeats: beats.filter((b) => b.downbeat).map((b) => shift(b.t)),
    cuts: cuts.map(shift),
    sections: sections.map((s) => ({ t: shift(s.t), kind: s.kind })),
    ...(range ? { range } : {}),
    ...(channels && Object.keys(channels).length ? { channels } : {}),
    ...(show && Object.values(show.lanes).some((l) => l?.length)
      ? { show: { lanes: Object.fromEntries(Object.entries(show.lanes).filter(([, l]) => l?.length).map(([k, l]) => [k, l!.map((c) => ({ ...c, t: shift(c.t) }))])) } }
      : {}),
    ...(hits
      ? {
          events: {
            kick: hits.kick.filter((h) => h.conf >= minConf).map((h) => shift(h.t)),
            snare: hits.snare.filter((h) => h.conf >= minConf).map((h) => shift(h.t)),
          },
        }
      : {}),
    ...(lyrics && lyrics.lines.length
      ? {
          lyrics: {
            ...lyrics,
            lines: lyrics.lines.map((l) => ({
              ...l,
              t: shift(l.t),
              tEnd: shift(l.tEnd),
              ...(l.words ? { words: l.words.map((w) => ({ ...w, t: shift(w.t) })) } : {}),
            })),
          },
        }
      : {}),
    frames,
  };
}
