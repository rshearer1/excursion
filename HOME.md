# Excursion — home machine setup (RTX 3070)

One-time setup, then the pipeline is: grid a track in the browser → one command → reel.mp4.

## 1. Install (once)

- **Blender 4.2 or newer** (built and tested on **5.2.1 LTS**) — blender.org, or
  `choco install blender`. `apply_drive` picks OptiX/CUDA for Cycles itself, so no
  preferences step is needed.
- **ffmpeg** — `choco install ffmpeg` / `winget install ffmpeg` (or add to PATH).
- **Node.js 20+** — nodejs.org.
- Clone and install:
  ```
  git clone https://github.com/rshearer1/excursion
  cd excursion/grid-tool
  npm install
  ```
- If `blender` is not on PATH, set the env var once:
  `setx BLENDER "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"`

## 2. Assets (once per scene)

```
node scripts/fetch-assets.mjs blender/scenes/void.manifest.json
```
Downloads the studio HDRI (Poly Haven, CC0), the Plastic012A 4K PBR set (ambientCG, CC0: fine-grain matte black, colour + roughness + normal + displacement-as-bump) and
PMC's official CAD models (pmc-speakers.com/3d-cad-downloads): **PMC6-2**, PMC6, the PMC8-2
stand, PMC8-2 SUB, PMC8 SUB and PMC8-2 on its stand (80 MB) into
`assets/cache/`. `make_reel` also runs this automatically. Then build the scene once:

```
blender -b -P blender/build_scene.py        # -> blender/scenes/void.blend (~13 s)
```
(`make_reel` builds it too if it is missing.) Re-run after editing `build_scene.py`.

### Smoke test without a track

```
cd grid-tool && npm run demo-job && cd ..
node blender/make_reel.mjs blender/jobs/demo-140-halftime.drive.json --draft
```
Writes the engine's deterministic 140 BPM test track + drive.json into `blender/jobs/`
and renders `out/demo-140-halftime.draft.mp4` — kicks on 1 should pump the woofers,
the slate should flash on every beat, and the camera should cut every 2 bars.

### A track without the browser

```
cd grid-tool
npm run track-job -- "C:/path/to/track.wav" --start 20 --end 40
cd .. && node blender/make_reel.mjs blender/jobs/<track-slug>.drive.json --draft
```
Copies the WAV into `blender/jobs/` under a slug name and writes its drive.json with the same
engine the grid tool uses. BPM and beat phase are detected; the **downbeat guess is weak**, so
when you know the grid pass `--bpm 140 --offset 0` (offset = first downbeat in ms). Also
`--cuts <bars>` (default 2), `--mood`, `--name`. Section markers:
`--drop 26.57` / `--break 40` (comma-separate several) — a drop thickens the smoke, flares the
red lights, slams the logo and the camera push-in; a break thins the smoke and dims the key.
`--auto 20` picks the window itself: a bar before the first drop (where the 4 s bass average
first reaches 70 % of its peak), 20 s long, with a drop marker. MP3s: convert first with
`ffmpeg -i track.mp3 -ar 48000 track.wav`.

## 3. Per track

1. `cd grid-tool && npm run dev` → open the printed URL in **Chrome/Edge**.
2. Click **Link folder** and pick your cloned `excursion` folder — exports now
   write straight into `blender/jobs/`.
3. Drop the track (44.1 kHz WAV — put the same audio file into `blender/jobs/` too,
   next to its drive.json, so the mux can find it). Set BPM, click a kick in the
   beat lane, nudge until the metronome disappears into the drums. Pick scene + mood.
   Then the per-reel controls: `I`/`O` set the render range (a reel is 15–60 s, not the
   whole track), `M`/`B` drop and break markers, the **cuts** select picks camera-cut
   cadence, and the **drive** checkbox previews the woofer envelope before you render.
   The **3D** checkbox opens the live preview: cones pump, the slate flashes, cuts alternate
   cameras, dust gets shoved on each stroke — all from the same drive data. It shows the
   placeholder monitor until `blender/scenes/<scene>.glb` exists in the linked folder
   (export the scene-kit as glTF from Blender with the kit names; the woofer `Excursion`
   shape key becomes a morph target).
