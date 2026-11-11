# Excursion — measure a PMC STL and write its driver kit as JSON.
#
#   blender -b --factory-startup -P blender/measure_kit.py -- assets/cache/pmc/PMC6.stl [more.stl]
#
# Writes blender/kits/<Model>.json: cabinet size, the front face, and every driver on the
# baffle (woofers, mid domes, tweeters) with the radii build_scene.py needs to cut it out and
# key it. Measured from the geometry alone: the baffle is ray-cast into a 2 mm depth map,
# woofer bowls are the large round recesses below the local baffle plane, domes are round
# bumps, and each driver's radial depth profile gives its cone, surround and flat-ring radii.
# The PMC6-2 result matches the hand measurements in build_scene.py, so trust it, but eyeball
# the numbers for a new model once and then commit the JSON.
import json
import math
import os
import sys
from collections import deque

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "kits")
STEP = 2.0  # mm per depth-map cell
# Where the real part differs from the CAD. PMC6-2 mid: the CAD dome is a 48 mm cap on a bare
# floor; the real driver is a 55 mm soft dome (PMC spec, product photo) with a narrow surround,
# so build_scene.py rebuilds the dome skin (dome_r_mm) and cuts the piece at 29 mm.
REAL_PARTS = {
    ("PMC6-2", "mid"): {"r_cone_mm": 27.5, "r_surround_mm": 28.8, "r_cut_mm": 29.0, "dome_r_mm": 27.5},
    # woofers: the CAD cone edge is at r 53.0 (the 35 % threshold gives 49); "skin" makes
    # build_scene.py re-lathe the measured profile instead of the hand-modelled cap and roll
    ("PMC6-2", "woofer"): {"r_cone_mm": 53.0, "skin": "pmc6-2"},
    ("PMC6-2", "tweeter"): {"skin": "pmc6-2"},  # build_scene.py re-lathes the surround roll round the dome
}
# approximate dome centres (model mm, x right, y up) per model; refined from the geometry
DOME_HINTS = {
    "PMC6-2": [(257, 201), (260, 314)],
    "PMC6": [(122, 300)],
    "PMC8-2INCSTAND": [(364, 1354), (364, 1477)],
}


def depth_map(obj, lo, hi, zmax):
    """Ray-cast the front face: depth (mm below the front-most surface) per 2 mm cell."""
    xs = np.arange(lo[0] + STEP / 2, hi[0], STEP)
    ys = np.arange(lo[1] + STEP / 2, hi[1], STEP)
    D = np.full((len(ys), len(xs)), np.nan)
    down = Vector((0, 0, -1))
    for j, y in enumerate(ys):
        for i, x in enumerate(xs):
            hit, loc, _, _ = obj.ray_cast(Vector((x, y, zmax + 5)), down)
            if hit:
                D[j, i] = zmax - loc.z
    return xs, ys, D


def local_plane(D, block=20, reach=4):
    """The baffle plane under each cell: 10th-percentile depth per block, min over nearby blocks."""
    h, w = D.shape
    bh, bw = math.ceil(h / block), math.ceil(w / block)
    P = np.full((bh, bw), np.nan)
    for bj in range(bh):
        for bi in range(bw):
            cells = D[bj * block : (bj + 1) * block, bi * block : (bi + 1) * block]
            if np.isfinite(cells).sum() > 10:
                P[bj, bi] = np.nanpercentile(cells, 10)
    R = np.full_like(P, np.nan)
    for bj in range(bh):
        for bi in range(bw):
            win = P[max(0, bj - reach) : bj + reach + 1, max(0, bi - reach) : bi + reach + 1]
            if np.isfinite(win).any():
                R[bj, bi] = np.nanmin(win)
    return np.repeat(np.repeat(R, block, axis=0), block, axis=1)[:h, :w]


