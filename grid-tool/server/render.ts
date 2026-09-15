// Excursion — the local render helper, a Vite dev-server plugin (phase 05).
//
// The grid tool runs in the browser; Blender and ffmpeg run on this machine. This plugin
// gives the page a few local endpoints so "Render" is a button, not a terminal:
//
//   GET  /api/moods                  the moods in blender/moods/ (name + description)
//   PUT  /api/jobs/<file>            store the track's audio in blender/jobs/ (raw body)
//   POST /api/render                 { slug, engine, profile, drive } -> writes the drive.json,
//                                    runs blender/make_reel.mjs, answers with the job state
//   GET  /api/render                 the current job state (poll it)
//   POST /api/render/stop            kill the running job
//   GET  /api/reels/<slug>.mp4       the finished reel, with Range support for <video>
//
// One job at a time. Blender comes from $BLENDER, then the newest "Blender Foundation"
// install, then PATH. The state shape lives in src/engine/renderJob.ts with the parser.

import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { IDLE, parseProgressLine, totalFrames, type RenderRequest, type RenderState } from "../src/engine/renderJob";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const jobsDir = path.join(root, "blender", "jobs");
const moodsDir = path.join(root, "blender", "moods");
const outDir = path.join(root, "out");

function findBlender(): string {
  if (process.env["BLENDER"]) return process.env["BLENDER"];
  const base = "C:/Program Files/Blender Foundation";
  if (existsSync(base)) {
    const versions = readdirSync(base)
      .filter((d) => /^Blender \d/.test(d))
      .sort((a, b) => parseFloat(b.slice(8)) - parseFloat(a.slice(8)));
    for (const v of versions) {
      const exe = path.join(base, v, "blender.exe");
      if (existsSync(exe)) return exe;
    }
  }
  return "blender";
}

let state: RenderState = { ...IDLE };
let child: ChildProcess | null = null;

function json(res: ServerResponse, code: number, body: unknown): void {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function safeName(name: string): string | null {
  const base = path.basename(name);
  return base && base === name && !base.startsWith(".") ? base : null;
}

function listMoods(): { name: string; description: string }[] {
  if (!existsSync(moodsDir)) return [];
  return readdirSync(moodsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const name = f.replace(/\.json$/, "");
      try {
        const m = JSON.parse(readFileSync(path.join(moodsDir, f), "utf8")) as { description?: string };
        return { name, description: m.description ?? "" };
      } catch {
        return { name, description: "" };
      }
    })
    .sort((a, b) => (a.name === "moody" ? -1 : b.name === "moody" ? 1 : a.name.localeCompare(b.name)));
}

function pushLog(line: string): void {
  state.log.push(line);
  if (state.log.length > 12) state.log.shift();
}

function startRender(req: RenderRequest): void {
  const drivePath = path.join(jobsDir, `${req.slug}.drive.json`);
  mkdirSync(jobsDir, { recursive: true });
  writeFileSync(drivePath, JSON.stringify(req.drive));
  const args = [path.join(root, "blender", "make_reel.mjs"), drivePath, "--engine", req.engine];
  if (req.profile === "test") args.push("--test");
  if (req.profile === "draft") args.push("--draft");
  state = {
    status: "running",
    slug: req.slug,
    engine: req.engine,
    profile: req.profile,
    done: 0,
    total: totalFrames(req.drive),
    startedAt: Date.now(),
    log: [],
  };
  const seen = new Set<number>();
  child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, BLENDER: findBlender() } });
  let pending = "";
  const onChunk = (chunk: Buffer): void => {
    pending += chunk.toString("utf8");
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (/HIPEW|Error opening HIP/.test(line)) continue; // AMD loader noise on an NVIDIA box
      const ev = parseProgressLine(line);
      if (ev && "frame" in ev) {
        seen.add(ev.frame);
        state.done = seen.size;
      } else if (ev && "reel" in ev) {
        state.reel = `/api/reels/${req.slug}${req.profile === "draft" ? ".draft" : ""}.mp4`;
      } else if (ev && "error" in ev) {
        state.error = ev.error;
        pushLog(line);
      } else if (line.trim()) {
        pushLog(line.trim());
      }
    }
  };
  child.stdout?.on("data", onChunk);
  child.stderr?.on("data", onChunk);
  child.on("error", (e) => {
    state.status = "error";
    state.error = e.message;
    state.finishedAt = Date.now();
    child = null;
  });
  child.on("exit", (code) => {
    state.finishedAt = Date.now();
    if (state.status === "running") {
      state.status = code === 0 && state.reel ? "done" : "error";
      if (state.status === "error" && !state.error) state.error = `make_reel exited ${code}`;
    }
    child = null;
  });
}

function serveReel(req: IncomingMessage, res: ServerResponse, file: string): void {
  const name = safeName(file);
  if (!name || !name.endsWith(".mp4")) return json(res, 404, { error: "no such reel" });
  const full = path.join(outDir, name);
  if (!existsSync(full)) return json(res, 404, { error: "no such reel" });
  const size = statSync(full).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  let start = 0;
  let end = size - 1;
  if (range) {
    if (range[1]) start = Number(range[1]);
    if (range[2]) end = Number(range[2]);
    if (!range[1] && range[2]) {
      start = Math.max(0, size - Number(range[2]));
      end = size - 1;
    }
    end = Math.min(end, size - 1);
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Length", String(end - start + 1));
  res.setHeader("Cache-Control", "no-store");
  createReadStream(full, { start, end }).pipe(res);
}

export function renderHelper(): Plugin {
  return {
    name: "excursion-render-helper",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith("/api/")) return next();
        try {
          if (req.method === "GET" && url.pathname === "/api/moods") return json(res, 200, listMoods());
          if (req.method === "GET" && url.pathname === "/api/render") return json(res, 200, { ...state, blender: findBlender() });
          if (req.method === "POST" && url.pathname === "/api/render/stop") {
            if (child) {
              child.kill();
              state.status = "error";
              state.error = "stopped";
              state.finishedAt = Date.now();
            }
            return json(res, 200, state);
          }
          if (req.method === "PUT" && url.pathname.startsWith("/api/jobs/")) {
            const name = safeName(decodeURIComponent(url.pathname.slice("/api/jobs/".length)));
            if (!name) return json(res, 400, { error: "bad file name" });
            mkdirSync(jobsDir, { recursive: true });
            await new Promise<void>((resolve, reject) => {
              const out = createWriteStream(path.join(jobsDir, name));
              req.pipe(out);
              out.on("finish", resolve);
              out.on("error", reject);
            });
            return json(res, 200, { stored: `blender/jobs/${name}` });
          }
          if (req.method === "POST" && url.pathname === "/api/render") {
            if (state.status === "running") return json(res, 409, { error: "a render is already running", state });
            const body = JSON.parse((await readBody(req)).toString("utf8")) as RenderRequest;
            if (!safeName(body.slug) || !body.drive?.frames?.length) return json(res, 400, { error: "bad request" });
            const audio = safeName(body.drive.audio?.file ?? "");
            if (!audio || !existsSync(path.join(jobsDir, audio))) return json(res, 400, { error: `audio not stored: ${audio}` });
            startRender(body);
            return json(res, 200, state);
          }
          if (req.method === "GET" && url.pathname.startsWith("/api/reels/")) {
            return serveReel(req, res, decodeURIComponent(url.pathname.slice("/api/reels/".length)));
          }
          return json(res, 404, { error: "unknown api route" });
        } catch (e) {
          return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}
