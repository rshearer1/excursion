// Excursion — build a drive.json for a real track without the browser UI.
//
//   npm run track-job -- <track.wav> [--start s --end s] [--bpm n] [--offset ms]
//                        [--cuts bars] [--mood smoke|neon|clean] [--name slug]
//                        [--drop s[,s]] [--break s[,s]] [--auto seconds] [--hits]
//                        [--template name] [--scene room] [--rig name]
//
// --auto 20 picks the reel window for you: it finds the first drop (where the bass level
// first climbs to 70 % of the track's peak), starts a bar before it on a downbeat, runs for
// the given seconds, and adds a drop marker there unless --drop was given. The bass level is
// averaged over 4 s so an opening hit followed by an intro does not count.
//
// Copies the WAV into blender/jobs/<slug>.wav and writes <slug>.drive.json beside it, using
// the same feature extraction, cut cadence and drive builder the grid tool calls. Without
// --bpm/--offset the grid is detected: tempo and beat phase from a comb search over a combined
// onset envelope (spectral flux + bass/mid/high attacks, each normalised — the kick band alone
// is unreliable when sub-bass swamps it), downbeat from where the claps/snares land (beats 2
// and 4). Always check the result — the draft render's slate should flash on the beat.
//
// --template <name> applies presets/templates/<name>.json exactly as the grid tool's Apply
// button does: its scene preset (scene, cut cadence, lead, fps), mood, show preset (cue lanes
// laid onto this track's bars) and lyric styling. --mood and --cuts on the command line win
// over the template's. --scene picks a room (presets/rooms/ or a built-in base) and --rig a light
// rig from presets/rigs/; the rig goes into the drive inline.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFeatures } from "../src/engine/features";
import { buildDrive } from "../src/engine/exporter";
import { coneMotion, MID_DOME } from "../src/engine/cone";
import { computeCuts } from "../src/engine/cuts";
import { detectHits } from "../src/engine/hits";
import type { Grid } from "../src/engine/grid";
import { DEFAULT_LYRICS } from "../src/engine/lyrics";
import { PRESET_DIRS, applyTemplate, parsePreset, resolveTemplate, type Library, type Preset, type ReelState, type Template } from "../src/engine/presets";

const argv = process.argv.slice(2);
const input = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
if (!input) {
  console.error(
    "usage: npm run track-job -- <track.wav> [--start s --end s] [--bpm n] [--offset ms] [--cuts bars] [--mood m] [--name slug] [--drop s,..] [--break s,..]",
  );
  process.exit(1);
}
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const num = (name: string): number | undefined => {
  const v = opt(name);
  return v === undefined ? undefined : Number(v);
};

// ---------- WAV decode (PCM 16/24/32, float 32/64, extensible) -> mono ----------
function decodeWav(buf: Buffer): { mono: Float32Array; sampleRate: number } {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let pos = 12;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") {
      let format = buf.readUInt16LE(body);
      if (format === 0xfffe) format = buf.readUInt16LE(body + 24); // extensible: subformat GUID
      fmt = {
        format,
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      if (!fmt) throw new Error("data chunk before fmt chunk");
      const { format, channels, bits } = fmt;
      const bytes = bits / 8;
      const end = Math.min(buf.length, body + size);
      const frames = Math.floor((end - body) / (bytes * channels));
      const mono = new Float32Array(frames);
      const read = (o: number): number => {
        if (format === 3) return bits === 64 ? buf.readDoubleLE(o) : buf.readFloatLE(o);
        if (bits === 16) return buf.readInt16LE(o) / 0x8000;
        if (bits === 24) return buf.readIntLE(o, 3) / 0x800000;
        if (bits === 32) return buf.readInt32LE(o) / 0x80000000;
        throw new Error(`unsupported PCM bit depth ${bits}`);
      };
      for (let f = 0; f < frames; f++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += read(body + (f * channels + c) * bytes);
        mono[f] = sum / channels;
      }
      return { mono, sampleRate: fmt.sampleRate };
    }
    pos = body + size + (size % 2);
  }
  throw new Error("no data chunk");
}

