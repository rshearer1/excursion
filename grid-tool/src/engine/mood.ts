// Excursion — the mood file, editable in the app. A mood is blender/moods/<name>.json: the
// baseline the show desk's lanes sit on (key, cue list, smoke, shells), the grade, exposure
// and the routing matrix. apply_drive.py reads it at apply time. This module is the schema
// the mood panel is generated from, plus parse/serialise; main.ts owns the form and the files.

export type Rgb = [number, number, number];

export interface MoodCue {
  rim: Rgb;
  rim_gain: number;
  back_gain: number;
  trace: Rgb;
}

export interface Mood {
  name: string;
  description: string;
  exposure: number;
  key: { color: Rgb; gain: number };
  graze_gain: number;
  dust_back_gain: number;
  cues: MoodCue[];
  cue_bars: number;
  cue_fade: number;
  smoke: { show: boolean; density_gain: number; haze_gain: number };
  grade: {
    bloom: number;
    chromatic: number;
    black_lift: number;
    gain: Rgb;
    lift: Rgb;
    saturation: number;
    vignette: number;
    grain: number;
  };
  shells: { show: boolean; strength: number };
  /** target -> "channels.<name>"; absent target = the mix's bass band */
  routing: Partial<Record<"key" | "smoke" | "wash", string>>;
}

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const MOOD_DEFAULTS: Omit<Mood, "name"> = {
  description: "",
  exposure: 0,
  key: { color: [1, 0.84, 0.66], gain: 1 },
  graze_gain: 1,
  dust_back_gain: 1,
  cues: [],
  cue_bars: 2,
  cue_fade: 6,
  smoke: { show: true, density_gain: 1, haze_gain: 1 },
  grade: { bloom: 0.08, chromatic: 0.006, black_lift: 0.02, gain: [1, 1, 1], lift: [1, 1, 1], saturation: 1, vignette: 0.075, grain: 0.006 },
  shells: { show: true, strength: 0.3 },
  routing: {},
};

export const DEFAULT_CUE: MoodCue = { rim: [0.6, 0.03, 0.03], rim_gain: 1, back_gain: 1, trace: [1, 0.22, 0.16] };

export type FieldKind = "number" | "color" | "bool" | "route" | "text";

export interface MoodField {
  path: string;
  label: string;
  group: string;
  kind: FieldKind;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}

/** The editable fields, in panel order. Cues are a list and are handled by the panel itself. */
export const MOOD_FIELDS: MoodField[] = [
  { path: "description", label: "description", group: "mood", kind: "text" },
  { path: "exposure", label: "exposure", group: "mood", kind: "number", min: -3, max: 3, step: 0.05, hint: "stops, applied in the grade" },
  { path: "key.color", label: "key colour", group: "key", kind: "color" },
  { path: "key.gain", label: "key gain", group: "key", kind: "number", min: 0, max: 2.5, step: 0.05 },
  { path: "graze_gain", label: "graze", group: "key", kind: "number", min: 0, max: 3, step: 0.05, hint: "the grazing light across the baffle" },
  { path: "dust_back_gain", label: "dust back", group: "key", kind: "number", min: 0, max: 3, step: 0.05, hint: "the dust backlight" },
  { path: "cue_bars", label: "cue every", group: "cues", kind: "number", min: 1, max: 16, step: 1, hint: "bars between cue steps" },
  { path: "cue_fade", label: "cue fade", group: "cues", kind: "number", min: 0, max: 60, step: 1, hint: "frames" },
  { path: "smoke.show", label: "smoke", group: "smoke", kind: "bool" },
  { path: "smoke.density_gain", label: "density", group: "smoke", kind: "number", min: 0, max: 3, step: 0.05 },
  { path: "smoke.haze_gain", label: "haze", group: "smoke", kind: "number", min: 0, max: 3, step: 0.05 },
  { path: "shells.show", label: "shells", group: "shells", kind: "bool" },
  { path: "shells.strength", label: "strength", group: "shells", kind: "number", min: 0, max: 1, step: 0.02 },
  { path: "grade.bloom", label: "bloom", group: "grade", kind: "number", min: 0, max: 0.5, step: 0.005 },
  { path: "grade.chromatic", label: "chromatic", group: "grade", kind: "number", min: 0, max: 0.03, step: 0.001 },
  { path: "grade.black_lift", label: "black lift", group: "grade", kind: "number", min: 0, max: 0.1, step: 0.005 },
  { path: "grade.gain", label: "gain (highlights)", group: "grade", kind: "color", hint: "split tone: tint of the highlights" },
  { path: "grade.lift", label: "lift (shadows)", group: "grade", kind: "color", hint: "split tone: tint of the shadows" },
  { path: "grade.saturation", label: "saturation", group: "grade", kind: "number", min: 0, max: 2, step: 0.02 },
  { path: "grade.vignette", label: "vignette", group: "grade", kind: "number", min: 0, max: 0.5, step: 0.005 },
  { path: "grade.grain", label: "grain", group: "grade", kind: "number", min: 0, max: 0.05, step: 0.001 },
  { path: "routing.key", label: "key follows", group: "routing", kind: "route" },
  { path: "routing.smoke", label: "smoke follows", group: "routing", kind: "route" },
  { path: "routing.wash", label: "wash follows", group: "routing", kind: "route" },
];