4. **Render** (phase 05). Pick a profile and press Render: the page hands the track and
   the drive to the local helper inside `npm run dev`, Blender and ffmpeg run on this
   machine, the panel under the console shows frames done and the time left, and the reel
   plays in the same tab when it lands (it is also in `out/<slug>.mp4`). Profiles:
   **test** is Cycles at half size and 32 samples (about 3 s a frame, a 10 s clip in 16 min),
   **draft** is half size with few samples, **final** is full size. One job at a time; Stop
   kills it. The helper needs Blender on this machine (`BLENDER` env var, or the newest
   install under Program Files). The mood list comes from `blender/moods/`.
   **Preview frame** renders one EEVEE draft frame at the playhead through the same helper
   (about 20 s) and shows it in the preview column: the true materials, lights, lyrics and
   grade for that moment, before committing to a render. The **safe** checkbox shades where the
   Instagram reels UI covers the 3D preview.
   Or by hand: **Export drive.json**, then:
   ```
   node blender/make_reel.mjs blender/jobs/<track>.drive.json --draft
   ```
   Several drives in one command render as a batch, one after another. `--lut look.cube`
   applies a display-referred LUT at mux time (a look without a re-render).
   Watch the draft: the orange **slate panel flashes on every beat — if the flashes
   sit on the drums, sync is proven end to end** (this is the phase-2 milestone).
   Then drop `--draft` for the real render, or `--engine cycles` for a hero pass.
   The cameras orbit the speaker across the render range (30 degrees; `--sweep 0` holds them still).
   `--slate` shows the orange sync slate, `--crf 18` trades file size for quality (default 20:
   the film grain makes these files large).
   `--shutter 0.25` (90-degree) makes cone hits crisper, `--shutter 0.75` smears them more.

## Moods (phase 05, 2026-09-15)

A mood is a JSON file in `blender/moods/`: the key light's colour and gain, the cue list
(rim colour and gain, dust-backlight gain and LED trace colour per cue; `cue_bars`,
`cue_fade`), the smoke (`show`, density and haze gains) and the grade (bloom, chromatic
aberration, black lift, split-tone lift/gain, saturation, vignette, grain) plus exposure.
`apply_drive.py` reads `drive.mood` (or `--mood name`) and applies it **at apply time**, so
switching moods never rebuilds the scene: the compositor stages are named (`Bloom`, `Lens`,
`Curve`, `Balance`, `Saturation`, `Vignette`, `GrainAmount`) and re-graded from the JSON.
Shipped: **moody** (the default; old drives that say `smoke` mean this), **ember** (look A
held), **neon** (cyan / magenta / blue chase), **clean** (product shot, no smoke). Add a mood
by copying a file; the grid tool lists whatever is in the folder.

## The show (phase 12, 2026-09-16)

The **show** box under the console is a lighting desk over the drive. One lane per thing —
camera, key, rims, wall, dust back, smoke, shells — each a list of cues: set the faders
(gain, colour, camera, density...), press **Cue** and the values are written at the playhead
with the lane's fade; a cue holds until the next one and crossfades in. **Lanes from mood**
fills the lanes from the selected mood on the track's downbeats, so the desk starts where the
mood is; a lane with cues then overrides the mood in the render, a lane without leaves the
mood in charge (old drives render unchanged). Cues show as dots across the top of the beat
lane (click to delete; shift-click a chip). The 3D preview follows the key and rim gains.
`drive.show.lanes` is the file; `apply_drive.py` evaluates it (`lane_series`).

**live** (in the show box) keeps one Blender open through the dev server
(`blender/live_server.py`, `/api/live`) and renders a quarter-size EEVEE frame of the
playhead whenever you seek or change a cue: a few seconds when the drive changed (the scene
is reopened and re-bound), about a second when only the playhead moved. It shows in the
preview column. `blender/live_server.log` has Blender's own output.

## Why a frame costs what it costs (2026-09-16)

Measured on one full-size 64-sample frame, features switched off one at a time: without the
smoke volume the frame was 5 s; with the old procedural smoke shader, 17 s — Cycles evaluated
the whole node graph at every ray-march step. The smoke is now a geometry-nodes **Volume
Cube** (2.2 cm voxels, `SMOKE_GRID` in build_scene.py): the same field sampled once per frame,
rendered as a NanoVDB grid, and the frame is 10–12 s. Bevel, depth of field, motion blur,
shells and the dust pass cost a second or two each. Finals also run the i9 alongside the
card, at adaptive threshold 0.02, with the bevel node at 2 samples.

## Scenes (2026-09-16)

