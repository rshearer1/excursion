import { type Grid, beatTimes, beatPhaseAt } from "./grid";
import type { FrameFeatures } from "./features";
import { envelopeFollow } from "./envelope";
import { autoGain } from "./autogain";

export interface DriveFrame {
  bass: number;
  mid: number;
  high: number;
  onset: 0 | 1;
  beatPhase: number;
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
  range?: { start: number; end: number };
  sections?: { t: number; kind: string }[];
  cuts?: number[];
  /** Shift grid events (beats, cuts, sections) this many ms EARLY, for visual anticipation. */
  leadMs?: number;
  tuning?: DriveTuning;
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

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
    range,
    sections = [],
    cuts = [],
    leadMs = 0,
    tuning = {},
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
    frames,
  };
}
