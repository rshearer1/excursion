// Excursion — rooms (presets/rooms/<name>.json). A room is what build_scene.py builds into
// blender/scenes/<name>.blend: a base set (void, macro, stack or concrete) plus optional
// overrides — walls, the full stage, the speakers around the hero, extra cameras, lyric anchors
// and the rig it lights with by default. A field left out keeps the base's own value, so the
// four starter rooms ({ base } only) build exactly the scenes the pipeline had before rooms.
// The hero PMC6-2 always sits at the origin; everything else is placed around it.
// Coordinates as in rig.ts: metres, x right, y away from the camera, z up.
// Changing a room needs a rebuild (make_reel and the helper rebuild when the room file is newer
// than the .blend). Pure: main.ts owns the panel, the Blender add-on edits the same file.

import type { Vec3 } from "./rig";

export type RoomBase = "void" | "macro" | "stack" | "concrete";
/** how a speaker stands: on a PMC stand, on the floor, or this many metres above the floor */
export type Mount = "stand" | "floor" | number;

export interface RoomSpeaker {
  /** object-name prefix in Blender (<id>_Cabinet …); unique in the room */
  id: string;
  /** a kit in blender/kits/ */
  model: string;
  /** cabinet centre on the floor plan, metres */
  pos: [number, number];
  /** degrees, + turns the baffle toward +x */
  yaw: number;
  mount: Mount;
}

export interface RoomCamera {
  /** must start with Cam and not be one of the built-in names */
  name: string;
  pos: Vec3;
  target: Vec3;
  /** focal length, mm */
  lens: number;
  fstop: number;
  /** how far it travels over each shot it gets (metres, in the camera rig's space) */
  move: Vec3;
}

export interface Room {
  kind: "room";
  name: string;
  description: string;
  base: RoomBase;
  /** room corner walls on (concrete's default) */
  walls?: boolean;
  /** the full stage: truss, moving heads, lasers, projectors, blinders and the wider cameras */
  stage?: boolean;
  /** speakers besides the hero; absent = the base's own layout */
  speakers?: RoomSpeaker[];
  /** cameras added to the base's; they join the cut list after the built-in shots */
  cameras?: RoomCamera[];
  /** lyric anchors by name; absent = the base's own anchors */
  lyricAnchors?: Record<string, Vec3>;
  /** the rig used when the drive names none */
  rig?: string;
  /** a stereo pair: a twin of the hero `gap` metres to the right (centre to centre), both toed in
   * `toe` degrees, each lit by its own key, graze and top-back; the LED wall centres between them */
  pair?: { gap: number; toe: number };
}

export const ROOM_BASES: { value: RoomBase; hint: string }[] = [
  { value: "void", hint: "the hero floating in the dark, five close cameras" },
  { value: "macro", hint: "the same hero, close cameras only plus a 90 mm on the cone" },
  { value: "stack", hint: "a wall of six PMC6-2s, wide camera further back" },
  { value: "concrete", hint: "the hero in a concrete room corner" },
];

export const SPEAKER_MODELS = ["PMC6-2", "PMC6", "PMC8SUB", "PMC8-2SUB", "PMC8-2INCSTAND"];

export const BUILT_IN_CAMERAS = ["Cam1_Wide", "Cam2_Woofers", "Cam3_Macro", "Cam4_Rig", "Cam5_Low", "Cam6_Side", "Cam7_Top", "Cam8_Cone"];

/** Approximate footprints (width, depth in metres) for the plan view. */
export const SPEAKER_FOOTPRINT: Record<string, [number, number]> = {
  "PMC6-2": [0.43, 0.37],
  PMC6: [0.19, 0.17],
  PMC8SUB: [0.43, 0.43],
  "PMC8-2SUB": [0.43, 0.5],
  "PMC8-2INCSTAND": [0.34, 0.33],
};

const STACK_GAP = 0.06;
const STACK_X = 0.43 + STACK_GAP;
const RIG_SPACING = 1.4;