One builder, one switch: `EXCURSION_SCENE=void|macro|stack|concrete blender -b -P
blender/build_scene.py` writes `blender/scenes/<scene>.blend` and `.glb`. `make_reel` builds
a missing scene on demand from `drive.scene`, and the Preview-frame button uses it too.
- **void** — the hero floating in the dark, five cameras (the default).
- **macro** — the same hero, only the close cameras plus `Cam8_Cone`, a 90 mm f/4 a hand from
  the upper dust cap; finer, denser dust packed in front of the baffle. No lyric anchors.
- **stack** — a wall of six PMC6-2 on the floor, the hero in the middle of the bottom row, the
  wide camera back at 2.4 m, a wider and brighter softbox. Every cone is driven.
- **concrete** — the hero in a room corner (`SET_WALLS`), walls in ambientCG Concrete034; lyric
  anchors `wall-left`, `wall-right`, `wall-top` on the back wall.
Each scene has a manifest next to it; concrete adds the concrete texture set (2K).

## Stems and routing (phase 08, second slice, 2026-09-16)

**stems** (advanced row) takes Ableton's Export All Individual Tracks. Each file becomes a
channel in `drive.channels` (one 0..1 value per frame; the channel name comes from the file
name: kick, snare, hats, drums, bass, vocal, synth, fx, else the name itself), and when there
is a kick, drums or bass stem the **woofer follows that stem** through the driver model
instead of the mix — the cone ignores everything but the kick. Stems are not persisted;
reload them with the track. A mood's `routing` names the channel for `key` (the key light's
breathing) and `smoke` (the drift); the mix's bass band stands in when the channel is absent.

## The AI env (2026-09-16)

`.venv-ai/` (gitignored) is a Python 3.13 venv with CUDA torch 2.8 (cu128), WhisperX and
Demucs; the helper finds `whisperx` and `demucs` there first, then on PATH. To recreate it:
```
python3.13 -m venv .venv-ai
.venv-ai/Scripts/python -m pip install whisperx demucs
.venv-ai/Scripts/python -m pip install --force-reinstall --no-deps torch==2.8.0 torchaudio==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu128
```
(WhisperX pulls a CPU torch; the last line puts the CUDA build back.) **Drums stem** in the
advanced row runs Demucs and tracks kicks and snares on the stem; **Transcribe** in the lyrics
box runs WhisperX. Both cache under `assets/generated/`.

## The photoreal handoff (2026-09-16)

`blender/PHOTOREAL-HANDOFF.md` is a ranked critique of the renders. Applied: the HDRI now
lights reflections and bounce at 0.1 (camera rays still see black), the key is a 0.8 m
softbox (an area light, 40-degree spread, 10 W; `KEY_SOFTBOX = 0` brings the spot back) and
the graze a softer source, the LED wall has a glass front, the badge glows only on the beat,
dust lives in a smaller box with fewer motes, a 1.5 mm shader bevel rounds every cabinet edge, the cone is 0.45 rough
and the surround a diffuse rubber, a glue ring sits where the cap meets the cone, chromatic
aberration, vignette and grain are halved (scene defaults and every mood), the Cycles seed is
fixed and finals use adaptive threshold 0.01 (tests keep 0.05), the lyric room light is up.
Not done: hex-socket screw heads, dust culled to the beam cones, deeper vent slots. Walls are
the concrete scene.

## Hits and the Ableton project (phases 09 and 08, 2026-09-15)

The **hits** checkbox tracks kicks and snares from the mix: band-split spectral flux at a 10 ms
hop (a kick is a low thump with next to no noise burst; a snare is 150–400 Hz body plus a
2–8 kHz burst), an adaptive threshold, and the grid prior (kick on the 1, snare on the 3 in
halftime) that boosts on-grid candidates. Two tick rows on the beat lane: orange kicks, cyan
snares, height and brightness = confidence, a foot under off-grid ones. Click a tick to delete
it, `K` / `N` add one at the playhead. Hits at or above 0.5 confidence go out as
`drive.events.kick/snare`; the shells then ride the kicks instead of the beats. Headless:
`track-job --hits`.

**project** (advanced row) takes the track's Ableton `.als` (gzipped XML): its tempo becomes
the grid with the downbeat at 0, locators named drop/chorus become drop markers and
break/build/intro/outro become break markers, and drum-track MIDI (tracks named kick/snare/
clap, or GM keys 36 and 38–40) becomes kicks and snares with full confidence. Looped clips are
unrolled; tempo automation is not followed. Stems and the routing matrix are still open.

## Pressure-wave shells (phase 04, 2026-09-15)

