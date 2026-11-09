// Excursion — light rigs (presets/rigs/<name>.json). A rig is a list of fixtures added to the
// scene at apply time (blender/rigkit.py), so swapping or editing a rig never needs a scene
// rebuild. Every fixture has a role that says what drives it:
//   key     follows the desk's key lane (gain, colour) and breathes with the bass, like KeyLight
//   rim     takes the rims lane's colour and gain and pulses on downbeats, like RimLeft/RimRight
//   wash    takes the rims lane's colour and gain without the pulse, like the WallUp uplights
//   back    follows the dust-back lane's gain, like DustBack
//   static  keeps its own colour and power
// and a react that adds motion on top: none, bass (the bass level), beat (flash on every beat,
// harder on downbeats) or kick (flash on tracked kicks), scaled by amount.
// Coordinates are Blender's, in metres: the hero speaker's cabinet centre is the origin, x to
// the right, y away from the camera (its baffle faces -y), z up.
// Pure: main.ts owns the panel, the Blender add-on edits the same file.

export type Vec3 = [number, number, number];
export type Rgb = [number, number, number];
export type FixtureType = "spot" | "area" | "point";
export type FixtureRole = "key" | "rim" | "wash" | "back" | "static";
export type FixtureReact = "none" | "bass" | "beat" | "kick";

export interface Fixture {
  /** unique in the rig; the Blender light is named Rig_<id> */
  id: string;
  type: FixtureType;
  pos: Vec3;
  /** the point the light faces (ignored for point lights) */
  aim: Vec3;
  /** watts */
  power: number;
  color: Rgb;
  /** spot: beam angle; area: spread (degrees) */
  cone: number;
  /** spot edge softness 0..1 */
  blend: number;
  /** source size in metres: soft-shadow radius, or the side of an area light */
  size: number;
  /** how much the beam lights the smoke, 0..1+ */
  volume: number;
  role: FixtureRole;
  react: FixtureReact;
  /** 0..1: how far react moves the power (0 = steady) */
  amount: number;
}

export interface Rig {
  kind: "rig";
  name: string;
  description: string;
  /** hide the room's own lights (KeyLight, Graze, TopBack, RimLeft, RimRight, WallUp_*), so the rig is the whole lighting */
  replaceBuiltIn: boolean;
  fixtures: Fixture[];
}

export const FIXTURE_TYPES: FixtureType[] = ["spot", "area", "point"];
export const FIXTURE_ROLES: { value: FixtureRole; hint: string }[] = [
  { value: "key", hint: "the desk's key lane and the bass, like the softbox" },
  { value: "rim", hint: "the rims lane's colour and gain, pulsing on downbeats" },
  { value: "wash", hint: "the rims lane's colour and gain, steady" },
  { value: "back", hint: "the dust-back lane's gain" },
  { value: "static", hint: "its own colour and power" },
];
export const FIXTURE_REACTS: { value: FixtureReact; hint: string }[] = [
  { value: "none", hint: "steady" },
  { value: "bass", hint: "rides the bass level" },
  { value: "beat", hint: "flashes on every beat, harder on downbeats" },
  { value: "kick", hint: "flashes on tracked kicks" },
];

