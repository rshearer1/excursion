import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STARTER_ROOMS, baseSpeakers, effectiveRoom, parseRoom, roomToJson, type Room } from "./room";

const ROOMS = path.resolve(__dirname, "../../../presets/rooms");

describe("room files", () => {
  it("a base-only room builds the base: no overrides written back", () => {
    for (const r of STARTER_ROOMS) {
      const text = roomToJson(r);
      expect(JSON.parse(text)).toEqual({ kind: "room", name: r.name, description: r.description, base: r.base });
      expect(parseRoom(text)).toEqual(r);
    }
  });

  it("the effective room falls back to the base's walls, speakers and anchors", () => {
    const stack = effectiveRoom({ kind: "room", name: "s", description: "", base: "stack" });
    expect(stack.speakers).toHaveLength(5);
    expect(stack.walls).toBe(false);
    expect(effectiveRoom({ kind: "room", name: "c", description: "", base: "concrete" }).walls).toBe(true);
    expect(effectiveRoom({ kind: "room", name: "v", description: "", base: "void" }).speakers).toEqual([]);
    expect(baseSpeakers("void", true).length).toBe(8); // the full stage rig
    expect(effectiveRoom({ kind: "room", name: "m", description: "", base: "macro" }).lyricAnchors).toEqual({});
  });

  it("round-trips overrides", () => {
    const room: Room = {
      kind: "room",
      name: "pair",
      description: "two",
      base: "void",
      walls: true,
      stage: false,
      rig: "kick-floor",
      speakers: [{ id: "R1", model: "PMC6-2", pos: [1, 0], yaw: -10, mount: "stand" }, { id: "R2", model: "PMC6", pos: [1, 0], yaw: 0, mount: 0.4 }],
      cameras: [{ name: "Cam9_Pair", pos: [0.5, -2.6, 0.1], target: [0.5, 0, 0], lens: 35, fstop: 2.8, move: [0, 0.4, 0] }],
      lyricAnchors: { high: [0, 1, 1.2] },
    };
    expect(parseRoom(roomToJson(room))).toEqual(room);
  });

  it("rejects what build_scene could not build", () => {
    const base = { kind: "room", name: "x", base: "void" };
    expect(() => parseRoom({ ...base, base: "moon" })).toThrow(/base/);
    expect(() => parseRoom({ ...base, speakers: [{ id: "a", model: "PMC6", pos: [0, 0], mount: "ceiling" }] })).toThrow(/mount/);
    expect(() => parseRoom({ ...base, speakers: [{ id: "a", model: "PMC6", pos: [0, 0], mount: "floor" }, { id: "a", model: "PMC6", pos: [1, 0], mount: "floor" }] })).toThrow(/twice/);
    expect(() => parseRoom({ ...base, cameras: [{ name: "Cam1_Wide", pos: [0, 0, 0], target: [0, 1, 0] }] })).toThrow(/built-in/);
    expect(() => parseRoom({ ...base, cameras: [{ name: "Wide", pos: [0, 0, 0], target: [0, 1, 0] }] })).toThrow(/Cam/);
    expect(() => parseRoom({ ...base, lyricAnchors: { Top: [0, 0, 0] } })).toThrow(/anchor/);
  });

  it("every shipped room parses and the four bases have a room file", () => {
    const files = readdirSync(ROOMS).filter((f) => f.endsWith(".json"));
    for (const f of files) expect(`${parseRoom(readFileSync(path.join(ROOMS, f), "utf8")).name}.json`).toBe(f);
    for (const b of ["void", "macro", "stack", "concrete"]) expect(files).toContain(`${b}.json`);
  });
});
