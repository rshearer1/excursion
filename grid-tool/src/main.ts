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
import { detectHits, type Hits } from "./engine/hits";
import { automationChannel, inflateAls, parseAls, type AlsAutomation } from "./engine/ableton";
import { stemChannel, stemNameOf, wooferStem } from "./engine/stems";
import { LANE_DEFAULTS, LANE_INFO, cueCount, laneAt, lanesFromMood, setCue, type CueValue, type LaneName, type Rgb, type Show } from "./engine/show";
import {
  PRESET_DIRS,
  applyTemplate,
  blockToShow,
  lyricBlock,
  parsePreset,
  resolveTemplate,
  sceneBlock,
  showToBlock,
  slugName,
  type Library,
  type Preset,
  type ReelState,
  type Template,
} from "./engine/presets";
import { DEFAULT_CUE, MOOD_FIELDS, getPath, moodToJson, parseMood, setPath, withMoodDefaults, type Mood } from "./engine/mood";
import { addHistory, describeLook, lookSignature, matchingReel, type ReelRecord } from "./engine/history";
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
const scenePresetSel = $<HTMLSelectElement>("scenePresetSel");
const scenePresetSaveBtn = $<HTMLButtonElement>("scenePresetSave");
const showPresetSel = $<HTMLSelectElement>("showPresetSel");
const showPresetSaveBtn = $<HTMLButtonElement>("showPresetSave");
const lyricPresetSel = $<HTMLSelectElement>("lyricPresetSel");
const lyricPresetSaveBtn = $<HTMLButtonElement>("lyricPresetSave");
const templateSel = $<HTMLSelectElement>("templateSel");
const templateApplyBtn = $<HTMLButtonElement>("templateApply");
const templateSaveBtn = $<HTMLButtonElement>("templateSave");
const presetFile = $<HTMLInputElement>("presetFile");
const reelHint = $<HTMLSpanElement>("reelHint");
const moodLoadBtn = $<HTMLButtonElement>("moodLoad");
const moodSaveBtn = $<HTMLButtonElement>("moodSave");
const moodSaveAsBtn = $<HTMLButtonElement>("moodSaveAs");
const moodCueAddBtn = $<HTMLButtonElement>("moodCueAdd");
const moodHint = $<HTMLSpanElement>("moodHint");
const moodForm = $<HTMLDivElement>("moodForm");
const sceneSel = $<HTMLSelectElement>("scene");
const linkBtn = $<HTMLButtonElement>("linkdir");
const driveChk = $<HTMLInputElement>("driveOverlay");
const hitsChk = $<HTMLInputElement>("hitsChk");
const alsFile = $<HTMLInputElement>("alsFile");
const stemBtn = $<HTMLButtonElement>("stemBtn");
const stemsFiles = $<HTMLInputElement>("stemsFiles");
const showBox = $<HTMLDetailsElement>("showBox");
const showFromMoodBtn = $<HTMLButtonElement>("showFromMood");
const showClearBtn = $<HTMLButtonElement>("showClear");
const showHint = $<HTMLSpanElement>("showHint");
const deskEl = $<HTMLDivElement>("desk");
const liveChk = $<HTMLInputElement>("liveChk");
const previewChk = $<HTMLInputElement>("preview3d");
const previewCanvas = $<HTMLCanvasElement>("preview");
const previewWrap = $<HTMLDivElement>("previewWrap");
const safeChk = $<HTMLInputElement>("safeChk");
const safezone = $<HTMLDivElement>("safezone");
const lyricOverlay = $<HTMLDivElement>("lyricOverlay");
const lyricOverlayText = $<HTMLSpanElement>("lyricOverlayText");
const cutsSel = $<HTMLSelectElement>("cuts");
const cutMarkersChk = $<HTMLInputElement>("cutMarkers");
const fpsSel = $<HTMLSelectElement>("fps");
const leadInput = $<HTMLInputElement>("lead");
const exportBtn = $<HTMLButtonElement>("export");
const bpmInput = $<HTMLInputElement>("bpm");
const lockGridChk = $<HTMLInputElement>("lockGrid");
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
const previewBtn = $<HTMLButtonElement>("previewBtn");
const previewFrameImg = $<HTMLImageElement>("previewFrame");
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
let hits: Hits | null = null; // tracked kicks and snares, edited in the audit lane
let stems = new Map<string, { mono: Float32Array; sampleRate: number }>(); // loaded stem files by channel name (this session only)
let automation: AlsAutomation[] = []; // automation lanes from the loaded .als, sampled into channels at export
let history: ReelRecord[] = []; // what this track's reels looked like (per track, persisted)
let moodEdit: Mood | null = null; // the mood panel's working copy
let moodDirty = false;
let show: Show = { lanes: {} }; // the desk's cue lanes (phase 12)
// presets and templates (spec 2026-09-18): blocks read from <linked folder>/presets/*, moods from the mood picker
const library: Library & { templates: Record<string, Template> } = { scenes: {}, shows: {}, lyrics: {}, moods: [], templates: {} };
const faders: Partial<Record<LaneName, CueValue>> = {}; // the programmer: what Cue writes
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
  hits?: Hits | null;
  show?: Show;
  history?: ReelRecord[];
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
    hits,
    show,
    history,
  };
  updateReelHint();
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
    hits = s.hits ?? null;
    hitsChk.checked = hits !== null;
    show = s.show ?? { lanes: {} };
    history = s.history ?? [];
    renderDesk();
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
  hits = null;
  hitsChk.checked = false;
  stems = new Map();
  automation = [];
  history = [];
  show = { lanes: {} };
  renderDesk();
  trackNameEl.textContent = `${name} — ${buffer.duration.toFixed(2)}s @ ${buffer.sampleRate}Hz`;
  playBtn.disabled = false;
  exportBtn.disabled = false;
  templateSaveBtn.disabled = false;
  templateApplyBtn.disabled = !templateSel.value;
  updateReelHint();
  renderBtn.disabled = !(file && helperOnline);
  previewBtn.disabled = !helperOnline;
  stemBtn.disabled = !(file && helperOnline);
  previewFrameImg.hidden = true;
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
  requestLive();
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

  // the desk's cues: a thin row per lane across the top, a dot per cue
  LANE_INFO.forEach((info, row) => {
    const cues = show.lanes[info.name];
    if (!cues?.length) return;
    const y = 14 + row * 9;
    zmCtx.fillStyle = LANE_COLORS[info.name];
    for (const c of cues) {
      const x = xOf(c.t);
      if (x < -6 || x > W + 6) continue;
      zmCtx.fillRect(x - 3, y, 7, 7);
    }
  });

  // hit audit lane: kicks (orange) and snares (cyan), tick height = confidence
  if (hits) {
    const row = (list: Hits["kick"], color: string, y: number): void => {
      for (const h of list) {
        const x = xOf(h.t);
        if (x < 0 || x > W) continue;
        const hgt = 8 + 16 * h.conf;
        zmCtx.globalAlpha = 0.35 + 0.65 * h.conf;
        zmCtx.fillStyle = color;
        zmCtx.fillRect(x - 1, y - hgt, 3, hgt);
        if (!h.onGrid) zmCtx.fillRect(x - 3, y + 2, 7, 2); // off-grid: a foot under the tick
      }
      zmCtx.globalAlpha = 1;
    };
    row(hits.kick, "#f08a2e", H - 70);
    row(hits.snare, "#4ec9d4", H - 46);
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
  const t = songTime();
  const state = rigStateAt(previewDrive, t);
  const keyV = laneAt(show.lanes.key, t, LANE_DEFAULTS.key) as { gain: number };
  const rimV = laneAt(show.lanes.rims, t, LANE_DEFAULTS.rims) as { gain: number };
  preview.render({ ...state, key: state.key * keyV.gain, rim: state.rim * rimV.gain }, dt);
  tickLyricOverlay(t);
}