/** The lights every built scene already has (build_scene.py), for the panels' reference. */
export const BUILT_IN_LIGHTS = ["KeyLight", "Graze", "TopBack", "RimLeft", "RimRight", "WallUp_*", "DustBack"];

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const FIXTURE_DEFAULTS: Omit<Fixture, "id"> = {
  type: "spot",
  pos: [0, -1, 0.8],
  aim: [0, -0.12, 0],
  power: 300,
  color: [1, 1, 1],
  cone: 30,
  blend: 0.5,
  size: 0.05,
  volume: 0.3,
  role: "static",
  react: "none",
  amount: 0.5,
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num = (v: unknown, d: number): number => (finite(v) ? v : d);
const vec = (v: unknown, d: Vec3): Vec3 => (Array.isArray(v) && v.length === 3 && v.every(finite) ? [v[0]!, v[1]!, v[2]!] : [...d]);
const pick = <T extends string>(v: unknown, options: readonly T[], d: T): T => (typeof v === "string" && (options as readonly string[]).includes(v) ? (v as T) : d);
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** A complete fixture from whatever fields are present. */
export function withFixtureDefaults(raw: Partial<Fixture> & { id: string }): Fixture {
  const d = FIXTURE_DEFAULTS;
  const r = raw as Record<string, unknown>;
  return {
    id: raw.id,
    type: pick(r["type"], FIXTURE_TYPES, d.type),
    pos: vec(r["pos"], d.pos),
    aim: vec(r["aim"], d.aim),
    power: Math.max(0, num(r["power"], d.power)),
    color: vec(r["color"], d.color),
    cone: clamp(num(r["cone"], d.cone), 1, 180),
    blend: clamp(num(r["blend"], d.blend), 0, 1),
    size: Math.max(0, num(r["size"], d.size)),
    volume: Math.max(0, num(r["volume"], d.volume)),
    role: pick(r["role"], FIXTURE_ROLES.map((x) => x.value), d.role),
    react: pick(r["react"], FIXTURE_REACTS.map((x) => x.value), d.react),
    amount: clamp(num(r["amount"], d.amount), 0, 1),
  };
}

/** Parse and validate a rig file. Throws with a message naming the problem. */
export function parseRig(json: string | Record<string, unknown>): Rig {
  const raw = (typeof json === "string" ? JSON.parse(json) : json) as Record<string, unknown>;
  if (raw["kind"] !== "rig") throw new Error("not a rig file (kind must be \"rig\")");
  const name = raw["name"];
  if (typeof name !== "string" || !NAME_RE.test(name)) throw new Error("rig name must be lower-case letters, digits and dashes");
  const list = raw["fixtures"];
  if (!Array.isArray(list)) throw new Error("rig needs a fixtures list");
  const seen = new Set<string>();
  const fixtures = list.map((f, i) => {
    const o = (f ?? {}) as Record<string, unknown>;
    const id = o["id"];
    if (typeof id !== "string" || !ID_RE.test(id)) throw new Error(`fixture ${i + 1}: id must be letters, digits, _ or -`);
    if (seen.has(id)) throw new Error(`fixture id ${id} is used twice`);
    seen.add(id);
    return withFixtureDefaults({ ...(o as Partial<Fixture>), id });
  });
  return {
    kind: "rig",
    name,
    description: typeof raw["description"] === "string" ? (raw["description"] as string) : "",
    replaceBuiltIn: raw["replaceBuiltIn"] === true,
    fixtures,
  };
}

const r4 = (x: number): number => Math.round(x * 1e4) / 1e4 + 0;

/** The file text: 2-space JSON, numbers rounded to 0.1 mm / 4 places. */
export function rigToJson(rig: Rig): string {
  const out: Rig = {
    kind: "rig",
    name: rig.name,
    description: rig.description,
    replaceBuiltIn: rig.replaceBuiltIn,
    fixtures: rig.fixtures.map((f) => ({
      id: f.id,
      type: f.type,
      pos: f.pos.map(r4) as Vec3,
      aim: f.aim.map(r4) as Vec3,
      power: r4(f.power),
      color: f.color.map(r4) as Rgb,
      cone: r4(f.cone),
      blend: r4(f.blend),
      size: r4(f.size),
      volume: r4(f.volume),
      role: f.role,
      react: f.react,
      amount: r4(f.amount),
    })),
  };
  return JSON.stringify(out, null, 2) + "\n";
}

/** A fixture id not yet used in the rig: <stem>, <stem>-2, <stem>-3… */
export function freeFixtureId(rig: Rig, stem: string): string {
  const ids = new Set(rig.fixtures.map((f) => f.id));
  const base = stem.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "light";
  if (!ids.has(base)) return base;
  for (let n = 2; ; n++) if (!ids.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Starting values per role, so a new fixture lands somewhere sensible. */
const ROLE_START: Record<FixtureRole, Partial<Fixture>> = {
  key: { type: "area", pos: [-0.3, -0.97, 0.7], aim: [0.06, -0.12, 0.1], power: 10, color: [1, 0.84, 0.66], cone: 40, size: 0.8, volume: 0.6 },
  rim: { pos: [1.0, 0.9, 0.3], aim: [0.2, 0.3, -0.2], power: 800, color: [0.4, 0.6, 1], cone: 28, blend: 0.8, size: 0.08, volume: 0.05 },
  wash: { pos: [0, 1.1, -0.6], aim: [0, 1.35, 2], power: 60, color: [0.4, 0.6, 1], cone: 55, blend: 0.9, volume: 0.3 },
  back: { pos: [0, 1.5, 0.4], aim: [0, -0.5, 0], power: 400, cone: 45, blend: 0.8, volume: 1 },
  static: {},
};

export function newFixture(rig: Rig, role: FixtureRole = "static", type?: FixtureType): Fixture {
  const start = ROLE_START[role];
  return withFixtureDefaults({ ...start, ...(type ? { type } : {}), role, id: freeFixtureId(rig, role) });
}

export function emptyRig(name: string): Rig {
  return { kind: "rig", name, description: "", replaceBuiltIn: false, fixtures: [] };
}

/** Yaw (degrees, 0 = facing +y, positive toward +x) and tilt (degrees, + up) of a fixture's beam, for the plan view. */
export function beamAngles(f: Pick<Fixture, "pos" | "aim">): { yaw: number; tilt: number; reach: number } {
  const dx = f.aim[0] - f.pos[0];
  const dy = f.aim[1] - f.pos[1];
  const dz = f.aim[2] - f.pos[2];
  const flat = Math.hypot(dx, dy);
  return { yaw: (Math.atan2(dx, dy) * 180) / Math.PI, tilt: (Math.atan2(dz, flat) * 180) / Math.PI, reach: Math.hypot(flat, dz) };
}
