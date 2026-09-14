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
PMC's official **PMC6-2 CAD model** (pmc-speakers.com/3d-cad-downloads) into
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
4. **Export drive.json**, then:
   ```
   node blender/make_reel.mjs blender/jobs/<track>.drive.json --draft
   ```
   Watch the draft: the orange **slate panel flashes on every beat — if the flashes
   sit on the drums, sync is proven end to end** (this is the phase-2 milestone).
   Then drop `--draft` for the real render, or `--engine cycles` for a hero pass.
   The cameras orbit the speaker across the render range (30 degrees; `--sweep 0` holds them still).
   `--slate` shows the orange sync slate, `--crf 18` trades file size for quality (default 20:
   the film grain makes these files large).
   `--shutter 0.25` (90-degree) makes cone hits crisper, `--shutter 0.75` smears them more.

## What runs where

| Piece | Runs | Needs GPU |
|---|---|---|
| grid tool (browser) | anywhere | no |
| fetch-assets | anywhere | no |
| build_scene / apply_drive (Blender) | home | yes (fast with it) |
| ffmpeg mux | anywhere | no |

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
| `Floor` | dark satin ground under the speaker: contact shadow, rim reflections | — |
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

Phases 4+: neon/clean moods, lights driven by the track, more scenes/cameras. A `Mid` binding is free to add:
`frames[].mid` is already in drive.json and the PMC55 waveguide sits at scene
(x 0.045, z 0.0) on the Cabinet.
