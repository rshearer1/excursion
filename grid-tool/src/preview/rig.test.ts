import { describe, test, expect } from "vitest";
import { rigStateAt, makeDust, stepDust, type DriveLike, type Jet } from "./rig";

const fps = 30;
const frame = () => ({ bass: 0, mid: 0, high: 0, onset: 0 as const, beatPhase: 0 });
function drive(overrides: Partial<DriveLike> = {}): DriveLike {
  return { fps, beats: [], cuts: [], frames: Array.from({ length: 90 }, frame), ...overrides };
}

describe("rigStateAt", () => {
  test("woofer excursion is the bass envelope times full travel (6 mm)", () => {
    const d = drive();
    d.frames[30]!.bass = 0.5;
    expect(rigStateAt(d, 30 / fps).excursionMm).toBeCloseTo(3, 6);
  });

  test("tweeter glow follows the high band", () => {
    const d = drive();
    d.frames[30]!.high = 0.8;
    expect(rigStateAt(d, 30 / fps).tweeter).toBeCloseTo(0.8, 6);
  });

  test("slate flashes to 1 on a beat and has decayed within 200 ms", () => {
    const d = drive({ beats: [1.0] });
    expect(rigStateAt(d, 0.9).slate).toBe(0);
    expect(rigStateAt(d, 1.0).slate).toBeCloseTo(1, 6);
    expect(rigStateAt(d, 1.2).slate).toBeLessThan(0.2);
  });

  test("camera index alternates at each cut", () => {
    const d = drive({ cuts: [2, 4] });
    expect(rigStateAt(d, 1).cameraIndex).toBe(0);
    expect(rigStateAt(d, 2.5).cameraIndex).toBe(1);
    expect(rigStateAt(d, 4.5).cameraIndex).toBe(0);
  });

  test("cone velocity is positive on the outward stroke and negative on the return", () => {
    const d = drive();
    d.frames[30]!.bass = 0.5;
    d.frames[31]!.bass = 0.5;
    // frame 29 = 0 -> 30 = 0.5 is the outward stroke; 31 = 0.5 -> 32 = 0 is the return
    expect(rigStateAt(d, 30 / fps).coneVelocity).toBeCloseTo(0.003 * fps, 6);
    expect(rigStateAt(d, 32 / fps).coneVelocity).toBeCloseTo(-0.003 * fps, 6);
  });

  test("time past the end clamps to the last frame", () => {
    const d = drive();
    d.frames[89]!.bass = 1;
    const s = rigStateAt(d, 99);
    expect(s.excursionMm).toBeCloseTo(6, 6);
    expect(Number.isFinite(s.coneVelocity)).toBe(true);
  });
});

const jetDown: Jet = { origin: [0, 0, 0], axis: [0, -1, 0], halfAngleDeg: 20, reach: 0.15, speed: 1 };
const still = { drag: 1, turbulence: 0, time: 0 };

describe("dust", () => {
  test("the same seed produces the same cloud", () => {
    const a = makeDust(100, 7, { min: [-1, -1, -1], max: [1, 1, 1] });
    const b = makeDust(100, 7, { min: [-1, -1, -1], max: [1, 1, 1] });
    expect(Array.from(a.pos)).toEqual(Array.from(b.pos));
    expect(a.count).toBe(100);
  });

  test("a still point inside the jet cone is pushed along the axis", () => {
    const c = makeDust(1, 1, { min: [0, 0, 0], max: [0, 0, 0] });
    c.pos.set([0, -0.05, 0]);
    stepDust(c, 1 / fps, [jetDown], still);
    expect(c.vel[1]!).toBeLessThan(0);
    expect(c.pos[1]!).toBeLessThan(-0.05);
  });

  test("a point outside the cone is not pushed", () => {
    const c = makeDust(1, 1, { min: [0, 0, 0], max: [0, 0, 0] });
    c.pos.set([0.1, -0.05, 0]); // 63 degrees off axis
    stepDust(c, 1 / fps, [jetDown], still);
    expect(Array.from(c.vel)).toEqual([0, 0, 0]);
  });

  test("a negative jet speed pulls the point back toward the source", () => {
    const c = makeDust(1, 1, { min: [0, 0, 0], max: [0, 0, 0] });
    c.pos.set([0, -0.05, 0]);
    stepDust(c, 1 / fps, [{ ...jetDown, speed: -1 }], still);
    expect(c.vel[1]!).toBeGreaterThan(0);
  });

  test("drag slows a moving point when there is no jet", () => {
    const c = makeDust(1, 1, { min: [0, 0, 0], max: [0, 0, 0] });
    c.vel.set([0, 0, 1]);
    stepDust(c, 1 / fps, [], { ...still, drag: 0.9 });
    expect(c.vel[2]!).toBeLessThan(1);
    expect(c.vel[2]!).toBeGreaterThan(0);
  });

  test("points that leave the box wrap back inside it", () => {
    const box = { min: [-1, -1, -1] as const, max: [1, 1, 1] as const };
    const c = makeDust(1, 1, box);
    c.pos.set([0, 0, 0.999]);
    c.vel.set([0, 0, 1]);
    stepDust(c, 0.1, [], { ...still, box });
    expect(c.pos[2]!).toBeLessThan(0);
  });
});

