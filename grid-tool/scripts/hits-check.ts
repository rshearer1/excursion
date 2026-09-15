// Excursion — compare kick/snare tracking on a mix against its Demucs drums stem.
//   npx vite-node scripts/hits-check.ts <mix.wav> <drums.wav> --bpm 120 [--start s --end s]
import { readFileSync } from "node:fs";
import { detectHits } from "../src/engine/hits";

function decodeWav(buf: Buffer): { mono: Float32Array; sampleRate: number } {
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error("not a WAV");
  let p = 12;
  let fmt = { channels: 1, sampleRate: 44100, bits: 16, format: 1 };
  while (p + 8 <= buf.length) {
    const id = buf.toString("ascii", p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === "fmt ") fmt = { format: buf.readUInt16LE(p + 8), channels: buf.readUInt16LE(p + 10), sampleRate: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    if (id === "data") {
      const bytes = fmt.bits / 8;
      const frames = Math.floor(size / bytes / fmt.channels);
      const mono = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < fmt.channels; c++) {
          const off = p + 8 + (i * fmt.channels + c) * bytes;
          sum += fmt.format === 3 ? buf.readFloatLE(off) : fmt.bits === 16 ? buf.readInt16LE(off) / 32768 : fmt.bits === 24 ? ((buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16)) << 8) / 2147483648 : buf.readInt32LE(off) / 2147483648;
        }
        mono[i] = sum / fmt.channels;
      }
      return { mono, sampleRate: fmt.sampleRate };
    }
    p += 8 + size + (size & 1);
  }
  throw new Error("no data chunk");
}

const argv = process.argv.slice(2);
const opt = (k: string): string | undefined => argv[argv.indexOf(k) + 1];
const [mixPath, stemPath] = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
const grid = { bpm: Number(opt("--bpm") ?? 120), offsetMs: 0, beatsPerBar: 4, halftime: false };
const start = Number(opt("--start") ?? 0);
const end = Number(opt("--end") ?? 1e9);
for (const [label, file] of [["mix", mixPath], ["drums stem", stemPath]] as const) {
  if (!file) continue;
  const { mono, sampleRate } = decodeWav(readFileSync(file));
  const hits = detectHits(mono, sampleRate, { grid });
  const inRange = (h: { t: number; conf: number }): boolean => h.t >= start && h.t < end && h.conf >= 0.5;
  const k = hits.kick.filter(inRange);
  const s = hits.snare.filter(inRange);
  console.log(`${label}: ${k.length} kicks  ${k.map((h) => h.t.toFixed(2)).join(" ")}`);
  console.log(`${label}: ${s.length} snares ${s.map((h) => h.t.toFixed(2)).join(" ")}`);
}
