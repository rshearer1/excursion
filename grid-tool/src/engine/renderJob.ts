// Excursion — the pure parts of the Render button: job naming, progress from make_reel's
// log, and the state both the local helper (server/render.ts) and the page share.

export type RenderProfile = "test" | "draft" | "final";
export type RenderEngine = "cycles" | "eevee";

export interface RenderRequest {
  /** Job slug: blender/jobs/<slug>.drive.json, frames/<slug>, out/<slug>.mp4. */
  slug: string;
  engine: RenderEngine;
  profile: RenderProfile;
  /** drive.json content; audio.file must name a file already in blender/jobs/. */
  drive: { fps: number; range?: { start: number; end: number }; frames: unknown[]; audio: { file: string } };
}

export interface RenderState {
  status: "idle" | "running" | "done" | "error";
  slug?: string;
  profile?: RenderProfile;
  engine?: RenderEngine;
  /** Frames written so far and the number the job will write. */
  done: number;
  total: number;
  startedAt?: number;
  finishedAt?: number;
  /** Set when the reel is muxed: the URL the page can play. */
  reel?: string;
  error?: string;
  /** The last few lines of make_reel's output, for the status line. */
  log: string[];
}

export const IDLE: RenderState = { status: "idle", done: 0, total: 0, log: [] };

/** A safe job name from a track filename: "MiXX-Repressed Emotion.wav" -> "mixx-repressed-emotion". */
export function slugify(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").toLowerCase();
  const slug = base
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "track";
}

/** Frames the render will write: the trimmed range when there is one, else the whole drive. */
export function totalFrames(drive: RenderRequest["drive"]): number {
  if (drive.range) {
    const start = Math.max(1, Math.round(drive.range.start * drive.fps) + 1);
    const end = Math.min(drive.frames.length, Math.round(drive.range.end * drive.fps));
    return Math.max(0, end - start + 1);
  }
  return drive.frames.length;
}

/** What one line of make_reel's output means for progress, if anything. */
export function parseProgressLine(line: string): { frame: number } | { reel: string } | { error: string } | null {
  const saved = /Saved: '([^']+?)(\d+)\.png'/.exec(line);
  if (saved) return { frame: Number(saved[2]) };
  const reel = /^done: (.+\.mp4)\s*$/.exec(line.trim());
  if (reel) return { reel: reel[1]! };
  if (/Traceback|^Error: |exited \d+|ENOENT/.test(line)) return { error: line.trim() };
  return null;
}

/** Seconds left at the current rate, or null before the first frame lands. */
export function etaSeconds(state: Pick<RenderState, "done" | "total" | "startedAt">, now: number): number | null {
  if (state.startedAt === undefined || state.done <= 0 || state.total <= 0) return null;
  const perFrame = (now - state.startedAt) / 1000 / state.done;
  return Math.max(0, (state.total - state.done) * perFrame);
}

/** "12 s", "4 min", "1 h 05" — for the status line. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}
