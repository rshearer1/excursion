# Excursion — home machine setup (RTX 3070)

One-time setup, then the pipeline is: grid a track in the browser → one command → reel.mp4.

## 1. Install (once)

- **Blender 4.2 LTS or newer** — blender.org. After installing: Edit → Preferences →
  System → Cycles Render Devices → enable **OptiX** for the 3070.
- **ffmpeg** — `winget install ffmpeg` (or add to PATH).
- **Node.js 20+** — nodejs.org.
- Clone and install:
  ```
  git clone https://github.com/rshearer1/excursion
  cd excursion/grid-tool
  npm install
  ```
- If `blender` is not on PATH, set the env var once:
  `setx BLENDER "C:\Program Files\Blender Foundation\Blender 4.2\blender.exe"`

## 2. Assets (once per scene)

```
node scripts/fetch-assets.mjs blender/scenes/void.manifest.json
```
Downloads the studio HDRI (Poly Haven) and plastic PBR set (ambientCG) into
`assets/cache/` — all CC0. `make_reel` also runs this automatically.

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

## What runs where

| Piece | Runs | Needs GPU |
|---|---|---|
| grid tool (browser) | anywhere | no |
| fetch-assets | anywhere | no |
| build_scene / apply_drive (Blender) | home | yes (fast with it) |
| ffmpeg mux | anywhere | no |

## Next build steps (with Claude, per the plan artifact)

Phase 3: real speaker model — import PMC's official `PMC6-2.STL`
(pmc-speakers.com/3d-cad-downloads), split drivers to the kit names, materials
(ambientCG Plastic006 base for the cabinet — the fetched folder even includes a
ready `.blend` material). Then phases 4+: light rig, smoke, moods, scenes.
