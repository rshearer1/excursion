// Excursion — the show (phase 12): a lighting desk's cue list for the scene. Each lane holds
// cues in time order; a cue's value holds until the next one and crossfades in over its fade.
// Lanes: camera (which camera), key (gain, colour), rims (gain, colour), wall (trace colour),
// dustback (gain), smoke (density, haze gains), shells (strength). A lane that exists in the
// show overrides the mood's own cues in the render; a missing lane leaves the mood in charge.
// Pure: main.ts owns the desk UI, apply_drive.py evaluates the same file in Blender.

export type LaneName = "camera" | "key" | "rims" | "wall" | "dustback" | "smoke" | "shells";
export type Rgb = [number, number, number];

export interface Cue<V = CueValue> {
  /** seconds */
  t: number;
  value: V;
  /** crossfade in, seconds (default 0.25; camera cues switch hard) */
  fade?: number;
}

export type CueValue =
  | { camera: string }
  | { gain: number; color: Rgb }
  | { trace: Rgb }
  | { gain: number }
  | { density: number; haze: number }
  | { strength: number };

export type Lanes = Partial<Record<LaneName, Cue[]>>;

export interface Show {
  lanes: Lanes;
}

export const LANE_INFO: { name: LaneName; label: string; hint: string }[] = [
  { name: "camera", label: "camera", hint: "which camera from this cue on (replaces the round-robin cuts)" },
  { name: "key", label: "key", hint: "the softbox: gain and colour" },
  { name: "rims", label: "rims", hint: "rim and back lights and the uplights: gain and colour" },
  { name: "wall", label: "wall", hint: "the LED wall's trace colour" },
  { name: "dustback", label: "dust back", hint: "the dust backlight's gain" },
  { name: "smoke", label: "smoke", hint: "density and haze gains on the mood's smoke" },
  { name: "shells", label: "shells", hint: "pressure-wave strength (0 = off)" },
];

/** Default value per lane, used for the faders before any cue exists. */
export const LANE_DEFAULTS: Record<LaneName, CueValue> = {
  camera: { camera: "Cam1_Wide" },
  key: { gain: 1, color: [1, 0.84, 0.66] },
  rims: { gain: 1, color: [0.6, 0.03, 0.03] },
  wall: { trace: [1, 0.22, 0.16] },
  dustback: { gain: 1 },
  smoke: { density: 1, haze: 1 },
  shells: { strength: 0.3 },
};

const DEFAULT_FADE = 0.25;

function blendValue(a: CueValue, b: CueValue, k: number): CueValue {
  const out: Record<string, unknown> = { ...(b as Record<string, unknown>) };
  for (const [key, bv] of Object.entries(b as Record<string, unknown>)) {
    const av = (a as Record<string, unknown>)[key];
    if (typeof bv === "number" && typeof av === "number") out[key] = av + (bv - av) * k;
    else if (Array.isArray(bv) && Array.isArray(av) && bv.length === av.length) out[key] = bv.map((x, i) => (av[i] as number) + ((x as number) - (av[i] as number)) * k);
  }
  return out as CueValue;
}

/** The lane's value at time t: the latest cue, crossfaded in from the one before it. */
export function laneAt(cues: Cue[] | undefined, t: number, fallback: CueValue): CueValue {
  if (!cues?.length) return fallback;
  const sorted = [...cues].sort((a, b) => a.t - b.t);
  let idx = -1;
  for (let i = 0; i < sorted.length; i++) if (sorted[i]!.t <= t) idx = i;
  if (idx < 0) return fallback;
  const cur = sorted[idx]!;
  const prev = idx > 0 ? sorted[idx - 1]!.value : fallback;
  const fade = cur.fade ?? DEFAULT_FADE;
  if ("camera" in cur.value || fade <= 0) return cur.value;
  const k = Math.min(1, (t - cur.t) / fade);
  return k >= 1 ? cur.value : blendValue(prev, cur.value, k);
}

/** Add a cue at t (replacing one within 1/30 s), keeping the lane sorted. */
export function setCue(cues: Cue[] | undefined, cue: Cue): Cue[] {
  const kept = (cues ?? []).filter((c) => Math.abs(c.t - cue.t) > 1 / 30);
  return [...kept, cue].sort((a, b) => a.t - b.t);
}

/** Lanes filled from a mood JSON, so the desk starts where the mood is. cue_bars steps the cue list on downbeats. */
export function lanesFromMood(
  mood: {
    key?: { color?: Rgb; gain?: number };
    cues?: { rim: Rgb; rim_gain?: number; back_gain?: number; trace: Rgb }[];
    cue_bars?: number;
    cue_fade?: number;
    smoke?: { density_gain?: number; haze_gain?: number };
    shells?: { strength?: number };
    dust_back_gain?: number;
  },
  downbeats: number[],
  fps = 30,
): Lanes {
  const lanes: Lanes = {};
  if (mood.key) lanes.key = [{ t: 0, value: { gain: mood.key.gain ?? 1, color: mood.key.color ?? [1, 0.84, 0.66] } }];
  if (mood.smoke) lanes.smoke = [{ t: 0, value: { density: mood.smoke.density_gain ?? 1, haze: mood.smoke.haze_gain ?? 1 } }];
  if (mood.shells) lanes.shells = [{ t: 0, value: { strength: mood.shells.strength ?? 0 } }];
  const cues = mood.cues ?? [];
  if (cues.length) {
    const bars = Math.max(1, mood.cue_bars ?? 2);
    const fade = (mood.cue_fade ?? 6) / fps;
    const steps = cues.length > 1 ? downbeats.filter((_, i) => i % bars === 0) : [0];
    lanes.rims = [];
    lanes.wall = [];
    lanes.dustback = [];
    steps.forEach((t, i) => {
      const c = cues[i % cues.length]!;
      lanes.rims!.push({ t, value: { gain: c.rim_gain ?? 1, color: c.rim }, fade });
      lanes.wall!.push({ t, value: { trace: c.trace }, fade });
      lanes.dustback!.push({ t, value: { gain: (c.back_gain ?? 1) * (mood.dust_back_gain ?? 1) }, fade });
    });
  }
  return lanes;
}

/** Cue count across lanes, for the status line. */
export function cueCount(lanes: Lanes): number {
  return Object.values(lanes).reduce((n, l) => n + (l?.length ?? 0), 0);
}
