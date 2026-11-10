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
 * Environment for the look scripts.
 * out/name: where wave_test.py writes (a clip lands in <out>/<name>/####.png).
 * meters: first meter image or null (the wall then shows the plain waveform).
 * render: { clip: "a,b" | "scene" } or { frames: "1600,..." }.
 */
export function lookEnv({ out, name, meters, half = false, render }) {
  const env = {
    LT_OUT: out, LT_NAME: name, LT_FIX: "1", LT_NORENDER: "1", LT_NOSHAKE: "1",
    WALL_IMG_GAIN: "10",
    V4_SHAKE: "1", V4_SHAKE_INFLUENCE: "0.3", V4_LENS: "1", V4_FILM: "1",
    WT_NAME: name, WT_OUT: out, WT_A: "0", WT_B: "1",
    WT_BACKLIGHT: "0", WT_RIP_W: "0.1", WT_SMOKE_GAIN: "3", WT_HAZE_BUMP: "0", WT_DUST_PUSH: "0.1",
  };
  if (meters) env.WALL_IMAGE = meters;
  if (half) Object.assign(env, { LT_HALF: "1", WT_HALF: "1" });
  if (render.clip) env.WT_CLIP = render.clip;
  else env.WT_FRAMES = render.frames;
  return env;
}

/** The -P script list after apply_drive.py (meterCam: the wide meter test shot). */
export function lookScripts({ meterCam = false, debugLights = false } = {}) {
  const chain = ["-P", S("look_test.py"), "-P", S("wall_test.py"), "-P", S("photo_test.py")];
  if (meterCam) chain.push("-P", S("meter_cam.py"));
  if (debugLights) chain.push("-P", S("debug_lights.py"));
  chain.push("-P", S("wave_test.py"));
  return chain;
}
