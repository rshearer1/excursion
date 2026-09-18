# presets/ — templates and blocks

Saved looks the grid tool can lay onto any track (spec: `docs/superpowers/specs/2026-09-18-templates-and-presets-design.md`).
Fixed recipes: applying one reproduces exactly what was saved. All files carry `kind` and `name`
(the file stem, `[a-z0-9-]`).

| Folder | Kind | What it holds |
|---|---|---|
| `scenes/` | `scene` | scene, cut cadence, cut-at-markers, lead ms, fps |
| `shows/` | `show` | the desk's cue lanes with times in **bars from the downbeat** |
| `lyrics/` | `lyrics` | lyric defaults and section styles — never the lines |
| `templates/` | `template` | names one block of each kind plus a mood (`blender/moods/<mood>.json`) |

In the tool: **Link folder**, then the pickers fill from here. **Save preset** on the export strip,
the show desk and the lyrics panel writes one block; **Templates → Save as…** writes a block of
each kind plus the template. Headless: `npm run track-job -- track.wav --template club-night`.

`club-night` is the starter: void scene cutting every 8 bars, the moody mood, red/purple rim and
wall cues alternating every 2 bars, lyrics fading in behind the speaker and popping white on drops.
