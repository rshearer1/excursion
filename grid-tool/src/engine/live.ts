// Excursion — what the Blender live link sends: the desk's value per lane at the playhead.
// A lane with cues plays its cues (crossfades included); a lane without cues sends the fader
// the user has touched, so moving a fader lights the open Blender scene before any cue exists;
// an untouched lane without cues is left out and Blender keeps the room's own value.
// Pure: blenderLink.ts sends it, rigkit.apply_live applies it.

import { LANE_DEFAULTS, LANE_INFO, laneAt, type CueValue, type LaneName, type Show } from "./show";

export type LiveLanes = Partial<Record<LaneName, CueValue>>;

export function liveLanes(show: Show, faders: Partial<Record<LaneName, CueValue>>, t: number): LiveLanes {
  const out: LiveLanes = {};
  for (const { name } of LANE_INFO) {
    const cues = show.lanes[name];
    if (cues?.length) {
      const first = [...cues].sort((a, b) => a.t - b.t)[0]!;
      // before the first cue the lane holds the first cue's value, as apply_drive's lanes do
      out[name] = t < first.t ? first.value : laneAt(cues, t, faders[name] ?? LANE_DEFAULTS[name]);
    } else if (faders[name]) {
      out[name] = faders[name];
    }
  }
  return out;
}
