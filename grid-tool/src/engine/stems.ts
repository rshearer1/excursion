// Excursion — stems intake (phase 08, second slice). A stems folder from Ableton's "Export
// All Individual Tracks" gives one clean envelope per instrument, with zero bleed. Each stem
// becomes a channel in drive.json (one value per frame, 0..1); a mood's routing then picks
// which channel drives what. The kick (or drums) stem also drives the woofer model directly
// in place of the mix, so the cone ignores everything but the kick. Pure functions.
import { extractFeatures } from "./features";
import { envelopeFollow } from "./envelope";
import { autoGain } from "./autogain";

export type StemName = "kick" | "snare" | "drums" | "bass" | "hats" | "vocal" | "synth" | "fx" | string;

/** The channel a stem file feeds, from its filename: "03 Kick.wav" -> "kick". */
export function stemNameOf(fileName: string): StemName {
  const base = fileName.replace(/\.[^.]+$/, "").toLowerCase();
  const rules: [RegExp, StemName][] = [
    [/kick|\bbd\b|bass ?drum/, "kick"],
    [/snare|clap|\bsd\b|rim/, "snare"],
    [/hat|hh|ride|cymbal|shaker|perc/, "hats"],
    [/drum|beat|break/, "drums"],
    [/sub|bass|808/, "bass"],
    [/vox|vocal|voice|lead vox|acap/, "vocal"],
    [/synth|lead|pad|key|chord|arp|pluck/, "synth"],
    [/fx|riser|sweep|noise|impact/, "fx"],
  ];
  for (const [re, name] of rules) if (re.test(base)) return name;
  return base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "stem";
}

/** One value per frame: the stem's full-band energy, envelope-followed and auto-gained. */
export function stemChannel(mono: Float32Array, sampleRate: number, fps: number, options: { attack?: number; release?: number } = {}): number[] {
  const { attack = 0.6, release = 0.2 } = options;
  const f = extractFeatures(mono, sampleRate, { fps });
  const energy = new Float32Array(f.frameCount);
  for (let i = 0; i < f.frameCount; i++) energy[i] = f.bass[i]! + f.mid[i]! + f.high[i]!;
  const env = autoGain(envelopeFollow(energy, attack, release), { percentile: 0.95, target: 0.9, trim: 1 });
  return Array.from(env, (v) => Math.round(v * 1e4) / 1e4);
}

/** The stem the woofer should follow, best first. */
export function wooferStem(names: Iterable<string>): string | null {
  const have = new Set(names);
  for (const n of ["kick", "drums", "bass"]) if (have.has(n)) return n;
  return null;
}
