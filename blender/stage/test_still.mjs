// Current-best test render: the one command every thread uses for test stills and short clips.
//
//   node blender/stage/test_still.mjs                     frame 1280, wide meter shot, 48 samples
//   node blender/stage/test_still.mjs --frames 1040,1280  several stills (show cameras, not the meter shot)
//   node blender/stage/test_still.mjs --clip 1272,1343    ~3 s clip (72 frames at the drive fps, 24)
//   options: --name <n>  --drive <drive.json>  --samples <n>  --half  --show-cams  --rebuild  --no-grade
//
// It builds blender/scenes/void.blend from THIS checkout when the speaker sources changed, then
// stacks the current look on top, in this order (all in blender/stage/):
//   apply_drive.py -> look_test.py (f-stops, gel rolloff) -> wall_test.py (LED wall + meter frames)
//   -> photo_test.py (Shakify 30 %, OSL lens, film finish) -> meter_cam.py -> wave_test.py (air
//   ripples, dust push; renders) -> ffmpeg print_soft.cube grade.
// Output: out/current-best/<name>/  (<name>_<frame>.png raw, <name>_<frame>_graded.jpg, log).
// Refuses to start while another Blender is running (one GPU).
import { spawnSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lookEnv, lookScripts, metersFor, GRADE_VF } from "./look.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const BLENDER = process.env.BLENDER || "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const flag = (k) => args.includes(k);

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
const commit = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim();
const name = opt("--name", `cb_${commit}_${stamp}`);
const drive = path.resolve(ROOT, opt("--drive", "blender/jobs/psychidelly.drive.json"));
const samples = opt("--samples", "48");
const clip = opt("--clip");
const frames = opt("--frames", "1280");
// --meters <folder of <frame>.png>: the LED wall's screen images; default: this drive's meters
// (look.mjs metersFor). --wall waveform: the old plain waveform instead (never by accident).
let meters;
try {
  meters = metersFor({ drivePath: drive, name: path.basename(drive).replace(/\.drive\.json$/, ""),
    explicit: opt("--meters") && path.resolve(ROOT, opt("--meters")), wall: opt("--wall") });
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
const outDir = path.join(ROOT, "out", "current-best", name);
const showCams = flag("--show-cams") || (!clip && opt("--frames") && frames.includes(","));

// ---- one GPU: never start while another render runs
// (only background renders count: an open Blender window, e.g. the live link, is fine)
const tasks = execSync(
  "powershell -NoProfile -Command \"Get-CimInstance Win32_Process -Filter \\\"Name='blender.exe'\\\" | ForEach-Object { $_.CommandLine }\"",
).toString();
if (tasks.split(/\r?\n/).some((l) => /\s-b\s/.test(` ${l} `))) {
  console.error("Another Blender render is running. Wait for it to finish, then run this again.");
  process.exit(2);
}
if (clip) {
  const [a, b] = clip.split(",").map(Number);
  if (b - a + 1 > 100) {
    console.error(`Clip is ${b - a + 1} frames; tests are ~3 s (<= 100 frames).`);
    process.exit(2);
  }
}

// ---- rebuild the scene when any speaker/scene source is newer than the .blend
const blend = path.resolve(ROOT, opt("--blend", "blender/scenes/void.blend")); // --blend: A/B against another scene
const sources = ["build_scene.py", "speaker_finish.py", "speaker_wear.py", "rigkit.py", "kits/PMC6-2.json", "kits/PMC6-2.waveguide.json"]
  .map((f) => path.join(ROOT, "blender", f))
  .filter((f) => fs.existsSync(f));
const stale = !fs.existsSync(blend) || sources.some((f) => fs.statSync(f).mtimeMs > fs.statSync(blend).mtimeMs);
fs.mkdirSync(outDir, { recursive: true });
const logPath = path.join(outDir, `${name}.log`);
const log = fs.openSync(logPath, "w");
if ((stale && !opt("--blend")) || flag("--rebuild")) {
  console.log("building void.blend from this checkout ...");
  const r = spawnSync(BLENDER, ["-b", "-P", path.join(ROOT, "blender", "build_scene.py")], {
    cwd: ROOT,
    env: { ...process.env, EXCURSION_SCENE: "void" },
    stdio: ["ignore", log, log],
  });
  if (r.status !== 0) {
    console.error(`scene build failed, see ${logPath}`);
    process.exit(1);
  }
}

// ---- the current look (blender/stage/look.mjs: the same look full reels use)
const env = {
  ...process.env,
  ...lookEnv({ out: outDir, name, meters, half: flag("--half"),
    render: clip ? { clip } : { frames } }),
};
const chain = ["-b", "-y", blend, "-P", path.join(ROOT, "blender", "apply_drive.py"),
  ...lookScripts({ meterCam: !showCams, debugLights: !!(process.env.CB_LIGHTS_OFF || process.env.CB_WALL_OFF) }),
  "--", drive, "--engine", "cycles", "--samples", samples];
console.log(`rendering ${clip ? "clip " + clip : "frames " + frames} at ${samples} samples -> ${outDir}`);
const r = spawnSync(BLENDER, chain, { cwd: ROOT, env, stdio: ["ignore", log, log] });
fs.closeSync(log);
const text = fs.readFileSync(logPath, "utf8");
if (/Failed to load image|missing texture/i.test(text)) console.warn("WARNING: missing textures in the log (magenta risk)");
if (r.status !== 0) {
  console.error(`render failed, see ${logPath}`);
  process.exit(1);
}

// ---- grade (print_soft LUT + deep blacks, look.mjs) for review copies
if (!flag("--no-grade")) {
  if (clip) {
    const seq = path.join(outDir, name, "%04d.png");
    const [a] = clip.split(",");
    spawnSync("ffmpeg", ["-v", "error", "-y", "-framerate", String(JSON.parse(fs.readFileSync(drive, "utf8")).fps || 30), "-start_number", a, "-i", seq,
      "-vf", GRADE_VF, "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
      path.join(outDir, `${name}_graded.mp4`)], { stdio: "inherit" });
  } else {
    for (const f of frames.split(",")) {
      const raw = path.join(outDir, `${name}_${String(f).padStart(4, "0")}.png`);
      spawnSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-vf", GRADE_VF, "-q:v", "2",
        raw.replace(/\.png$/, "_graded.jpg")], { stdio: "inherit" });
    }
  }
}
fs.writeFileSync(path.join(outDir, "source.txt"), `commit ${commit}\nbranch claude/project-thread-11phqh (current best)\n`);
console.log(`done: ${outDir}`);
