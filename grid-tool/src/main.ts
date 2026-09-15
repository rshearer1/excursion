import {
  type Grid,
  beatTimes,
  beatPhaseAt,
  beatPosition,
  beatDurationSec,
} from "./engine/grid";
import { extractFeatures } from "./engine/features";
import { buildDrive, type DriveJson } from "./engine/exporter";
import { coneMotion, MID_DOME } from "./engine/cone";
import { synthTestTrack } from "./engine/synth";
import { computeCuts } from "./engine/cuts";
import { envelopeFollow } from "./engine/envelope";
import { autoGain } from "./engine/autogain";
import type { FrameFeatures } from "./engine/features";
import { rigStateAt, type DriveLike } from "./preview/rig";
import { etaSeconds, formatDuration, slugify, type RenderEngine, type RenderProfile, type RenderState } from "./engine/renderJob";
import {
  DEFAULT_LYRICS,
  LYRIC_ANCHORS,
  LYRIC_COLORS,
  LYRIC_STYLES,
  exportLyrics,
  fillEnds,
  lineAt,
  linesFromText,
  parseLrc,
  quantiseLyrics,
  tapLine,
  type LyricLine,
  type LyricSize,
  type LyricStyle,
  type Lyrics,
} from "./engine/lyrics";
import type { PreviewViewport } from "./preview/viewport";

declare global {
  interface Window {
    /** File System Access API — Chromium only; feature-detected before use. */
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
  }
}

// ---------- dom ----------
function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}
const fileInput = $<HTMLInputElement>("file");
const demoBtn = $<HTMLButtonElement>("demo");
const trackNameEl = $<HTMLSpanElement>("trackname");
const overviewCanvas = $<HTMLCanvasElement>("overview");
const zoomCanvas = $<HTMLCanvasElement>("wave");
const playBtn = $<HTMLButtonElement>("play");
const timeEl = $<HTMLSpanElement>("time");
const metroChk = $<HTMLInputElement>("metro");
const moodSel = $<HTMLSelectElement>("mood");
const sceneSel = $<HTMLSelectElement>("scene");
const linkBtn = $<HTMLButtonElement>("linkdir");
const driveChk = $<HTMLInputElement>("driveOverlay");
const previewChk = $<HTMLInputElement>("preview3d");
const previewCanvas = $<HTMLCanvasElement>("preview");
const previewWrap = $<HTMLDivElement>("previewWrap");
const safeChk = $<HTMLInputElement>("safeChk");
const safezone = $<HTMLDivElement>("safezone");
const cutsSel = $<HTMLSelectElement>("cuts");
const cutMarkersChk = $<HTMLInputElement>("cutMarkers");
const fpsSel = $<HTMLSelectElement>("fps");
const leadInput = $<HTMLInputElement>("lead");
const exportBtn = $<HTMLButtonElement>("export");
const bpmInput = $<HTMLInputElement>("bpm");
const tapBtn = $<HTMLButtonElement>("tap");
const offsetInput = $<HTMLInputElement>("offset");
const offsetValEl = $<HTMLSpanElement>("offsetVal");
const halftimeChk = $<HTMLInputElement>("halftime");
const bpbInput = $<HTMLInputElement>("bpb");
const trimInput = $<HTMLInputElement>("trim");
const statusEl = $<HTMLDivElement>("status");
const profileSel = $<HTMLSelectElement>("profile");
const engineSel = $<HTMLSelectElement>("engine");
const renderBtn = $<HTMLButtonElement>("render");
const stopRenderBtn = $<HTMLButtonElement>("stopRender");
const renderPanel = $<HTMLDivElement>("renderPanel");
const renderText = $<HTMLSpanElement>("renderText");
const renderEta = $<HTMLSpanElement>("renderEta");
const renderBar = $<HTMLProgressElement>("renderBar");
const reelVideo = $<HTMLVideoElement>("reel");
const renderLog = $<HTMLDivElement>("renderLog");
const lrcFile = $<HTMLInputElement>("lrcFile");
const lyricTranscribeBtn = $<HTMLButtonElement>("lyricTranscribe");
const lyricQuantiseBtn = $<HTMLButtonElement>("lyricQuantise");
const lyricClearBtn = $<HTMLButtonElement>("lyricClear");
const lyricStyleSel = $<HTMLSelectElement>("lyricStyle");
const lyricAnchorSel = $<HTMLSelectElement>("lyricAnchor");
const lyricColorSel = $<HTMLSelectElement>("lyricColor");
const lyricSizeSel = $<HTMLSelectElement>("lyricSize");
const lyricLightChk = $<HTMLInputElement>("lyricLight");
const lyricText = $<HTMLTextAreaElement>("lyricText");
const lyricUseBtn = $<HTMLButtonElement>("lyricUse");
const lyricHint = $<HTMLSpanElement>("lyricHint");
const lyricList = $<HTMLDivElement>("lyricList");
const lyricsBox = $<HTMLDetailsElement>("lyricsBox");
const loadRow = $<HTMLDivElement>("drop");

const ZOOM_BEATS = 8; // width of the beat lane window

