# blender/stage/ — the locked look and the current-best test render

Despite their names, the `*_test.py` files here are not throwaway tests. Together they are the
**locked look** (v11, agreed 2026-11-10) that every test still and every Cycles reel renders
with. Their names are kept because the commands and notes across the project use them.

## Who runs what

- `look.mjs`: the single source of the look. It lists the script chain (`lookScripts`) and the
  environment that configures it (`lookEnv`). Both entry points below import it, so a test still
  and a full reel always match.
- `test_still.mjs`: the current-best test render (stills or clips of about 3 s, 48 samples).
  Rebuilds `blender/scenes/void.blend` first when `build_scene.py`, `speaker_finish.py`,
  `speaker_wear.py`, `rigkit.py` or the PMC6-2 kit files are newer than it. Refuses to start
  while another Blender is running. Rules for using it: `CURRENT_BEST.md`.
- `blender/make_reel.mjs`: full reels. With `--engine cycles` it adds the same chain
  (`--no-look` turns it off).

## The chain, in run order

Blender runs `apply_drive.py` (without `--render`), then each script below with `-P`. Blender
needs `-y`, because Camera Shakify's drivers are Python expressions. Every switch is listed in
`docs/env-switches.md`.

| Order | Script | What it adds | Switch prefix |
|---|---|---|---|
| 1 | `look_test.py` | Real f-stops, gel highlight rolloff, motion blur, TopBack gain | `LT_` |
| 2 | `wall_test.py` | The LED video wall (pixel grid, seams, truss) showing the meter frames | `WALL_` |
| 3 | `photo_test.py` | Camera Shakify handheld, OSL physical lens (`lens.osl`), film finish | `V4_` |
| 4 | `meter_cam.py` | The wide meter test shot (test stills only, not `--show-cams` or reels) | `MC_` |
| 5 | `debug_lights.py` | Debug only: switches named lights off (added when a `CB_` switch is set) | `CB_` |
| 6 | `laser_test.py` | Test laser beams for judging the haze (off unless `LASERS` is set) | `LASER` |
| 7 | `air_test.py` | Haze, smoke-clump and dust trims | `AIR_` |
| 8 | `check_textures.py` | Prints `textures: OK ...` or `textures: MISSING ...` | |
| 9 | `wave_test.py` | Kick ripples through the smoke, dust push; **renders the frames** | `WT_` |

After Blender, ffmpeg grades each frame with `luts/print_soft.cube` plus a deep-blacks curve
(`GRADE_VF` in `look.mjs`). `luts/print_film.cube` is the stronger alternative grade.

A clean render log does not prove the textures loaded: `build_scene.py` skips a missing map
silently. Trust the `textures:` line from step 8 (`test_still.mjs` reads it).

## Other files here

| File | What it is |
|---|---|
| `make_meters.mjs` | Draws meter frames (oscilloscope, vectorscope, spectrum) from a track with ffmpeg, one PNG per scene frame. `look.mjs` calls it when a drive has no meter frames yet. |
| `neutral.py` | Neutral product shot (studio HDRI, no show lights, no haze) for comparing with a reference photo. |
| `refpair.py` | Puts the reference photo next to our render on white, same height. |
| `lens.osl` | The physical lens shader used by `photo_test.py`. |

## Map of `blender/build_scene.py`

About 3,100 lines that run top to bottom and build one room. Section by section, in file order
(search for the function names; line numbers move):

| Section | Where | What it builds |
|---|---|---|
| Settings | top of file | Paths, the room (`EXCURSION_SCENE`, loaded by `rigkit.load_room`), look switches (`LOOK`, `INTIMATE`, `BACK_LASERS`, bokeh), cabinet finish constants. |
| Mesh and material helpers | `make_material` … `add_camera` | Materials, cutting drivers out of the baffle, the woofer and mid `Excursion` shape keys, woofer surround and rim, logo text, the placeholder speaker. |
| Speaker from PMC's CAD | `load_kit` … `place_stand` | Kits from `blender/kits/`, honeycomb plate, mid waveguide, tweeter roll, screws, `build_speaker` (one speaker, any model), stands. |
| Speaker materials | after `place_stand` | Cabinet, woofer and dome materials, finished by `speaker_finish.py` and worn by `speaker_wear.py`; `add_pebble_skin` for the domes. |
| Speakers placed | after `add_pebble_skin` | The hero plus the room's extra speakers, or the placeholder when the CAD is not cached. |
| Cameras | `add_focus`, `set_dof`, `add_lyric_anchor`, `aim` | Shot cameras with focus racks, lyric anchors (`Lyric_<anchor>`). |
| Lights and LED wall | `add_spot`, `build_led_wall` | KeyLight, Graze, TopBack, rims; the LED wall. |
| Room | `plaster_material`, `wall` | Walls when the room has them (concrete), the stage truss and lasers when not intimate. |
| Air | `build_dust`, `build_smoke`, `build_smoke_grid`, `build_shells` | Dust motes, haze volume, smoke grid, kick shells. |
| Output | `build_compositor`, `build_pair`, end of file | Compositor grade, the stereo twin (`pair`), save `blender/scenes/<room>.blend`, export the `.glb` for the grid tool's 3D preview. |

Object and material names (`Woofer_L`, `Mid`, `KeyLight`, `SmokeMat`, `Lyric_<anchor>`, ...) are a
contract with `apply_drive.py`, the look scripts, `rigkit.py`, the add-on and the three.js preview.
Renaming one breaks those bindings without an error. `apply_drive.py`'s header lists them.
