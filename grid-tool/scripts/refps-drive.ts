// Excursion — remake a drive.json's per-frame data at another frame rate (e.g. 30 -> 24 fps).
//
//   npm run refps-drive -- <track.drive.json> --fps 24 [--out other.drive.json]
//
// Everything in the drive is in seconds (grid, beats, cuts, sections, events, range, show, rig)
// except the per-frame list, so only `frames` and `fps` change: bass/mid/high/onset/beatPhase
// and the cone and mid-dome motion are recomputed from the track's WAV (next to the drive) at
// the new rate with the same code the grid tool uses. Writes in place unless --out is given;
// the old file is kept as <name>.drive.<oldfps>fps.json.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractFeatures } from "../src/engine/features";
import { buildDrive } from "../src/engine/exporter";
import { coneMotion, MID_DOME } from "../src/engine/cone";

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const drivePath = args.find((a, i) => !a.startsWith("--") && !["--fps", "--out"].includes(args[i - 1] ?? ""));
const fps = Number(opt("--fps"));
if (!drivePath || !Number.isFinite(fps) || fps <= 0) {
  console.error("usage: npm run refps-drive -- <track.drive.json> --fps 24 [--out other.drive.json]");
  process.exit(1);
}
const absDrive = path.resolve(drivePath);
const old = JSON.parse(readFileSync(absDrive, "utf8"));
if (old.fps === fps) {
  console.log(`${path.basename(absDrive)} is already ${fps} fps`);
  process.exit(0);
}
const wavPath = path.join(path.dirname(absDrive), old.audio.file);
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

const { mono, sampleRate } = decodeWav(readFileSync(wavPath));
const durationSec = mono.length / sampleRate;
const built = buildDrive({
  fileName: old.audio.file,
  sha1: old.audio.sha1,
  durationSec,
  grid: old.grid,
  fps,
  scene: old.scene,
  mood: old.mood,
  features: extractFeatures(mono, sampleRate, { fps }),
  cone: coneMotion(mono, sampleRate, { fps }),
  dome: coneMotion(mono, sampleRate, { fps, ...MID_DOME }),
});
const next = { ...old, fps, frames: built.frames };
const out = path.resolve(opt("--out") ?? absDrive);
if (out === absDrive) copyFileSync(absDrive, absDrive.replace(/\.drive\.json$/, `.drive.${old.fps}fps.json`));
writeFileSync(out, JSON.stringify(next));
console.log(`${path.basename(absDrive)}: ${old.fps} fps (${old.frames.length} frames) -> ${fps} fps (${built.frames.length} frames) -> ${out}`);
