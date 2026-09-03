import { type Grid, beatTimes, beatPhaseAt, beatPosition, beatDurationSec } from "./engine/grid";
import { extractFeatures } from "./engine/features";
import { buildDrive } from "./engine/exporter";
import { synthTestTrack } from "./engine/synth";

// ---------- dom ----------
function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}
const fileInput = $<HTMLInputElement>("file");
const demoBtn = $<HTMLButtonElement>("demo");
const trackNameEl = $<HTMLSpanElement>("trackname");
const canvas = $<HTMLCanvasElement>("wave");
const playBtn = $<HTMLButtonElement>("play");
const timeEl = $<HTMLSpanElement>("time");
const metroChk = $<HTMLInputElement>("metro");
const moodSel = $<HTMLSelectElement>("mood");
const exportBtn = $<HTMLButtonElement>("export");
const bpmInput = $<HTMLInputElement>("bpm");
const tapBtn = $<HTMLButtonElement>("tap");
const offsetInput = $<HTMLInputElement>("offset");
const halftimeChk = $<HTMLInputElement>("halftime");
const bpbInput = $<HTMLInputElement>("bpb");
const trimInput = $<HTMLInputElement>("trim");
const statusEl = $<HTMLDivElement>("status");
const dropZone = $<HTMLDivElement>("drop");

// ---------- state ----------
interface Track {
  name: string;
  sha1: string;
  buffer: AudioBuffer;
  mono: Float32Array;
  peaks: { min: Float32Array; max: Float32Array };
}
let grid: Grid = { bpm: 140, offsetMs: 0, beatsPerBar: 4, halftime: true };
let track: Track | null = null;
let audioCtx: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let playing = false;
let startCtxTime = 0; // AudioContext.currentTime when playback started
let startOffsetSec = 0; // song position at that moment
let schedUntil = 0; // song time up to which metronome clicks are scheduled
let taps: number[] = [];

const status = (msg: string, err = false): void => {
  statusEl.textContent = msg;
  statusEl.classList.toggle("err", err);
};

function ctx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

// ---------- persistence ----------
interface Saved {
  bpm: number;
  offsetMs: number;
  beatsPerBar: number;
  halftime: boolean;
  mood: string;
  trim: number;
}
const storeKey = (sha1: string): string => `excursion:grid:${sha1}`;
function saveState(): void {
  if (!track) return;
  const saved: Saved = {
    bpm: grid.bpm,
    offsetMs: grid.offsetMs,
    beatsPerBar: grid.beatsPerBar,
    halftime: grid.halftime,
    mood: moodSel.value,
    trim: Number(trimInput.value) || 1,
  };
  try {
    localStorage.setItem(storeKey(track.sha1), JSON.stringify(saved));
  } catch {
    /* storage unavailable — settings just will not persist */
  }
}
function loadState(sha1: string): boolean {
  try {
    const raw = localStorage.getItem(storeKey(sha1));
    if (!raw) return false;
    const s = JSON.parse(raw) as Saved;
    grid = { bpm: s.bpm, offsetMs: s.offsetMs, beatsPerBar: s.beatsPerBar, halftime: s.halftime };
    moodSel.value = s.mood;
    trimInput.value = String(s.trim);
    syncControls();
    return true;
  } catch {
    return false;
  }
}
function syncControls(): void {
  bpmInput.value = String(grid.bpm);
  offsetInput.value = String(grid.offsetMs);
  halftimeChk.checked = grid.halftime;
  bpbInput.value = String(grid.beatsPerBar);
}

