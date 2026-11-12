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

// ---- easy controls: controls.json at the repo root -------------------------------------------
export const CONTROL_DEFAULTS = { mist: 4, screenGlow: 8, screenCatchesLight: 0.05, frontLight: 150,
  beamsOn: true, beamCount: 6, beamBrightness: 700, beamsMoving: true, beamColours: "0.55,0.12,1.0;1.0,0.05,0.08" };
const COLOURS = { purple: "0.55,0.12,1.0", red: "1.0,0.05,0.08", blue: "0.1,0.25,1.0", green: "0.15,1.0,0.25",
  white: "1.0,1.0,1.0", amber: "1.0,0.55,0.1", pink: "1.0,0.2,0.6", cyan: "0.1,0.9,1.0" };
/** Read controls.json; every value is checked and a bad one keeps the saved look (with a warning). */
export function readControls(file = path.join(ROOT, "controls.json")) {
  const c = { ...CONTROL_DEFAULTS };
  let j;
  try {
    j = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (fs.existsSync(file)) console.warn(`controls.json could not be read (${e.message}); using the saved look.`);
    return c;
  }
  const num = (v, lo, hi, key, label) => {
    if (v === undefined) return;
    if (typeof v === "number" && v >= lo && v <= hi) c[key] = v;
    else console.warn(`controls.json: "${label}" should be a number from ${lo} to ${hi}; keeping ${c[key]}.`);
  };
  const bool = (v, key, label) => {
    if (v === undefined) return;
    if (typeof v === "boolean") c[key] = v;
    else console.warn(`controls.json: "${label}" should be true or false; keeping ${c[key]}.`);
  };
  num(j.mist, 0, 10, "mist", "mist");
  num(j.front_light, 0, 600, "frontLight", "front_light");
  num(j.screen?.glow, 0, 30, "screenGlow", "screen.glow");
  num(j.screen?.catches_light, 0, 0.2, "screenCatchesLight", "screen.catches_light");
  bool(j.beams?.on, "beamsOn", "beams.on");
  bool(j.beams?.moving, "beamsMoving", "beams.moving");
  num(j.beams?.count, 1, 12, "beamCount", "beams.count");
  num(j.beams?.brightness, 0, 3000, "beamBrightness", "beams.brightness");
  const cols = j.beams?.colours;
  if (cols !== undefined) {
    const ok = Array.isArray(cols) && cols.length > 0 && cols.every((n) => COLOURS[String(n).toLowerCase()]);
    if (ok) c.beamColours = cols.map((n) => COLOURS[String(n).toLowerCase()]).join(";");
    else console.warn(`controls.json: "beams.colours" should be a list from: ${Object.keys(COLOURS).join(", ")}; keeping the saved colours.`);
  }
  return c;
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
  // The adjustable part of the look comes from controls.json at the repo root (Robert's easy
  // controls); a bad or missing value falls back to the saved look, and an environment variable
  // of the same name still wins (that is how tests override one thing).
  for (const k of ["WT_B", "WT_SMOKE_GAIN", "WT_RIP_W", "WT_DUST_PUSH", "V4_LENS", "V4_FILM", "V4_SHAKE", "WALL_IMG_GAIN"]) if (process.env[k]) env[k] = process.env[k];  // tests may override the air ripple
  const c = readControls();
  const put = (k, v) => { if (!process.env[k]) env[k] = String(v); };
  put("AIR_HAZE", c.mist);            // hazer-style even haze (10 veiled the speaker)
  put("AIR_DENSITY", "0.3");
  put("WALL_FACE", c.screenCatchesLight);  // the screen's black face reflects a little room light
  put("WALL_SPILL", c.screenGlow);         // the screen glows into the mist
  put("WALL_WASH", "450");                 // soft front wash on speakers and screen (rooms without the ambient light)
  // Robert, 2026-11-12 ("much better"): no spotlights on the speakers; one big soft ambient panel
  // lights their faces and the screen. As a default (AMBIENT_AUTO) it only applies in the void rooms.
  if (!process.env.AMBIENT_FRONT) Object.assign(env, { AMBIENT_FRONT: String(c.frontLight), AMBIENT_AUTO: "1" });
  // the void world's faint studio image has a bright lamp that mirrored in the glossy floor as a
  // white blob from side angles (found 2026-11-12). Off in the void rooms (WORLD_AUTO); the
  // picture is otherwise unchanged there. Other rooms keep it.
  if (process.env.WORLD_GAIN === undefined) Object.assign(env, { WORLD_GAIN: "0", WORLD_AUTO: "1" });
  // rim lights skip the glossy floor in the void rooms: it mirrored the lamp as a hot pink patch
  // from three-quarter angles (2026-11-12)
  if (process.env.RIM_NO_FLOOR === undefined) Object.assign(env, { RIM_NO_FLOOR: "1", RIM_AUTO: "1" });
  put("AMBIENT_PULSE", "1.2");  // the soft light swells with the bass (Robert, 2026-11-12 "save")
  // dust (Robert, 2026-11-12 "save"): no squiggly lint, a cooler white, and a few soft motes
  // close to the lens. The near motes are placed for the void cameras, so as a default
  // (DUST_AUTO) they only apply in the void rooms.
  put("DUST_LINT", "0");
  put("DUST_COLOR", "0.9,0.92,1.0");
  if (!process.env.DUST_NEAR) Object.assign(env, { DUST_NEAR: "1.05", DUST_AUTO: "1",
    DUST_NEAR_SIZE: process.env.DUST_NEAR_SIZE || "3", DUST_NEAR_COUNT: process.env.DUST_NEAR_COUNT || "500" });
  // rave beams above the speakers, sweeping with the bars and pulsing with the bass. As a default
  // (BEAM_AUTO) they only apply in the void rooms: they veil the close cameras in stack/concrete/macro.
  if (!process.env.BEAM_RIG) {
    env.BEAM_RIG = String(c.beamsOn ? c.beamCount : 0);
    env.BEAM_AUTO = "1";
    put("BEAM_POWER", c.beamBrightness);
    put("BEAM_AIM_Z", "1.0");
    put("BEAM_MOVE", c.beamsMoving ? "1" : "0");
    put("BEAM_COLORS", c.beamColours);
  }
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
  chain.push("-P", S("dust_test.py")); // DUST_LINT / DUST_COLOR / DUST_NEAR; all off unless set
  chain.push("-P", S("air_test.py"));  // AIR_HAZE / AIR_DENSITY / AIR_DUST trims; all default to 1 = no change
  chain.push("-P", S("check_textures.py"));  // prints "textures: OK ..." or "textures: MISSING ..." (see textureReport)
  chain.push("-P", S("wave_test.py"));
  return chain;
}