def components(mask):
    """Connected components of a boolean image -> list of (js, is) index arrays."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    out = []
    for j0, i0 in zip(*np.nonzero(mask)):
        if seen[j0, i0]:
            continue
        q, js, iis = deque([(j0, i0)]), [], []
        seen[j0, i0] = True
        while q:
            j, i = q.popleft()
            js.append(j)
            iis.append(i)
            for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nj, ni = j + dj, i + di
                if 0 <= nj < h and 0 <= ni < w and mask[nj, ni] and not seen[nj, ni]:
                    seen[nj, ni] = True
                    q.append((nj, ni))
        out.append((np.array(js), np.array(iis)))
    return out


def circle_fit(x, y):
    A = np.column_stack([x, y, np.ones(len(x))])
    (a, c, d), *_ = np.linalg.lstsq(A, x * x + y * y, rcond=None)
    cx, cy = a / 2, c / 2
    return cx, cy, math.sqrt(max(d + cx * cx + cy * cy, 0))


def profile(D, xs, ys, cx, cy, rmax, step=1.0):
    """Median depth per 1 mm annulus out to rmax, and its per-sector spread at each radius."""
    X, Y = np.meshgrid(xs, ys)
    R = np.hypot(X - cx, Y - cy)
    A = np.arctan2(Y - cy, X - cx)
    med, spread = [], []
    for r in np.arange(0, rmax, step):
        sel = (R >= r) & (R < r + step) & np.isfinite(D)
        if sel.sum() < 3:
            med.append(np.nan)
            spread.append(np.nan)
            continue
        med.append(float(np.median(D[sel])))
        sectors = [D[sel & (A >= a) & (A < a + math.pi / 4)] for a in np.arange(-math.pi, math.pi, math.pi / 4)]
        vals = [float(np.median(s)) for s in sectors if len(s)]
        spread.append(float(np.std(vals)) if len(vals) > 2 else np.nan)
    return np.array(med), np.array(spread)


def flat_run(rel, start, floor, min_len=7, tol=0.5):
    """First flat stretch (within tol over min_len mm) at radius >= start that lies at least
    2 mm behind 'floor' (the surround crest) -> (start, end) radii."""
    for k in range(int(start), len(rel) - min_len):
        seg = rel[k : k + min_len]
        if np.isfinite(seg).all() and seg.max() - seg.min() < tol and seg.min() > floor + 2:
            end = k + min_len
            while end < len(rel) and np.isfinite(rel[end]) and abs(rel[end] - seg[0]) < 2.5:
                end += 1
            return k, end
    return None


def measure(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.stl_import(filepath=path, global_scale=1.0)
    obj = bpy.context.selected_objects[0]
    me = obj.data
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    lo, hi = co.min(axis=0), co.max(axis=0)
    zmax = float(hi[2])
    xs, ys, D = depth_map(obj, lo, hi, zmax)
    plane = local_plane(D)
    rel = D - plane  # depth below the local baffle plane (bowls positive, bumps negative)

    drivers = []

    # woofers: big round bowls
    for js, iis in components(np.nan_to_num(rel, nan=0.0) > 6.0):
        if len(js) < 300:
            continue
        span_x = (iis.max() - iis.min() + 1) * STEP
        span_y = (js.max() - js.min() + 1) * STEP
        span = max(span_x, span_y)
        if span < 70 or min(span_x, span_y) < 0.8 * span:
            continue
        area = len(js) * STEP * STEP
        if area < 0.6 * math.pi * (span / 2) ** 2:
            continue
        cx0, cy0 = xs[iis].mean(), ys[js].mean()
        rr = np.hypot(xs[iis] - cx0, ys[js] - cy0)
        edge = rr > np.percentile(rr, 80)
        cx, cy, r_bowl = circle_fit(xs[iis][edge], ys[js][edge])
        med, _ = profile(D, xs, ys, cx, cy, r_bowl * 1.6)
        ref = np.nanmedian(med[int(r_bowl * 1.2) : int(r_bowl * 1.5)])
        p = med - ref
        deep = np.nanmax(p[: int(r_bowl)])
        if deep < 8:
            continue  # a shallow dish (waveguide, recess), not a cone
        cone_r = next((k for k in range(4, int(r_bowl)) if p[k] < 0.35 * deep), int(r_bowl * 0.6))
        crest = int(cone_r + np.nanargmin(p[cone_r : int(r_bowl * 1.25)]))
        run = flat_run(p, crest + 2, p[crest])
        if run is None or run[0] > r_bowl * 1.6:
            flat, cut = int(r_bowl * 1.1), int(r_bowl * 1.15)
        else:
            flat, end = run
            cut = int(flat + max(3, 0.65 * (end - flat)))
        drivers.append(
            {
                "kind": "woofer",
                "x_mm": round(float(cx), 1),
                "y_mm": round(float(cy), 1),
                "r_cone_mm": float(cone_r),
                "r_surround_mm": float(max(cone_r + 4, flat)),
                "r_cut_mm": float(cut),
                "depth_mm": round(float(deep), 1),
                "plate_depth_mm": round(float(ref), 1),
                "back_mm": round(float(np.nanmax(med[: int(cut)])), 1),
            }
        )

    # domes: refined from DOME_HINTS (approximate centres read off the model). The apex is the
    # front-most point within 25 mm of the hint; the radial profile gives the base radius.
    name0 = os.path.splitext(os.path.basename(path))[0]
    X, Y = np.meshgrid(xs, ys)
    for hx, hy in DOME_HINTS.get(name0, []):
        near = np.hypot(X - hx, Y - hy) < 25
        if not (near & np.isfinite(D)).any():
            print(f"   dome hint ({hx},{hy}): nothing there")
            continue
        Dn = np.where(near, D, np.nan)
        j, i = np.unravel_index(np.nanargmin(Dn), Dn.shape)
        # centroid of the cells within 0.6 mm of the apex depth, for a sub-cell centre
        top = near & (D < Dn[j, i] + 0.6)
        cx, cy = float(X[top].mean()), float(Y[top].mean())
        med, spread = profile(D, xs, ys, cx, cy, 60)
        med0 = float(np.nanmin(med[:3]))
        peak = int(np.nanargmax(med[:45]))
        rise = med[peak] - med0
        if peak >= 20:  # a big soft dome: its base is where the profile levels out at the groove
            kind = "mid"
            r_dome = next(k for k in range(2, 45) if med[k] >= med[peak] - 0.3) + 2
        else:  # a tweeter: its base is where the dome curvature gives way to the recess floor
            kind = "tweeter"
            r_dome = next(k for k in range(2, 30) if med[k] >= med0 + 0.55 * rise)
        r_dome = min(r_dome, 40)
        drivers.append(
            {
                "kind": kind,
                "x_mm": round(cx, 1),
                "y_mm": round(cy, 1),
                "r_cone_mm": float(round(r_dome * 0.62)),
                "r_surround_mm": float(r_dome),
                "r_cut_mm": float(r_dome + 1),
                "depth_mm": round(med0, 1),
                "plate_depth_mm": round(float(np.nanmedian(med[int(r_dome) + 2 : int(r_dome) + 8])), 1),
                "back_mm": round(float(np.nanmax(med[: int(r_dome) + 2])), 1),
            }
        )

    drivers.sort(key=lambda d: (-d["y_mm"], d["x_mm"]))
    name = os.path.splitext(os.path.basename(path))[0]
    for d in drivers:  # real-part facts the CAD does not carry
        d.update(REAL_PARTS.get((name, d["kind"]), {}))
    kit = {
        "model": name,
        "stl": os.path.relpath(path, os.path.dirname(HERE)).replace("\\", "/"),
        "size_mm": [round(float(v), 1) for v in (hi - lo)],
        "front_z_mm": round(zmax, 1),
        "faces": len(me.polygons),
        "drivers": drivers,
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(kit, fh, indent=2)
    print(f"{name}: {kit['size_mm']} mm, {len(drivers)} drivers")
    for d in drivers:
        print(
            f"   {d['kind']:8s} at ({d['x_mm']:6.1f},{d['y_mm']:6.1f})  cone {d['r_cone_mm']:5.1f}  "
            f"surround {d['r_surround_mm']:5.1f}  cut {d['r_cut_mm']:5.1f}  depth {d['depth_mm']:5.1f}  plate {d['plate_depth_mm']:5.1f}"
        )


argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
for p in argv:
    measure(os.path.abspath(p))