// ---------- loading ----------
async function sha1Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
function monoMix(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < mono.length; i++) mono[i]! += data[i]! / buffer.numberOfChannels;
  }
  return mono;
}
function computePeaks(mono: Float32Array, columns: number): Track["peaks"] {
  const min = new Float32Array(columns);
  const max = new Float32Array(columns);
  const per = mono.length / columns;
  for (let c = 0; c < columns; c++) {
    let lo = 0;
    let hi = 0;
    const start = Math.floor(c * per);
    const end = Math.min(mono.length, Math.ceil((c + 1) * per));
    for (let i = start; i < end; i++) {
      const v = mono[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[c] = lo;
    max[c] = hi;
  }
  return { min, max };
}
function adoptTrack(name: string, sha1: string, buffer: AudioBuffer): void {
  stop();
  const mono = monoMix(buffer);
  track = { name, sha1, buffer, mono, peaks: computePeaks(mono, canvas.width) };
  startOffsetSec = 0;
  trackNameEl.textContent = `${name} — ${buffer.duration.toFixed(2)}s @ ${buffer.sampleRate}Hz`;
  playBtn.disabled = false;
  exportBtn.disabled = false;
  const restored = loadState(sha1);
  status(
    restored
      ? "Loaded. Grid restored from last session."
      : "Loaded. Set BPM, then nudge the offset until the clicks disappear into the drums.",
  );
}
async function loadFile(file: File): Promise<void> {
  try {
    status(`Decoding ${file.name}…`);
    const bytes = await file.arrayBuffer();
    const sha1 = await sha1Hex(bytes.slice(0));
    const buffer = await ctx().decodeAudioData(bytes);
    adoptTrack(file.name, sha1, buffer);
  } catch (e) {
    status(`Could not decode that file: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}
async function loadDemo(): Promise<void> {
  const sr = 44100;
  const pcm = synthTestTrack({ bpm: 140, offsetMs: 150, bars: 8, sampleRate: sr });
  const copy = pcm.slice(0);
  const sha1 = await sha1Hex(copy.buffer);
  const buffer = ctx().createBuffer(1, pcm.length, sr);
  buffer.copyToChannel(copy, 0);
  adoptTrack("demo-140-halftime", sha1, buffer);
  status("Demo loaded. Ground truth: BPM 140, offset 150 ms. Try finding it by ear, then check.");
}

// ---------- transport ----------
function songTime(): number {
  if (!track) return 0;
  const t = playing && audioCtx ? startOffsetSec + (audioCtx.currentTime - startCtxTime) : startOffsetSec;
  return Math.min(t, track.buffer.duration);
}
function play(): void {
  if (!track || playing) return;
  const ac = ctx();
  if (startOffsetSec >= track.buffer.duration - 0.01) startOffsetSec = 0;
  source = ac.createBufferSource();
  source.buffer = track.buffer;
  source.connect(ac.destination);
  source.onended = () => {
    if (playing && track) pauseAt(track.buffer.duration);
  };
  startCtxTime = ac.currentTime;
  schedUntil = startOffsetSec;
  source.start(0, startOffsetSec);
  playing = true;
  playBtn.textContent = "Pause";
}
function pauseAt(t: number): void {
  playing = false;
  startOffsetSec = t;
  if (source) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      /* already stopped */
    }
    source = null;
  }
  playBtn.textContent = "Play";
}
function pause(): void {
  pauseAt(songTime());
}
function stop(): void {
  pauseAt(0);
}
function seek(t: number): void {
  const wasPlaying = playing;
  pauseAt(Math.max(0, t));
  if (wasPlaying) play();
}

// ---------- metronome ----------
function scheduleClicks(): void {
  if (!playing || !metroChk.checked || !track || !audioCtx) return;
  const now = songTime();
  const horizon = now + 0.3;
  if (schedUntil < now) schedUntil = now;
  const beatDur = beatDurationSec(grid);
  const offsetSec = grid.offsetMs / 1000;
  for (let k = Math.ceil(beatPosition(grid, schedUntil) - 1e-9); ; k++) {
    const beatT = offsetSec + k * beatDur;
    if (beatT <= schedUntil) continue;
    if (beatT > horizon || beatT > track.buffer.duration) break;
    const when = startCtxTime + (beatT - startOffsetSec);
    if (when < audioCtx.currentTime) continue;
    const downbeat = ((k % grid.beatsPerBar) + grid.beatsPerBar) % grid.beatsPerBar === 0;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = downbeat ? 1568 : 1046;
    gain.gain.setValueAtTime(downbeat ? 0.5 : 0.32, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.04);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(when);
    osc.stop(when + 0.05);
  }
  schedUntil = horizon;
}
function gridChanged(): void {
  schedUntil = songTime();
  saveState();
}

// ---------- drawing ----------
const c2d = canvas.getContext("2d");
function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}
function draw(): void {
  requestAnimationFrame(draw);
  if (!c2d) return;
  const W = canvas.width;
  const H = canvas.height;
  c2d.fillStyle = "#171b1e";
  c2d.fillRect(0, 0, W, H);
  if (!track) return;

  const dur = track.buffer.duration;
  const mid = H / 2;
  c2d.fillStyle = "#3d565e";
  for (let x = 0; x < W; x++) {
    const lo = track.peaks.min[x]!;
    const hi = track.peaks.max[x]!;
    const y0 = mid - hi * (mid - 6);
    const y1 = mid - lo * (mid - 6);
    c2d.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
  for (const b of beatTimes(grid, dur)) {
    const x = (b.t / dur) * W;
    c2d.fillStyle = b.downbeat ? "#f08a2e" : "rgba(78,201,212,0.45)";
    c2d.fillRect(x, 0, b.downbeat ? 2 : 1, H);
  }
  const t = songTime();
  c2d.fillStyle = "#e9ebe7";
  c2d.fillRect((t / dur) * W, 0, 2, H);

  if (playing && metroChk.checked) {
    const phase = beatPhaseAt(grid, t);
    const alpha = Math.max(0, 1 - phase * 4);
    if (alpha > 0) {
      c2d.fillStyle = `rgba(240,138,46,${(alpha * 0.8).toFixed(3)})`;
      c2d.fillRect(0, 0, W, 8);
    }
  }
  timeEl.textContent = `${fmtTime(t)} / ${fmtTime(dur)}`;
  scheduleClicks();
}

// ---------- export ----------
async function exportDrive(): Promise<void> {
  if (!track) return;
  status("Analysing… (this can take a moment on long tracks)");
  exportBtn.disabled = true;
  await new Promise((r) => setTimeout(r, 30)); // let the status paint
  try {
    const features = extractFeatures(track.mono, track.buffer.sampleRate, { fps: 30 });
    const drive = buildDrive({
      fileName: track.name,
      sha1: track.sha1,
      durationSec: track.buffer.duration,
      grid,
      fps: 30,
      mood: moodSel.value,
      features,
      tuning: { trim: Number(trimInput.value) || 1 },
    });
    const blob = new Blob([JSON.stringify(drive)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${track.name.replace(/\.[^.]+$/, "")}.drive.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    saveState();
    status(`Exported ${drive.frames.length} frames, ${drive.beats.length} beats.`);
  } catch (e) {
    status(`Export failed: ${e instanceof Error ? e.message : String(e)}`, true);
  } finally {
    exportBtn.disabled = false;
  }
}

// ---------- wiring ----------
fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void loadFile(f);
});
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("armed");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("armed"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("armed");
  const f = e.dataTransfer?.files?.[0];
  if (f) void loadFile(f);
});
demoBtn.addEventListener("click", () => void loadDemo());
playBtn.addEventListener("click", () => (playing ? pause() : play()));
canvas.addEventListener("click", (e) => {
  if (!track) return;
  const rect = canvas.getBoundingClientRect();
  seek(((e.clientX - rect.left) / rect.width) * track.buffer.duration);
});
exportBtn.addEventListener("click", () => void exportDrive());
moodSel.addEventListener("change", saveState);
trimInput.addEventListener("change", saveState);

bpmInput.addEventListener("change", () => {
  const v = Number(bpmInput.value);
  if (v >= 40 && v <= 220) {
    grid = { ...grid, bpm: v };
    gridChanged();
  }
});
offsetInput.addEventListener("change", () => {
  grid = { ...grid, offsetMs: Number(offsetInput.value) || 0 };
  gridChanged();
});
halftimeChk.addEventListener("change", () => {
  grid = { ...grid, halftime: halftimeChk.checked };
  gridChanged();
});
bpbInput.addEventListener("change", () => {
  const v = Math.round(Number(bpbInput.value));
  if (v >= 2 && v <= 8) {
    grid = { ...grid, beatsPerBar: v };
    gridChanged();
  }
});
function nudge(deltaMs: number): void {
  grid = { ...grid, offsetMs: grid.offsetMs + deltaMs };
  offsetInput.value = String(grid.offsetMs);
  gridChanged();
  status(`offset ${grid.offsetMs} ms`);
}
document.querySelectorAll<HTMLButtonElement>("[data-nudge]").forEach((btn) => {
  btn.addEventListener("click", () => nudge(Number(btn.dataset["nudge"])));
});
tapBtn.addEventListener("click", () => {
  const now = performance.now() / 1000;
  const last = taps[taps.length - 1];
  if (last !== undefined && now - last > 2) taps = [];
  taps.push(now);
  if (taps.length >= 4) {
    const diffs = taps.slice(1).map((t, i) => t - taps[i]!);
    const bpm = Math.round((60 / (diffs.reduce((a, b) => a + b, 0) / diffs.length)) * 10) / 10;
    grid = { ...grid, bpm };
    bpmInput.value = String(bpm);
    gridChanged();
    status(`tap: ${bpm} BPM from ${taps.length} taps`);
  } else {
    status(`tap ${taps.length}/4…`);
  }
});
document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === "INPUT" || target.tagName === "SELECT") return;
  if (e.code === "Space") {
    e.preventDefault();
    if (track) {
      if (playing) pause();
      else play();
    }
  } else if (e.code === "ArrowLeft") {
    e.preventDefault();
    nudge(e.shiftKey ? -1 : -10);
  } else if (e.code === "ArrowRight") {
    e.preventDefault();
    nudge(e.shiftKey ? 1 : 10);
  }
});

syncControls();
draw();
status("Drop a track or load the demo to start.");