// ---------- state ----------
interface Track {
  name: string;
  sha1: string;
  /** The file as loaded, so Render can hand the audio to Blender; null for the demo. */
  file: File | null;
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
let projectDir: FileSystemDirectoryHandle | null = null;
let rangeIn: number | null = null;
let rangeOut: number | null = null;
let markers: { t: number; kind: "drop" | "break" }[] = [];
let lyrics: Lyrics = structuredClone(DEFAULT_LYRICS);
let driveCache: FrameFeatures | null = null; // 30fps features for the overlay
let overlayBass: Float32Array | null = null;
let overlayOnsets: number[] = [];
let preview: PreviewViewport | null = null;
let previewDrive: DriveLike | null = null; // same frames the exporter writes, at 30 fps
let previewDirty = true;
let previewBuilding = false;
let previewLastTs = 0;

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
  scene: string;
  mood: string;
  trim: number;
  rangeIn: number | null;
  rangeOut: number | null;
  markers: { t: number; kind: "drop" | "break" }[];
  cutsEveryBars: number;
  cutMarkers: boolean;
  fps: number;
  leadMs: number;
  lyrics?: Lyrics;
}
const storeKey = (sha1: string): string => `excursion:grid:${sha1}`;
function saveState(): void {
  if (!track) return;
  previewDirty = true; // every persisted change can move a beat, a cut or an envelope
  const saved: Saved = {
    bpm: grid.bpm,
    offsetMs: grid.offsetMs,
    beatsPerBar: grid.beatsPerBar,
    halftime: grid.halftime,
    scene: sceneSel.value,
    mood: moodSel.value,
    trim: Number(trimInput.value) || 1,
    rangeIn,
    rangeOut,
    markers,
    cutsEveryBars: Number(cutsSel.value) || 0,
    cutMarkers: cutMarkersChk.checked,
    fps: Number(fpsSel.value) || 30,
    leadMs: Number(leadInput.value) || 0,
    lyrics,
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
    if (s.scene) sceneSel.value = s.scene;
    trimInput.value = String(s.trim);
    rangeIn = s.rangeIn ?? null;
    rangeOut = s.rangeOut ?? null;
    markers = s.markers ?? [];
    if (s.cutsEveryBars !== undefined) cutsSel.value = String(s.cutsEveryBars);
    if (s.cutMarkers !== undefined) cutMarkersChk.checked = s.cutMarkers;
    lyrics = s.lyrics ?? structuredClone(DEFAULT_LYRICS);
    syncLyricControls();
    if (s.fps) fpsSel.value = String(s.fps);
    if (s.leadMs !== undefined) leadInput.value = String(s.leadMs);
    syncControls();
    return true;
  } catch {
    return false;
  }
}
function syncControls(): void {
  bpmInput.value = String(grid.bpm);
  offsetInput.value = String(grid.offsetMs);
  offsetValEl.textContent = String(grid.offsetMs);
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
function adoptTrack(name: string, sha1: string, buffer: AudioBuffer, file: File | null = null): void {
  stop();
  const mono = monoMix(buffer);
  track = { name, sha1, file, buffer, mono, peaks: computePeaks(mono, overviewCanvas.width) };
  startOffsetSec = 0;
  rangeIn = null;
  rangeOut = null;
  markers = [];
  driveCache = null;
  overlayBass = null;
  overlayOnsets = [];
  previewDrive = null;
  previewDirty = true;
  lyrics = structuredClone(DEFAULT_LYRICS);
  syncLyricControls();
  trackNameEl.textContent = `${name} — ${buffer.duration.toFixed(2)}s @ ${buffer.sampleRate}Hz`;
  playBtn.disabled = false;
  exportBtn.disabled = false;
  renderBtn.disabled = !(file && helperOnline);
  const restored = loadState(sha1);
  syncControls();
  status(
    restored
      ? "Loaded. Grid restored from last session."
      : "Loaded. Set BPM, then click a kick in the beat lane to set the downbeat — nudge from there.",
  );
}
async function loadFile(file: File): Promise<void> {
  try {
    status(`Decoding ${file.name}…`);
    const bytes = await file.arrayBuffer();
    const sha1 = await sha1Hex(bytes.slice(0));
    const buffer = await ctx().decodeAudioData(bytes);
    adoptTrack(file.name, sha1, buffer, file);
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
  syncControls();
  saveState();
}

// ---------- drawing ----------
const ovCtx = overviewCanvas.getContext("2d");
const zmCtx = zoomCanvas.getContext("2d");
function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}
function zoomWindow(): { start: number; dur: number } {
  const dur = ZOOM_BEATS * beatDurationSec(grid);
  return { start: songTime() - dur / 2, dur };
}
function drawOverview(): void {
  if (!ovCtx) return;
  const W = overviewCanvas.width;
  const H = overviewCanvas.height;
  ovCtx.fillStyle = "#12161a";
  ovCtx.fillRect(0, 0, W, H);
  if (!track) return;
  const dur = track.buffer.duration;
  const mid = H / 2;

  ovCtx.fillStyle = "#31454d";
  for (let x = 0; x < W; x++) {
    const lo = track.peaks.min[x]!;
    const hi = track.peaks.max[x]!;
    const y0 = mid - hi * (mid - 3);
    const y1 = mid - lo * (mid - 3);
    ovCtx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
  // downbeats only — the full grid would be an unreadable comb at this scale
  ovCtx.fillStyle = "rgba(240,138,46,0.55)";
  for (const b of beatTimes(grid, dur)) {
    if (!b.downbeat) continue;
    ovCtx.fillRect((b.t / dur) * W, 0, 1, H);
  }
  // dim outside the render range
  ovCtx.fillStyle = "rgba(0,0,0,0.55)";
  if (rangeIn !== null) ovCtx.fillRect(0, 0, (rangeIn / dur) * W, H);
  if (rangeOut !== null) ovCtx.fillRect((rangeOut / dur) * W, 0, W - (rangeOut / dur) * W, H);
  // markers
  for (const m of markers) {
    ovCtx.fillStyle = m.kind === "drop" ? "#ff5f52" : "#d4b64e";
    ovCtx.fillRect((m.t / dur) * W, 0, 2, H);
  }
  // zoom viewport
  const { start, dur: zdur } = zoomWindow();
  ovCtx.fillStyle = "rgba(78,201,212,0.12)";
  ovCtx.fillRect((start / dur) * W, 0, (zdur / dur) * W, H);
  // playhead
  ovCtx.fillStyle = "#e8ebe6";
  ovCtx.fillRect((songTime() / dur) * W, 0, 2, H);
}
function drawZoom(): void {
  if (!zmCtx) return;
  const W = zoomCanvas.width;
  const H = zoomCanvas.height;
  zmCtx.fillStyle = "#12161a";
  zmCtx.fillRect(0, 0, W, H);
  if (!track) return;

  const sr = track.buffer.sampleRate;
  const mono = track.mono;
  const { start, dur } = zoomWindow();
  const xOf = (t: number): number => ((t - start) / dur) * W;

  // alternating bar tint for orientation
  const beatDur = beatDurationSec(grid);
  const barDur = grid.beatsPerBar * beatDur;
  const offsetSec = grid.offsetMs / 1000;
  const firstBar = Math.floor((start - offsetSec) / barDur) - 1;
  for (let bar = firstBar; ; bar++) {
    const t0 = offsetSec + bar * barDur;
    if (t0 > start + dur) break;
    if (bar % 2 !== 0) continue;
    const x0 = Math.max(0, xOf(t0));
    const x1 = Math.min(W, xOf(t0 + barDur));
    if (x1 <= 0) continue;
    zmCtx.fillStyle = "rgba(255,255,255,0.022)";
    zmCtx.fillRect(x0, 0, x1 - x0, H);
  }

  // waveform at window resolution
  const mid = H / 2;
  zmCtx.fillStyle = "#3d565e";
  const samplesPerCol = (dur * sr) / W;
  for (let x = 0; x < W; x++) {
    const s0 = Math.floor((start + (x / W) * dur) * sr);
    const s1 = Math.floor(s0 + samplesPerCol) + 1;
    if (s1 < 0 || s0 >= mono.length) continue;
    let lo = 0;
    let hi = 0;
    for (let i = Math.max(0, s0); i < Math.min(mono.length, s1); i++) {
      const v = mono[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const y0 = mid - hi * (mid - 8);
    const y1 = mid - lo * (mid - 8);
    zmCtx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }

  // beat lines
  const firstBeat = Math.floor((start - offsetSec) / beatDur);
  for (let k = firstBeat; ; k++) {
    const t = offsetSec + k * beatDur;
    if (t > start + dur) break;
    const x = xOf(t);
    if (x < 0) continue;
    const downbeat = ((k % grid.beatsPerBar) + grid.beatsPerBar) % grid.beatsPerBar === 0;
    zmCtx.fillStyle = downbeat ? "#f08a2e" : "rgba(78,201,212,0.5)";
    zmCtx.fillRect(x, 0, downbeat ? 3 : 1, H);
  }

  // drive overlay: what the woofer will actually do
  if (driveChk.checked && overlayBass) {
    zmCtx.fillStyle = "rgba(240,138,46,0.35)";
    for (let x = 0; x < W; x++) {
      const idx = Math.round((start + (x / W) * dur) * 30);
      const v = idx >= 0 && idx < overlayBass.length ? overlayBass[idx]! : 0;
      if (v > 0.005) zmCtx.fillRect(x, H - v * H * 0.4, 1, v * H * 0.4);
    }
    zmCtx.fillStyle = "#ffd9a8";
    for (const i of overlayOnsets) {
      const x = xOf(i / 30);
      if (x >= 0 && x < W) zmCtx.fillRect(x, H - 14, 2, 14);
    }
  }

  // range edges + markers
  zmCtx.font = "24px monospace";
  const edge = (t: number | null, label: string): void => {
    if (t === null) return;
    const x = xOf(t);
    if (x < -20 || x > W + 20) return;
    zmCtx.fillStyle = "#9fe8ef";
    zmCtx.fillRect(x, 0, 2, H);
    zmCtx.fillText(label, x + 6, 28);
  };
  edge(rangeIn, "IN");
  edge(rangeOut, "OUT");
  for (const m of markers) {
    const x = xOf(m.t);
    if (x < 0 || x > W) continue;
    zmCtx.fillStyle = m.kind === "drop" ? "#ff5f52" : "#d4b64e";
    zmCtx.fillRect(x, 0, 2, H);
    zmCtx.fillText(m.kind === "drop" ? "D" : "B", x + 6, H - 20);
  }

  // lyric lane: each timed line is a block along the bottom, the live one lit
  const timed = lyrics.lines.filter((l) => l.t >= 0);
  if (timed.length) {
    const now = songTime();
    zmCtx.font = "22px monospace";
    for (const l of timed) {
      const x0 = xOf(l.t);
      const x1 = xOf(l.tEnd > l.t ? l.tEnd : l.t + 2);
      if (x1 < 0 || x0 > W) continue;
      const live = now >= l.t && now < (l.tEnd > l.t ? l.tEnd : l.t + 2);
      zmCtx.fillStyle = live ? "rgba(240,138,46,0.55)" : "rgba(240,138,46,0.22)";
      zmCtx.fillRect(Math.max(0, x0), H - 44, Math.min(W, x1) - Math.max(0, x0), 30);
      zmCtx.fillStyle = live ? "#fff2e0" : "#ffd9a8";
      zmCtx.fillText(l.text, Math.max(4, x0 + 6), H - 22);
    }
  }

  // centre playhead
  zmCtx.fillStyle = "#e8ebe6";
  zmCtx.fillRect(W / 2 - 1, 0, 3, H);

  // beat flash
  if (playing && metroChk.checked) {
    const phase = beatPhaseAt(grid, songTime());
    const alpha = Math.max(0, 1 - phase * 4);
    if (alpha > 0) {
      zmCtx.fillStyle = `rgba(240,138,46,${(alpha * 0.75).toFixed(3)})`;
      zmCtx.fillRect(0, 0, W, 10);
    }
  }
}
function draw(): void {
  requestAnimationFrame(draw);
  drawOverview();
  drawZoom();
  if (track) timeEl.textContent = `${fmtTime(songTime())} / ${fmtTime(track.buffer.duration)}`;
  scheduleClicks();
  tickPreview();
}

// ---------- 3D preview ----------
async function ensurePreviewDrive(): Promise<void> {
  if (!track || previewBuilding) return;
  previewBuilding = true;
  try {
    if (!driveCache) {
      status("Analysing for 3D preview…");
      await new Promise((r) => setTimeout(r, 30));
      driveCache = extractFeatures(track.mono, track.buffer.sampleRate, { fps: 30 });
    }
    previewDrive = buildCurrentDrive(30, driveCache);
    previewDirty = false;
  } finally {
    previewBuilding = false;
  }
}
function tickPreview(): void {
  if (!preview || !previewChk.checked || !track) return;
  if (previewDirty) void ensurePreviewDrive();
  if (!previewDrive) return;
  const now = performance.now();
  const dt = playing && previewLastTs ? (now - previewLastTs) / 1000 : 0;
  previewLastTs = now;
  preview.render(rigStateAt(previewDrive, songTime()), dt);
}
/** Bind the scene-kit glTF export when the linked folder has one; otherwise the placeholder stays. */
async function loadPreviewRig(): Promise<void> {
  if (!preview || !projectDir) return;
  const { loadSceneGltf } = await import("./preview/gltf");
  const rig = await loadSceneGltf(projectDir, sceneSel.value).catch(() => null);
  if (rig && preview) {
    preview.setRig(rig);
    preview.resize();
    status(`3D preview: bound blender/scenes/${sceneSel.value}.glb.`);
  }
}

// ---------- drive overlay ----------
async function ensureOverlay(): Promise<void> {
  if (!track) return;
  if (!driveCache) {
    status("Analysing for drive overlay…");
    await new Promise((r) => setTimeout(r, 30));
    driveCache = extractFeatures(track.mono, track.buffer.sampleRate, { fps: 30 });
  }
  const gain = { percentile: 0.95, target: 0.9, trim: Number(trimInput.value) || 1 };
  overlayBass = autoGain(envelopeFollow(driveCache.bass, 0.6, 0.12), gain);
  const flux = autoGain(driveCache.flux, gain);
  overlayOnsets = [];
  for (let i = 0; i < flux.length; i++) if (flux[i]! > 0.5) overlayOnsets.push(i);
  status("Drive overlay on — orange fill is the woofer, pale ticks are onsets.");
}

// ---------- export ----------
/** drive.json for the loaded track from the current controls — the export and the 3D preview share it. */
function buildCurrentDrive(
  fps: number,
  features: FrameFeatures,
  motion: { cone?: [number, number][]; dome?: [number, number][] } = {},
): DriveJson {
  if (!track) throw new Error("no track loaded");
  const sortedMarkers = [...markers].sort((a, b) => a.t - b.t);
  const range =
    rangeIn !== null && rangeOut !== null && rangeOut > rangeIn
      ? { start: rangeIn, end: rangeOut }
      : undefined;
  return buildDrive({
    fileName: track.name,
    sha1: track.sha1,
    durationSec: track.buffer.duration,
    grid,
    fps,
    scene: sceneSel.value,
    mood: moodSel.value,
    features,
    ...motion,
    range,
    sections: sortedMarkers,
    cuts: computeCuts(grid, track.buffer.duration, {
      everyBars: Number(cutsSel.value) || 0,
      markerTimes: cutMarkersChk.checked ? sortedMarkers.map((m) => m.t) : [],
    }),
    leadMs: Number(leadInput.value) || 0,
    tuning: { trim: Number(trimInput.value) || 1 },
    lyrics: exportLyrics(lyrics),
  });
}
async function exportDrive(): Promise<void> {
  if (!track) return;
  status("Analysing… (this can take a moment on long tracks)");
  exportBtn.disabled = true;
  await new Promise((r) => setTimeout(r, 30)); // let the status paint
  try {
    const fps = Number(fpsSel.value) || 30;
    const features = extractFeatures(track.mono, track.buffer.sampleRate, { fps });
    const drive = buildCurrentDrive(fps, features, {
      cone: coneMotion(track.mono, track.buffer.sampleRate, { fps }),
      dome: coneMotion(track.mono, track.buffer.sampleRate, { fps, ...MID_DOME }),
    });
    const json = JSON.stringify(drive);
    const fname = `${track.name.replace(/\.[^.]+$/, "")}.drive.json`;
    if (projectDir) {
      const blenderDir = await projectDir.getDirectoryHandle("blender", { create: true });
      const jobsDir = await blenderDir.getDirectoryHandle("jobs", { create: true });
      const fileHandle = await jobsDir.getFileHandle(fname, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(json);
      await writable.close();
      status(`Wrote blender/jobs/${fname} — ${drive.frames.length} frames, ${drive.beats.length} beats.`);
    } else {
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      a.click();
      URL.revokeObjectURL(a.href);
      status(`Downloaded ${fname} — ${drive.frames.length} frames, ${drive.beats.length} beats. Link a folder to write straight into blender/jobs/.`);
    }
    saveState();
  } catch (e) {
    status(`Export failed: ${e instanceof Error ? e.message : String(e)}`, true);
  } finally {
    exportBtn.disabled = false;
  }
}

// ---------- lyrics (phase 10) ----------
function fillSelect(sel: HTMLSelectElement, values: { value: string; label: string; title?: string }[], keep?: string): void {
  sel.replaceChildren(
    ...values.map((v) => {
      const o = document.createElement("option");
      o.value = v.value;
      o.textContent = v.label;
      if (v.title) o.title = v.title;
      return o;
    }),
  );
  if (keep && values.some((v) => v.value === keep)) sel.value = keep;
}
fillSelect(lyricStyleSel, LYRIC_STYLES.map((s) => ({ value: s.value, label: s.label, title: s.hint })));
fillSelect(lyricColorSel, LYRIC_COLORS.map((c) => ({ value: c, label: c })));

/** Push the lyric defaults into the controls and redraw the list. */
function syncLyricControls(): void {
  const anchors = LYRIC_ANCHORS[sceneSel.value] ?? [];
  fillSelect(lyricAnchorSel, anchors.map((a) => ({ value: a, label: a })), lyrics.defaults.anchor);
  if (!anchors.includes(lyrics.defaults.anchor) && anchors[0]) lyrics.defaults.anchor = anchors[0];
  lyricStyleSel.value = lyrics.defaults.style;
  lyricColorSel.value = lyrics.defaults.color;
  lyricSizeSel.value = lyrics.defaults.size;
  lyricLightChk.checked = lyrics.defaults.lightRoom;
  renderLyricList();
}

function lyricsChanged(): void {
  saveState();
  renderLyricList();
  draw();
}

function renderLyricList(): void {
  const untimed = lyrics.lines.filter((l) => l.t < 0).length;
  lyricHint.textContent = lyrics.lines.length
    ? `${lyrics.lines.length} lines${untimed ? ` · ${untimed} to tap in: play and press Enter on each` : " · all timed"}`
    : "no lines";
  if (lyrics.lines.length) lyricsBox.open = true;
  const now = songTime();
  const live = lineAt(lyrics.lines, now);
  lyricList.replaceChildren(
    ...lyrics.lines.flatMap((line, i) => {
      const t = document.createElement("span");
      t.className = `t${line.t < 0 ? " untimed" : ""}${line === live ? " live" : ""}`;
      t.textContent = line.t < 0 ? "— tap —" : fmtTime(line.t);
      t.title = "click to seek here · shift-click to re-time at the playhead";
      t.addEventListener("click", (e) => {
        if (e.shiftKey) {
          const shift = songTime() - (line.t < 0 ? songTime() : line.t);
          line.t = songTime();
          line.tEnd = line.tEnd > 0 ? Math.max(line.t + 0.3, line.tEnd + shift) : line.t;
          lyricsChanged();
        } else if (line.t >= 0) seek(line.t);
      });
      const text = document.createElement("input");
      text.type = "text";
      text.value = line.text;
      text.addEventListener("change", () => {
        line.text = text.value;
        delete line.words; // typed edits invalidate word times
        lyricsChanged();
      });
      const style = document.createElement("select");
      fillSelect(style, [{ value: "", label: "inherit" }, ...LYRIC_STYLES.map((s) => ({ value: s.value, label: s.label }))], line.style ?? "");
      style.addEventListener("change", () => {
        if (style.value) line.style = style.value as LyricStyle;
        else delete line.style;
        lyricsChanged();
      });
      const anchor = document.createElement("select");
      fillSelect(anchor, [{ value: "", label: "inherit" }, ...(LYRIC_ANCHORS[sceneSel.value] ?? []).map((a) => ({ value: a, label: a }))], line.anchor ?? "");
      anchor.addEventListener("change", () => {
        if (anchor.value) line.anchor = anchor.value;
        else delete line.anchor;
        lyricsChanged();
      });
      const del = document.createElement("button");
      del.textContent = "×";
      del.title = "delete this line";
      del.addEventListener("click", () => {
        lyrics.lines.splice(i, 1);
        lyricsChanged();
      });
      return [t, text, style, anchor, del];
    }),
  );
}

function tapLyric(): void {
  if (!track) return;
  const before = lyrics.lines.filter((l) => l.t < 0).length;
  lyrics.lines = tapLine(lyrics.lines, songTime());
  const after = lyrics.lines.filter((l) => l.t < 0).length;
  if (after === before) {
    status("Every line is timed — shift-click a time in the list to re-time it.");
    return;
  }
  lyricsChanged();
  status(after ? `Tapped — ${after} line${after === 1 ? "" : "s"} to go.` : "All lines timed.");
}

lyricUseBtn.addEventListener("click", () => {
  const fresh = linesFromText(lyricText.value);
  if (!fresh.length) return;
  // keep times for lines whose text already exists, in order
  const old = [...lyrics.lines];
  lyrics.lines = fresh.map((l) => {
    const idx = old.findIndex((o) => o.text === l.text && o.t >= 0);
    return idx >= 0 ? old.splice(idx, 1)[0]! : l;
  });
  lyricText.value = "";
  lyricsChanged();
  status(`${lyrics.lines.length} lines — play the track and press Enter as each one is sung.`);
});
lrcFile.addEventListener("change", async () => {
  const f = lrcFile.files?.[0];
  if (!f) return;
  const text = await f.text();
  let lines: LyricLine[] = [];
  if (f.name.endsWith(".json")) {
    try {
      const j = JSON.parse(text) as { segments?: { start: number; end: number; text: string; words?: { word: string; start?: number }[] }[] };
      lines = fillEnds(
        (j.segments ?? []).map((s) => ({
          t: s.start,
          tEnd: s.end,
          text: s.text.trim(),
          ...(s.words?.length ? { words: s.words.filter((w) => w.start !== undefined).map((w) => ({ t: w.start!, w: w.word.trim() })) } : {}),
        })),
      );
    } catch {
      status("That json is not a WhisperX result.", true);
      return;
    }
  } else {
    lines = parseLrc(text);
    if (!lines.length) lines = linesFromText(text);
  }
  lyrics.lines = lines;
  lrcFile.value = "";
  lyricsChanged();
  status(`${lines.length} lyric lines from ${f.name}.`);
});
lyricTranscribeBtn.addEventListener("click", async () => {
  if (!track?.file) {
    status("Load an audio file first (the demo has no vocal).", true);
    return;
  }
  lyricTranscribeBtn.disabled = true;
  status("Storing the audio and running WhisperX… (a minute or two)");
  try {
    const put = await fetch(`/api/jobs/${encodeURIComponent(track.name)}`, { method: "PUT", body: track.file });
    if (!put.ok) throw new Error(`could not store the audio (${put.status})`);
    const res = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: track.name }) });
    const body = (await res.json()) as { lines?: LyricLine[]; error?: string; hint?: string };
    if (!res.ok || !body.lines) throw new Error(`${body.error ?? res.status}${body.hint ? ` — ${body.hint}` : ""}`);
    lyrics.lines = fillEnds(body.lines);
    lyricsChanged();
    status(`WhisperX: ${lyrics.lines.length} lines with word times. Check the low-confidence ones by ear.`);
  } catch (e) {
    status(`Transcribe: ${e instanceof Error ? e.message : String(e)}`, true);
  } finally {
    lyricTranscribeBtn.disabled = false;
  }
});
lyricQuantiseBtn.addEventListener("click", () => {
  lyrics.lines = quantiseLyrics(lyrics.lines, grid);
  lyricsChanged();
  status("Lyric starts and word onsets snapped to 16ths.");
});
lyricClearBtn.addEventListener("click", () => {
  lyrics.lines = [];
  lyricsChanged();
});
lyricStyleSel.addEventListener("change", () => {
  lyrics.defaults.style = lyricStyleSel.value as LyricStyle;
  lyricsChanged();
});
lyricAnchorSel.addEventListener("change", () => {
  lyrics.defaults.anchor = lyricAnchorSel.value;
  lyricsChanged();
});
lyricColorSel.addEventListener("change", () => {
  lyrics.defaults.color = lyricColorSel.value;
  lyricsChanged();
});
lyricSizeSel.addEventListener("change", () => {
  lyrics.defaults.size = lyricSizeSel.value as LyricSize;
  lyricsChanged();
});
lyricLightChk.addEventListener("change", () => {
  lyrics.defaults.lightRoom = lyricLightChk.checked;
  lyricsChanged();
});

// ---------- render (phase 05) ----------
// The dev server carries a local helper (server/render.ts): the page stores the audio in
// blender/jobs/, posts the drive, and polls the job until the reel is muxed, then plays it.
let helperOnline = false;
let renderPoll: number | null = null;

async function detectHelper(): Promise<void> {
  try {
    const res = await fetch("/api/moods");
    if (!res.ok) return;
    const moods = (await res.json()) as { name: string; description: string }[];
    helperOnline = true;
    if (moods.length) {
      const current = moodSel.value;
      moodSel.replaceChildren(
        ...moods.map((m) => {
          const o = document.createElement("option");
          o.value = m.name;
          o.textContent = m.name;
          o.title = m.description;
          return o;
        }),
      );
      moodSel.value = moods.some((m) => m.name === current) ? current : moods[0]!.name;
    }
    renderBtn.disabled = !(track?.file && helperOnline);
    const st = (await (await fetch("/api/render")).json()) as RenderState;
    if (st.status === "running") {
      showRender(st);
      startPolling();
    }
  } catch {
    helperOnline = false; // a static build, or the page is open without npm run dev
  }
}

function showRender(st: RenderState): void {
  renderPanel.hidden = false;
  const pct = st.total > 0 ? st.done / st.total : 0;
  renderBar.value = pct;
  const where = st.slug ? `<b>${st.slug}</b> · ${st.engine} · ${st.profile}` : "";
  if (st.status === "running") {
    const eta = etaSeconds(st, Date.now());
    renderText.innerHTML = `${where} · frame ${st.done} / ${st.total}`;
    renderEta.textContent = eta === null ? "starting Blender…" : `about ${formatDuration(eta)} left`;
    reelVideo.hidden = true;
    stopRenderBtn.hidden = false;
    renderBtn.disabled = true;
  } else if (st.status === "done") {
    const took = st.startedAt && st.finishedAt ? formatDuration((st.finishedAt - st.startedAt) / 1000) : "";
    renderText.innerHTML = `${where} · done${took ? ` in ${took}` : ""} · out/${st.slug}${st.profile === "draft" ? ".draft" : ""}.mp4`;
    renderEta.textContent = "";
    renderBar.value = 1;
    if (st.reel && reelVideo.dataset["src"] !== st.reel) {
      reelVideo.src = `${st.reel}?t=${st.finishedAt ?? Date.now()}`;
      reelVideo.dataset["src"] = st.reel;
    }
    reelVideo.hidden = false;
    stopRenderBtn.hidden = true;
    renderBtn.disabled = !(track?.file && helperOnline);
  } else if (st.status === "error") {
    renderText.innerHTML = `${where} · <span class="err">${st.error ?? "failed"}</span>`;
    renderEta.textContent = "";
    stopRenderBtn.hidden = true;
    renderBtn.disabled = !(track?.file && helperOnline);
  }
  renderLog.textContent = st.status === "done" ? "" : st.log.slice(-4).join("\n");
}

function startPolling(): void {
  if (renderPoll !== null) return;
  renderPoll = window.setInterval(async () => {
    try {
      const st = (await (await fetch("/api/render")).json()) as RenderState;
      showRender(st);
      if (st.status !== "running" && renderPoll !== null) {
        clearInterval(renderPoll);
        renderPoll = null;
        status(st.status === "done" ? "Reel ready — playing below. It is also in out/." : `Render failed: ${st.error ?? "see the log"}`, st.status !== "done");
      }
    } catch {
      /* the helper went away; keep trying */
    }
  }, 1500);
}

async function renderReel(): Promise<void> {
  if (!track?.file) return;
  renderBtn.disabled = true;
  try {
    status("Analysing the track…");
    await new Promise((r) => setTimeout(r, 30));
    const fps = Number(fpsSel.value) || 30;
    const features = extractFeatures(track.mono, track.buffer.sampleRate, { fps });
    const drive = buildCurrentDrive(fps, features, {
      cone: coneMotion(track.mono, track.buffer.sampleRate, { fps }),
      dome: coneMotion(track.mono, track.buffer.sampleRate, { fps, ...MID_DOME }),
    });
    status(`Sending ${track.name} to Blender…`);
    const put = await fetch(`/api/jobs/${encodeURIComponent(track.name)}`, { method: "PUT", body: track.file });
    if (!put.ok) throw new Error(`could not store the audio (${put.status})`);
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: slugify(track.name),
        engine: engineSel.value as RenderEngine,
        profile: profileSel.value as RenderProfile,
        drive,
      }),
    });
    const st = (await res.json()) as RenderState & { error?: string };
    if (!res.ok) throw new Error(st.error ?? `render refused (${res.status})`);
    saveState();
    showRender(st);
    startPolling();
    status(`Rendering ${st.total} frames — ${profileSel.value} profile on ${engineSel.value}. You can keep gridding.`);
  } catch (e) {
    status(`Render failed to start: ${e instanceof Error ? e.message : String(e)}`, true);
    renderBtn.disabled = false;
  }
}

