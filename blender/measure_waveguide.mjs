// Measure the mid driver's waveguide straight from PMC's CAD, so build_scene.py rebuilds the
// real shape instead of a guessed one.
//
//   node blender/measure_waveguide.mjs [PMC6-2]      -> blender/kits/<model>.waveguide.json
//
// The STL (mm, front face at z = kit.front_z_mm) is rasterised into a height field around the
// mid driver (frontmost surface, 0.1 mm pixels). The horn is 8-fold symmetric with a mirror
// line through every fin, so the field is folded onto one half-sector: depth as a function of
// radius and of the angle to the nearest fin crest, the median of the 16 symmetric copies.
// build_scene.py interpolates that table; nothing about the shape is hand-tuned.
//
// What the CAD shows (PMC6-2): a flat pocket floor 21.5 mm behind the baffle around the dome
// (out to r ~31 mm), then a smooth flare up to the plate face (6.5 mm) at r ~60 mm. Eight
// RAISED fins sit on the flare, centred at 22.5 + 45k degrees: about 6 mm proud next to the
// dome, fading to nothing at the rim; the channels between them are smooth and wide.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const model = process.argv[2] || "PMC6-2";
const kitPath = path.join(ROOT, "blender", "kits", `${model}.json`);
const kit = JSON.parse(fs.readFileSync(kitPath, "utf8"));
const mid = kit.drivers.find((d) => d.kind === "mid");
if (!mid) {
  console.error(`${model}: no mid driver in the kit`);
  process.exit(1);
}
const FRONT = kit.front_z_mm, CX = mid.x_mm, CY = mid.y_mm;
const FOLD = 8, FIN0 = 22.5; // fins at FIN0 + k * 360 / FOLD degrees (x right, y up, seen from the front)
const R0 = 26, R1 = 64, DR = 0.25; // table radii, mm
const HALF_SECTOR = 180 / FOLD, DA = 0.5; // table angles: 0 (fin crest) .. 22.5 (channel centre), degrees
const HALF = R1 + 4, PX = 0.1, N = Math.round((2 * HALF) / PX);

// ---- rasterise the frontmost surface
const buf = fs.readFileSync(path.join(ROOT, ...kit.stl.split("/")));
const tris = buf.readUInt32LE(80);
const zb = new Float32Array(N * N).fill(-1);
for (let i = 0; i < tris; i++) {
  const o = 84 + i * 50 + 12;
  const xs = [], ys = [], zs = [];
  for (let k = 0; k < 3; k++) {
    xs.push((buf.readFloatLE(o + k * 12) - (CX - HALF)) / PX);
    ys.push((buf.readFloatLE(o + k * 12 + 4) - (CY - HALF)) / PX);
    zs.push(buf.readFloatLE(o + k * 12 + 8));
  }
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(N - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(N - 1, Math.ceil(Math.max(...ys)));
  if (x0 > x1 || y0 > y1) continue;
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
      if (z > zb[y * N + x]) zb[y * N + x] = z;
    }
  }
}
const depthAt = (xmm, ymm) => {
  // bilinear, mm relative to the dome centre; depth behind the baffle front
  const fx = (xmm + HALF) / PX - 0.5, fy = (ymm + HALF) / PX - 0.5;
  const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
  const z = (x, y) => zb[Math.max(0, Math.min(N - 1, y)) * N + Math.max(0, Math.min(N - 1, x))];
  const v = z(ix, iy) * (1 - tx) * (1 - ty) + z(ix + 1, iy) * tx * (1 - ty) + z(ix, iy + 1) * (1 - tx) * ty + z(ix + 1, iy + 1) * tx * ty;
  return FRONT - v;
};

// ---- fold onto one half-sector: the median of the 16 symmetric copies
const radii = [], angles = [];
for (let r = R0; r <= R1 + 1e-9; r += DR) radii.push(+r.toFixed(3));
for (let a = 0; a <= HALF_SECTOR + 1e-9; a += DA) angles.push(+a.toFixed(3));
let worst = 0;
const table = radii.map((r) =>
  angles.map((a) => {
    const copies = [];
    for (let k = 0; k < FOLD; k++) {
      for (const s of [-1, 1]) {
        const t = ((FIN0 + (k * 360) / FOLD + s * a) * Math.PI) / 180;
        copies.push(depthAt(r * Math.cos(t), r * Math.sin(t)));
      }
    }
    copies.sort((p, q) => p - q);
    worst = Math.max(worst, copies[13] - copies[2]); // spread, ignoring the two extremes each side
    return +((copies[7] + copies[8]) / 2).toFixed(3);
  }),
);
const plate = table[Math.round((62 - R0) / DR)][angles.length - 1]; // the flat plate just outside the horn mouth (r 61.45)
const out = {
  model,
  source: kit.stl,
  note: "depth_mm[radius][angle]: mm behind the baffle front; angle = degrees from the nearest fin crest (0) to the channel centre (22.5)",
  fold: FOLD,
  fin0_deg: FIN0,
  r0_mm: R0,
  dr_mm: DR,
  da_deg: DA,
  plate_mm: plate,
  depth_mm: table,
};
const outPath = path.join(ROOT, "blender", "kits", `${model}.waveguide.json`);
fs.writeFileSync(outPath, JSON.stringify(out));
const row = (r) => table[Math.round((r - R0) / DR)];
console.log(`${model}: ${radii.length} radii x ${angles.length} angles -> ${outPath}`);
console.log(`plate ${plate} mm; symmetric-copy spread up to ${worst.toFixed(2)} mm`);
for (const r of [28, 32, 34, 38, 42, 46, 50, 54, 58, 62]) console.log(`r ${r}: fin crest ${row(r)[0]}  channel ${row(r)[angles.length - 1]}`);
