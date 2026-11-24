# Environment switches

Every environment variable the scripts read, in one place. Each is also described at the top of
the file that reads it; that file wins if the two ever disagree.

**"Look sets"** is the value `blender/stage/look.mjs` (`lookEnv`) passes for every test still
(`test_still.mjs`) and every Cycles reel (`make_reel.mjs`). That is the locked look. A switch
with no "look sets" value keeps its default unless you set it yourself.

Set one for a single run, for example in PowerShell:
`$env:MC_KEY_GAIN="0.2"; node blender/stage/test_still.mjs; Remove-Item Env:MC_KEY_GAIN`

## Paths and scene

| Switch | Read by | Default | What it does |
|---|---|---|---|
| `BLENDER` | `make_reel.mjs`, `test_still.mjs`, `grid-tool/server/render.ts` | `blender` on PATH (make_reel); `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe` (test_still); newest Blender install, then PATH (render helper) | The Blender executable. |
| `EXCURSION_SCENE` | `build_scene.py` (the add-on sets it) | `void` | Which room to build: `presets/rooms/<room>.json`, saved as `blender/scenes/<room>.blend`. |

## Look chain (`blender/stage/`, run in this order)

### `look_test.py`: f-stops, gel rolloff, handheld

| Switch | Default | Look sets | What it does |
|---|---|---|---|
| `LT_OUT` | required | output folder | Where its own renders go (it does not render in the look chain). |
| `LT_NAME` | `test` | run name | Output prefix. |
| `LT_FIX` | off | `1` | Real f-stops, gel highlight rolloff, 1/f handheld. |
| `LT_NORENDER` | off | `1` | Do not render here; `wave_test.py` renders at the end. |
| `LT_NOSHAKE` | off | `1` | Skip this file's handheld (Camera Shakify is used instead). |
| `LT_MBLUR` | off | `1` | Motion blur at the drive's shutter. |
| `LT_HALF` | off | `1` with `--half` | 50 % resolution. |
| `LT_AGX` | off | | AgX view transform with the Punchy look instead of the scene's ACES 2.0. |
| `LT_FRAMES` / `LT_CLIP` | | | Stills (`"1000,1300"`) or a range (`"1300,1389"`) when this file renders itself. |
| `LT_TOPBACK` | `0.3` | | Gain on the TopBack light that floods the cabinet top. |
| `LT_TOPBACK_GRAZE` | off | | Lower the TopBack light to this many metres above the cabinet top, so it skims the top instead of flooding it. |

### `wall_test.py`: the LED wall

| Switch | Default | Look sets | What it does |
|---|---|---|---|
| `WALL_IMAGE` | off (plain waveform) | first meter frame | Image sequence shown on the wall (the meter frames). |
| `WALL_IMG_GAIN` | `6` | `10` | Brightness of the image content. |
| `WALL_GAIN` | `60` | | Wall brightness in nits for the waveform content. |
| `WALL_BG` | `0.05` | | Strength of the wall's faint, uneven background glow. |

### `photo_test.py`: camera shake, lens, film

| Switch | Default | Look sets | What it does |
|---|---|---|---|
| `V4_SHAKE` | off | `1` | Camera Shakify handheld on every shot camera. Blender must run with `-y`. |
| `V4_SHAKE_PROFILE` | `INVESTIGATION` | | Shakify profile. |
| `V4_SHAKE_INFLUENCE` | `0.6` | `0.3` | Shake strength. |
| `V4_LENS` | off | `1` | OSL physical lens (`lens.osl`) on every camera with depth of field. |
| `V4_K1_MUL` | `1` | | Multiplier on lens distortion. |
| `V4_CAT` | `0.55` | | Cat-eye bokeh amount. |
| `V4_ONION` | `0.12` | | Onion-ring bokeh amount. |
| `V4_BUBBLE` | `0.25` | | Soap-bubble bokeh amount. |
| `V4_FILM` | off | `1` | Film finish in the compositor: glare, lens dirt, halation, grain, gate weave, flicker. |
| `V4_DIRT` | `0.35` | | Lens dirt amount. |
| `V4_HALATION` | `0.3` | | Halation amount. |
| `V4_GRAIN` | `0.22` | | Grain amount. |

### `meter_cam.py`: the wide meter test shot (test stills only, not `--show-cams` or reels)

