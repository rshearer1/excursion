// Multicam view: the angles in angles.json rendered one after another (one GPU) and joined
// side by side into one picture or clip.
//
//   node blender/stage/multicam.mjs                      still, frame 1280
//   node blender/stage/multicam.mjs --frames 1320        another frame
//   node blender/stage/multicam.mjs --clip 1272,1343     ~3 s clip
//   options: --name <n>  --half  --samples <n>  --drive <drive.json>
//
// Each angle is an ordinary test_still.mjs run on blender/scenes/void-pair.blend, so it carries
// the whole saved look. Output: out/current-best/<name>/<name>_multicam.jpg or .mp4.
// It takes as long as one render per angle.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const args = process.argv.slice(2);
const opt = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const name = opt("--name", "multicam");
const clip = opt("--clip");
const frames = opt("--frames", "1280");
if (!clip && frames.includes(",")) {
  console.error("multicam takes one frame (--frames 1320) or one clip (--clip a,b).");
  process.exit(2);
}
const { angles } = JSON.parse(fs.readFileSync(path.join(HERE, "angles.json"), "utf8"));
const pass = ["--half", "--samples", "--drive"].flatMap((k) =>
  args.includes(k) ? (k === "--half" ? [k] : [k, opt(k)]) : []);

const parts = [];
for (const a of angles) {
  const part = `${name}-${a.name}`;
  const env = { ...process.env };
  for (const k of ["MC_LOC", "MC_AIM", "MC_LENS", "MC_FOCUS", "MC_FSTOP", "MC_SHIFT"]) {
    if (a[k] !== undefined) env[k] = String(a[k]);
    else delete env[k];
  }
  console.log(`angle ${a.name} ...`);
  const r = spawnSync("node", [path.join(HERE, "test_still.mjs"), ...(clip ? ["--clip", clip] : ["--frames", frames]),
    "--blend", "blender/scenes/void-pair.blend", "--name", part, ...pass], { cwd: ROOT, env, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`angle ${a.name} failed; nothing was joined.`);
    process.exit(1);
  }
  const dir = path.join(ROOT, "out", "current-best", part);
  parts.push(clip ? path.join(dir, `${part}_graded.mp4`) : path.join(dir, `${part}_${String(frames).padStart(4, "0")}_graded.jpg`));
}

const outDir = path.join(ROOT, "out", "current-best", name);
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${name}_multicam.${clip ? "mp4" : "jpg"}`);
const inputs = parts.flatMap((p) => ["-i", p]);
const stack = `${parts.map((_, i) => `[${i}]`).join("")}hstack=${parts.length}`;
const enc = clip ? ["-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p"] : ["-q:v", "2"];
const j = spawnSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", stack, ...enc, out], { stdio: "inherit" });
if (j.status !== 0) process.exit(1);
console.log(`multicam: ${out}`);
