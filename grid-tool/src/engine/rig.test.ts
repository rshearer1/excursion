import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { beamAngles, emptyRig, freeFixtureId, newFixture, parseRig, rigToJson, withFixtureDefaults } from "./rig";

const RIGS = path.resolve(__dirname, "../../../presets/rigs");

describe("rig files", () => {
  it("fills every missing fixture field with its default and clamps the ranges", () => {
    const f = withFixtureDefaults({ id: "a", cone: 400, blend: -1, amount: 3, power: -5, role: "nope" as never });
    expect(f.cone).toBe(180);
    expect(f.blend).toBe(0);
    expect(f.amount).toBe(1);
    expect(f.power).toBe(0);
    expect(f.role).toBe("static");
    expect(f.type).toBe("spot");
  });

  it("rejects a wrong kind, a bad name and duplicate fixture ids", () => {
    expect(() => parseRig({ kind: "room", name: "x", fixtures: [] })).toThrow(/not a rig/);
    expect(() => parseRig({ kind: "rig", name: "Bad Name", fixtures: [] })).toThrow(/lower-case/);
    expect(() => parseRig({ kind: "rig", name: "x", fixtures: [{ id: "a" }, { id: "a" }] })).toThrow(/twice/);
    expect(() => parseRig({ kind: "rig", name: "x", fixtures: [{ id: "has space" }] })).toThrow(/id/);
  });

  it("round-trips through the file text", () => {
    const rig = emptyRig("round-trip");
    for (const [role, type] of [["rim"], ["rim"], ["key", "area"]] as const) rig.fixtures.push(newFixture(rig, role, type));
    rig.replaceBuiltIn = true;
    const back = parseRig(rigToJson(rig));
    expect(back).toEqual(rig);
    expect(back.fixtures.map((f) => f.id)).toEqual(["rim", "rim-2", "key"]);
    expect(back.fixtures[2]!.type).toBe("area");
  });

  it("finds a free id", () => {
    const rig = emptyRig("x");
    rig.fixtures.push(withFixtureDefaults({ id: "wash" }), withFixtureDefaults({ id: "wash-2" }));
    expect(freeFixtureId(rig, "wash")).toBe("wash-3");
    expect(freeFixtureId(rig, "a b")).toBe("a-b");
  });

  it("measures a beam: yaw 0 faces +y, tilt up is positive", () => {
    const a = beamAngles({ pos: [0, 0, 0], aim: [0, 1, 1] });
    expect(a.yaw).toBeCloseTo(0);
    expect(a.tilt).toBeCloseTo(45);
    expect(beamAngles({ pos: [0, 0, 0], aim: [1, 0, 0] }).yaw).toBeCloseTo(90);
  });

  it("every shipped rig parses", () => {
    const files = readdirSync(RIGS).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const rig = parseRig(readFileSync(path.join(RIGS, f), "utf8"));
      expect(`${rig.name}.json`).toBe(f);
    }
  });
});
