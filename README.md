# Excursion

Turns a music track into a photoreal reel of PMC speakers (the PMC6-2 is the hero) whose
woofers pump to the music. A browser tool grids and analyses the track; Blender builds the
scene, binds the music to it and renders; ffmpeg grades and muxes the reel.

```
track.wav ──> grid tool (browser) ──> blender/jobs/<slug>.drive.json
          ──> make_reel.mjs: fetch assets → build scene → apply drive + look → render → ffmpeg ──> out/<slug>.mp4
```

## Folders

| Folder | What it holds |
|---|---|
| `grid-tool/` | The browser app (Vite + TypeScript): beat grid, analysis, show desk, presets, 3D preview. Its dev server also runs the local render helper (`server/render.ts`). See `grid-tool/README.md`. |
| `blender/` | Scene builder (`build_scene.py`), drive binding and render (`apply_drive.py`), the one-command reel (`make_reel.mjs`), speaker surface (`speaker_finish.py`, `speaker_wear.py`), rooms and rigs (`rigkit.py`), the Blender add-on (`addon/`). |
| `blender/stage/` | The locked look chain and the current-best test render. See `blender/stage/README.md`. |
| `blender/kits/` | Speaker measurements taken from PMC's CAD models. |
| `blender/moods/` | Mood files (colour, smoke, grade), edited from the grid tool. |
| `presets/` | Rooms, light rigs, scenes, shows, lyric styles and templates (JSON). See `presets/README.md`. |
| `scripts/` | Asset fetcher, review-still publisher, syntax check. |
| `docs/` | Feature notes, the list of environment switches, design specs. |
| `looks/` | Small review stills; the only render output allowed in git. |

Not in git: `assets/cache/`, `blender/jobs/`, `blender/scenes/*.blend`, `out/`, `frames/`.

## Quick start

Needs Blender 4.2+ (tested on 5.2), ffmpeg and Node 20+. Full setup is in [HOME.md](HOME.md).

```
cd grid-tool && npm install && cd ..
npm run assets           # HDRI, textures and PMC CAD into assets/cache/
npm run dev              # grid tool + render helper at http://localhost:5173
```

## Commands (from the repo root)

| Command | What it does |
|---|---|
| `npm test` | grid-tool unit tests (vitest) |
| `npm run typecheck` | grid-tool TypeScript check |
| `npm run check` | tests + typecheck + syntax check of every `.mjs` |
| `npm run dev` | grid tool and render helper |
| `npm run assets` | fetch scene assets |
| `npm run still -- [options]` | current-best test still or short clip (`blender/stage/test_still.mjs`; options at the top of that file) |
| `npm run reel -- <drive.json> [options]` | full reel (`blender/make_reel.mjs`; options at the top of that file) |

Set `BLENDER` to the Blender executable when it is not on PATH.

## Where to read next

- [HOME.md](HOME.md): setup on the home PC and the per-track workflow.
- [CURRENT_BEST.md](CURRENT_BEST.md): the shared "current best" branch and the rules for test renders.
- [docs/features.md](docs/features.md): how each feature works (moods, show desk, scenes, rooms and rigs, lyrics, ...).
- [docs/env-switches.md](docs/env-switches.md): every environment variable the scripts read.
- [CLAUDE.md](CLAUDE.md): notes for Claude Code sessions.
