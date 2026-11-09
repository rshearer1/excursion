// Excursion — one command from drive.json to reel.mp4.
//
//   node blender/make_reel.mjs blender/jobs/track.drive.json [more drives: a batch] [--engine eevee|cycles] [--draft] [--test] [--mood name] [--rig name] [--rebuild] [--lut look.cube] [--audio path] [--sweep deg] [--shutter 0..1] [--slate] [--crf n]
//
// Steps: fetch scene assets -> build scene if missing (or its room file changed) -> apply drive + render frames -> ffmpeg mux.
// Audio is resolved from drive.audio.file sitting NEXT TO the drive.json (or pass --audio).
// Set BLENDER env var if blender is not on PATH.

import { spawn } from "node:child_process";
import { access, readFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const valueFlags = new Set(["--engine", "--audio", "--sweep", "--shutter", "--crf", "--samples", "--mood", "--lut"]);
const drivePaths = args.filter((a, i) => !a.startsWith("--") && !valueFlags.has(args[i - 1] ?? ""));
if (drivePaths.length > 1) {
  // batch: one reel after another, same flags; a failure stops the batch
  for (const p of drivePaths) {
    await run(process.execPath, [fileURLToPath(import.meta.url), p, ...args.filter((a) => !drivePaths.includes(a))], `reel ${p}`);
  }
  process.exit(0);
}
const drivePath = drivePaths[0];
if (!drivePath) {
  console.error("usage: node blender/make_reel.mjs <drive.json> [--engine eevee|cycles] [--draft] [--test] [--audio path]");
  process.exit(1);
}
const flag = (name) => args.includes(name);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const engine = opt("--engine", "eevee");
const draft = flag("--draft");
const test = flag("--test");
const blender = process.env.BLENDER || "blender";
const exists = (p) => access(p).then(() => true, () => false);

function run(cmd, argv, label, env = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n=== ${label}\n${cmd} ${argv.join(" ")}`);
    const child = spawn(cmd, argv, { stdio: "inherit", env: { ...process.env, ...env } });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${label} exited ${code}`))));
  });
}

const drive = JSON.parse(await readFile(drivePath, "utf8"));
const range = drive.range;
const startFrame = range ? Math.max(1, Math.round(range.start * drive.fps) + 1) : 1;
const name = path.basename(drivePath).replace(/\.drive\.json$/, "");
const sceneName = drive.scene || "void";
const sceneBlend = path.join(root, "blender", "scenes", `${sceneName}.blend`);
// a room (presets/rooms/<scene>.json) builds on one of the four bases; its assets are the base's
const roomFile = path.join(root, "presets", "rooms", `${sceneName}.json`);
const room = (await exists(roomFile)) ? JSON.parse(await readFile(roomFile, "utf8")) : null;
const manifest = path.join(root, "blender", "scenes", `${room?.base || sceneName}.manifest.json`);
const roomNewer = room && (await exists(sceneBlend)) && (await stat(roomFile)).mtimeMs > (await stat(sceneBlend)).mtimeMs;
const framesDir = path.join(root, "frames", name);
const outDir = path.join(root, "out");
const audio = opt("--audio", path.join(path.dirname(path.resolve(drivePath)), drive.audio.file));

if (await exists(manifest)) {
  await run(process.execPath, [path.join(root, "scripts", "fetch-assets.mjs"), manifest], "fetch assets");
}
if (!(await exists(sceneBlend)) || roomNewer || flag("--rebuild")) {
  // every scene comes from the one builder: EXCURSION_SCENE picks the set
  await run(blender, ["-b", "-P", path.join(root, "blender", "build_scene.py")], `build scene ${sceneName}`, { EXCURSION_SCENE: sceneName });
}

const applyArgs = [
  "-b", sceneBlend,
  "-P", path.join(root, "blender", "apply_drive.py"),
  "--", path.resolve(drivePath), "--render", "--out", framesDir, "--engine", engine,
];
if (draft) applyArgs.push("--draft");
if (test) applyArgs.push("--test");
if (opt("--sweep")) applyArgs.push("--sweep", opt("--sweep"));
if (opt("--shutter")) applyArgs.push("--shutter", opt("--shutter"));
if (flag("--slate")) applyArgs.push("--slate");
if (opt("--samples")) applyArgs.push("--samples", opt("--samples"));
if (opt("--mood")) applyArgs.push("--mood", opt("--mood"));
if (opt("--rig")) applyArgs.push("--rig", opt("--rig"));
await run(blender, applyArgs, "apply drive + render");

await mkdir(outDir, { recursive: true });
const reel = path.join(outDir, `${name}${draft ? ".draft" : ""}.mp4`);
const ffmpegArgs = [
  "-y",
  "-framerate", String(drive.fps),
  "-start_number", String(startFrame),
  "-i", path.join(framesDir, "%04d.png"),
];
if (await exists(audio)) {
  if (range) ffmpegArgs.push("-ss", String(range.start), "-t", String(range.end - range.start));
  ffmpegArgs.push("-i", audio, "-c:a", "aac", "-shortest");
} else {
  console.warn(`warning: audio not found at ${audio} — writing silent video (use --audio)`);
}
if (opt("--lut")) {
  // a display-referred .cube LUT applied at mux time: a look without a re-render
  ffmpegArgs.push("-vf", `lut3d=${path.resolve(opt("--lut")).split(String.fromCharCode(92)).join("/").split(":").join(String.fromCharCode(92) + ":")}`);
}
ffmpegArgs.push("-c:v", "libx264", "-crf", opt("--crf", "20"), "-pix_fmt", "yuv420p", reel);
await run("ffmpeg", ffmpegArgs, "mux reel");

console.log(`\ndone: ${reel}`);