// ---------- grid detection ----------
const ODF_FPS = 200; // onset-envelope resolution: 5 ms

function positiveDiff(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 1; i < x.length; i++) out[i] = Math.max(0, x[i]! - x[i - 1]!);
  return out;
}

/** Mean envelope value at the beat grid (bpm, phase in seconds), max over +-1 sample. */
function combScore(env: Float32Array, bpm: number, phase: number): number {
  const step = (60 / bpm) * ODF_FPS;
  let sum = 0;
  let n = 0;
  for (let t = phase * ODF_FPS; t < env.length - 1; t += step) {
    const i = Math.round(t);
    sum += Math.max(env[i - 1] ?? 0, env[i]!, env[i + 1] ?? 0);
    n++;
  }
  return n ? sum / n : 0;
}

function bestPhase(env: Float32Array, bpm: number): { phase: number; score: number } {
  const beatSec = 60 / bpm;
  let best = { phase: 0, score: -1 };
  for (let p = 0; p < beatSec; p += 1 / ODF_FPS) {
    const score = combScore(env, bpm, p);
    if (score > best.score) best = { phase: p, score };
  }
  return best;
}

function detectGrid(mono: Float32Array, sampleRate: number): Grid & { confidence: number } {
  const feats = extractFeatures(mono, sampleRate, { fps: ODF_FPS, fftSize: 1024 });
  const clap = positiveDiff(feats.high);
  const parts = [feats.flux, positiveDiff(feats.bass), positiveDiff(feats.mid), clap];
  const kick = new Float32Array(feats.frameCount); // the onset envelope the grid is fitted to
  for (const part of parts) {
    let mean = 0;
    for (const v of part) mean += v;
    mean = mean / part.length || 1;
    for (let i = 0; i < kick.length; i++) kick[i]! += part[i]! / mean / parts.length;
  }

  // coarse tempo, then fine
  let coarse = { bpm: 120, phase: 0, score: -1 };
  for (let bpm = 90; bpm <= 180; bpm += 0.1) {
    const r = bestPhase(kick, bpm);
    if (r.score > coarse.score) coarse = { bpm, ...r };
  }
  let fine = coarse;
  for (let bpm = coarse.bpm - 0.15; bpm <= coarse.bpm + 0.15; bpm += 0.005) {
    const r = bestPhase(kick, bpm);
    if (r.score > fine.score) fine = { bpm, ...r };
  }
  const bpm = Math.round(fine.bpm * 100) / 100;
  const { phase, score } = bestPhase(kick, bpm);

  // how much stronger the kick envelope is on the grid than half a beat off it
  const off = combScore(kick, bpm, phase + 30 / bpm);
  const confidence = off > 0 ? score / off : Infinity;

  // downbeat: of the 4 beat slots, the one whose +1 and +3 beats carry the most clap energy
  const beatSec = 60 / bpm;
  const barBpm = bpm / 4;
  let downSlot = 0;
  let downScore = -Infinity;
  for (let k = 0; k < 4; k++) {
    const p = phase + k * beatSec;
    const s =
      combScore(clap, barBpm, p + beatSec) +
      combScore(clap, barBpm, p + 3 * beatSec) -
      combScore(clap, barBpm, p) -
      combScore(clap, barBpm, p + 2 * beatSec);
    if (s > downScore) {
      downScore = s;
      downSlot = k;
    }
  }
  const offsetMs = Math.round((phase + downSlot * beatSec) * 1000 * 10) / 10;
  return { bpm, offsetMs, beatsPerBar: 4, halftime: false, confidence };
}

// ---------- main ----------
const FPS = 30;
const wavPath = path.resolve(input);
const bytes = readFileSync(wavPath);
const { mono, sampleRate } = decodeWav(bytes);
const durationSec = mono.length / sampleRate;
const slug =
  opt("--name") ??
  path
    .basename(wavPath)
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
console.log(`${path.basename(wavPath)}: ${durationSec.toFixed(2)} s @ ${sampleRate} Hz -> job "${slug}"`);

