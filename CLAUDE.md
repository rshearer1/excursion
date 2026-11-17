# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Excursion turns a music track into a photoreal reel of PMC speakers (the PMC6-2 is the hero)
whose woofers pump to the music. Two halves joined by one file, `drive.json`:

- `grid-tool/` (Vite + TypeScript, runs in the browser): beat grid, band analysis, hits, stems,
  lyrics, the show desk, presets, a three.js preview. It exports `blender/jobs/<slug>.drive.json`.
  Its dev server also hosts the local render helper (`grid-tool/server/render.ts`), which runs
  Blender and ffmpeg for the page's Render, Preview frame and Live buttons.
- `blender/` (Blender Python, driven by Node `.mjs` scripts): `make_reel.mjs` fetches assets,
  builds the scene if missing or stale (`build_scene.py` -> `blender/scenes/<room>.blend`),
  keys the drive onto it (`apply_drive.py`), adds the look chain, renders, then grades and
  muxes with ffmpeg into `out/<slug>.mp4`.

## Where the work is

- The live branch is `claude/project-thread-11phqh` (the "current best"), not `main`. Read
  `CURRENT_BEST.md` before any render or scene change: it says how to cut a branch, land work
  and run test renders. Never merge to `main` without Robert's go.
- The renders happen on Robert's Windows PC (RTX 3070, Blender 5.2 not on PATH: set `BLENDER`).
  `D:\Rescue\Kingston\Users-ITSM\excursion-current` is the shared worktree on the current best,
  and every test render runs there.
- One GPU: never start Blender while another render runs (`test_still.mjs` refuses on its own).
  Tests are single frames or clips of about 3 s (100 frames max) at 48 samples.
- Renders never go into git (`out/`, `frames/`, `blender/jobs/`, `*.blend` are ignored). Review
  stills go into `looks/` only, through `scripts/publish-looks.mjs`.

## Commands (from the repo root)

```
npm test                    # grid-tool unit tests (vitest)
npm run typecheck           # grid-tool tsc --noEmit
npm run check               # tests + typecheck + node --check on every .mjs outside grid-tool
npm run dev                 # grid tool + render helper on http://localhost:5173
npm run assets              # HDRI, textures, PMC CAD into assets/cache/
npm run still -- [opts]     # current-best test render: blender/stage/test_still.mjs (options at its top)
npm run reel -- <drive.json> [opts]   # full reel: blender/make_reel.mjs (options at its top)
```

- One test file: `cd grid-tool && npx vitest run src/engine/grid.test.ts`; one test by name: add `-t "<name>"`.
- Headless drive.json from a WAV: `cd grid-tool && npm run track-job -- track.wav --start 20 --end 40`.
- Build a scene by hand: `blender -b -P blender/build_scene.py` (`EXCURSION_SCENE=<room>` for other rooms).
- Python has no tests and only runs inside Blender (`bpy`). Outside Blender, `python -m py_compile <file>`
  checks syntax only. A change to the scene or look is verified by a test render and by looking at it.

## Architecture that spans files

- **Kit contract.** Object, material and shape-key names (`Woofer_L`, `Woofer_R`, `Mid` with shape
  key `Excursion`, `KeyLight`, `Graze`, `TopBack`, `SmokeMat`, `DustField`, `Lyric_<anchor>`,
  `CamRig`, ...) are made in `build_scene.py` and looked up by name in `apply_drive.py`, the look
  scripts, `rigkit.py`, the Blender add-on and the three.js preview (`grid-tool/src/preview/`).
  A rename breaks those bindings without an error. `apply_drive.py`'s header lists the bindings.
- **drive.json.** Built by `grid-tool/src/engine/exporter.ts` (shape in `grid-tool/README.md`);
  drive frame i is Blender frame i+1. Drives are 24 fps now.
- **The locked look.** `blender/stage/look.mjs` is its single source: a chain of `-P` scripts run
  after `apply_drive.py` (without `--render`), configured by environment variables, then an ffmpeg
  LUT grade. Both `test_still.mjs` and `make_reel.mjs --engine cycles` use it. The `*_test.py`
  files in `blender/stage/` are production, not throwaway tests. Chain order and a map of
  `build_scene.py`: `blender/stage/README.md`. Every switch: `docs/env-switches.md`.
- **Rooms and rigs.** `presets/rooms/*.json` change the built scene (rebuild needed);
  `presets/rigs/*.json` add lights at apply time (no rebuild). Schemas and field meanings:
  `grid-tool/src/engine/room.ts` and `rig.ts`. Blender side: `blender/rigkit.py`, shared by
  `apply_drive.py`, `build_scene.py` and the add-on `blender/addon/excursion_studio.py`.
- **The speaker** is measured from PMC's CAD: `blender/kits/*.json` come from `measure_kit.py`,
  `measure_screws.mjs` and `measure_waveguide.mjs`. Surface detail lives in `speaker_finish.py`
  and `speaker_wear.py`, imported by `build_scene.py`. `test_still.mjs` rebuilds `void.blend` when
  any of those sources is newer than it.
- **Presets and moods are user data** (`presets/`, `blender/moods/`): keep fields backward
  compatible. A field left out must keep its old meaning so existing renders and presets still work.
- **A clean render log does not prove textures loaded.** `build_scene.py` skips a missing map
  silently; trust the `textures: OK|MISSING` line from `blender/stage/check_textures.py`.

## Large files

`blender/build_scene.py` (~3,100 lines, runs top to bottom), `grid-tool/src/main.ts` (~2,400, the
whole UI) and `blender/apply_drive.py` (~1,200). Search by function name and read in parts.

## Docs

`README.md` (overview), `HOME.md` (setup, per-track workflow), `CURRENT_BEST.md` (test-render
rules), `docs/features.md` (how each feature works), `docs/env-switches.md`,
`blender/stage/README.md`, `presets/README.md`, `blender/PHOTOREAL-HANDOFF.md` (a September
review, kept for history).
