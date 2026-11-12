# Excursion — home machine setup (RTX 3070)

One-time setup, then the pipeline is: grid a track in the browser → one command → reel.mp4.
How each feature works (moods, the show desk, scenes, rooms and rigs, lyrics, stems, ...) is in
[docs/features.md](docs/features.md). Every environment switch is in
[docs/env-switches.md](docs/env-switches.md).


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

## What runs where

| Piece | Runs | Needs GPU |
|---|---|---|
| grid tool (browser) | anywhere | no |
| fetch-assets | anywhere | no |
| build_scene / apply_drive (Blender) | home | yes (fast with it) |
| ffmpeg mux | anywhere | no |

## Sharing stills for review

Renders never go in git (`out/`, `frames/` are ignored) — but a few small review stills can:

```
node scripts/publish-looks.mjs                                   # every PNG in out/looksheet/
node scripts/publish-looks.mjs --video out/<track>.mp4 --label "handoff pass 2"
```

Writes ≤ 1080 px JPEGs plus a `notes.md` into `looks/<date>-<label>/`, commits and pushes.
Then, from any machine: "assess looks/<date>-<label>" against `blender/PHOTOREAL-HANDOFF.md`.
