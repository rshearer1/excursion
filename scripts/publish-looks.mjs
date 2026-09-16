// Excursion — publish a handful of render stills so they can be reviewed off the home box.
//
//   node scripts/publish-looks.mjs [--video out/track.mp4]... [--dir out/looksheet]
//                                  [--label "handoff pass 2"] [--out looks] [--no-git]
//
// Copies every PNG in --dir (default out/looksheet) into looks/<date>[-<label>]/ as JPEGs no
// wider than 1080 px (ffmpeg; plain copy if ffmpeg is missing), pulls one frame every 10 s
// from each --video (max 6), writes notes.md listing the sources, then commits and pushes
// that folder. Renders themselves stay ignored (out/, frames/); looks/ is the one place
// small review stills are allowed in git.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};
const flag = (name) => args.includes(name);
const videos = [];
for (let i = 0; i < args.length; i++) if (args[i] === "--video" && args[i + 1]) videos.push(args[++i]);

const srcDir = path.resolve(ROOT, opt("--dir", "out/looksheet"));
const label = opt("--label", "");
const outRoot = path.resolve(ROOT, opt("--out", "looks"));
const noGit = flag("--no-git");

const stamp = new Date().toISOString().slice(0, 10);
const slug = label ? `${stamp}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}` : stamp;
const dest = path.join(outRoot, slug);

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
if (!hasFfmpeg) console.warn("ffmpeg not found — copying PNGs as they are (bigger files) and skipping --video.");

fs.mkdirSync(dest, { recursive: true });
const written = [];

const pngs = fs.existsSync(srcDir)
  ? fs.readdirSync(srcDir).filter((f) => /\.png$/i.test(f)).sort()
  : [];
for (const f of pngs) {
  const src = path.join(srcDir, f);
  if (hasFfmpeg) {
    const out = path.join(dest, f.replace(/\.png$/i, ".jpg"));
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-vf", "scale='min(1080,iw)':-2", "-q:v", "4", out]);
    written.push(path.basename(out));
  } else {
    const out = path.join(dest, f);
    fs.copyFileSync(src, out);
    written.push(f);
  }
}

if (hasFfmpeg) {
  for (const v of videos) {
    const src = path.resolve(ROOT, v);
    const base = path.basename(src).replace(/\.[^.]+$/, "");
    const pattern = path.join(dest, `${base}_%02d.jpg`);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-vf", "fps=1/10,scale='min(1080,iw)':-2", "-frames:v", "6", "-q:v", "4", pattern]);
    for (const f of fs.readdirSync(dest)) if (f.startsWith(`${base}_`) && f.endsWith(".jpg")) written.push(f);
  }
}

if (written.length === 0) {
  console.error(`Nothing to publish: no PNGs in ${srcDir}${videos.length ? " and no frames extracted" : ""}.`);
  process.exit(1);
}

let head = "unknown";
try {
  head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
} catch {
  /* not a git checkout */
}
const notes = [
  `# Stills — ${slug}`,
  "",
  `Scene code at commit ${head}. Sources: ${srcDir.replace(ROOT + path.sep, "")}${videos.length ? ", " + videos.join(", ") : ""}.`,
  label ? `Label: ${label}` : "",
  "",
  ...[...new Set(written)].sort().map((f) => `- ${f}`),
  "",
  "Reviewed against blender/PHOTOREAL-HANDOFF.md items — notes go below this line.",
  "",
].join("\n");
fs.writeFileSync(path.join(dest, "notes.md"), notes);

const total = fs.readdirSync(dest).reduce((n, f) => n + fs.statSync(path.join(dest, f)).size, 0);
console.log(`${written.length} still(s) → ${path.relative(ROOT, dest)} (${(total / 1024 / 1024).toFixed(1)} MB)`);

if (!noGit) {
  const rel = path.relative(ROOT, dest);
  execFileSync("git", ["add", rel], { cwd: ROOT, stdio: "inherit" });
  execFileSync("git", ["commit", "-q", "-m", `looks: stills ${slug}`], { cwd: ROOT, stdio: "inherit" });
  execFileSync("git", ["push"], { cwd: ROOT, stdio: "inherit" });
  console.log(`Pushed. Tell Claude: "assess looks/${slug}".`);
}