On each beat where the cone actually hits, a shell leaves the woofers and expands at 0.45 m per
beat, its rim fading over a second (`Shell_k` pool in build_scene, keyed in apply_drive). A
shell is a transparent sphere whose rim glows, so a wave reads as an expanding ring in the haze
and never refracts the frame when it passes the camera. `mood.shells = { show, strength }`;
clean turns them off.

## The 3D preview's scene kit (phase 11, 2026-09-15)

`build_scene.py` ends by exporting `blender/scenes/void.glb` (gitignored): the hero and its
parts, the cameras, the main lights, the lyric anchors, and the woofers' `Excursion` shape key
as a morph target. With the project folder linked, the grid tool's **3D** preview binds it in
place of the placeholder box.

## Lyrics (phase 10, 2026-09-15)

The **lyrics** box under the console is the lyric lane. Paste the words one line per row and
press **Use lines**, then play the track and hit **Enter** as each line is sung; shift-click a
time in the list to re-time a line at the playhead, click it to seek there. Import an `.lrc`
instead (enhanced word tags `<mm:ss.xx>` become word times) or a WhisperX json. **Transcribe**
runs WhisperX through the dev server when it is installed on this machine (it is not, yet:
`pip install whisperx` on a Python 3.10–3.12 with a CUDA torch); the button says so otherwise.
**Quantise** snaps starts and word onsets to 16ths. Per line: style, anchor; defaults for style,
anchor, colour, size and whether the line lights the room. Lines show as blocks on the beat lane.

In the render (`drive.lyrics`) each line is real emissive text parented to the scene's
`Lyric_<anchor>` empty (void: `behind`, `front-low`, `wall`), auto-scaled to fit the wide frame,
hidden outside its window, with a paired area light per anchor so the words light the haze and
the cabinet cleanly. Styles: `fade` (attack/release), `karaoke` (word objects light in turn),
`pop` (each word flashes on its onset), `pulse` (breathes with the bass), `typewriter` (letters
on the 16th grid). A `sections` map gives markers their own defaults (the drop pops in white,
large, out of the box).

## What runs where

| Piece | Runs | Needs GPU |
|---|---|---|
| grid tool (browser) | anywhere | no |
| fetch-assets | anywhere | no |
| build_scene / apply_drive (Blender) | home | yes (fast with it) |
| ffmpeg mux | anywhere | no |

## The rig (phase 5 — the PMC family, 2026-09-15)

Every speaker is built from a **kit**: `blender/kits/<Model>.json`, written by
`measure_kit.py` from the STL (cabinet size, front face, and each driver's centre, cone,
surround and cut radii — found from a ray-cast depth map of the baffle; dome centres come from
`DOME_HINTS`). `build_speaker()` in `build_scene.py` imports the STL, cuts every driver out,
keys it and places it. Re-measure a model with:

```
blender -b --factory-startup -P blender/measure_kit.py -- assets/cache/pmc/PMC6.stl
```

The hero PMC6-2 sits at the origin on a PMC8-2 stand (scaled to its width); the `RIG` table
places the rest: a second PMC6-2 on a stand 1.8 m to the right, a PMC8-2 on its stand outside
each (toed in 12 degrees, set back 0.35 m), and in the centre a PMC8-2 SUB with the PMC8 SUB
and the PMC6 stacked on it. Every woofer and mid dome in the rig moves with the track; object
names are prefixed (`R6-2_Woofer`, `L8-2_Mid`, `SUB_Woofer_1`, ...) and `apply_drive` binds
by name. Models that are not cached are skipped. `Cam4_Rig` (28 mm, 6 m back) joins the cut
rotation to show the whole wall. The hero's mid/tweeter plate carries a machined honeycomb
relief (`PlateMat`, generated tile in `assets/generated/`).

## The photoreal pass (from the plan, 2026-09-15)

Target is Cycles only; EEVEE is for sync drafts. What the pass changed:

- **Dust**: 25k matte, half-translucent motes (no specular — glints read as glitter), log-normal
  0.25–0.7 mm so in-focus motes are sub-pixel and out-of-focus ones bloom into discs, 7 % lint.
  Pushed by the cone's *signed velocity* (outward stroke shoves, return stroke sucks), flowing in
  from behind and around the cabinet. Own view layer (`Dust`, undenoised, main layer held out)
  composited over `Main`; a dedicated backlight `DustBack` light-linked to the dust, and the
  front lights (`KeyLight`, `Graze`) linked to everything *but* the dust.
- **Colour**: ACES 2.0 view transform (pinned — never change it mid-project), blacks kept ~5 %
  above crush, sensor-noise grain, soft vignette, `exposure` in `build_scene.py`.