describe("cone model (frames[].cone) and the dust field", () => {
  test("excursion and velocity come from the cone extremes when a frame has them", () => {
    const d = drive();
    d.frames[30]!.cone = [-0.5, 0.5]; // outward stroke during the exposure, ends 3 mm out
    d.frames[31]!.cone = [0.5, -0.5]; // return stroke, ends 3 mm in
    const out = rigStateAt(d, 30 / fps);
    expect(out.excursionMm).toBeCloseTo(3, 6);
    expect(out.coneVelocity).toBeGreaterThan(0);
    expect(out.gust).toBeCloseTo(0.5, 6); // half the peak-to-peak travel, 0..1
    const back = rigStateAt(d, 31 / fps);
    expect(back.excursionMm).toBeCloseTo(-3, 6);
    expect(back.coneVelocity).toBeLessThan(0);
  });

  test("gust falls back to the bass envelope on drives without cone data", () => {
    const d = drive();
    d.frames[30]!.bass = 0.7;
    expect(rigStateAt(d, 30 / fps).gust).toBeCloseTo(0.7, 6);
  });

  test("room drift carries a still mote toward the camera", () => {
    const c = makeDust(1, 1, { min: [0, 0, 0], max: [0, 0, 0] });
    stepDust(c, 0.5, [], { ...still, drift: [0, 0, 0.02] });
    expect(c.pos[2]!).toBeCloseTo(0.01, 6);
  });

  test("a column jet streams motes near the woofer axis and leaves motes off to the side alone", () => {
    const column: Jet = { origin: [0, 0, 0], axis: [0, 0, 1], radius: 0.16, reach: 0.6, speed: 1 };
    const near = makeDust(1, 1, { min: [0, 0, 0], max: [0, 0, 0] });
    near.pos.set([0.03, 0, 0.1]);
    stepDust(near, 1 / fps, [column], still);
    expect(near.vel[2]!).toBeGreaterThan(0);
    const side = makeDust(1, 1, { min: [0, 0, 0], max: [0, 0, 0] });
    side.pos.set([0.3, 0, 0.1]);
    stepDust(side, 1 / fps, [column], still);
    expect(Array.from(side.vel)).toEqual([0, 0, 0]);
  });

  test("motes never sit inside the cabinet: one that ends up inside is moved out through the nearest side", () => {
    const cabinet = { min: [-0.15, -0.275, -0.12] as const, max: [0.15, 0.275, 0.12] as const };
    const c = makeDust(1, 1, { min: [0, 0, 0], max: [0, 0, 0] });
    c.pos.set([0.13, 0.0, 0.0]); // inside, nearest the +x face
    stepDust(c, 1 / fps, [], { ...still, solid: cabinet });
    expect(c.pos[0]!).toBeGreaterThanOrEqual(0.15);
    expect(c.pos[1]!).toBeCloseTo(0, 6);
  });

  test("makeDust never spawns inside an avoided box", () => {
    const cabinet = { min: [-0.15, -0.275, -0.12] as const, max: [0.15, 0.275, 0.12] as const };
    const c = makeDust(500, 3, { min: [-0.3, -0.4, -0.3] as const, max: [0.3, 0.4, 0.3] as const }, cabinet);
    let inside = 0;
    for (let i = 0; i < c.count; i++) {
      const [x, y, z] = [c.pos[i * 3]!, c.pos[i * 3 + 1]!, c.pos[i * 3 + 2]!];
      if (x > -0.15 && x < 0.15 && y > -0.275 && y < 0.275 && z > -0.12 && z < 0.12) inside++;
    }
    expect(inside).toBe(0);
    expect(c.count).toBe(500);
  });
});
