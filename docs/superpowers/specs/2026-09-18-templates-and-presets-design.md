# Templates and presets — design

Date: 2026-09-18. Status: approved in chat (Rob), building on the work box.

## Goal

The webview is a scene and lighting manager, a lyric manager, the sound-sync controls and a
basic preview. Its output must be **reusable**: save what a reel looked like and apply it to
the next track, as a whole or in parts. Templates are **fixed recipes** — applying one
reproduces exactly what was saved; variety comes from choosing templates and blocks per reel.

## Files

All JSON, in the repo, written through the linked project folder (File System Access API) so
they sync by git and work headless. Without a linked folder the same JSON downloads/uploads.

| Kind | Path | Contents |
|---|---|---|
| Lighting block | `blender/moods/<name>.json` | unchanged mood format; the app reads and, for the fields it owns, writes it |
| Show block | `presets/shows/<name>.json` | `{ "lanes": { lane: [{ "bar": n, "value": …, "fade"?: s }] } }` — cue times in **bars from the downbeat** |
| Lyric block | `presets/lyrics/<name>.json` | `{ "defaults", "sections" }` from `Lyrics`, never `lines` |
| Scene block | `presets/scenes/<name>.json` | `{ "scene", "cutsEveryBars", "cutMarkers", "leadMs", "fps" }` |
| Template | `presets/templates/<name>.json` | `{ "scene": name, "mood": name, "show": name, "lyrics": name }` — names of blocks; any may be omitted |

Every file carries `"name"` and `"kind"`. Names are the file stem; `[a-z0-9-]` only.

## Time in bars

`barOf(grid, tSec)` and `secOf(grid, bar)` in `engine/grid.ts` (bar = beats / beatsPerBar from
the downbeat). `showToBlock(show, grid)` and `blockToShow(block, grid)` in `engine/presets.ts`
convert cue lanes both ways; camera cues switch hard (no fade) as today.

## Apply semantics

`applyTemplate(resolved, state)` returns the new per-track state: it sets scene, mood, cuts,
lead, fps, show lanes (converted to the target grid) and lyric defaults/sections, and leaves
grid, range, markers, hits, stems, automation and lyric **lines** untouched. Applying a single
block does the same for its own fields only.

## App

- **Templates strip** under Export: template `<select>` (from `presets/templates/`), **Apply**,
  **Save as…** (prompts a name; writes one file per block kind from the current state plus the
  template file that names them).
- **Save preset / Load preset** on the show desk, the lyrics panel and the scene/mood strip.
- Loading a preset applies it to the current track immediately; saving writes the file and
  refreshes the pickers. Status line reports what was written.

## Headless

`track-job --template <name>` resolves the template through the same engine functions.

## Tests (engine, vitest)

- bar ↔ seconds round trip on a 140 BPM grid with a 150 ms offset, including beats/bar ≠ 4.
- show ↔ block round trip preserves values, fades and lane names; camera cues keep no fade.
- lyric block never carries lines; applying it keeps the track's lines.
- template resolution: missing block names are reported, present ones merge in the documented
  order (scene, mood, show, lyrics); unknown kinds rejected.
- applyTemplate leaves grid/markers/hits/lines untouched.

## Out of scope

Editing every mood field in the app; a reel history to avoid repeats; seeded variation.