/** The live lyric line over the viewport: anchor picks the position, style picks the reveal. */
function tickLyricOverlay(t: number): void {
  const line = lineAt(lyrics.lines, t);
  if (!line) {
    lyricOverlay.hidden = true;
    return;
  }
  const sec = lyrics.sections?.[[...markers].sort((a, b) => a.t - b.t).filter((m) => m.t <= line.t).pop()?.kind ?? ""] ?? {};
  const style = line.style ?? sec.style ?? lyrics.defaults.style;
  const anchor = line.anchor ?? sec.anchor ?? lyrics.defaults.anchor;
  const color = line.color ?? sec.color ?? lyrics.defaults.color;
  const size = line.size ?? sec.size ?? lyrics.defaults.size;
  let text = line.text;
  if (style === "karaoke" && line.words?.length) {
    text = line.words.map((w) => (t >= w.t ? w.w : "\u2007".repeat(Math.max(1, w.w.length)))).join(" ");
  } else if (style === "typewriter") {
    const step = 60 / grid.bpm / 4;
    const shown = Math.max(0, Math.floor((t - line.t) / step) + 1);
    let k = 0;
    text = [...line.text].map((ch) => (ch === " " ? ch : k++ < shown ? ch : "\u2007")).join("");
  }
  lyricOverlayText.textContent = text;
  lyricOverlayText.style.fontSize = size === "L" ? "17px" : size === "S" ? "10px" : "13px";
  let alpha = 1;
  if (style === "fade") {
    const a = lyrics.defaults.attackMs / 1000;
    const r = lyrics.defaults.releaseMs / 1000;
    alpha = Math.min(1, a > 0 ? (t - line.t + a) / a : 1, r > 0 ? (line.tEnd - t + r) / r : 1);
  } else if (style === "pop") {
    const onset = line.words?.length ? [...line.words].reverse().find((w) => t >= w.t)?.t ?? line.t : line.t;
    alpha = 0.45 + 0.55 * Math.exp(-(t - onset) / 0.28);
  } else if (style === "pulse") {
    const i = Math.round(t * 30);
    alpha = 0.35 + 0.65 * (previewDrive?.frames[i]?.bass ?? 0);
  }
  lyricOverlay.style.opacity = String(Math.max(0, Math.min(1, alpha)));
  lyricOverlay.className = `lyricoverlay ${anchor} ${color}`;
  lyricOverlay.hidden = false;
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
/** A channel key for an automation lane: the parameter word, lower-cased. "Bass/Cutoff" -> "cutoff". */
function autoSlug(name: string): string {
  return (name.split("/").pop() ?? name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

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
    ...(hits ? { hits } : {}),
    ...(() => {
      const channels: Record<string, number[]> = {};
      for (const [name, s] of stems) channels[name] = stemChannel(s.mono, s.sampleRate, fps);
      for (const lane of automation) channels[`auto:${autoSlug(lane.name)}`] = automationChannel(lane, grid.bpm, fps, features.frameCount);
      return Object.keys(channels).length ? { channels } : {};
    })(),
    show,
  });
}