| Switch | Default | What it does |
|---|---|---|
| `MC_LOC` | `0.18,-1.3,0.02` | Camera position "x,y,z" in metres. |
| `MC_AIM` | `0.0,0.6,0.1` | Point the camera looks at. |
| `MC_LENS` | `40` | Focal length in mm (36 mm sensor). |
| `MC_FSTOP` | `4.0` | Aperture. |
| `MC_KEY_GAIN` | `0.1` | Key light gain in this shot only (the darkest front, Robert's pick C). |

### `debug_lights.py`: debugging only (test_still adds it when either switch is set)

| Switch | Default | What it does |
|---|---|---|
| `CB_LIGHTS_OFF` | off | Lights to switch off: `"KeyLight,Graze"`, or `ALL` for every lamp (LED wall and emission stay on). |
| `CB_WALL_OFF` | off | `1` hides the LED wall faces too. |

### `laser_test.py`: test beams for judging the haze

| Switch | Default | What it does |
|---|---|---|
| `LASERS` | `0` (off) | Number of beams. |
| `LASER_COLOR` | `0.15,1.0,0.25` | Beam colour "r,g,b". |
| `LASER_POWER` | `2500` | Watts per beam. |
| `LASER_FAN` | `2.4` | Fan width in metres where the beams land. |
| `LASER_WIDTH` | `0.004` | Beam radius in metres. |
| `LASER_GLOW` | `60` | Emission strength of the visible beam rods. |

### `air_test.py`: air and dust trims

| Switch | Default | Look sets | What it does |
|---|---|---|---|
| `AIR_HAZE` | `1` (no change) | `10`, unless already set | Multiplier on the even haze that beams are drawn in. |
| `AIR_DENSITY` | `1` (no change) | `0.3`, unless already set | Multiplier on the smoke clumps. |
| `AIR_DUST` | `1` (no change) | | Multiplier on the dust backlight (how brightly motes sparkle). |

### `wave_test.py`: air ripples and dust push; renders

| Switch | Default | Look sets | What it does |
|---|---|---|---|
| `WT_OUT` | required | output folder | Where frames are written. |
| `WT_NAME` | `wave` | run name | Output prefix. |
| `WT_FRAMES` / `WT_CLIP` | | from `--frames` / `--clip` | Stills or a frame range to render. |
| `WT_HALF` | off | `1` with `--half` | 50 % resolution. |
| `WT_A` | `1` | `0` | Part A: the neon-tube oscilloscope (off in the look; the LED wall shows meters). |
| `WT_TUBE_BEHIND` | `1` | | Part A: place the tube behind the cabinet. |
| `WT_B` | `1` | `1` | Part B: kick shells become smoke ripples and push dust. |
| `WT_RIP_W` | `0.12` | `0.1` | Thickness of the ripple's shell of air, metres. |
| `WT_SMOKE_GAIN` | `15` | `3` | Smoke density multiplier at the ripple crest. |
| `WT_HAZE_BUMP` | `0.6` | `0` | Extra density at the crest where the haze is thin. |
| `WT_DUST_PUSH` | `0.12` | `0.1` | Metres a dust mote is shoved outward at the crest. |
| `WT_BACKLIGHT` | `1` | `0` | Back light behind the cabinet for the ripples (off in the look). |

## Other scripts

| Switch | Read by | Default | What it does |
|---|---|---|---|
| `FINISH`, `WEAR`, `SURFACE`, `VENTS` | `blender/finish_test.py` | `1` each | `0` skips that step of the before/after finish test. |
| `GRILLE_NOSHADOW`, `GRILLE_NOGLOSSY` | `blender/finish_test.py` | off | `1` stops the grille casting shadows / showing in reflections. |
| `HIDE_GRILLE`, `HIDE_PORT` | `blender/finish_test.py` | off | `1` hides the grille / the port cavity. |
| `LOOK_VARIANT` | `blender/looksheet.py` | `current` | Look variant for a contact-sheet still (`cool-rims`, `hard-key`, `soft-key`, `rays`, `mono-warm`, `brighter`, ...). |
| `LOOK_CAMERA` | `blender/looksheet.py` | off | Render from this camera whatever the cuts say. |
| `HDRI_STRENGTH` | `blender/stage/neutral.py` | `1.0` | Studio HDRI strength for the neutral product shot. |
| `YAW` | `blender/stage/neutral.py` | `0` | Speaker turn in degrees. |
| `NEUTRAL_TOP` | `blender/stage/neutral.py` | off | Adds a product-photo softbox of this many watts in front of the speaker. |
| `NEUTRAL_BOX_SIZE`, `NEUTRAL_BOX_EL` | `blender/stage/neutral.py` | `0.9`, `15` | Softbox size (m) and elevation (degrees). |
| `NEUTRAL_AIM`, `NEUTRAL_LENS` | `blender/stage/neutral.py` | off, `240` | Close-up of one part: offset "x,z" in metres from the cabinet centre, and lens (mm). |