/** The speakers each base builds around the hero (build_scene.py STACK_RIG and the stage RIG). */
export function baseSpeakers(base: RoomBase, stage = false): RoomSpeaker[] {
  if (base === "stack")
    return [
      { id: "L1", model: "PMC6-2", pos: [-STACK_X, 0], yaw: 0, mount: "floor" },
      { id: "L2", model: "PMC6-2", pos: [-STACK_X, 0], yaw: 0, mount: 0.4 + STACK_GAP },
      { id: "C2", model: "PMC6-2", pos: [0, 0], yaw: 0, mount: 0.4 + STACK_GAP },
      { id: "R1", model: "PMC6-2", pos: [STACK_X, 0], yaw: 0, mount: "floor" },
      { id: "R2", model: "PMC6-2", pos: [STACK_X, 0], yaw: 0, mount: 0.4 + STACK_GAP },
    ];
  if (!stage) return [];
  return [
    { id: "R6-2", model: "PMC6-2", pos: [RIG_SPACING, 0], yaw: 0, mount: "stand" },
    { id: "L8-2", model: "PMC8-2INCSTAND", pos: [-1.35, 0.3], yaw: 15, mount: "floor" },
    { id: "R8-2", model: "PMC8-2INCSTAND", pos: [RIG_SPACING + 1.35, 0.3], yaw: -15, mount: "floor" },
    { id: "LSUB", model: "PMC8-2SUB", pos: [-0.62, 0.15], yaw: 15, mount: "floor" },
    { id: "RSUB", model: "PMC8-2SUB", pos: [RIG_SPACING + 0.62, 0.15], yaw: -15, mount: "floor" },
    { id: "MSUB", model: "PMC8SUB", pos: [RIG_SPACING / 2, 0.15], yaw: 0, mount: "floor" },
    { id: "LFILL", model: "PMC6", pos: [RIG_SPACING / 2 - 0.14, 0.15], yaw: 12, mount: 0.266 },
    { id: "RFILL", model: "PMC6", pos: [RIG_SPACING / 2 + 0.14, 0.15], yaw: -12, mount: 0.266 },
  ];
}

/** The lyric anchors each base builds (build_scene.py LYRIC_ANCHORS; "behind" sits on the hero's top). */
export function baseLyricAnchors(base: RoomBase): Record<string, Vec3> {
  const top = 0.2;
  if (base === "concrete") return { "wall-left": [-0.75, 1.32, 0.45], "wall-right": [0.75, 1.32, 0.45], "wall-top": [0, 1.32, 1.1] };
  if (base === "macro") return {};
  if (base === "stack") return { behind: [0, 0.4, top + 0.3] };
  return { behind: [0, 0.4, top + 0.3], "front-low": [0, -0.47, -0.18], wall: [0, 1.05, 0.58] };
}

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID_RE = /^[A-Za-z][A-Za-z0-9-]*$/;
const CAM_RE = /^Cam[A-Za-z0-9_]+$/;
const ANCHOR_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const vec3 = (v: unknown, what: string): Vec3 => {
  if (Array.isArray(v) && v.length === 3 && v.every(finite)) return [v[0]!, v[1]!, v[2]!];
  throw new Error(`${what} must be [x, y, z] in metres`);
};

