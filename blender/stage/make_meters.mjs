// Meter frames for the LED wall: an oscilloscope, a stereo vectorscope and a spectrum, drawn by
// ffmpeg straight from the track's audio, one PNG per scene frame across the drive's whole range.
//
//   node blender/stage/make_meters.mjs [--drive <drive.json>] [--out out/meters]
//
// Writes <out>/<frame>.png (unpadded scene frame numbers, as test_still.mjs and wall_test.py expect)
// for every frame of drive.range, so the screen moves in any test window. Old numbered PNGs in
// <out> are removed first. Replace the folder with real MiniMeters footage (same naming) when it
// exists; nothing else changes.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const drivePath = path.resolve(ROOT, opt("--drive", "blender/jobs/psychidelly.drive.json"));
const outDir = path.resolve(ROOT, opt("--out", "out/meters"));
const drive = JSON.parse(fs.readFileSync(drivePath, "utf-8"));
const fps = drive.fps;
const first = drive.range ? Math.max(1, Math.round(drive.range.start * fps) + 1) : 1;
const last = drive.range ? Math.min(drive.frames.length, Math.round(drive.range.end * fps)) : drive.frames.length;
const count = last - first + 1;
const audio = path.join(path.dirname(drivePath), drive.audio.file);

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) {
  if (/^\d+\.png$/.test(f)) fs.unlinkSync(path.join(outDir, f));
}

// ffmpeg's drawtext wants the font path escaped: C\:/Windows/Fonts/...
const font = "C\\:/Windows/Fonts/arialbd.ttf";
const panel = "drawbox=x=0:y=0:w=iw:h=ih:color=0x2a2a34@1:t=3";
const label = (t) => `drawtext=fontfile='${font}':text='${t}':x=10:y=8:fontsize=14:fontcolor=0x8888a0`;
const graph = [
  `color=c=0x0e0e12:s=1280x768:r=${fps}[bg]`,
  `[0:a]asplit=3[a1][a2][a3]`,
  `[a1]showwaves=s=628x372:mode=cline:rate=${fps}:colors=0xc8b4ff:scale=sqrt:draw=full,format=rgba,colorkey=black:0.05,${panel},${label("OSCILLOSCOPE")}[wave]`,
  `[a2]avectorscope=s=628x372:mode=lissajous:draw=line:scale=sqrt:rc=200:gc=160:bc=255:rf=30:gf=30:bf=30:zoom=1.2:rate=${fps},format=rgba,colorkey=black:0.05,${panel},${label("STEREO")}[vec]`,
  `[a3]showcqt=s=1268x372:rate=${fps}:bar_g=2:sono_h=0:axis=0:basefreq=30:endfreq=14000:bar_v=12,format=rgba,colorkey=black:0.05,${panel},${label("SPECTRUM")}[cqt]`,
  `[bg][wave]overlay=6:6:shortest=1[b1]`,
  `[b1][vec]overlay=646:6[b2]`,
  `[b2][cqt]overlay=6:390,format=rgb24[v]`,
].join(";");

const start = (first - 1) / fps; // scene frame f shows the audio at (f - 1) / fps, as apply_drive does
const r = spawnSync("ffmpeg", [
  "-v", "error", "-y", "-ss", start.toFixed(4), "-i", audio,
  "-filter_complex", graph, "-map", "[v]", "-r", String(fps), "-frames:v", String(count),
  "-start_number", String(first), path.join(outDir, "%d.png"),
], { stdio: "inherit" });
if (r.status !== 0) {
  console.error("ffmpeg failed");
  process.exit(1);
}
// which track these meters belong to (make_reel.mjs checks it)
fs.writeFileSync(path.join(outDir, "drive.txt"), path.basename(drivePath));
const made = fs.readdirSync(outDir).filter((f) => /^\d+\.png$/.test(f)).length;
console.log(`meters: ${made} frames ${first}..${last} -> ${outDir}`);
