# Excursion — bind a drive.json to the scene and (optionally) render frames.
#
#   blender -b blender/scenes/void.blend -P blender/apply_drive.py -- \
#       blender/jobs/track.drive.json --render --out frames/track [--engine eevee|cycles] [--draft]
#
# Bindings (kit contract):
#   frames[i].bass  -> Woofer_L / Woofer_R shape key "Excursion"
#   frames[i].high  -> TweeterMat emission strength
#   beats[]         -> SlateMat emission flash (downbeats brighter) — the sync slate
# One keyframe per output frame; drive frame i == blender frame i+1 == t = i/fps.

import argparse
import json
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("drive")
ap.add_argument("--engine", default="eevee", choices=["eevee", "cycles"])
ap.add_argument("--render", action="store_true")
ap.add_argument("--out", default="frames/job")
ap.add_argument("--draft", action="store_true", help="half resolution, low samples")
args = ap.parse_args(argv)

with open(args.drive, encoding="utf-8") as fh:
    data = json.load(fh)

scene = bpy.context.scene
fps = data["fps"]
frames = data["frames"]
scene.render.fps = fps
scene.frame_start = 1
scene.frame_end = len(frames)


def fcurve_fill(id_data, data_path, values, index=0):
    """Batch-insert one LINEAR keyframe per output frame on data_path."""
    ad = id_data.animation_data or id_data.animation_data_create()
    if ad.action is None:
        ad.action = bpy.data.actions.new(id_data.name + "Action")
    fc = ad.action.fcurves.find(data_path, index=index)
    if fc is None:
        fc = ad.action.fcurves.new(data_path, index=index)
    fc.keyframe_points.add(count=len(values))
    for i, v in enumerate(values):
        kp = fc.keyframe_points[i]
        kp.co = (i + 1, v)
        kp.interpolation = "LINEAR"
    fc.update()


# woofers ---------------------------------------------------------------
bass = [f["bass"] for f in frames]
for name in ("Woofer_L", "Woofer_R"):
    obj = bpy.data.objects.get(name)
    if obj is not None and obj.data.shape_keys is not None:
        fcurve_fill(obj.data.shape_keys, 'key_blocks["Excursion"].value', bass)
    else:
        print(f"warning: {name} missing or has no shape keys — skipped")

# tweeter shimmer -------------------------------------------------------
tweeter_mat = bpy.data.materials.get("TweeterMat")
if tweeter_mat is not None and tweeter_mat.node_tree is not None:
    highs = [f["high"] * 8.0 for f in frames]
    fcurve_fill(
        tweeter_mat.node_tree,
        'nodes["Principled BSDF"].inputs["Emission Strength"].default_value',
        highs,
    )

# sync slate: flash on every beat, brighter on downbeats ----------------
slate_mat = bpy.data.materials.get("SlateMat")
if slate_mat is not None and slate_mat.node_tree is not None:
    flash = [0.0] * len(frames)
    downbeats = set(round(t * fps) for t in data.get("downbeats", []))
    for t in data.get("beats", []):
        i = round(t * fps)
        peak = 20.0 if i in downbeats else 8.0
        for step, factor in ((0, 1.0), (1, 0.35), (2, 0.1)):
            j = i + step
            if 0 <= j < len(flash):
                flash[j] = max(flash[j], peak * factor)
    fcurve_fill(
        slate_mat.node_tree,
        'nodes["Principled BSDF"].inputs["Emission Strength"].default_value',
        flash,
    )

# render range: drive.range (seconds) -> frame window --------------------
rng = data.get("range")
if rng:
    scene.frame_start = max(1, round(rng["start"] * fps) + 1)
    scene.frame_end = min(len(frames), round(rng["end"] * fps))
    print(f"range: rendering frames {scene.frame_start}..{scene.frame_end}")

# camera cuts: timeline markers bound round-robin over all cameras -------
cuts = data.get("cuts", [])
cameras = sorted((o for o in scene.objects if o.type == "CAMERA"), key=lambda o: o.name)
if cuts and len(cameras) > 1:
    cut_frames = sorted({scene.frame_start} | {round(t * fps) + 1 for t in cuts})
    n = 0
    for fr in cut_frames:
        if fr < scene.frame_start or fr > scene.frame_end:
            continue
        marker = scene.timeline_markers.new(f"cut{n}", frame=fr)
        marker.camera = cameras[n % len(cameras)]
        n += 1
    print(f"cuts: {n} camera switches over {len(cameras)} cameras")
elif cuts:
    print(f"note: {len(cuts)} cuts in drive but the scene has one camera — add more cameras to use them")

# engine + render settings ---------------------------------------------
if args.engine == "cycles":
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32 if args.draft else 128
else:
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = 16 if args.draft else 64
scene.render.resolution_percentage = 50 if args.draft else 100
scene.render.image_settings.file_format = "PNG"

if args.render:
    scene.render.filepath = args.out.rstrip("/\\") + "/"
    print(f"rendering {len(frames)} frames to {scene.render.filepath} ({args.engine}{' draft' if args.draft else ''})")
    bpy.ops.render.render(animation=True)
else:
    print(f"applied {len(frames)} frames of {args.drive} — no --render flag, scene left keyframed")