/** Everything a drive needs from the audio: features of the mix, the cone from the kick stem when there is one. */
function analyseForDrive(fps: number): { features: FrameFeatures; cone: [number, number][]; dome: [number, number][] } {
  if (!track) throw new Error("no track loaded");
  const features = extractFeatures(track.mono, track.buffer.sampleRate, { fps });
  const follow = wooferStem(stems.keys());
  const src = follow ? stems.get(follow)! : { mono: track.mono, sampleRate: track.buffer.sampleRate };
  return {
    features,
    cone: coneMotion(src.mono, src.sampleRate, { fps }),
    dome: coneMotion(track.mono, track.buffer.sampleRate, { fps, ...MID_DOME }),
  };
}
async function exportDrive(): Promise<void> {
  if (!track) return;
  status("Analysing… (this can take a moment on long tracks)");
  exportBtn.disabled = true;
  await new Promise((r) => setTimeout(r, 30)); // let the status paint
  try {
    const fps = Number(fpsSel.value) || 30;
    const { features, cone, dome } = analyseForDrive(fps);
    const drive = buildCurrentDrive(fps, features, { cone, dome });
    const json = JSON.stringify(drive);
    const fname = `${track.name.replace(/\.[^.]+$/, "")}.drive.json`;
    if (projectDir) {
      const blenderDir = await projectDir.getDirectoryHandle("blender", { create: true });
      const jobsDir = await blenderDir.getDirectoryHandle("jobs", { create: true });
      const fileHandle = await jobsDir.getFileHandle(fname, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(json);
      await writable.close();
      recordReel("export", "-");
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

// ---------- Ableton project (phase 08) ----------
// The project is ground truth: tempo and downbeat, locators, and MIDI note-ons. Stems and the
// routing matrix are still to come; this fills the same grid, markers and hits the FFT path
// estimates.
alsFile.addEventListener("change", async () => {
  const f = alsFile.files?.[0];
  if (!f || !track) {
    if (!track) status("Load the track's audio first, then its project.", true);
    return;
  }
  try {
    const project = parseAls(await inflateAls(await f.arrayBuffer()));
    grid = { ...grid, bpm: project.bpm, offsetMs: 0 };
    markers = project.locators.filter((l) => l.kind !== "section").map((l) => ({ t: l.t, kind: l.kind as "drop" | "break" }));
    automation = project.automation;
    if (project.kicks.length || project.snares.length) {
      hits = {
        kick: project.kicks.map((t) => ({ t, conf: 1, onGrid: true })),
        snare: project.snares.map((t) => ({ t, conf: 1, onGrid: true })),
      };
      hitsChk.checked = true;
    }
    gridChanged();
    saveState();
    status(
      `Ableton project: ${project.bpm} BPM, downbeat at 0 (nudge if the export was trimmed), ${markers.length} markers, ` +
        `${project.kicks.length} kicks and ${project.snares.length} snares from MIDI. ` +
        (project.automation.length
          ? `Automation → ${project.automation.map((a) => "auto:" + autoSlug(a.name)).join(", ")} (route from a mood).`
          : "No automation lanes."),
    );
  } catch (e) {
    status(`Could not read that project: ${e instanceof Error ? e.message : String(e)}`, true);
  } finally {
    alsFile.value = "";
  }
});

// ---------- stems (phase 08) ----------
stemsFiles.addEventListener("change", async () => {
  const files = [...(stemsFiles.files ?? [])];
  if (!files.length) return;
  if (!track) {
    status("Load the mix first, then its stems.", true);
    return;
  }
  status(`Decoding ${files.length} stems…`);
  try {
    for (const f of files) {
      const buffer = await ctx().decodeAudioData(await f.arrayBuffer());
      stems.set(stemNameOf(f.name), { mono: monoMix(buffer), sampleRate: buffer.sampleRate });
    }
    const follow = wooferStem(stems.keys());
    previewDirty = true;
    status(`Stems: ${[...stems.keys()].join(", ")}. ${follow ? `The woofer follows the ${follow} stem.` : "No kick, drums or bass stem — the woofer follows the mix."} Export full-length stems so they stay aligned.`);
  } catch (e) {
    status(`Stems: ${e instanceof Error ? e.message : String(e)}`, true);
  } finally {
    stemsFiles.value = "";
  }
});

// ---------- hits (phase 09) ----------
async function ensureHits(): Promise<void> {
  if (!track || hits) return;
  status("Tracking kicks and snares…");
  await new Promise((r) => setTimeout(r, 30));
  hits = detectHits(track.mono, track.buffer.sampleRate, { grid });
  saveState();
  const sure = (l: Hits["kick"]): number => l.filter((h) => h.conf >= 0.5).length;
  status(`Hits: ${sure(hits.kick)} kicks and ${sure(hits.snare)} snares sure, ${hits.kick.length + hits.snare.length - sure(hits.kick) - sure(hits.snare)} doubtful. Click a tick to delete, K / N to add.`);
}
/** Demucs drums stem through the helper, then hits tracked on the stem (clean, no bleed). */
stemBtn.addEventListener("click", async () => {
  if (!track?.file) return;
  stemBtn.disabled = true;
  try {
    status("Storing the audio and separating drums with Demucs… (a minute or two on the GPU)");
    const put = await fetch(`/api/jobs/${encodeURIComponent(track.name)}`, { method: "PUT", body: track.file });
    if (!put.ok) throw new Error(`could not store the audio (${put.status})`);
    const res = await fetch("/api/separate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: track.name }) });
    const body = (await res.json()) as { url?: string; error?: string; hint?: string };
    if (!res.ok || !body.url) throw new Error(`${body.error ?? res.status}${body.hint ? ` — ${body.hint}` : ""}`);
    status("Decoding the drums stem…");
    const stem = await ctx().decodeAudioData(await (await fetch(body.url)).arrayBuffer());
    hits = detectHits(monoMix(stem), stem.sampleRate, { grid });
    hitsChk.checked = true;
    saveState();
    draw();
    const sure = (l: Hits["kick"]): number => l.filter((h) => h.conf >= 0.5).length;
    status(`Drums stem: ${sure(hits.kick)} kicks and ${sure(hits.snare)} snares sure. Click a tick to delete, K / N to add.`);
  } catch (e) {
    status(`Drums stem: ${e instanceof Error ? e.message : String(e)}`, true);
  } finally {
    stemBtn.disabled = !(track?.file && helperOnline);
  }
});
hitsChk.addEventListener("change", () => {
  if (hitsChk.checked) void ensureHits().then(draw);
  else {
    hits = null;
    saveState();
    draw();
  }
});

// ---------- the show (phase 12) ----------
// A lighting desk over the drive: lanes of cues the render follows. The faders are the
// programmer; Cue writes their values at the playhead. Colours are edited in sRGB and stored
// linear, the way Blender wants them.
const LANE_COLORS: Record<LaneName, string> = { camera: "#e8ebe6", key: "#f0c060", rims: "#e06c60", wall: "#86adea", dustback: "#c9a3ff", smoke: "#9198a0", shells: "#8fd9c0" };
const SCENE_CAMERAS: Record<string, string[]> = {
  void: ["Cam1_Wide", "Cam2_Woofers", "Cam7_Top", "Cam3_Macro", "Cam6_Side"],
  macro: ["Cam8_Cone", "Cam2_Woofers", "Cam3_Macro"],
  stack: ["Cam1_Wide", "Cam2_Woofers", "Cam7_Top", "Cam3_Macro", "Cam6_Side"],
  concrete: ["Cam1_Wide", "Cam2_Woofers", "Cam7_Top", "Cam3_Macro", "Cam6_Side"],
};
const toHex = (c: Rgb): string => "#" + c.map((v) => Math.round(Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2) * 255).toString(16).padStart(2, "0")).join("");
const fromHex = (h: string): Rgb => [1, 3, 5].map((i) => Math.pow(parseInt(h.slice(i, i + 2), 16) / 255, 2.2)) as Rgb;
const cueSummary = (name: LaneName, v: CueValue): string => {
  if ("camera" in v) return v.camera;
  if ("trace" in v) return toHex(v.trace);
  if ("density" in v) return `d${v.density.toFixed(2)} h${v.haze.toFixed(2)}`;
  if ("strength" in v) return `${v.strength.toFixed(2)}`;
  if ("color" in v) return `${v.gain.toFixed(2)} ${toHex(v.color)}`;
  return `${(v as { gain: number }).gain.toFixed(2)}`;
};

function showChanged(): void {
  saveState();
  renderDesk();
  draw();
  requestLive();
}

// live: the persistent Blender renders the playhead whenever it moves or the show changes
let liveTimer: number | null = null;
let liveBusy = false;
let liveAgain = false;
function requestLive(): void {
  if (!liveChk.checked || !track || !helperOnline) return;
  if (liveTimer !== null) clearTimeout(liveTimer);
  liveTimer = window.setTimeout(() => void liveFrame(), 350);
}
async function liveFrame(): Promise<void> {
  if (!track) return;
  if (liveBusy) {
    liveAgain = true;
    return;
  }
  liveBusy = true;
  try {
    const fps = Number(fpsSel.value) || 30;
    const { features, cone, dome } = analyseForDrive(fps);
    const drive = buildCurrentDrive(fps, features, { cone, dome });
    const t = songTime();
    const res = await fetch("/api/live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: slugify(track.name), time: t, drive, percent: 25 }) });
    const body = (await res.json()) as { url?: string; error?: string; ms?: number; rebound?: boolean };
    if (!res.ok || !body.url) throw new Error(body.error ?? `live refused (${res.status})`);
    previewFrameImg.src = body.url;
    previewFrameImg.hidden = false;
    previewWrap.hidden = false;
    status(`Live ${fmtTime(t)} — ${((body.ms ?? 0) / 1000).toFixed(1)} s${body.rebound ? " (drive re-applied)" : ""}.`);
  } catch (e) {
    status(`Live: ${e instanceof Error ? e.message : String(e)}`, true);
  } finally {
    liveBusy = false;
    if (liveAgain) {
      liveAgain = false;
      requestLive();
    }
  }
}
liveChk.addEventListener("change", () => {
  if (liveChk.checked) {
    previewWrap.hidden = false;
    status("Live on — the first frame opens the scene (a few seconds), then about a second a frame.");
    requestLive();
  }
});

function faderValue(name: LaneName): CueValue {
  return faders[name] ?? structuredClone(LANE_DEFAULTS[name]);
}

function renderDesk(): void {
  const n = cueCount(show.lanes);
  showHint.textContent = n ? `${n} cues — lanes with cues override the mood` : "no cues — the mood runs the lights";
  if (n) showBox.open = true;
  deskEl.replaceChildren(
    ...LANE_INFO.map((info) => {
      const lane = document.createElement("div");
      lane.className = "lane";
      lane.title = info.hint;
      const name = document.createElement("span");
      name.className = "name";
      const dot = document.createElement("b");
      dot.style.background = LANE_COLORS[info.name];
      name.append(dot, info.label);
      const fadersEl = document.createElement("div");
      fadersEl.className = "faders";
      const v = faderValue(info.name) as Record<string, unknown>;
      const num = (key: string, min: number, max: number, step: number): HTMLLabelElement => {
        const l = document.createElement("label");
        const r = document.createElement("input");
        r.type = "range";
        r.min = String(min);
        r.max = String(max);
        r.step = String(step);
        r.value = String(v[key] ?? 1);
        const out = document.createElement("span");
        out.textContent = Number(r.value).toFixed(2);
        r.addEventListener("input", () => {
          (faders[info.name] = faderValue(info.name) as CueValue);
          (faders[info.name] as unknown as Record<string, unknown>)[key] = Number(r.value);
          out.textContent = Number(r.value).toFixed(2);
        });
        l.append(`${key} `, r, out);
        return l;
      };
      const col = (key: string): HTMLLabelElement => {
        const l = document.createElement("label");
        const c = document.createElement("input");
        c.type = "color";
        c.value = toHex((v[key] as Rgb) ?? [1, 1, 1]);
        c.addEventListener("input", () => {
          faders[info.name] = faderValue(info.name);
          (faders[info.name] as unknown as Record<string, unknown>)[key] = fromHex(c.value);
        });
        l.append(`${key} `, c);
        return l;
      };
      if (info.name === "camera") {
        const l = document.createElement("label");
        const sel = document.createElement("select");
        fillSelect(sel, (SCENE_CAMERAS[sceneSel.value] ?? SCENE_CAMERAS["void"]!).map((c) => ({ value: c, label: c })), (v["camera"] as string) ?? "Cam1_Wide");
        sel.addEventListener("change", () => (faders.camera = { camera: sel.value }));
        l.append("camera ", sel);
        fadersEl.append(l);
      } else if (info.name === "key" || info.name === "rims") {
        fadersEl.append(num("gain", 0, 2.5, 0.05), col("color"));
      } else if (info.name === "wall") {
        fadersEl.append(col("trace"));
      } else if (info.name === "dustback") {
        fadersEl.append(num("gain", 0, 3, 0.05));
      } else if (info.name === "smoke") {
        fadersEl.append(num("density", 0, 3, 0.05), num("haze", 0, 3, 0.05));
      } else {
        fadersEl.append(num("strength", 0, 1, 0.05));
      }
      const fadeL = document.createElement("label");
      const fade = document.createElement("input");
      fade.type = "number";
      fade.min = "0";
      fade.max = "10";
      fade.step = "0.05";
      fade.value = info.name === "camera" ? "0" : "0.25";
      fade.title = "crossfade in, seconds";
      fadeL.append("fade ", fade);
      const cueBtn = document.createElement("button");
      cueBtn.textContent = "Cue";
      cueBtn.title = "write these values as a cue at the playhead";
      cueBtn.disabled = !track;
      cueBtn.addEventListener("click", () => {
        show.lanes[info.name] = setCue(show.lanes[info.name], { t: Math.round(songTime() * 1000) / 1000, value: structuredClone(faderValue(info.name)), fade: Number(fade.value) || 0 });
        showChanged();
        status(`${info.label} cue at ${fmtTime(songTime())}.`);
      });
      fadersEl.append(fadeL, cueBtn);
      const cuesEl = document.createElement("div");
      cuesEl.className = "cues";
      for (const c of [...(show.lanes[info.name] ?? [])].sort((a, b) => a.t - b.t)) {
        const chip = document.createElement("span");
        chip.className = "cue";
        chip.innerHTML = `<i>${fmtTime(c.t)}</i>${cueSummary(info.name, c.value)}`;
        chip.title = "click: seek here · shift-click: delete";
        chip.addEventListener("click", (e) => {
          if (e.shiftKey) {
            show.lanes[info.name] = (show.lanes[info.name] ?? []).filter((x) => x !== c);
            showChanged();
          } else seek(c.t);
        });
        cuesEl.append(chip);
      }
      lane.append(name, fadersEl, cuesEl);
      return lane;
    }),
  );
}

showFromMoodBtn.addEventListener("click", async () => {
  if (!track) return;
  try {
    const res = await fetch(`/api/moods/${encodeURIComponent(moodSel.value)}`);
    if (!res.ok) throw new Error(`no mood file for ${moodSel.value} (is npm run dev running?)`);
    const mood = (await res.json()) as Parameters<typeof lanesFromMood>[0];
    const downbeats = beatTimes(grid, track.buffer.duration).filter((b) => b.downbeat).map((b) => b.t);
    show = { lanes: lanesFromMood(mood, downbeats, Number(fpsSel.value) || 30) };
    for (const info of LANE_INFO) {
      const first = show.lanes[info.name]?.[0];
      if (first) faders[info.name] = structuredClone(first.value);
    }
    showChanged();
    status(`Lanes filled from the ${moodSel.value} mood: ${cueCount(show.lanes)} cues on the downbeats. Edit, then Render.`);
  } catch (e) {
    status(`Lanes from mood: ${e instanceof Error ? e.message : String(e)}`, true);
  }
});
showClearBtn.addEventListener("click", () => {
  show = { lanes: {} };
  showChanged();
});
sceneSel.addEventListener("change", renderDesk);
renderDesk();

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
    previewBtn.disabled = !(track && helperOnline);
    stemBtn.disabled = !(track?.file && helperOnline);
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
    const { features, cone, dome } = analyseForDrive(fps);
    const drive = buildCurrentDrive(fps, features, { cone, dome });
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
    recordReel(profileSel.value, engineSel.value);
    showRender(st);
    startPolling();
    status(`Rendering ${st.total} frames — ${profileSel.value} profile on ${engineSel.value}. You can keep gridding.`);
  } catch (e) {
    status(`Render failed to start: ${e instanceof Error ? e.message : String(e)}`, true);
    renderBtn.disabled = false;
  }
}

renderBtn.addEventListener("click", () => void renderReel());

/** Phase 11's true-look tier: one EEVEE draft frame of the current drive at the playhead. */
async function previewFrameNow(): Promise<void> {
  if (!track) return;
  previewBtn.disabled = true;
  try {
    const t = songTime();
    status(`Preview frame at ${fmtTime(t)} — EEVEE draft, about 20 seconds…`);
    await new Promise((r) => setTimeout(r, 30));
    const fps = Number(fpsSel.value) || 30;
    const { features, cone, dome } = analyseForDrive(fps);
    const drive = buildCurrentDrive(fps, features, { cone, dome });
    const res = await fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: slugify(track.name), time: t, drive }),
    });
    const body = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || !body.url) throw new Error(body.error ?? `preview refused (${res.status})`);
    previewFrameImg.src = body.url;
    previewFrameImg.hidden = false;
    previewWrap.hidden = false;
    status(`Preview frame at ${fmtTime(t)}: the true look, EEVEE draft. Render for the Cycles version.`);
  } catch (e) {
    status(`Preview frame: ${e instanceof Error ? e.message : String(e)}`, true);
  } finally {
    previewBtn.disabled = !(track && helperOnline);
  }
}
previewBtn.addEventListener("click", () => void previewFrameNow());
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
  {
    const rowY = ((e.clientY - rect.top) / rect.height) * zoomCanvas.height;
    const row = Math.floor((rowY - 14) / 9);
    const info = rowY >= 12 && row >= 0 ? LANE_INFO[row] : undefined;
    const cues = info ? show.lanes[info.name] : undefined;
    if (info && cues) {
      const idx = cues.findIndex((c) => Math.abs(c.t - t) < tolerance);
      if (idx >= 0) {
        cues.splice(idx, 1);
        showChanged();
        status(`Deleted ${info.label} cue.`);
        return;
      }
    }
  }
  if (hits) {
    const y = e.clientY - rect.top;
    const rowY = (y / rect.height) * zoomCanvas.height;
    const list = rowY > zoomCanvas.height - 58 ? hits.snare : rowY > zoomCanvas.height - 96 ? hits.kick : null;
    if (list) {
      const idx = list.findIndex((h) => Math.abs(h.t - t) < tolerance);
      if (idx >= 0) {
        list.splice(idx, 1);
        saveState();
        status(`Deleted ${list === hits.kick ? "kick" : "snare"} hit.`);
        return;
      }
    }
  }
  const hit = markers.findIndex((m) => Math.abs(m.t - t) < tolerance);
  if (hit >= 0) {
    const gone = markers.splice(hit, 1)[0]!;
    saveState();
    status(`Deleted ${gone.kind} marker.`);
    return;
  }
  // a plain click seeks; the downbeat moves only on a double-click (it was too easy to knock)
  seek(t);
});
zoomCanvas.addEventListener("dblclick", (e) => {
  if (!track) return;
  if (lockGridChk.checked) {
    status("Grid is locked — untick lock to move the downbeat.");
    return;
  }
  const rect = zoomCanvas.getBoundingClientRect();
  const { start, dur } = zoomWindow();
  const t = start + ((e.clientX - rect.left) / rect.width) * dur;
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
    void loadLibrary();
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
  if (lockGridChk.checked) {
    status("Grid is locked — untick lock to nudge.");
    return;
  }
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
  } else if ((e.code === "KeyK" || e.code === "KeyN") && track && hits) {
    const list = e.code === "KeyK" ? hits.kick : hits.snare;
    list.push({ t: songTime(), conf: 1, onGrid: false });
    list.sort((a, b) => a.t - b.t);
    saveState();
    status(`${e.code === "KeyK" ? "Kick" : "Snare"} added at ${fmtTime(songTime())}.`);
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

// ---------- presets and templates ----------
// Blocks are JSON files under presets/{scenes,shows,lyrics,templates}/ in the linked folder; a
// reel template names one block of each kind plus a mood. Fixed recipes: applying reproduces
// what was saved. Without a linked folder the same JSON downloads, and any file can be loaded
// through the preset file input.

/** The template-able slice of the current per-track state. */
function currentReelState(): ReelState {
  return {
    scene: sceneSel.value,
    mood: moodSel.value,
    cutsEveryBars: Number(cutsSel.value) || 0,
    cutMarkers: cutMarkersChk.checked,
    leadMs: Number(leadInput.value) || 0,
    fps: Number(fpsSel.value) || 30,
    show,
    lyrics,
  };
}

/** Push a reel state into the controls and the managers; the grid, markers, hits and lines are not part of it. */
function applyReelState(next: ReelState): void {
  if ([...sceneSel.options].some((o) => o.value === next.scene)) sceneSel.value = next.scene;
  if ([...moodSel.options].some((o) => o.value === next.mood)) moodSel.value = next.mood;
  cutsSel.value = String(next.cutsEveryBars);
  if (!cutsSel.value) cutsSel.value = "0";
  cutMarkersChk.checked = next.cutMarkers;
  leadInput.value = String(next.leadMs);
  fpsSel.value = String(next.fps);
  show = next.show;
  lyrics = next.lyrics;
  for (const info of LANE_INFO) {
    const first = show.lanes[info.name]?.[0];
    if (first) faders[info.name] = structuredClone(first.value);
  }
  syncLyricControls();
  showChanged();
  lyricsChanged();
  void loadPreviewRig();
}

function moodNames(): string[] {
  return [...moodSel.options].map((o) => o.value).filter(Boolean);
}

function refreshPresetPickers(): void {
  const opts = (names: string[], head: string) => [{ value: "", label: head }, ...names.sort().map((n) => ({ value: n, label: n }))];
  fillSelect(scenePresetSel, opts(Object.keys(library.scenes), "scene presets…"));
  fillSelect(showPresetSel, opts(Object.keys(library.shows), "show presets…"));
  fillSelect(lyricPresetSel, opts(Object.keys(library.lyrics), "lyric presets…"));
  const templates = Object.keys(library.templates);
  fillSelect(templateSel, templates.length ? opts(templates, "pick a template…") : [{ value: "", label: projectDir ? "no templates yet" : "link a folder first" }]);
  templateApplyBtn.disabled = !track || !templateSel.value;
  templateSaveBtn.disabled = !track;
}

function addToLibrary(p: Preset): void {
  if (p.kind === "scene") library.scenes[p.name] = p;
  else if (p.kind === "show") library.shows[p.name] = p;
  else if (p.kind === "lyrics") library.lyrics[p.name] = p;
  else library.templates[p.name] = p;
}

async function loadLibrary(): Promise<void> {
  if (!projectDir) return;
  library.scenes = {};
  library.shows = {};
  library.lyrics = {};
  library.templates = {};
  let n = 0;
  try {
    const root = await projectDir.getDirectoryHandle("presets", { create: true });
    for (const dir of Object.values(PRESET_DIRS)) {
      let sub: FileSystemDirectoryHandle;
      try {
        sub = await root.getDirectoryHandle(dir);
      } catch {
        continue;
      }
      for await (const [name, handle] of sub as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        if (handle.kind !== "file" || !name.endsWith(".json")) continue;
        try {
          addToLibrary(parsePreset(await (await (handle as FileSystemFileHandle).getFile()).text()));
          n++;
        } catch (e) {
          console.warn(`presets/${dir}/${name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  } catch (e) {
    status(`Could not read presets/: ${e instanceof Error ? e.message : String(e)}`, true);
  }
  library.moods = moodNames();
  refreshPresetPickers();
  if (n) status(`${n} preset${n === 1 ? "" : "s"} loaded from ${projectDir.name}/presets/.`);
}

/** Write a preset to presets/<dir>/<name>.json in the linked folder, or download it. */
async function writePreset(p: Preset): Promise<string> {
  const json = JSON.stringify(p, null, 2);
  const fname = `${p.name}.json`;
  if (projectDir) {
    const root = await projectDir.getDirectoryHandle("presets", { create: true });
    const sub = await root.getDirectoryHandle(PRESET_DIRS[p.kind], { create: true });
    const fh = await sub.getFileHandle(fname, { create: true });
    const w = await fh.createWritable();
    await w.write(json);
    await w.close();
    addToLibrary(p);
    refreshPresetPickers();
    return `presets/${PRESET_DIRS[p.kind]}/${fname}`;
  }
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${p.name}.${p.kind}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  addToLibrary(p);
  refreshPresetPickers();
  return `download ${a.download}`;
}

function askName(what: string, suggestion: string): string | null {
  const raw = window.prompt(`Name for this ${what} (letters, digits, dashes):`, suggestion);
  if (raw === null) return null;
  const name = slugName(raw);
  if (!name) {
    status("A preset needs a name.", true);
    return null;
  }
  return name;
}

function applyPreset(p: Preset): void {
  const state = currentReelState();
  if (p.kind === "template") {
    library.moods = moodNames();
    const { resolved, missing } = resolveTemplate(p, library);
    applyReelState(applyTemplate(resolved, state, grid));
    status(
      missing.length
        ? `Template ${p.name} applied without ${missing.join(", ")} — those presets are not in the linked folder.`
        : `Template ${p.name} applied: scene, mood, cuts, show cues and lyric styling. Grid, markers, hits and lines kept.`,
    );
    return;
  }
  if (p.kind === "scene") applyReelState(applyTemplate({ scene: p }, state, grid));
  else if (p.kind === "show") applyReelState(applyTemplate({ show: p }, state, grid));
  else applyReelState(applyTemplate({ lyrics: p }, state, grid));
  status(`${p.kind} preset ${p.name} applied.`);
}

scenePresetSel.addEventListener("change", () => {
  const p = library.scenes[scenePresetSel.value];
  scenePresetSel.value = "";
  if (p) applyPreset(p);
});
showPresetSel.addEventListener("change", () => {
  const p = library.shows[showPresetSel.value];
  showPresetSel.value = "";
  if (p) applyPreset(p);
});
lyricPresetSel.addEventListener("change", () => {
  const p = library.lyrics[lyricPresetSel.value];
  lyricPresetSel.value = "";
  if (p) applyPreset(p);
});
templateSel.addEventListener("change", () => {
  templateApplyBtn.disabled = !track || !templateSel.value;
});
templateApplyBtn.addEventListener("click", () => {
  const p = library.templates[templateSel.value];
  if (p) applyPreset(p);
});

scenePresetSaveBtn.addEventListener("click", async () => {
  const name = askName("scene preset", `${sceneSel.value}-${cutsSel.value || "0"}bar`);
  if (!name) return;
  try {
    status(`Saved ${await writePreset(sceneBlock(currentReelState(), name))}.`);
  } catch (e) {
    status(`Save failed: ${e instanceof Error ? e.message : String(e)}`, true);
  }
});
showPresetSaveBtn.addEventListener("click", async () => {
  if (!cueCount(show.lanes)) {
    status("No cues to save — set faders and press Cue first, or Lanes from mood.", true);
    return;
  }
  const name = askName("show preset", `${moodSel.value}-cues`);
  if (!name) return;
  try {
    status(`Saved ${await writePreset(showToBlock(show, grid, name))} — cue times in bars.`);
  } catch (e) {
    status(`Save failed: ${e instanceof Error ? e.message : String(e)}`, true);
  }
});
lyricPresetSaveBtn.addEventListener("click", async () => {
  const name = askName("lyric preset", `${lyrics.defaults.anchor}-${lyrics.defaults.style}`);
  if (!name) return;
  try {
    status(`Saved ${await writePreset(lyricBlock(lyrics, name))} — styling only, no lines.`);
  } catch (e) {
    status(`Save failed: ${e instanceof Error ? e.message : String(e)}`, true);
  }
});
templateSaveBtn.addEventListener("click", async () => {
  if (!track) return;
  const name = askName("template", `${sceneSel.value}-${moodSel.value}`);
  if (!name) return;
  const state = currentReelState();
  const t: Template = { kind: "template", name, scene: name, mood: moodSel.value, lyrics: name };
  try {
    const written = [await writePreset(sceneBlock(state, name)), await writePreset(lyricBlock(lyrics, name))];
    if (cueCount(show.lanes)) {
      t.show = name;
      written.push(await writePreset(showToBlock(show, grid, name)));
    }
    written.push(await writePreset(t));
    templateSel.value = name;
    templateApplyBtn.disabled = false;
    status(`Template ${name} saved: ${written.length} files under presets/. Apply it to any track.`);
  } catch (e) {
    status(`Save failed: ${e instanceof Error ? e.message : String(e)}`, true);
  }
});
presetFile.addEventListener("change", async () => {
  const f = presetFile.files?.[0];
  presetFile.value = "";
  if (!f) return;
  try {
    const p = parsePreset(await f.text());
    addToLibrary(p);
    refreshPresetPickers();
    if (track) applyPreset(p);
    else status(`${p.kind} ${p.name} loaded — load a track to apply it.`);
  } catch (e) {
    status(`Not a preset: ${e instanceof Error ? e.message : String(e)}`, true);
  }
});
refreshPresetPickers();

// ---------- reel history ----------
// Every Render and Export remembers the look (scene, mood, cuts, show cues in bars, lyric
// styling) so the next reel can be checked against the old ones: uniqueness by record, not hope.
function recordReel(profile: string, engine: string): void {
  if (!track) return;
  const state = currentReelState();
  history = addHistory(history, { when: Date.now(), profile, engine, signature: lookSignature(state, grid), summary: describeLook(state) });
  saveState();
}
function updateReelHint(): void {
  if (!track) {
    reelHint.textContent = "";
    return;
  }
  const n = history.length;
  if (!n) {
    reelHint.textContent = "no reels yet for this track";
    return;
  }
  const match = matchingReel(history, lookSignature(currentReelState(), grid));
  reelHint.textContent = match
    ? `${n} reel${n === 1 ? "" : "s"} · this look matches reel #${match.index} (${new Date(match.record.when).toLocaleDateString()}, ${match.record.profile}) — change something to keep it unique`
    : `${n} reel${n === 1 ? "" : "s"} · new look`;
  reelHint.title = history.map((r, i) => `#${n - i} ${new Date(r.when).toLocaleString()} ${r.profile}: ${r.summary}`).join("\n");
}

// ---------- mood panel ----------
// The mood file is the baseline under the show desk plus the grade and the routing. The panel
// is generated from MOOD_FIELDS; Save writes blender/moods/<name>.json through the linked
// folder (the file Blender reads), Save as… makes a new mood and selects it.

async function readMood(name: string): Promise<Mood> {
  if (helperOnline) {
    const res = await fetch(`/api/moods/${encodeURIComponent(name)}`);
    if (res.ok) return parseMood(await res.text());
  }
  if (projectDir) {
    const dir = await (await projectDir.getDirectoryHandle("blender")).getDirectoryHandle("moods");
    const file = await dir.getFileHandle(`${name}.json`);
    return parseMood(await (await file.getFile()).text());
  }
  throw new Error("no dev server and no linked folder — link the excursion folder to read blender/moods/");
}

async function writeMood(m: Mood): Promise<string> {
  const text = moodToJson(m);
  if (projectDir) {
    const dir = await (await projectDir.getDirectoryHandle("blender", { create: true })).getDirectoryHandle("moods", { create: true });
    const fh = await dir.getFileHandle(`${m.name}.json`, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
    return `blender/moods/${m.name}.json`;
  }
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${m.name}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  return `download ${a.download} (put it in blender/moods/)`;
}

function routeOptions(current: string): { value: string; label: string }[] {
  const names = new Set<string>(["bass", "kick", "snare", "hats", "drums", "vocal", "synth", "fx"]);
  for (const k of stems.keys()) names.add(k);
  for (const a of automation) names.add(`auto:${autoSlug(a.name)}`);
  const opts = [{ value: "", label: "mix bass (default)" }, ...[...names].map((n) => ({ value: `channels.${n}`, label: n }))];
  if (current && !opts.some((o) => o.value === current)) opts.push({ value: current, label: current });
  return opts;
}

function moodChanged(path: string, value: unknown): void {
  if (!moodEdit) return;
  moodEdit = setPath(moodEdit, path, value);
  moodDirty = true;
  moodHint.textContent = `${moodEdit.name} — edited, not saved`;
}

function renderMoodForm(): void {
  moodForm.replaceChildren();
  const m = moodEdit;
  moodSaveBtn.disabled = !m;
  moodSaveAsBtn.disabled = !m;
  moodCueAddBtn.disabled = !m;
  if (!m) return;
  const groups = new Map<string, HTMLDivElement>();
  const groupEl = (name: string): HTMLDivElement => {
    let g = groups.get(name);
    if (!g) {
      g = document.createElement("div");
      g.className = "lane";
      const title = document.createElement("div");
      title.className = "lanename";
      title.textContent = name;
      const body = document.createElement("div");
      body.className = "faders";
      g.append(title, body);
      groups.set(name, g);
      moodForm.append(g);
    }
    return g.lastElementChild as HTMLDivElement;
  };
  for (const f of MOOD_FIELDS) {
    const body = groupEl(f.group);
    const l = document.createElement("label");
    if (f.hint) l.title = f.hint;
    const v = getPath(m, f.path);
    if (f.kind === "number") {
      const r = document.createElement("input");
      r.type = "range";
      r.min = String(f.min);
      r.max = String(f.max);
      r.step = String(f.step);
      r.value = String(v ?? 0);
      const out = document.createElement("span");
      out.textContent = Number(r.value).toFixed(f.step! < 0.01 ? 3 : 2);
      r.addEventListener("input", () => {
        out.textContent = Number(r.value).toFixed(f.step! < 0.01 ? 3 : 2);
        moodChanged(f.path, Number(r.value));
      });
      l.append(`${f.label} `, r, out);
    } else if (f.kind === "color") {
      const c = document.createElement("input");
      c.type = "color";
      c.value = toHex((v as Rgb) ?? [1, 1, 1]);
      c.addEventListener("input", () => moodChanged(f.path, fromHex(c.value)));
      l.append(`${f.label} `, c);
    } else if (f.kind === "bool") {
      const c = document.createElement("input");
      c.type = "checkbox";
      c.checked = Boolean(v);
      c.addEventListener("change", () => moodChanged(f.path, c.checked));
      l.append(c, ` ${f.label}`);
    } else if (f.kind === "route") {
      const sel = document.createElement("select");
      fillSelect(sel, routeOptions(String(v ?? "")), String(v ?? ""));
      sel.addEventListener("change", () => {
        const next = { ...m.routing } as Record<string, string>;
        const target = f.path.split(".")[1]!;
        if (sel.value) next[target] = sel.value;
        else delete next[target];
        moodChanged("routing", next);
      });
      l.append(`${f.label} `, sel);
    } else {
      const t = document.createElement("input");
      t.type = "text";
      t.value = String(v ?? "");
      t.style.width = "26em";
      t.addEventListener("change", () => moodChanged(f.path, t.value));
      l.append(`${f.label} `, t);
    }
    body.append(l);
  }
  // the cue list: each step the mood cycles through on the downbeats
  const cuesBody = groupEl("cues");
  m.cues.forEach((cue, i) => {
    const row = document.createElement("div");
    row.className = "cues";
    const rim = document.createElement("input");
    rim.type = "color";
    rim.value = toHex(cue.rim);
    rim.title = "rim colour";
    rim.addEventListener("input", () => moodChanged(`cues.${i}.rim`, fromHex(rim.value)));
    const rimGain = document.createElement("input");
    rimGain.type = "number";
    rimGain.min = "0";
    rimGain.max = "3";
    rimGain.step = "0.05";
    rimGain.value = String(cue.rim_gain);
    rimGain.title = "rim gain";
    rimGain.style.width = "62px";
    rimGain.addEventListener("change", () => moodChanged(`cues.${i}.rim_gain`, Number(rimGain.value) || 0));
    const back = document.createElement("input");
    back.type = "number";
    back.min = "0";
    back.max = "4";
    back.step = "0.1";
    back.value = String(cue.back_gain);
    back.title = "dust-back gain";
    back.style.width = "62px";
    back.addEventListener("change", () => moodChanged(`cues.${i}.back_gain`, Number(back.value) || 0));
    const trace = document.createElement("input");
    trace.type = "color";
    trace.value = toHex(cue.trace);
    trace.title = "LED trace colour";
    trace.addEventListener("input", () => moodChanged(`cues.${i}.trace`, fromHex(trace.value)));
    const del = document.createElement("button");
    del.textContent = "×";
    del.title = "remove this cue";
    del.addEventListener("click", () => {
      moodChanged("cues", m.cues.filter((_, j) => j !== i));
      renderMoodForm();
    });
    row.append(`cue ${i + 1}: rim `, rim, rimGain, ` back `, back, ` trace `, trace, del);
    cuesBody.append(row);
  });
  if (!m.cues.length) {
    const none = document.createElement("span");
    none.className = "drophint";
    none.textContent = "no cue steps — the rims hold the mood's key; + cue adds a step";
    cuesBody.append(none);
  }
}

moodLoadBtn.addEventListener("click", async () => {
  try {
    moodEdit = await readMood(moodSel.value);
    moodDirty = false;
    moodHint.textContent = `${moodEdit.name} loaded — ${moodEdit.description || "no description"}`;
    renderMoodForm();
  } catch (e) {
    status(`Load mood: ${e instanceof Error ? e.message : String(e)}`, true);
  }
});
moodCueAddBtn.addEventListener("click", () => {
  if (!moodEdit) return;
  moodChanged("cues", [...moodEdit.cues, structuredClone(DEFAULT_CUE)]);
  renderMoodForm();
});
async function saveMoodAs(name: string): Promise<void> {
  if (!moodEdit) return;
  const m: Mood = { ...moodEdit, name };
  try {
    const where = await writeMood(m);
    moodEdit = m;
    moodDirty = false;
    if (![...moodSel.options].some((o) => o.value === name)) {
      const o = document.createElement("option");
      o.value = name;
      o.textContent = name;
      moodSel.append(o);
    }
    moodSel.value = name;
    saveState();
    moodHint.textContent = `${name} saved`;
    status(`Mood ${name} written to ${where}. Render uses it on the next job.`);
  } catch (e) {
    status(`Save mood: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}
moodSaveBtn.addEventListener("click", () => moodEdit && void saveMoodAs(moodEdit.name));
moodSaveAsBtn.addEventListener("click", () => {
  if (!moodEdit) return;
  const name = askName("mood", `${moodEdit.name}-2`);
  if (name) void saveMoodAs(name);
});
moodSel.addEventListener("change", () => {
  if (moodEdit && moodEdit.name !== moodSel.value) {
    moodHint.textContent = moodDirty ? `${moodEdit.name} has unsaved edits — Load replaces them with ${moodSel.value}` : `Load to edit ${moodSel.value}`;
  }
});
// a brand-new mood from scratch: Load with nothing on disk offers the defaults
window.addEventListener("keydown", (e) => {
  if (e.key === "n" && e.altKey && !moodEdit) {
    moodEdit = withMoodDefaults({ name: "new-mood" });
    moodDirty = true;
    moodHint.textContent = "new mood from the defaults — Save as… to name it";
    renderMoodForm();
  }
});

// deep link: ?demo loads the demo track, ?demo&3d also switches the preview on
const params = new URLSearchParams(location.search);
if (params.has("desk")) showBox.open = true; // deep link: open the desk
if (params.has("demo")) {
  void loadDemo().then(() => {
    if (params.has("3d")) {
      previewChk.checked = true;
      previewChk.dispatchEvent(new Event("change"));
    }
    if (params.has("mood")) {
      // ?demo&mood opens the mood panel on a fresh mood from the defaults (a smoke test without a helper)
      moodEdit = withMoodDefaults({ name: "new-mood" });
      moodDirty = true;
      moodHint.textContent = "new mood from the defaults — Save as… to name it";
      renderMoodForm();
      (document.getElementById("moodBox") as HTMLDetailsElement).open = true;
    }
  });
}