let grid: Grid;
const bpmArg = num("--bpm");
const offsetArg = num("--offset");
if (bpmArg !== undefined && offsetArg !== undefined) {
  grid = { bpm: bpmArg, offsetMs: offsetArg, beatsPerBar: 4, halftime: false };
  console.log(`grid (given): ${grid.bpm} BPM, downbeat offset ${grid.offsetMs} ms`);
} else {
  const t0 = Date.now();
  const detected = detectGrid(mono, sampleRate);
  grid = {
    bpm: bpmArg ?? detected.bpm,
    offsetMs: offsetArg ?? detected.offsetMs,
    beatsPerBar: 4,
    halftime: false,
  };
  console.log(
    `grid (detected in ${((Date.now() - t0) / 1000).toFixed(1)} s): ${grid.bpm} BPM, downbeat offset ` +
      `${grid.offsetMs} ms, on-beat/off-beat onset ratio ${detected.confidence.toFixed(2)}`,
  );
}


const features = extractFeatures(mono, sampleRate, { fps: FPS });

// --auto N: choose the window around the first drop from the bass envelope
let autoDrop: number | undefined;
let start = num("--start");
let end = num("--end");
const autoLen = num("--auto");
if (autoLen !== undefined && (start === undefined || end === undefined)) {
  const bass = features.bass;
  const win = 4 * FPS; // 4 s moving average: a single opening hit does not count as a drop
  const avg = new Float32Array(bass.length);
  let acc = 0;
  for (let i = 0; i < bass.length; i++) {
    acc += bass[i]!;
    if (i >= win) acc -= bass[i - win]!;
    avg[i] = acc / Math.min(i + 1, win);
  }
  const full = avg.subarray(win); // only complete windows count
  const peak = Math.max(...full);
  const dropFrame = win + full.findIndex((v) => v >= 0.7 * peak);
  const dropSec = Math.max(0, (dropFrame - win / 2) / FPS); // the average lags the edge by half a window
  const bar = (60 / grid.bpm) * grid.beatsPerBar;
  const offset = grid.offsetMs / 1000;
  const barsBefore = Math.floor((dropSec - offset) / bar) - 1;
  start = Math.max(0, offset + barsBefore * bar);
  end = Math.min(durationSec, start + autoLen);
  autoDrop = dropSec;
  console.log(`auto window: drop at ${dropSec.toFixed(2)} s -> range ${start.toFixed(2)}-${end.toFixed(2)} s`);
}

// --drop 26.5,58 / --break 40: section markers the scene reacts to (smoke, lights, camera)
const sections = [
  ...(opt("--drop") ?? "").split(",").filter(Boolean).map((t) => ({ t: Number(t), kind: "drop" })),
  ...(opt("--break") ?? "").split(",").filter(Boolean).map((t) => ({ t: Number(t), kind: "break" })),
].sort((a, b) => a.t - b.t);
if (autoDrop !== undefined && !sections.some((s) => s.kind === "drop")) sections.push({ t: autoDrop, kind: "drop" });
const range =
  start !== undefined && end !== undefined && end > start
    ? { start, end: Math.min(end, durationSec) }
    : undefined;