/** Parse and validate a room file. Throws with a message naming the problem. */
export function parseRoom(json: string | Record<string, unknown>): Room {
  const raw = (typeof json === "string" ? JSON.parse(json) : json) as Record<string, unknown>;
  if (raw["kind"] !== "room") throw new Error("not a room file (kind must be \"room\")");
  const name = raw["name"];
  if (typeof name !== "string" || !NAME_RE.test(name)) throw new Error("room name must be lower-case letters, digits and dashes");
  const base = raw["base"];
  if (!ROOM_BASES.some((b) => b.value === base)) throw new Error(`room base must be one of ${ROOM_BASES.map((b) => b.value).join(", ")}`);
  const room: Room = { kind: "room", name, description: typeof raw["description"] === "string" ? (raw["description"] as string) : "", base: base as RoomBase };
  if (typeof raw["walls"] === "boolean") room.walls = raw["walls"];
  if (typeof raw["stage"] === "boolean") room.stage = raw["stage"];
  if (typeof raw["rig"] === "string" && raw["rig"]) room.rig = raw["rig"];
  if (raw["speakers"] !== undefined) {
    if (!Array.isArray(raw["speakers"])) throw new Error("speakers must be a list");
    const seen = new Set<string>();
    room.speakers = raw["speakers"].map((s, i) => {
      const o = (s ?? {}) as Record<string, unknown>;
      const id = o["id"];
      if (typeof id !== "string" || !ID_RE.test(id)) throw new Error(`speaker ${i + 1}: id must start with a letter (letters, digits, -)`);
      if (seen.has(id)) throw new Error(`speaker id ${id} is used twice`);
      seen.add(id);
      if (typeof o["model"] !== "string" || !o["model"]) throw new Error(`speaker ${id}: model is missing`);
      const pos = o["pos"];
      if (!(Array.isArray(pos) && pos.length === 2 && pos.every(finite))) throw new Error(`speaker ${id}: pos must be [x, y]`);
      const mount = o["mount"];
      if (!(mount === "stand" || mount === "floor" || finite(mount))) throw new Error(`speaker ${id}: mount must be stand, floor or a height in metres`);
      return { id, model: o["model"] as string, pos: [pos[0], pos[1]] as [number, number], yaw: finite(o["yaw"]) ? o["yaw"] : 0, mount: mount as Mount };
    });
  }
  if (raw["cameras"] !== undefined) {
    if (!Array.isArray(raw["cameras"])) throw new Error("cameras must be a list");
    const seen = new Set<string>();
    room.cameras = raw["cameras"].map((c, i) => {
      const o = (c ?? {}) as Record<string, unknown>;
      const cname = o["name"];
      if (typeof cname !== "string" || !CAM_RE.test(cname)) throw new Error(`camera ${i + 1}: name must start with Cam (letters, digits, _)`);
      if (BUILT_IN_CAMERAS.includes(cname)) throw new Error(`camera ${cname} is a built-in name — pick another`);
      if (seen.has(cname)) throw new Error(`camera ${cname} is listed twice`);
      seen.add(cname);
      return {
        name: cname,
        pos: vec3(o["pos"], `camera ${cname} pos`),
        target: vec3(o["target"], `camera ${cname} target`),
        lens: finite(o["lens"]) ? o["lens"] : 35,
        fstop: finite(o["fstop"]) ? o["fstop"] : 2.8,
        move: o["move"] === undefined ? [0, 0, 0] : vec3(o["move"], `camera ${cname} move`),
      };
    });
  }
  if (raw["lyricAnchors"] !== undefined) {
    const a = raw["lyricAnchors"];
    if (a === null || typeof a !== "object" || Array.isArray(a)) throw new Error("lyricAnchors must be { name: [x, y, z] }");
    room.lyricAnchors = {};
    for (const [k, v] of Object.entries(a)) {
      if (!ANCHOR_RE.test(k)) throw new Error(`lyric anchor ${k}: lower-case letters, digits and dashes`);
      room.lyricAnchors[k] = vec3(v, `lyric anchor ${k}`);
    }
  }
  if (raw["pair"] !== undefined) {
    const p = (raw["pair"] ?? {}) as Record<string, unknown>;
    const gap = p["gap"] === undefined ? 1.4 : p["gap"];
    const toe = p["toe"] === undefined ? 10 : p["toe"];
    if (!finite(gap) || gap < 0.5 || gap > 4) throw new Error("pair gap must be 0.5 to 4 metres");
    if (!finite(toe) || Math.abs(toe) > 45) throw new Error("pair toe must be -45 to 45 degrees");
    room.pair = { gap, toe };
  }
  return room;
}

const r4 = (x: number): number => Math.round(x * 1e4) / 1e4 + 0;

/** The file text: 2-space JSON in a fixed key order; absent overrides stay absent. */
export function roomToJson(room: Room): string {
  const out: Record<string, unknown> = { kind: "room", name: room.name, description: room.description, base: room.base };
  if (room.walls !== undefined) out["walls"] = room.walls;
  if (room.stage !== undefined) out["stage"] = room.stage;
  if (room.rig) out["rig"] = room.rig;
  if (room.speakers) out["speakers"] = room.speakers.map((s) => ({ id: s.id, model: s.model, pos: s.pos.map(r4), yaw: r4(s.yaw), mount: typeof s.mount === "number" ? r4(s.mount) : s.mount }));
  if (room.cameras) out["cameras"] = room.cameras.map((c) => ({ name: c.name, pos: c.pos.map(r4), target: c.target.map(r4), lens: r4(c.lens), fstop: r4(c.fstop), move: c.move.map(r4) }));
  if (room.lyricAnchors) out["lyricAnchors"] = Object.fromEntries(Object.entries(room.lyricAnchors).map(([k, v]) => [k, v.map(r4)]));
  if (room.pair) out["pair"] = { gap: r4(room.pair.gap), toe: r4(room.pair.toe) };
  return JSON.stringify(out, null, 2) + "\n";
}

/** What the room actually builds: overrides over the base. */
export function effectiveRoom(room: Room): { walls: boolean; stage: boolean; speakers: RoomSpeaker[]; cameras: RoomCamera[]; lyricAnchors: Record<string, Vec3> } {
  const stage = room.stage ?? false;
  return {
    walls: room.walls ?? room.base === "concrete",
    stage,
    speakers: room.speakers ?? baseSpeakers(room.base, stage),
    cameras: room.cameras ?? [],
    lyricAnchors: room.lyricAnchors ?? baseLyricAnchors(room.base),
  };
}

export function freeId(taken: Iterable<string>, stem: string): string {
  const ids = new Set(taken);
  if (!ids.has(stem)) return stem;
  for (let n = 2; ; n++) if (!ids.has(`${stem}${n}`)) return `${stem}${n}`;
}

export const STARTER_ROOMS: Room[] = ROOM_BASES.map((b) => ({ kind: "room", name: b.value, description: b.hint, base: b.value }));