- **Camera**: vertical 36 mm sensor, 11 blades, round bokeh, wide f/1.4, 90 mm f/2.8, 180° shutter.
- **Surfaces**: cabinet grain at 11 tiles/m with roughness smudges (`SMUDGE`) and settled dust
  on up-facing surfaces (`SETTLED_DUST`); doped-paper cones with colour speckle; a rubber
  surround band (`surround_r` on each driver piece); fabric tweeter dome; flat-topped honeycomb.
- **Cycles**: 48–64 denoised samples with the accurate prefilter, animated seed, adaptive
  sampling, persistent data — about 13 s/frame at 1080×1920 on the 3070.

## The look (phase 7 — intimate, 2026-09-15)

Two switches at the top of `build_scene.py` decide what the film is:

- `INTIMATE = True` (default): one speaker on its stand in a black void. No rig, truss, heads,
  projectors, LED wall or neon. Five close cameras with per-shot moves (`Cam1_Wide` push-in,
  `Cam2_Woofers` slide, `Cam7_Top` falling from above the cabinet, `Cam3_Macro` drifting down
  the plate, `Cam6_Side` tracking across the woofers), cut every 3 bars in `SHOT_ORDER`.
  `BACK_LASERS` thin red beams sweep behind the cabinet as a curtain in the haze
  (`BACK_LASER_COLOR`, `BACK_LASER_POWER`). `False` brings back the whole stage below.
- `LOOK = "moody"`: the grade — warm key + dark red only, fill almost off, big soft dust bokeh,
  low haze with fog pooling on the floor, crushed blacks, warm colour balance, heavy vignette,
  exposure -0.65. `"show"` is the brighter club grade.

The vent grilles are opened: the honeycomb cell floors listed in the kit's `vents` are deleted
and a black cavity sits behind, so you see through the hex holes.

## The show (phase 6 — stage, 2026-09-15)

The rig now stands on a stage: a room corner of dark plaster (`WALL_Y`, `ROOM_MARGIN`), the
floor at the stand feet, red uplights along the wall base, a neon `BIGHECK` on the wall and an
LED wall behind the rig whose oscilloscope trace is drawn in the shader from the track's
bass/mid/high (`ScopeMat` Value nodes). A truss across the room carries six moving heads
(`Head_k`, sweeping on slow figure-eights, colour stepping through `PALETTE` in
`apply_drive.py` every bar, pulsing on the beat), two laser units of six beams (`Laser_k_j`,
fanning and scanning, only while there is bass), two blinders (downbeats) and two projectors
that throw the name onto the side walls (`Proj_L`/`Proj_R` decal + beam). Breaks dim
everything, a drop flares it. Beams live in the smoke's haze floor (`SMOKE_HAZE`); EEVEE's
volumetric range is pushed out to the rig camera (`VOLUME_RANGE`). Layout is the `RIG` table:
mains on stands with their subs on the floor inboard, both PMC6-2s on stands, a centre fill
stack (PMC8 SUB with the two PMC6 on top).

## The scene (phase 3 — real speaker, done 2026-09-14)

`build_scene.py` imports the PMC6-2 STL (one closed solid, mm, cones modelled into the
body), centres it, and cuts the drivers out with exact boolean cylinders so the seams
are true circles on flat baffle — invisible because both sides share the same
box-projected cabinet material (the STL has no UVs; `CABINET_TEXTURE` picks the ambientCG set). Kit contract in the .blend:

| Object | What | Driven by |
|---|---|---|
| `Cabinet` | body + tweeter plate + mid waveguide + vents | — |
| `Woofer_L` / `Woofer_R` | upper / lower cone pieces, shape key `Excursion` (14 mm piston, -1..1, smooth falloff across the surround). `WooferMat`: the cabinet finish with a woven-fibre cone inside `cone_r` (`WEAVE_*`) | `frames[].cone`: audio-driven, see below |
| `Mid` | the 75 mm mid dome cut out of its waveguide, 3 mm key, same woven material | `frames[].dome`: the mid band through `MID_DOME` |
| `Floor` | dark satin ground under the rig (1.29 m below the hero, at the stand feet) | — |
| `Stand_L`, `R6-2_Stand` | PMC8-2 stands under the two PMC6-2s | — |
| `Tweeter` | dome cap, dark metallic satin (no emission) | — |
| `Badge` + `Logo` | satin plate filling the PMC badge slot with `BIGHECK` booleaned 0.8 mm into it and an emissive inlay in the cut (`LOGO_TEXT`, Impact/Arial Black from Windows fonts) | `beats[]`: idle glow, flash per beat, bigger on downbeats |
| `Slate` | orange panel above the speaker; hidden unless you pass `--slate` | beats (sync proof) |
| `Cam1_Wide`, `Cam2_Woofers`, `Cam3_Macro` | 50 mm wide, 90 mm close-up, 85 mm macro on tweeter + badge; `cuts[]` rotate through them. 7-blade anamorphic bokeh (`BOKEH_*`) | `cuts[]` |
| `Focus_Wide` / `Focus_Woofers` / `Focus_Macro` | depth-of-field targets, each with a `rack` (start, end): the focus point glides across every shot | `cuts[]` |
| every camera | pushes in up to 12 mm on cone hits and drifts like a handheld rig (`CAM_*` in `apply_drive.py`) | `frames[].cone` |
| `VoidComp` compositor | bloom, chromatic aberration + barrel distortion, vignette, per-frame film grain, S-curve (`COMP_*`) | — |
| `CamRig` | empty at the speaker centre; both cameras are parented to it | `--sweep DEG` (default 50) |
| `KeyLight` + `KeyTarget` | warm spot tracking an empty that glides along `KeyTarget["path"]` over the render range; its power follows the bass level (dims in breaks) | render range, `frames[].bass` |
| `Graze`, `TopBack`, `RimLeft`, `RimRight` | aimed spots, no ambient: a low rake across the surrounds, dark-red back/rim lights whose reflections trace the edges and glow faintly through the smoke; the reds pulse on downbeats and flare at a drop | `downbeats[]`, `sections[]` |
| `Dust` (`DustField` geometry nodes) | ~2500 dark glossy motes that only glint inside beams; hides with the smoke. Woofer wind: motes in the column in front of the cones stream toward camera at a speed that follows the bass (`Gust`) and jump forward/outward on hits (`Push`); `DUST_*` in `build_scene.py`, `DUST_GUST_SPEED` in `apply_drive.py` | `frames[].cone`, smoke `Drift`, time |
| `Smoke` / `SmokeMat` | procedural volume in front of the speaker; Value nodes `Push`, `Drift`, `Time`, `Density` | `frames[].bass`, only when `mood` is `smoke` |

The world is black to camera and to lighting, and EEVEE bounce light is off, so anything outside a beam stays black (`WORLD_STRENGTH` brings the studio HDRI back as fill). The cabinet albedo is darkened (`CABINET_ALBEDO`) and its roughness remapped glossier so the lights read as reflections. Motion blur is on.
Smoke is shoved out along the woofer axes on each kick attack and the whole cloud drifts toward
camera with the running bass total — no simulation bake, so any track renders straight away.
Tune the look with `SMOKE_DENSITY` in `build_scene.py` (0.6 default) and rebuild.

### Woofer motion is simulated from the audio

The grid tool runs the waveform through a driver model (`grid-tool/src/engine/cone.ts`): a 20 Hz
subsonic high-pass, then a 2nd-order low-pass at a 45 Hz resonance, which is how a moving-coil
cone's displacement responds (it follows bass, and travel falls ~12 dB/octave above resonance).
The cone moves at 40-100 Hz, faster than video, so each frame stores `cone: [first, second]`,
the extreme positions during a 180-degree exposure in time order, normalised so the loudest
~1 % reach full travel. `apply_drive` keys them at the exposure's start and end, and EEVEE's
3-step motion blur blends the real positions: bass hits swing and smear the cone, sustained bass
keeps it buzzing, silence is still. The beat grid is not involved. Drives exported before this
only carry the smoothed bass level, which is keyed directly — re-export them.

If the STL is not cached the builder falls back to the phase-2 placeholder primitives.

## Next build steps (with Claude, per the plan artifact)

In: 05 (moods, Render button), 06 (safe zone, batch, LUT), 10 (the lyric lane), 11 (the glb
export and the Preview-frame button), the shells, the modelled mid waveguide. Also in: hit
tracking with Demucs (09), the .als intake, stems and routing (08), WhisperX on this machine,
lyrics in the 3D preview, and the macro, stack and concrete scenes. Open from the plan:
grid-advected haze (04), Desk Set and Liquid, automation lanes as control signals. A `Mid` binding is free to add:
`frames[].mid` is already in drive.json and the PMC55 waveguide sits at scene
(x 0.045, z 0.0) on the Cabinet.
