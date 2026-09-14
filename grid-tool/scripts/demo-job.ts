// Excursion — write a demo job (WAV + drive.json) into blender/jobs/ without the browser UI.
//
//   npm run demo-job            (from grid-tool/)
//
// Uses the engine's deterministic 140 BPM halftime test track (kick on 1, snare on 3), the
// same feature extraction and drive builder the UI calls, and a 2-bar cut cadence so the
// multi-camera path is exercised. Then:
//
//   node blender/make_reel.mjs blender/jobs/demo-140-halftime.drive.json --draft

import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { synthTestTrack } from "../src/engine/synth";
import { extractFeatures } from "../src/engine/features";
import { buildDrive } from "../src/engine/exporter";
import { coneMotion, MID_DOME } from "../src/engine/cone";
import { computeCuts } from "../src/engine/cuts";
import type { Grid } from "../src/engine/grid";

const SR = 44100;
const FPS = 30;
const BARS = 8;
const NAME = "demo-140-halftime";
const grid: Grid = { bpm: 140, offsetMs: 150, beatsPerBar: 4, halftime: true };

function encodeWav16(mono: Float32Array, sampleRate: number): Buffer {
  const data = Buffer.alloc(mono.length * 2);
  for (let i = 0; i < mono.length; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]!));
    data.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const signal = synthTestTrack({ bpm: grid.bpm, offsetMs: grid.offsetMs, bars: BARS, sampleRate: SR });
const durationSec = signal.length / SR;
const wav = encodeWav16(signal, SR);
const sha1 = createHash("sha1").update(wav).digest("hex");

const features = extractFeatures(signal, SR, { fps: FPS });
const drive = buildDrive({
  fileName: `${NAME}.wav`,
  sha1,
  durationSec,
  grid,
  fps: FPS,
  scene: "void",
  mood: "smoke",
  features,
  cone: coneMotion(signal, SR, { fps: FPS }),
  dome: coneMotion(signal, SR, { fps: FPS, ...MID_DOME }),
  cuts: computeCuts(grid, durationSec, { everyBars: 2 }),
});

const jobsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "blender", "jobs");
mkdirSync(jobsDir, { recursive: true });
writeFileSync(path.join(jobsDir, `${NAME}.wav`), wav);
writeFileSync(path.join(jobsDir, `${NAME}.drive.json`), JSON.stringify(drive));
console.log(
  `wrote blender/jobs/${NAME}.{wav,drive.json} — ${durationSec.toFixed(2)} s, ` +
    `${drive.frames.length} frames, ${drive.beats.length} beats, ${drive.cuts.length} cuts`,
);
