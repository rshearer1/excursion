# Excursion — grid tool (phase 1)

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
- `src/main.ts` + `index.html` — the thin UI over the engine.

Grid settings persist per track (keyed by file SHA-1) in localStorage.

## drive.json shape

```json
{
  "audio": { "file": "...", "sha1": "...", "duration": 214.3 },
  "grid": { "bpm": 140, "offsetMs": 150, "beatsPerBar": 4, "halftime": true },
  "fps": 30,
  "scene": "void",
  "mood": "smoke",
  "beats": [0.15, 0.578, ...],
  "downbeats": [0.15, 1.864, ...],
  "frames": [{ "bass": 0.82, "mid": 0.34, "high": 0.11, "onset": 1, "beatPhase": 0.0 }, ...]
}
```
