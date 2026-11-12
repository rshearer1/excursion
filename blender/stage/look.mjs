// The locked look (v11, agreed 2026-11-10), in one place so test stills and full reels match.
//
//   test_still.mjs  -> short tests (meter camera, 48 samples)
//   make_reel.mjs   -> full reels (show cameras), on by default with --engine cycles; --no-look turns it off
//
// The look is a chain of Blender scripts run after apply_drive.py (which must NOT get --render):
//   look_test.py (f-stops, gel rolloff) -> wall_test.py (LED wall + meter frames)
//   -> photo_test.py (Shakify 30 %, OSL lens, film finish) -> [meter_cam.py] -> wave_test.py (air
//   ripples, dust push; renders), then an ffmpeg grade: print_soft.cube + a deep-blacks curve.
// Blender must run with -y (Shakify's drivers are Python expressions).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..", "..");
const S = (f) => path.join(HERE, f);

// the LUT lifts blacks, so press them back down (the void stays black, the speaker black paint)
export const BLACKS = "curves=all='0/0 0.25/0.12 0.6/0.55 1/1'";
const lutPath = S(path.join("luts", "print_soft.cube")).replace(/\\/g, "/").replace(/^([A-Z]):/, "$1\\:");
export const GRADE_VF = `lut3d='${lutPath}',${BLACKS}`;

/** First image of a meter-frame folder (<frame>.png), or null when it has none. */
export function meterImage(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const nums = fs.readdirSync(dir).filter((f) => /^\d+\.png$/.test(f)).map((f) => parseInt(f, 10));
  return nums.length ? path.join(dir, `${Math.min(...nums)}.png`) : null;
}

/**
 * The meter frames for a drive, never the old plain waveform by accident (Robert rejected it):
 *   1. explicit: a folder the caller named (--meters); must hold frames
 *   2. out/meters when its drive.txt names this drive (the real MiniMeters capture)
 *   3. out/meters-<name>: drawn from the track by make_meters.mjs, made now if missing (silent: ffmpeg only)
 * wall "waveform" is the explicit opt-out (returns null). Throws with a plain message when
 * nothing can be found or made.
 */
export function metersFor({ drivePath, name, explicit, wall }) {
  if (wall === "waveform") return null;
  if (explicit) {
    const img = meterImage(explicit);
    if (!img) throw new Error(`no meter frames (<frame>.png) in ${explicit}`);
    return img;
  }
  const shared = path.join(ROOT, "out", "meters");
  const stampFile = path.join(shared, "drive.txt");
  const stamp = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, "utf8").trim() : "";
  if (path.basename(stamp) === path.basename(drivePath) && meterImage(shared)) return meterImage(shared);
  const own = path.join(ROOT, "out", `meters-${name}`);
  if (!meterImage(own)) {
    console.log(`look: no meter frames for ${path.basename(drivePath)}; drawing them from the track -> ${own}`);
    const r = spawnSync(process.execPath, [path.join(HERE, "make_meters.mjs"), "--drive", drivePath, "--out", own], { stdio: "inherit" });
    if (r.status !== 0 || !meterImage(own)) {
      throw new Error(`could not make meter frames for ${path.basename(drivePath)} (is its audio file next to it, and ffmpeg installed?). ` +
        `Fix that, pass --meters <folder>, or pass --wall waveform to use the plain waveform on the LED wall.`);
    }
  }
  return meterImage(own);
}

/**
 * Environment for the look scripts.
 * out/name: where wave_test.py writes (a clip lands in <out>/<name>/####.png).
 * meters: first meter image or null (the wall then shows the plain waveform).
 * render: { clip: "a,b" | "scene" } or { frames: "1600,..." }.
 */
export function lookEnv({ out, name, meters, half = false, render }) {
  const env = {
    LT_OUT: out, LT_NAME: name, LT_FIX: "1", LT_NORENDER: "1", LT_NOSHAKE: "1", LT_MBLUR: "1",
    WALL_IMG_GAIN: "10",
    V4_SHAKE: "1", V4_SHAKE_INFLUENCE: "0.3", V4_LENS: "1", V4_FILM: "1",
    WT_NAME: name, WT_OUT: out, WT_A: "0", WT_B: "1",
    WT_BACKLIGHT: "0", WT_RIP_W: "0.1", WT_SMOKE_GAIN: "3", WT_HAZE_BUMP: "0", WT_DUST_PUSH: "0.1",
  };
  // air: hazer-style (Robert, 2026-11-11): a lot of even haze, few clumps, so beams and lasers read.
  // An AIR_* value already in the environment wins.
  if (!process.env.AIR_HAZE) env.AIR_HAZE = "4";  // 10 veiled the speaker
  if (!process.env.AIR_DENSITY) env.AIR_DENSITY = "0.3";
  // Robert, 2026-11-12 (pick 2): the screen shares the speakers' light: its face reflects a little,
  // it glows into the mist, and one soft front wash falls on speakers and screen together
  if (!process.env.WALL_FACE) env.WALL_FACE = "0.05";
  if (!process.env.WALL_SPILL) env.WALL_SPILL = "8";
  if (!process.env.WALL_WASH) env.WALL_WASH = "450";
  if (meters) env.WALL_IMAGE = meters;
  if (half) Object.assign(env, { LT_HALF: "1", WT_HALF: "1" });
  if (render.clip) env.WT_CLIP = render.clip;
  else env.WT_FRAMES = render.frames;
  return env;
}

/** The texture check's verdict from a render log: { ok, line }. ok is false when the line is absent too. */
export function textureReport(logText) {
  const m = /^textures: (OK|MISSING)(.*)$/m.exec(logText);
  if (!m) return { ok: false, line: "textures: not checked (check_textures.py did not run)" };
  return { ok: m[1] === "OK", line: m[0].trim() };
}

/** The -P script list after apply_drive.py (meterCam: the wide meter test shot). */
export function lookScripts({ meterCam = false, debugLights = false } = {}) {
  const chain = ["-P", S("look_test.py"), "-P", S("wall_test.py"), "-P", S("photo_test.py")];
  if (meterCam) chain.push("-P", S("meter_cam.py"));
  if (debugLights) chain.push("-P", S("debug_lights.py"));
  chain.push("-P", S("laser_test.py"));  // LASERS=<n>: test beams through the haze; off by default
  chain.push("-P", S("air_test.py"));  // AIR_HAZE / AIR_DENSITY / AIR_DUST trims; all default to 1 = no change
  chain.push("-P", S("check_textures.py"));  // prints "textures: OK ..." or "textures: MISSING ..." (see textureReport)
  chain.push("-P", S("wave_test.py"));
  return chain;
}
