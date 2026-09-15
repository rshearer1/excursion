# Photoreal handoff — what the latest renders are missing

Written 15 Sep 2026 from `out/looksheet/` (photoreal_Cam1/2/3 at frame 0700, shell_strip,
lyrics_strip3, moods_strip) and frames of `out/repressed-emotion.mp4` (the `--test` profile).
Scene code: `blender/build_scene.py` (scene) and `blender/apply_drive.py` (per-track drive +
render profile). All line numbers are as of commit 51fd749.

Verdict: the shading pass (cabinet texture, cone grain, settled dust, smudge) is close. What
gives the image away is the environment, the size of the light sources, the geometry edges,
and the amount of post. Ranked by payoff below; the first three are one-line changes.

## 1. The speaker floats in a black void (biggest tell)

- `SET_WALLS = False` (build_scene.py:1263) and `WORLD_STRENGTH = 0.0` (build_scene.py:1896).
  The HDRI in the manifest is downloaded but never loaded because of that 0.0. So there is
  no floor reflection, no wall falloff, no bounce, and nothing for glossy surfaces to reflect.
- Symptoms: shadow side of the cabinet goes to pure 0; the stand legs (metallic 0.9,
  StandMat build_scene.py:974-978) read as flat black card; no contact shadow where the
  cabinet sits on the stand or the stand on the floor.
- Fix: `SET_WALLS = True` (plaster room corner already built at build_scene.py:1392-1397,
  WallUp spots already scale to 260 W with walls). Keep the world black to camera (the
  Is Camera Ray mix at build_scene.py:1906-1910 already does this) but give the
  non-camera branch the HDRI at a low strength (0.05-0.15) so the black plastic has
  something to reflect. Floor (FloorMat build_scene.py:1059, rough 0.3) is already there;
  check it actually catches a soft reflection of the front baffle in Cam1/Cam5.

## 2. Light sources are too small

- Spot radii: Graze 0.01, TopBack/Rim 0.08, RigFill 0.35, RigWash 0.4
  (build_scene.py:1250-1259); heads 0.03, lasers 0.002, dust back 0.04.
- Symptom: a perfect round pinpoint hotspot on every dust cap (photoreal_Cam2). Reads as a
  CG point light. Real key/fill go through a softbox or diffusion: 0.5-1.2 m.
- Fix: key/fill radius 0.6-1.0 m; leave the rims and lasers small (hard edges are fine
  there). Optionally IES profiles on the show heads instead of `spot_blend`.

## 3. No bevels on the cabinet or stand

- The STLs have razor edges; the top rim highlight in Cam1 is a single hairline.
- Fix: Bevel modifier (width 1.5-2 mm, 3 segments, angle limit 30 deg) on every PMC body
  and the stand after import, or a Bevel node (radius 1.5 mm) into the normal of
  the cabinet material (build_scene.py:92-160). The shader route is cheaper and safe on
  the STL topology.

## 4. Woofer cones read as smooth plastic

- photoreal_Cam2: the cone is a flawless gradient, the surround a clean torus with one
  uniform highlight. The fibre grain built at scale 2200 (build_scene.py:270-275) is being
  smeared by 48 samples + OptiX denoise + `adaptive_threshold = 0.05`
  (apply_drive.py:977-984; Blender default threshold is 0.01).
- Missing geometry: the glue ring where the dust cap meets the cone, the cone's inner seam
  at the neck, a gasket ring between the woofer frame and the baffle (the recess reads flat
  in the wide shots).
- Fix: hero stills at 256+ samples, threshold 0.01; final video 128. Cone roughness up a
  touch (doped paper is matte, 0.55-0.7); surround a rubber roll with a diffuse, not glossy,
  highlight. Add the glue ring as a thin torus at cap radius.

## 5. Screw heads are flat discs

- Macro (Cam3): hex bolts are black dots with a dark centre. Need a real hex socket recess
  (~1 mm deep) with a chamfer, and per-bolt random rotation plus ~0.5 deg tilt.

## 6. Dust is in the wrong place

- DUST_BOX (build_scene.py:1693) fills the whole rig volume, so motes show as uniform sharp
  specks across the entire frame including regions no beam hits. Real dust only shows
  inside a beam, and most of it is out of focus.
- Fix: cull motes outside the beam cones (a dot-product test against each spot's direction
  and `spot_size` in the DustField node group), and make sure the camera DOF is on in the
  shots where dust is visible so the near ones bloom into bokeh.

## 7. The post is doing too much at once

- Bloom 0.08, chromatic 0.012, vignette 0.15, grain 0.012, barrel 0.005, colour-balance
  warm, S-curve (build_scene.py:2188-2300), plus the mood's red wash and dust backlight.
- Symptom: shell_strip has a red haze lifting the blacks uniformly across the whole frame,
  which flattens contrast instead of reading as haze in the air. Cyan-tinted grain is
  clearly visible in lyrics_strip3.
- Fix: halve chromatic, vignette and grain; keep bloom. Let the volumetric do the haze and
  drop the flat colour lift. Real footage has one or two of these artefacts, subtly.

## 8. Lyric text does not light the scene

- lyrics_strip3: "under the floor" glows (LYRIC_EMISSION = 14, apply_drive.py:447) but casts
  nothing onto the cabinet and does not reflect in the baffle. Check the lyric objects'
  ray visibility (glossy/diffuse) and that they are not on a separate view layer excluded
  from the main pass. Text edges look soft: check text resolution / extrude.

## 9. Smaller

- Plastic012A box projection tiles visibly at macro scale around the mid dome. Add a
  second, uncorrelated copy at a different scale and rotation, or break it with a large
  noise mask.
- SETTLED_DUST = 0.12 never shows because the top surface is never lit. Either light it
  (a faint top fill) or raise it.
- The LED wall trace has no pixel structure or screen surface; a subtle pixel grid and a
  glass front with a faint reflection would ground it.
- The Logo inlay is emissive (LogoMat build_scene.py:605). A metal badge lit by the key
  reads more real than a glowing one; if it must glow, keep emission low and let the
  badge's satin plastic reflect the key.
- `use_animated_seed = True` with the denoiser gives temporal flicker in the smooth
  gradients; prefer a fixed seed and let the compositor grain (already re-seeded every
  frame) provide the motion.
- Cabinet vents (the PMC transmission-line slots) read as flat cutouts; give the slots
  real depth and an inner shadow.
- Pure 0,0,0 blacks. Even on a dark set a real sensor's noise floor sits just above black;
  the grain should do this, so once grain is tuned check the histogram never clips at 0.

## Method

Keep the "against PMC's photo" side-by-side from pass 3 (commit d77d8b8) as the check for
every item. Two more reference photos of black studio monitors on a dark set with a visible
floor would settle items 1, 2 and 7 faster than tuning by eye.

## Not to touch

- `view_transform = "ACES 2.0"` (build_scene.py:1922) is pinned by the plan.
- Motion blur shutter 0.5 and the cone keying at exposure start/end are correct.
- Bokeh: 11 blades, anamorphic ratio, are right for the Sony GM look.
