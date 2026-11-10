// Current-best test render: the one command every thread uses for test stills and short clips.
//
//   node blender/stage/test_still.mjs                     frame 1600, wide meter shot, 48 samples
//   node blender/stage/test_still.mjs --frames 1300,1600  several stills (show cameras, not the meter shot)
//   node blender/stage/test_still.mjs --clip 1590,1661    ~3 s clip (72 frames at 24 fps)
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
const frames = opt("--frames", "1600");
// --meters: a folder of <frame>.png screen images (the wall starts at the lowest frame number)
const meterDir = path.resolve(ROOT, opt("--meters", "out/meters"));
const meterFrames = fs.existsSync(meterDir) ? fs.readdirSync(meterDir).filter((f) => /^\d+\.png$/.test(f)).map((f) => parseInt(f, 10)) : [];
const meters = meterFrames.length ? path.join(meterDir, `${Math.min(...meterFrames)}.png`) : path.join(meterDir, "none.png");
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
  if (b - a + 1 > 80) {
    console.error(`Clip is ${b - a + 1} frames; tests are ~3 s (<= 80 frames).`);
    process.exit(2);
  }
}

// ---- rebuild the scene when any speaker/scene source is newer than the .blend
const blend = path.resolve(ROOT, opt("--blend", "blender/scenes/void.blend")); // --blend: A/B against another scene
const sources = ["build_scene.py", "speaker_finish.py", "speaker_wear.py", "rigkit.py", "kits/PMC6-2.json"]
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

// ---- the current look (v6 picks + meters on the wall)
const env = {
  ...process.env,
  LT_OUT: outDir, LT_NAME: name, LT_FIX: "1", LT_NORENDER: "1", LT_NOSHAKE: "1",
  WALL_IMAGE: meters, WALL_IMG_GAIN: "10",
  V4_SHAKE: "1", V4_SHAKE_INFLUENCE: "0.3", V4_LENS: "1", V4_FILM: "1",
  WT_NAME: name, WT_OUT: outDir, WT_A: "0", WT_B: "1",
  WT_BACKLIGHT: "0", WT_RIP_W: "0.1", WT_SMOKE_GAIN: "3", WT_HAZE_BUMP: "0", WT_DUST_PUSH: "0.1",
};
if (flag("--half")) Object.assign(env, { LT_HALF: "1", WT_HALF: "1" });
if (clip) env.WT_CLIP = clip;
else env.WT_FRAMES = frames;
if (!fs.existsSync(meters)) {
  console.warn(`no meter frames at ${meters}: the wall shows the plain waveform instead`);
  delete env.WALL_IMAGE;
}

const S = (f) => path.join(HERE, f);
const chain = ["-b", "-y", blend, "-P", path.join(ROOT, "blender", "apply_drive.py"),
  "-P", S("look_test.py"), "-P", S("wall_test.py"), "-P", S("photo_test.py")];
if (!showCams) chain.push("-P", S("meter_cam.py"));
chain.push("-P", S("wave_test.py"), "--", drive, "--engine", "cycles", "--samples", samples);
console.log(`rendering ${clip ? "clip " + clip : "frames " + frames} at ${samples} samples -> ${outDir}`);
const r = spawnSync(BLENDER, chain, { cwd: ROOT, env, stdio: ["ignore", log, log] });
fs.closeSync(log);
const text = fs.readFileSync(logPath, "utf8");
if (/Failed to load image|missing texture/i.test(text)) console.warn("WARNING: missing textures in the log (magenta risk)");
if (r.status !== 0) {
  console.error(`render failed, see ${logPath}`);
  process.exit(1);
}

// ---- grade (print_soft LUT) for review copies; the LUT lifts blacks, so press them back down
// (the void stays black, the speaker stays black paint, not grey)
const BLACKS = "curves=all='0/0 0.25/0.12 0.6/0.55 1/1'";
if (!flag("--no-grade")) {
  const lut = path.join(HERE, "luts", "print_soft.cube").replace(/\\/g, "/").replace(/^([A-Z]):/, "$1\\:");
  if (clip) {
    const seq = path.join(outDir, name, "%04d.png");
    const [a] = clip.split(",");
    spawnSync("ffmpeg", ["-v", "error", "-y", "-framerate", "24", "-start_number", a, "-i", seq,
      "-vf", `lut3d='${lut}',${BLACKS}`, "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
      path.join(outDir, `${name}_graded.mp4`)], { stdio: "inherit" });
  } else {
    for (const f of frames.split(",")) {
      const raw = path.join(outDir, `${name}_${String(f).padStart(4, "0")}.png`);
      spawnSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-vf", `lut3d='${lut}',${BLACKS}`, "-q:v", "2",
        raw.replace(/\.png$/, "_graded.jpg")], { stdio: "inherit" });
    }
  }
}
fs.writeFileSync(path.join(outDir, "source.txt"), `commit ${commit}\nbranch claude/project-thread-11phqh (current best)\n`);
console.log(`done: ${outDir}`);
