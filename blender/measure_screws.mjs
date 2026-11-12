// Find every screw on the front of a PMC CAD model, so build_scene.py can give the heads their
// own metal instead of the cabinet plastic.
//
//   node blender/measure_screws.mjs [PMC6-2]      -> blender/kits/<model>.screws.json
//
// The STL front (mm, baffle front at z = kit.front_z_mm) is rasterised into a height field
// (frontmost surface, 0.2 mm pixels). A screw is found by its hex socket: a pit about 2.5 mm
// across and at least 1 mm deep in the middle of a flat head face (the ring 2.1-2.6 mm from
// the pit centre is flat to 0.35 mm; heads are 5.5-8 mm across). Each screw is written as centre (model x, y in mm), the
// head face depth behind the baffle front, and the socket depth.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const model = process.argv[2] || "PMC6-2";
const kit = JSON.parse(fs.readFileSync(path.join(ROOT, "blender", "kits", `${model}.json`), "utf8"));
const [W, H] = kit.size_mm, FRONT = kit.front_z_mm, PX = 0.2;
const NX = Math.ceil(W / PX), NY = Math.ceil(H / PX);

const buf = fs.readFileSync(path.join(ROOT, ...kit.stl.split("/")));
const tris = buf.readUInt32LE(80);
const zb = new Float32Array(NX * NY).fill(-1);
for (let i = 0; i < tris; i++) {
  const o = 84 + i * 50 + 12;
  const xs = [], ys = [], zs = [];
  for (let k = 0; k < 3; k++) {
    xs.push(buf.readFloatLE(o + k * 12) / PX);
    ys.push(buf.readFloatLE(o + k * 12 + 4) / PX);
    zs.push(buf.readFloatLE(o + k * 12 + 8));
  }
  if (Math.max(...zs) < FRONT - 45) continue; // only the front 45 mm
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(NX - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(NY - 1, Math.ceil(Math.max(...ys)));
  const den = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2]);
  if (Math.abs(den) < 1e-12) continue;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const a = ((ys[1] - ys[2]) * (px - xs[2]) + (xs[2] - xs[1]) * (py - ys[2])) / den;
      const b = ((ys[2] - ys[0]) * (px - xs[2]) + (xs[0] - xs[2]) * (py - ys[2])) / den;
      const c = 1 - a - b;
      if (a < -1e-4 || b < -1e-4 || c < -1e-4) continue;
      const z = a * zs[0] + b * zs[1] + c * zs[2];
      if (z > zb[y * NX + x]) zb[y * NX + x] = z;
    }
  }
}
const depth = (x, y) => (x < 0 || y < 0 || x >= NX || y >= NY || zb[y * NX + x] < 0 ? NaN : FRONT - zb[y * NX + x]);

// ring offsets: the head face around the socket
const ring = [];
for (let dy = -16; dy <= 16; dy++) {
  for (let dx = -16; dx <= 16; dx++) {
    const r = Math.hypot(dx, dy) * PX;
    if (r >= 2.1 && r <= 2.6) ring.push([dx, dy]);
  }
}
const cand = [];
for (let y = 20; y < NY - 20; y++) {
  for (let x = 20; x < NX - 20; x++) {
    const d = depth(x, y);
    if (!(d < 40)) continue;
    let sum = 0, lo = Infinity, hi = -Infinity, ok = true;
    for (const [dx, dy] of ring) {
      const v = depth(x + dx, y + dy);
      if (!(v < 40)) { ok = false; break; }
      sum += v; lo = Math.min(lo, v); hi = Math.max(hi, v);
      if (hi - lo > 0.35) { ok = false; break; }
    }
    if (!ok) continue;
    const head = sum / ring.length;
    if (d - head >= 1.0 && d - head <= 6) cand.push({ x, y, head, pit: d - head });
  }
}
// cluster candidate pixels (one socket = one blob); the centre is the blob's centroid
const screws = [];
for (const c of cand) {
  const s = screws.find((q) => Math.hypot(q.x / q.n - c.x, q.y / q.n - c.y) * PX < 3);
  if (s) { s.x += c.x; s.y += c.y; s.n++; s.pit = Math.max(s.pit, c.pit); s.head += c.head; }
  else screws.push({ x: c.x, y: c.y, n: 1, pit: c.pit, head: c.head });
}
const out = screws
  .filter((s) => s.n >= 12) // a real socket is ~5 mm^2 = 120 pixels; specks are not screws
  .map((s) => {
    // head radius: how far out the head face stays level (median over 24 directions)
    const cx = s.x / s.n, cy = s.y / s.n, head = s.head / s.n, reach = [];
    for (let k = 0; k < 24; k++) {
      let r = 2.0;
      while (r < 6 && Math.abs(depth(Math.round(cx + (r * Math.cos((k * Math.PI) / 12)) / PX), Math.round(cy + (r * Math.sin((k * Math.PI) / 12)) / PX)) - head) < 0.3) r += 0.1;
      reach.push(r);
    }
    reach.sort((a, b) => a - b);
    return { x_mm: +((cx + 0.5) * PX).toFixed(2), y_mm: +((cy + 0.5) * PX).toFixed(2), head_mm: +head.toFixed(2), socket_mm: +s.pit.toFixed(2), head_r_mm: +reach[12].toFixed(1) };
  })
  .sort((a, b) => b.y_mm - a.y_mm || a.x_mm - b.x_mm);
const outPath = path.join(ROOT, "blender", "kits", `${model}.screws.json`);
fs.writeFileSync(outPath, JSON.stringify({ model, source: kit.stl, note: "front screws found by their hex sockets: centre (model mm, x right, y up), head face depth behind the baffle front, socket depth", screws: out }, null, 1));
console.log(`${model}: ${out.length} screws -> ${outPath}`);
for (const s of out) console.log(`  x ${s.x_mm}  y ${s.y_mm}  head ${s.head_mm}  socket ${s.socket_mm}  r ${s.head_r_mm}`);