renderBtn.addEventListener("click", () => void renderReel());
stopRenderBtn.addEventListener("click", async () => {
  await fetch("/api/render/stop", { method: "POST" }).catch(() => undefined);
});
void detectHelper();

// ---------- wiring ----------
fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void loadFile(f);
});
// whole page is a drop target
window.addEventListener("dragover", (e) => {
  e.preventDefault();
  loadRow.classList.add("armed");
});
window.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget) loadRow.classList.remove("armed");
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  loadRow.classList.remove("armed");
  const f = e.dataTransfer?.files?.[0];
  if (f) void loadFile(f);
});
demoBtn.addEventListener("click", () => void loadDemo());
playBtn.addEventListener("click", () => (playing ? pause() : play()));
overviewCanvas.addEventListener("click", (e) => {
  if (!track) return;
  const rect = overviewCanvas.getBoundingClientRect();
  seek(((e.clientX - rect.left) / rect.width) * track.buffer.duration);
});
zoomCanvas.addEventListener("click", (e) => {
  if (!track) return;
  const rect = zoomCanvas.getBoundingClientRect();
  const { start, dur } = zoomWindow();
  const t = start + ((e.clientX - rect.left) / rect.width) * dur;
  const tolerance = (6 / rect.width) * dur; // ~6 css px
  const hit = markers.findIndex((m) => Math.abs(m.t - t) < tolerance);
  if (hit >= 0) {
    const gone = markers.splice(hit, 1)[0]!;
    saveState();
    status(`Deleted ${gone.kind} marker.`);
    return;
  }
  grid = { ...grid, offsetMs: Math.round(t * 1000) };
  gridChanged();
  status(`Downbeat set at ${grid.offsetMs} ms — nudge to fine-tune.`);
});
exportBtn.addEventListener("click", () => void exportDrive());
moodSel.addEventListener("change", saveState);
sceneSel.addEventListener("change", () => {
  syncLyricControls();
  saveState();
  void loadPreviewRig();
});
trimInput.addEventListener("change", () => {
  saveState();
  if (driveChk.checked) void ensureOverlay();
});
driveChk.addEventListener("change", () => {
  if (driveChk.checked) void ensureOverlay();
});
safeChk.addEventListener("change", () => safezone.classList.toggle("on", safeChk.checked));
previewChk.addEventListener("change", async () => {
  previewCanvas.hidden = !previewChk.checked;
  previewWrap.hidden = !previewChk.checked;
  if (!previewChk.checked) return;
  if (!preview) {
    try {
      // three.js is only fetched the first time the preview is switched on
      const [{ PreviewViewport }, { buildPlaceholder }] = await Promise.all([
        import("./preview/viewport"),
        import("./preview/placeholder"),
      ]);
      preview = new PreviewViewport(previewCanvas, buildPlaceholder());
    } catch (e) {
      previewChk.checked = false;
      previewCanvas.hidden = true;
      previewWrap.hidden = true;
      status(`3D preview unavailable: ${e instanceof Error ? e.message : String(e)}`, true);
      return;
    }
    void loadPreviewRig();
  }
  preview.resize();
  previewDirty = true;
  previewLastTs = 0;
  status(
    track
      ? "3D preview on — placeholder monitor until blender/scenes/<scene>.glb exists in the linked folder."
      : "3D preview on — load a track to drive it.",
  );
});
window.addEventListener("resize", () => preview?.resize());
cutsSel.addEventListener("change", saveState);
cutMarkersChk.addEventListener("change", saveState);
fpsSel.addEventListener("change", saveState);
leadInput.addEventListener("change", saveState);
linkBtn.addEventListener("click", async () => {
  if (!window.showDirectoryPicker) {
    status("This browser has no folder access — use Chrome or Edge, or keep using downloads.", true);
    return;
  }
  try {
    projectDir = await window.showDirectoryPicker({ mode: "readwrite" });
    linkBtn.textContent = `→ ${projectDir.name}/blender/jobs`;
    status(`Linked. Exports now write straight into ${projectDir.name}/blender/jobs/.`);
    void loadPreviewRig();
  } catch {
    /* picker cancelled */
  }
});

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
  } else if (e.code === "KeyI" && track) {
    rangeIn = e.shiftKey ? null : songTime();
    saveState();
    status(rangeIn === null ? "Range in cleared." : `Range in: ${fmtTime(rangeIn)}`);
  } else if (e.code === "KeyO" && track) {
    rangeOut = e.shiftKey ? null : songTime();
    saveState();
    status(rangeOut === null ? "Range out cleared." : `Range out: ${fmtTime(rangeOut)}`);
  } else if (e.code === "Enter" && track && target.tagName !== "TEXTAREA" && target.tagName !== "BUTTON") {
    e.preventDefault();
    tapLyric();
  } else if ((e.code === "KeyM" || e.code === "KeyB") && track) {
    const kind = e.code === "KeyM" ? ("drop" as const) : ("break" as const);
    markers.push({ t: songTime(), kind });
    saveState();
    status(`${kind} marker at ${fmtTime(songTime())} — click its line to delete.`);
  }
});

syncControls();
draw();
status("Drop a track anywhere, or load the demo.");

// deep link: ?demo loads the demo track, ?demo&3d also switches the preview on
const params = new URLSearchParams(location.search);
if (params.has("demo")) {
  void loadDemo().then(() => {
    if (params.has("3d")) {
      previewChk.checked = true;
      previewChk.dispatchEvent(new Event("change"));
    }
  });
}
