// Excursion — Ableton project intake (phase 08, first slice). An .als is gzipped XML; this
// reads the pieces the grid needs and nothing else: the tempo, the arrangement locators, and
// the MIDI note-ons of the drum tracks as kick / snare events. Times in the file are beats;
// they become seconds at the project tempo (tempo automation is not followed — a fixed grid
// is what the visuals ride anyway). Pure parsing on the XML text; inflate is separate.

export interface AlsProject {
  bpm: number;
  /** arrangement locators as seconds + the marker kind the grid tool uses */
  locators: { t: number; name: string; kind: "drop" | "break" | "section" }[];
  /** note-on times in seconds */
  kicks: number[];
  snares: number[];
  /** track names seen, for the status line */
  tracks: string[];
}

const KICK_KEYS = new Set([35, 36]);
const SNARE_KEYS = new Set([37, 38, 39, 40]);

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? m[1]! : null;
}

function valueOf(block: string, element: string): string | null {
  const m = new RegExp(`<${element}\\b[^>]*\\bValue="([^"]*)"`).exec(block);
  return m ? m[1]! : null;
}

/** All occurrences of <tag ...>...</tag> (non-nested) as their full text. */
function blocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[0]);
  return out;
}

export function locatorKind(name: string): "drop" | "break" | "section" {
  if (/drop|chorus|hook/i.test(name)) return "drop";
  if (/break|bridge|build|intro|outro/i.test(name)) return "break";
  return "section";
}

/** Parse the XML of an .als (already inflated). */
export function parseAls(xml: string): AlsProject {
  // tempo: the master/main track's mixer tempo (the first <Tempo> with a Manual value)
  const tempoBlock = blocks(xml, "Tempo")[0] ?? "";
  const bpm = Number(valueOf(tempoBlock, "Manual") ?? "0") || 120;
  const secPerBeat = 60 / bpm;

  const locators = blocks(xml, "Locator").map((b) => {
    const beat = Number(valueOf(b, "Time") ?? "0");
    const name = valueOf(b, "Name") ?? "";
    return { t: Math.round(beat * secPerBeat * 1000) / 1000, name, kind: locatorKind(name) };
  });

  const kicks: number[] = [];
  const snares: number[] = [];
  const tracks: string[] = [];
  for (const track of blocks(xml, "MidiTrack")) {
    const name = valueOf(blocks(track, "Name")[0] ?? "", "EffectiveName") ?? valueOf(track, "EffectiveName") ?? "";
    tracks.push(name);
    const byName = /kick|bd\b|bass ?drum/i.test(name) ? "kick" : /snare|clap|sd\b/i.test(name) ? "snare" : null;
    for (const clip of blocks(track, "MidiClip")) {
      const clipStart = Number(attr(clip.slice(0, clip.indexOf(">")), "Time") ?? valueOf(clip, "CurrentStart") ?? "0");
      const clipEnd = Number(valueOf(clip, "CurrentEnd") ?? "0");
      const loopStart = Number(valueOf(clip, "LoopStart") ?? "0");
      const loopEnd = Number(valueOf(clip, "LoopEnd") ?? String(clipEnd - clipStart + loopStart));
      const loopLen = Math.max(0, loopEnd - loopStart);
      const looped = (valueOf(clip, "LoopOn") ?? "true") === "true";
      for (const keyTrack of blocks(clip, "KeyTrack")) {
        const key = Number(valueOf(keyTrack, "MidiKey") ?? "-1");
        const kind = byName ?? (KICK_KEYS.has(key) ? "kick" : SNARE_KEYS.has(key) ? "snare" : null);
        if (!kind) continue;
        const target = kind === "kick" ? kicks : snares;
        const noteRe = /<MidiNoteEvent\b[^>]*>/g;
        let m: RegExpExecArray | null;
        while ((m = noteRe.exec(keyTrack))) {
          if (attr(m[0], "IsEnabled") === "false") continue;
          const nt = Number(attr(m[0], "Time") ?? "0");
          if (nt < loopStart || (loopLen > 0 && nt >= loopEnd)) continue;
          // the clip plays its loop from clipStart; repeat while the clip lasts
          for (let pass = 0; ; pass++) {
            const beat = clipStart + (nt - loopStart) + pass * loopLen;
            if (beat >= clipEnd && clipEnd > 0) break;
            target.push(Math.round(beat * secPerBeat * 1000) / 1000);
            if (!looped || loopLen <= 0) break;
          }
        }
      }
    }
  }
  const uniq = (a: number[]): number[] => Array.from(new Set(a)).sort((x, y) => x - y);
  return { bpm, locators: locators.sort((a, b) => a.t - b.t), kicks: uniq(kicks), snares: uniq(snares), tracks };
}

/** Inflate an .als (gzip) to its XML text, in the browser or Node 18+. */
export async function inflateAls(bytes: ArrayBuffer): Promise<string> {
  const head = new Uint8Array(bytes, 0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const ds = new DecompressionStream("gzip");
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return await new Response(stream).text();
  }
  return new TextDecoder().decode(bytes); // already XML
}
