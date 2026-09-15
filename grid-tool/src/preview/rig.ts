// Pure, renderer-free mapping from drive data to what the 3D preview shows.
// No three.js here on purpose: this file is unit-tested in node.

import type { DriveFrame } from "../engine/exporter";

/** The subset of drive.json the preview needs (the in-memory exporter output satisfies it). */
export interface DriveLike {
  fps: number;
  beats: number[];
  cuts: number[];
  frames: DriveFrame[];
}

export interface RigState {
  /** Woofer cone travel in mm (0 .. FULL_TRAVEL_MM). */
  excursionMm: number;
  /** Cone velocity in m/s along the throw axis: + outward, - return stroke. */
  coneVelocity: number;
  /** Tweeter emission 0..1. */
  tweeter: number;
  /** Sync-slate flash 0..1, 1 on a beat, exponential decay. */
  slate: number;
  /** Key / rim light intensities 0..1. */
  key: number;
  rim: number;
  /** Which camera is live: cuts alternate 0/1. */
  cameraIndex: number;
}

/** Matches build_scene.py: the "Excursion" shape key moves the cone 6 mm. */
export const FULL_TRAVEL_MM = 6;
/** Slate flash time constant (seconds). */
const SLATE_TAU = 0.06;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

function frameIndex(d: DriveLike, t: number): number {
  return Math.min(d.frames.length - 1, Math.max(0, Math.floor(t * d.fps)));
}

export function rigStateAt(d: DriveLike, t: number): RigState {
  const i = frameIndex(d, t);
  const f = d.frames[i]!;
  const prev = d.frames[Math.max(0, i - 1)]!;
  const excursionMm = clamp01(f.bass) * FULL_TRAVEL_MM;
  const prevMm = clamp01(prev.bass) * FULL_TRAVEL_MM;
  const coneVelocity = ((excursionMm - prevMm) / 1000) * d.fps;

  let slate = 0;
  let lastBeat = -Infinity;
  for (const b of d.beats) {
    if (b <= t + 1e-9 && b > lastBeat) lastBeat = b;
  }
  if (lastBeat !== -Infinity) slate = Math.exp(-(t - lastBeat) / SLATE_TAU);

  let cutsBefore = 0;
  for (const c of d.cuts) if (c <= t + 1e-9) cutsBefore++;

  return {
    excursionMm,
    coneVelocity,
    tweeter: clamp01(f.high),
    slate,
    key: 0.55 + 0.45 * clamp01(f.mid),
    rim: 0.25 + 0.75 * clamp01(f.bass),
    cameraIndex: cutsBefore % 2,
  };
}

// ---------- dust ----------

export type Vec3 = readonly [number, number, number];

export interface Box {
  min: Vec3;
  max: Vec3;
}

export interface DustCloud {
  count: number;
  /** xyz triplets, metres. */
  pos: Float32Array;
  /** xyz triplets, m/s. */
  vel: Float32Array;
  /** per-point phase for the turbulence noise. */
  phase: Float32Array;
}

export interface Jet {
  origin: Vec3;
  /** unit vector the air moves along at positive speed. */
  axis: Vec3;
  halfAngleDeg: number;
  /** metres the jet reaches before fading to nothing. */
  reach: number;
  /** m/s at the mouth; negative sucks back toward the origin. */
  speed: number;
}

export interface DustParams {
  /** velocity multiplier per 1/30 s (0.9 = brisk, 1 = none). */
  drag: number;
  /** turbulence amplitude in m/s. */
  turbulence: number;
  /** seconds, drives the turbulence field. */
  time: number;
  /** wrap volume; points that leave it re-enter from the far side. */
  box?: Box;
}

/** Deterministic LCG in [0, 1). */
function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function makeDust(count: number, seed: number, box: Box): DustCloud {
  const r = rng(seed);
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) pos[i * 3 + k] = box.min[k]! + r() * (box.max[k]! - box.min[k]!);
    phase[i] = r() * Math.PI * 2;
  }
  return { count, pos, vel, phase };
}

const FRAME = 1 / 30;

export function stepDust(c: DustCloud, dt: number, jets: readonly Jet[], p: DustParams): void {
  const dragStep = Math.pow(p.drag, dt / FRAME);
  const cones = jets.map((j) => ({ ...j, cosHalf: Math.cos((j.halfAngleDeg * Math.PI) / 180) }));
  for (let i = 0; i < c.count; i++) {
    const o = i * 3;
    let vx = c.vel[o]!, vy = c.vel[o + 1]!, vz = c.vel[o + 2]!;
    const px = c.pos[o]!, py = c.pos[o + 1]!, pz = c.pos[o + 2]!;

    for (const j of cones) {
      const dx = px - j.origin[0], dy = py - j.origin[1], dz = pz - j.origin[2];
      const along = dx * j.axis[0] + dy * j.axis[1] + dz * j.axis[2];
      if (along <= 0 || along >= j.reach) continue;
      const dist = Math.hypot(dx, dy, dz);
      if (dist === 0 || along / dist < j.cosHalf) continue;
      const falloff = 1 - along / j.reach;
      const push = j.speed * falloff * dt * 30; // reach full jet speed in ~1 frame at the mouth
      vx += j.axis[0] * push;
      vy += j.axis[1] * push;
      vz += j.axis[2] * push;
    }

    if (p.turbulence > 0) {
      const a = p.time * 0.7 + c.phase[i]!;
      vx += p.turbulence * Math.sin(a + px * 9) * dt;
      vy += p.turbulence * Math.cos(a * 1.3 + py * 7) * dt;
      vz += p.turbulence * Math.sin(a * 0.8 + pz * 11) * dt;
    }

    vx *= dragStep; vy *= dragStep; vz *= dragStep;
    let nx = px + vx * dt, ny = py + vy * dt, nz = pz + vz * dt;
    if (p.box) {
      const b = p.box;
      const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
      if (nx < b.min[0]) nx += sx; else if (nx > b.max[0]) nx -= sx;
      if (ny < b.min[1]) ny += sy; else if (ny > b.max[1]) ny -= sy;
      if (nz < b.min[2]) nz += sz; else if (nz > b.max[2]) nz -= sz;
    }
    c.vel[o] = vx; c.vel[o + 1] = vy; c.vel[o + 2] = vz;
    c.pos[o] = nx; c.pos[o + 1] = ny; c.pos[o + 2] = nz;
  }
}