// --template: the same resolution the grid tool runs, from presets/ next to blender/
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
function readPresets(): Library & { templates: Record<string, Template> } {
  const lib: Library & { templates: Record<string, Template> } = { scenes: {}, shows: {}, lyrics: {}, moods: [], templates: {}, rigs: {} };
  const moodsDir = path.join(ROOT, "blender", "moods");
  if (existsSync(moodsDir)) lib.moods = readdirSync(moodsDir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  for (const dir of Object.values(PRESET_DIRS)) {
    const full = path.join(ROOT, "presets", dir);
    if (!existsSync(full)) continue;
    for (const f of readdirSync(full).filter((x) => x.endsWith(".json"))) {
      let p: Preset;
      try {
        p = parsePreset(readFileSync(path.join(full, f), "utf8"));
      } catch (e) {
        console.warn(`presets/${dir}/${f}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      if (p.kind === "scene") lib.scenes[p.name] = p;
      else if (p.kind === "show") lib.shows[p.name] = p;
      else if (p.kind === "lyrics") lib.lyrics[p.name] = p;
      else if (p.kind === "rig") lib.rigs![p.name] = p;
      else if (p.kind === "template") lib.templates[p.name] = p;
    }
  }
  return lib;
}
let reel: ReelState = {
  scene: "void",
  mood: opt("--mood") ?? "smoke",
  cutsEveryBars: num("--cuts") ?? 2,
  cutMarkers: true,
  leadMs: 0,
  fps: FPS,
  show: { lanes: {} },
  lyrics: structuredClone(DEFAULT_LYRICS),
};
const templateName = opt("--template");
const lib = templateName || opt("--rig") ? readPresets() : null;
if (templateName && lib) {
  const t = lib.templates[templateName];
  if (!t) {
    console.error(`no template presets/templates/${templateName}.json (have: ${Object.keys(lib.templates).join(", ") || "none"})`);
    process.exit(1);
  }
  const { resolved, missing } = resolveTemplate(t, lib);
  if (missing.length) console.warn(`template ${templateName}: missing ${missing.join(", ")} — applying the rest`);
  reel = applyTemplate(resolved, reel, grid);
  if (opt("--mood")) reel.mood = opt("--mood")!; // the command line wins
  if (num("--cuts") !== undefined) reel.cutsEveryBars = num("--cuts")!;
  console.log(`template ${templateName}: scene ${reel.scene}, mood ${reel.mood}, cuts every ${reel.cutsEveryBars} bars, ${Object.keys(reel.show.lanes).length} show lanes`);
}
if (opt("--scene")) reel.scene = opt("--scene")!;
if (opt("--rig")) reel.rig = opt("--rig")!;
const rig = reel.rig ? lib?.rigs?.[reel.rig] : undefined;
if (reel.rig && !rig) console.warn(`no rig presets/rigs/${reel.rig}.json — the room's own lights only`);

const drive = buildDrive({
  fileName: `${slug}.wav`,
  sha1: createHash("sha1").update(bytes).digest("hex"),
  durationSec,
  grid,
  fps: FPS,
  scene: reel.scene,
  mood: reel.mood,
  features,
  cone: coneMotion(mono, sampleRate, { fps: FPS }),
  dome: coneMotion(mono, sampleRate, { fps: FPS, ...MID_DOME }),
  sections,
  range,
  cuts: computeCuts(grid, durationSec, { everyBars: reel.cutsEveryBars, markerTimes: reel.cutMarkers ? sections.map((s) => s.t) : [] }),
  leadMs: reel.leadMs,
  show: reel.show,
  ...(rig ? { rig } : {}),
  // --hits: track kicks and snares (phase 09); shells and the logo then ride the kicks
  ...(process.argv.includes("--hits") ? { hits: detectHits(mono, sampleRate, { grid }) } : {}),
});

const jobsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "blender", "jobs");
mkdirSync(jobsDir, { recursive: true });
copyFileSync(wavPath, path.join(jobsDir, `${slug}.wav`));
writeFileSync(path.join(jobsDir, `${slug}.drive.json`), JSON.stringify(drive));
const inRange = (t: number): boolean => !range || (t >= range.start && t < range.end);
console.log(
  `wrote blender/jobs/${slug}.{wav,drive.json} — ${drive.frames.length} frames, ` +
    (drive.events ? `${drive.events.kick.filter(inRange).length} kicks and ${drive.events.snare.filter(inRange).length} snares in range, ` : "") +
    `${drive.beats.filter(inRange).length} beats and ${drive.cuts.filter(inRange).length} cuts in range` +
    (range ? ` ${range.start}-${range.end} s` : ""),
);
console.log(`next: node blender/make_reel.mjs blender/jobs/${slug}.drive.json --draft`);