const isRgb = (v: unknown): v is Rgb => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));
const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
const rgb = (v: unknown, d: Rgb): Rgb => (isRgb(v) ? [v[0], v[1], v[2]] : [...d]);

/** A complete mood from whatever fields are present. */
export function withMoodDefaults(raw: Partial<Mood> & { name: string }): Mood {
  const d = MOOD_DEFAULTS;
  const r = raw as Record<string, unknown>;
  const key = (r["key"] ?? {}) as Record<string, unknown>;
  const smoke = (r["smoke"] ?? {}) as Record<string, unknown>;
  const grade = (r["grade"] ?? {}) as Record<string, unknown>;
  const shells = (r["shells"] ?? {}) as Record<string, unknown>;
  const routingRaw = (r["routing"] ?? {}) as Record<string, unknown>;
  const routing: Mood["routing"] = {};
  for (const t of ["key", "smoke", "wash"] as const) if (typeof routingRaw[t] === "string" && routingRaw[t]) routing[t] = routingRaw[t] as string;
  const cues = Array.isArray(r["cues"])
    ? (r["cues"] as unknown[]).map((c) => {
        const cue = (c ?? {}) as Record<string, unknown>;
        return { rim: rgb(cue["rim"], DEFAULT_CUE.rim), rim_gain: num(cue["rim_gain"], 1), back_gain: num(cue["back_gain"], 1), trace: rgb(cue["trace"], DEFAULT_CUE.trace) };
      })
    : [];
  return {
    name: raw.name,
    description: typeof r["description"] === "string" ? (r["description"] as string) : d.description,
    exposure: num(r["exposure"], d.exposure),
    key: { color: rgb(key["color"], d.key.color), gain: num(key["gain"], d.key.gain) },
    graze_gain: num(r["graze_gain"], d.graze_gain),
    dust_back_gain: num(r["dust_back_gain"], d.dust_back_gain),
    cues,
    cue_bars: num(r["cue_bars"], d.cue_bars),
    cue_fade: num(r["cue_fade"], d.cue_fade),
    smoke: { show: bool(smoke["show"], d.smoke.show), density_gain: num(smoke["density_gain"], d.smoke.density_gain), haze_gain: num(smoke["haze_gain"], d.smoke.haze_gain) },
    grade: {
      bloom: num(grade["bloom"], d.grade.bloom),
      chromatic: num(grade["chromatic"], d.grade.chromatic),
      black_lift: num(grade["black_lift"], d.grade.black_lift),
      gain: rgb(grade["gain"], d.grade.gain),
      lift: rgb(grade["lift"], d.grade.lift),
      saturation: num(grade["saturation"], d.grade.saturation),
      vignette: num(grade["vignette"], d.grade.vignette),
      grain: num(grade["grain"], d.grade.grain),
    },
    shells: { show: bool(shells["show"], d.shells.show), strength: num(shells["strength"], d.shells.strength) },
    routing,
  };
}

/** Parse a mood file; the name must be file-safe. Missing fields take the defaults. */
export function parseMood(json: string): Mood {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const name = raw["name"];
  if (typeof name !== "string" || !NAME_RE.test(name)) throw new Error("mood name must be lower-case letters, digits and dashes");
  return withMoodDefaults({ ...(raw as Partial<Mood>), name });
}

/** The file text: 2-space JSON in the shipped key order. */
export function moodToJson(m: Mood): string {
  const ordered: Mood = {
    name: m.name,
    description: m.description,
    exposure: m.exposure,
    key: m.key,
    graze_gain: m.graze_gain,
    dust_back_gain: m.dust_back_gain,
    cues: m.cues,
    cue_bars: m.cue_bars,
    cue_fade: m.cue_fade,
    smoke: m.smoke,
    grade: m.grade,
    shells: m.shells,
    routing: m.routing,
  };
  return JSON.stringify(ordered, null, 2) + "\n";
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** A copy of obj with the value at path replaced; every object on the path is copied, the rest shared. */
export function setPath<T>(obj: T, path: string, value: unknown): T {
  const segs = path.split(".");
  const walk = (cur: unknown, i: number): unknown => {
    if (i === segs.length) return value;
    const seg = segs[i]!;
    if (Array.isArray(cur)) {
      const copy = [...cur];
      copy[Number(seg)] = walk(cur[Number(seg)], i + 1);
      return copy;
    }
    const src = (cur ?? {}) as Record<string, unknown>;
    return { ...src, [seg]: walk(src[seg], i + 1) };
  };
  return walk(obj, 0) as T;
}
