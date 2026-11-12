# Excursion — grid tool

Browser beatgrid + analysis tool for the Excursion audio-visualizer pipeline.
Drop any audio file (or load the built-in 140 BPM demo), set BPM / tap tempo,
nudge the downbeat offset ±1/±10 ms against a metronome until the clicks
disappear into the drums, then export `drive.json` — per-frame band envelopes
(auto-gained), onset flags, beat + downbeat times — for the Blender side to consume.

Full project plan: the "Excursion" artifact on claude.ai (see `/artifacts` in Claude Code).

## Commands

```
npm install
npm run dev        # local UI at the printed URL
npm test           # engine unit tests (vitest)
npm run typecheck  # tsc --noEmit
npm run demo-job   # write the 140 BPM test track + drive.json into ../blender/jobs/
npm run track-job -- track.wav --start 20 --end 40 [--bpm 140 --offset 0]   # real track, no UI
```

## Layout

- `src/engine/` — pure, unit-tested core: grid math, envelope follower,
  auto-gain, FFT, feature extraction, drive.json builder, and a deterministic
  test-track synth (kick on 1, snare on 3 at 140 halftime — the demo track
  and the tests' ground truth).
- `src/preview/` — the 3D preview (phase 11, live tier). `rig.ts` is pure and
  unit-tested: drive frames + a time → rig state (excursion, cone velocity, slate
  flash, lights, camera index) and the deterministic dust step (drag, turbulence,
  cone jets scaled by cone velocity). `placeholder.ts` rebuilds the build_scene.py
  monitor in three.js with the kit-contract names; `gltf.ts` binds
  `blender/scenes/<scene>.glb` from the linked folder by those same names (woofer
  `Excursion` shape key → morph target); `viewport.ts` is the renderer glue
  (portrait camera on a 36 mm vertical sensor, fog haze, 20k-point dust, bloom).
  three.js is only fetched when the **3D** checkbox is first switched on.
- `src/engine/presets.ts` — templates and blocks (spec 2026-09-18): show cues in bars,
  lyric styling without lines, scene settings, and a template naming one of each plus a mood;
  `resolveTemplate` / `applyTemplate` are pure and shared by the UI and `track-job --template`.
  Files live in `../presets/` (see its README).
- `src/main.ts` + `index.html` — the thin UI over the engine.

Deep link: `?demo` loads the demo track, `?demo&3d` also turns the preview on
(handy for a headless screenshot smoke test).

Grid settings persist per track (keyed by file SHA-1) in localStorage.

## drive.json shape

```json
{
  "audio": { "file": "...", "sha1": "...", "duration": 214.3 },
  "grid": { "bpm": 140, "offsetMs": 150, "beatsPerBar": 4, "halftime": true },
  "fps": 24,
  "scene": "void",
  "mood": "smoke",
  "beats": [0.15, 0.578, ...],
  "downbeats": [0.15, 1.864, ...],
  "frames": [{ "bass": 0.82, "mid": 0.34, "high": 0.11, "onset": 1, "beatPhase": 0.0 }, ...]
}
```
