# Excursion — bind a drive.json to the scene and (optionally) render frames.
#
#   blender -b blender/scenes/void.blend -P blender/apply_drive.py -- \
#       blender/jobs/track.drive.json --render --out frames/track [--engine eevee|cycles] [--draft]
#
# Bindings (kit contract):
#   frames[i].cone  -> Woofer_L / Woofer_R shape key "Excursion", keyed at exposure start/end
#   beats[]         -> SlateMat emission flash (downbeats brighter) — the sync slate, --slate only
#   frames[].dome   -> Mid shape key "Excursion" (the mid dome, from the mid band)
#   sections[]      -> drop: smoke thickens, lights flare, logo + camera hit harder; break: smoke
#                      thins, key dims. KeyLight follows the bass level, rims pulse on downbeats
#   beats[]         -> LogoMat emission: a low idle glow, flashes on every beat, bigger on downbeats
#   --sweep DEG     -> CamRig Z rotation eased from -DEG/2 to +DEG/2 over the render range
#   cuts[]          -> focus racks per shot; frames[].cone -> camera push-in on hits; handheld drift
#   --shutter F     -> motion blur shutter fraction (0.5 = 180 degrees)
#   frames[].cone   -> DustField Gust (air moved so far) and Push (current hit): woofer wind
#   bass + mood     -> SmokeMat Push (kick transient), Drift (bass running sum) and Time;
#                      the Smoke volume only renders when drive.mood is "smoke"
# One keyframe per output frame; drive frame i == blender frame i+1 == t = i/fps.

import argparse
import math
import json
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("drive")
ap.add_argument("--engine", default="eevee", choices=["eevee", "cycles"])
ap.add_argument("--render", action="store_true")
ap.add_argument("--out", default="frames/job")
ap.add_argument("--draft", action="store_true", help="half resolution, low samples")
ap.add_argument("--sweep", type=float, default=30.0, help="camera orbit arc in degrees (0 = static)")
ap.add_argument("--slate", action="store_true", help="show the orange sync slate above the speaker (flashes on beats)")
ap.add_argument("--shutter", type=float, default=0.5, help="motion blur shutter as a fraction of the frame (0.5 = 180 degrees)")
args = ap.parse_args(argv)

with open(args.drive, encoding="utf-8") as fh:
    data = json.load(fh)

scene = bpy.context.scene
fps = data["fps"]
frames = data["frames"]
scene.render.fps = fps
scene.frame_start = 1
scene.frame_end = len(frames)
scene.render.motion_blur_shutter = args.shutter


def fcurve_fill(id_data, data_path, values=None, index=0, points=None):
    """Batch-insert LINEAR keyframes on data_path: one per output frame from values, or
    arbitrary (frame, value) points (sub-frame keys allowed)."""
    if points is None:
        points = [(i + 1, v) for i, v in enumerate(values)]
    ad = id_data.animation_data or id_data.animation_data_create()
    if ad.action is None:
        ad.action = bpy.data.actions.new(id_data.name + "Action")
    try:
        # Blender 4.4+ slotted actions (the legacy Action.fcurves API is gone in 5.x)
        fc = ad.action.fcurve_ensure_for_datablock(id_data, data_path, index=index)
    except AttributeError:
        fc = ad.action.fcurves.find(data_path, index=index)
        if fc is None:
            fc = ad.action.fcurves.new(data_path, index=index)
    fc.keyframe_points.clear()
    fc.keyframe_points.add(count=len(points))
    for kp, (frame, v) in zip(fc.keyframe_points, points):
        kp.co = (frame, v)
        kp.interpolation = "LINEAR"
    fc.update()


# section markers: drop / break from the grid tool (M/B) or track-job --drop/--break -------
# in_break[i]: inside a break; drop_pulse(i, s): 1 at a drop decaying to 0 over s seconds
section_frames = sorted((round(s["t"] * fps), s.get("kind", "")) for s in data.get("sections", []))
in_break, since_drop = [], []
state, last_drop, k = "", None, 0
for i in range(len(frames)):
    while k < len(section_frames) and section_frames[k][0] <= i:
        state = section_frames[k][1]
        if state == "drop":
            last_drop = i
        k += 1
    in_break.append(state == "break")
    since_drop.append(None if last_drop is None else i - last_drop)


def drop_pulse(i, seconds):
    return 0.0 if since_drop[i] is None else math.exp(-since_drop[i] / (seconds * fps))


if section_frames:
    print(f"sections: {', '.join(f'{kind}@{fr / fps:.1f}s' for fr, kind in section_frames)}")

# woofers: driven by the audio itself -------------------------------------------------------
# drive.frames[i].cone is [first, second]: the cone's extreme positions during that frame's
# camera exposure, simulated from the waveform through a driver model (grid-tool cone.ts).
# They are keyed at the start and end of the exposure, so motion blur smears the cone across
# its real travel and the sharp mid-exposure position sits between them. Bass hits swing it
# hard, sustained bass keeps it buzzing, silence leaves it still. No beat grid involved.
# Drives exported before cone.ts only have the smoothed bass level; that is keyed directly.
bass = [f["bass"] for f in frames]
shutter_half = scene.render.motion_blur_shutter / 2
if frames and "cone" in frames[0]:
    cone_points = []
    for i, f in enumerate(frames):
        first, second = f["cone"]
        cone_points.append((i + 1 - shutter_half, first))
        cone_points.append((i + 1 + shutter_half, second))
    cone_source = "audio-driven cone motion"
else:
    cone_points = [(i + 1, b) for i, b in enumerate(bass)]
    cone_source = "bass level (old drive without cone data — re-export for audio-driven motion)"
woofer_objs = [o for o in scene.objects if "Woofer" in o.name and o.type == "MESH" and o.data.shape_keys is not None]
for obj in woofer_objs:
    obj.data.shape_keys.key_blocks["Excursion"].slider_min = -1.0  # the cone travels in too
    fcurve_fill(obj.data.shape_keys, 'key_blocks["Excursion"].value', points=cone_points)
if not woofer_objs:
    print("warning: no Woofer objects with shape keys — nothing to drive")
print(f"woofers: {len(woofer_objs)} cones, {cone_source}")

# mid dome: the mid band through its own driver model (frames[].dome) ----
mid_objs = [o for o in scene.objects if "Mid" in o.name and o.type == "MESH" and o.data.shape_keys is not None]
if mid_objs:
    if frames and "dome" in frames[0]:
        dome_points = []
        for i, f in enumerate(frames):
            first, second = f["dome"]
            dome_points.append((i + 1 - shutter_half, first))
            dome_points.append((i + 1 + shutter_half, second))
        dome_source = "audio-driven dome motion"
    else:
        dome_points = [(i + 1, f["mid"]) for i, f in enumerate(frames)]
        dome_source = "mid level (re-export the drive for audio-driven motion)"
    for mid in mid_objs:
        mid.data.shape_keys.key_blocks["Excursion"].slider_min = -1.0
        fcurve_fill(mid.data.shape_keys, 'key_blocks["Excursion"].value', points=dome_points)
    print(f"mid domes: {len(mid_objs)}, {dome_source}")


# smoke: kicks shove it out of the woofers, bass keeps the cloud drifting ----
smoke = bpy.data.objects.get("Smoke")
smoke_mat = bpy.data.materials.get("SmokeMat")
if smoke is not None and smoke_mat is not None:
    mood = data.get("mood", "smoke")
    smoke.hide_render = mood != "smoke"
    if smoke.hide_render:
        print(f"smoke: hidden for mood {mood!r}")
    else:
        push, drift = [], []
        env, total, prev = 0.0, 0.0, 0.0
        for i, b in enumerate(bass):
            if "cone" in frames[i]:
                first, second = frames[i]["cone"]
                hit = min(1.0, abs(second - first))  # air moved: how far the cone swung this frame
            else:
                hit = b if b > prev + 0.02 else 0.0  # old drives: the attack of a bass rise
            env = max(hit, env * 0.88)  # snap out, relax over ~0.3 s
            total += (0.02 + 0.12 * b) / fps  # metres: slow base flow plus bass surges
            push.append(env)
            drift.append(total)
            prev = b
        nt = smoke_mat.node_tree
        # breaks thin the smoke, a drop thickens it and it settles back over ~4 s
        base_density = nt.nodes["Density"].outputs[0].default_value
        fcurve_fill(
            nt,
            'nodes["Density"].outputs[0].default_value',
            [base_density * (0.5 if in_break[i] else 1.0) * (1.0 + 0.8 * drop_pulse(i, 4.0)) for i in range(len(frames))],
        )
        fcurve_fill(nt, 'nodes["Push"].outputs[0].default_value', push)
        fcurve_fill(nt, 'nodes["Drift"].outputs[0].default_value', drift)
        fcurve_fill(nt, 'nodes["Time"].outputs[0].default_value', [i / fps for i in range(len(frames))])
        print(f"smoke: drifts {total:.2f} m over the track")

# dust rides the smoke's drift, streams and puffs with the woofers' air, hides with it --
DUST_GUST_SPEED = 0.6  # m/s stream speed in the woofer column at full cone travel
dust = bpy.data.objects.get("Dust")
if dust is not None:
    dust.hide_render = smoke is not None and smoke.hide_render
    mod = dust.modifiers.get("Dust")
    if mod is not None and not dust.hide_render and smoke is not None:
        ids = {item.name: item.identifier for item in mod.node_group.interface.items_tree if item.item_type == "SOCKET"}

        def dust_path(name):
            if hasattr(mod, "properties"):  # Blender 5.x: inputs live under modifier.properties.inputs
                return f'modifiers["Dust"].properties.inputs.{ids[name]}.value'
            return f'modifiers["Dust"]["{ids[name]}"]'  # Blender 4.x: ID properties on the modifier

        # Gust: metres of air the cones have moved so far, at DUST_GUST_SPEED m/s for full travel
        gust, total = [], 0.0
        for f in frames:
            travel = abs(f["cone"][1] - f["cone"][0]) / 2 if "cone" in f else f["bass"]
            total += DUST_GUST_SPEED * travel / fps
            gust.append(total)
        fcurve_fill(dust, dust_path("Drift"), drift)
        fcurve_fill(dust, dust_path("Time"), [i / fps for i in range(len(frames))])
        if "Gust" in ids:
            fcurve_fill(dust, dust_path("Gust"), gust)
            fcurve_fill(dust, dust_path("Push"), push)
            print(f"dust: woofer wind streams {total:.1f} m over the track")

# beat flashes: the sync slate (drafts only) and the logo -----------------
def beat_flash(peak, downbeat_peak, decay, floor=0.0):
    """Per-frame emission strength: floor, jumping to peak on each beat and decaying by
    'decay' per frame (downbeats hit downbeat_peak)."""
    flash = [floor] * len(frames)
    downbeats = set(round(t * fps) for t in data.get("downbeats", []))
    for t in data.get("beats", []):
        i = round(t * fps)
        level = downbeat_peak if i in downbeats else peak
        j = i
        while 0 <= j < len(flash) and level > floor:
            flash[j] = max(flash[j], level)
            level *= decay
            j += 1
    return flash


slate = bpy.data.objects.get("Slate")
slate_mat = bpy.data.materials.get("SlateMat")
if slate is not None:
    slate.hide_render = not args.slate  # the sync proof, on request only
if slate_mat is not None and slate_mat.node_tree is not None and args.slate:
    fcurve_fill(
        slate_mat.node_tree,
        'nodes["Principled BSDF"].inputs["Emission Strength"].default_value',
        beat_flash(8.0, 20.0, 0.3),
    )
logo_mat = bpy.data.materials.get("LogoMat")
if logo_mat is not None and logo_mat.node_tree is not None:
    fcurve_fill(
        logo_mat.node_tree,
        'nodes["Principled BSDF"].inputs["Emission Strength"].default_value',
        [max(v, 30.0 * drop_pulse(i, 0.5)) for i, v in enumerate(beat_flash(6.0, 14.0, 0.62, floor=0.35))],
    )

# lights follow the track: the key breathes with the bass level (dim in breaks, back at the
# drop), the red rims and back light pulse on downbeats and flare at a drop -----------------
slow, env = [], 0.0
for i, level in enumerate(bass):
    env = max(level, env * 0.985)  # ~2 s release
    slow.append(env * (0.5 if in_break[i] else 1.0))
key_light = bpy.data.objects.get("KeyLight")
if key_light is not None:
    base = key_light.data.energy
    fcurve_fill(key_light.data, "energy", [base * (0.35 + 0.65 * v) for v in slow])
downbeat_pulse = beat_flash(0.0, 1.0, 0.8)
for name in ("RimLeft", "RimRight", "TopBack"):
    light = bpy.data.objects.get(name)
    if light is not None:
        base = light.data.energy
        fcurve_fill(light.data, "energy", [base * (0.6 + 0.7 * p + 0.5 * drop_pulse(i, 3.0)) for i, p in enumerate(downbeat_pulse)])
print("lights: key follows the bass level, rims pulse on downbeats")

# render range: drive.range (seconds) -> frame window --------------------
rng = data.get("range")
if rng:
    scene.frame_start = max(1, round(rng["start"] * fps) + 1)
    scene.frame_end = min(len(frames), round(rng["end"] * fps))
    print(f"range: rendering frames {scene.frame_start}..{scene.frame_end}")

# camera sweep: orbit every camera around the speaker across the range ------
rig = bpy.data.objects.get("CamRig")
if rig is not None and args.sweep:
    import math

    half = math.radians(args.sweep) / 2
    ad = rig.animation_data
    if ad is not None:
        ad.action = None
    for fr, angle in ((scene.frame_start, -half), (scene.frame_end, half)):
        rig.rotation_euler = (0.0, 0.0, angle)
        rig.keyframe_insert("rotation_euler", index=2, frame=fr)  # default Bezier = ease in/out
    print(f"sweep: {args.sweep:g} deg orbit over frames {scene.frame_start}..{scene.frame_end}")
elif rig is None and args.sweep:
    print("note: scene has no CamRig — rebuild it with build_scene.py to get the camera sweep")

# moving key light: glide its target along KeyTarget["path"] over the render range --------
key_target = bpy.data.objects.get("KeyTarget")
if key_target is not None and "path" in key_target:
    flat = list(key_target["path"])
    stops = [tuple(flat[k : k + 3]) for k in range(0, len(flat) - 2, 3)]
    ad = key_target.animation_data
    if ad is not None:
        ad.action = None
    span = max(1, scene.frame_end - scene.frame_start)
    for n, stop in enumerate(stops):
        key_target.location = stop
        key_target.keyframe_insert("location", frame=scene.frame_start + span * n / max(1, len(stops) - 1))
    print(f"key light: glides through {len(stops)} stops over frames {scene.frame_start}..{scene.frame_end}")

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

# focus racks + camera thump + handheld ---------------------------------
# Each focus empty carries a "rack" (start xyz, end xyz) from build_scene; over every shot its
# camera gets, the focus point glides start -> end. Every camera also pushes in toward its
# subject on cone hits (a thump you feel) and drifts a little like a handheld rig.
CAM_THUMP = 0.012  # metres of push-in at full cone travel
CAM_SHAKE = 0.0015  # handheld drift, metres
CAM_SHAKE_ROT = 0.0035  # handheld drift, radians (~0.2 degrees)

segments = []  # (camera, first frame, last frame)
markers = sorted((m for m in scene.timeline_markers if m.camera is not None), key=lambda m: m.frame)
if markers:
    for k, m in enumerate(markers):
        last = markers[k + 1].frame - 1 if k + 1 < len(markers) else scene.frame_end
        segments.append((m.camera, m.frame, last))
elif scene.camera is not None:
    segments.append((scene.camera, scene.frame_start, scene.frame_end))

for focus in {cam.data.dof.focus_object for cam, _, _ in segments if cam.data.dof.focus_object}:
    if focus.animation_data is not None:
        focus.animation_data.action = None
racks = 0
for cam, f0, f1 in segments:
    focus = cam.data.dof.focus_object if cam.data.dof.use_dof else None
    if focus is None or "rack" not in focus:
        continue
    flat = list(focus["rack"])
    focus.location = flat[:3]
    focus.keyframe_insert("location", frame=f0)
    focus.location = flat[3:6]
    focus.keyframe_insert("location", frame=max(f0 + 1, f1))
    racks += 1
print(f"focus: {racks} rack moves over {len(segments)} shots")

travel = [abs(f["cone"][1] - f["cone"][0]) / 2 if "cone" in f else f["bass"] for f in frames]
thump, env = [], 0.0
for v in travel:
    env = max(v, env * 0.80)  # hit, then relax over ~5 frames
    thump.append(env)


def wobble(t, seed):
    """Smooth, aperiodic -1..1 drift."""
    return (math.sin(t * 1.7 + seed) + 0.5 * math.sin(t * 3.9 + 2 * seed) + 0.25 * math.sin(t * 8.3 + 3 * seed)) / 1.75


for cam in cameras:
    base_loc, base_rot = cam.location.copy(), cam.rotation_euler.copy()
    axes = cam.matrix_basis.to_3x3()
    fwd, right, up = axes @ Vector((0, 0, -1)), axes @ Vector((1, 0, 0)), axes @ Vector((0, 1, 0))
    seed = sum(map(ord, cam.name)) % 7  # deterministic per camera
    loc_pts, rot_pts = [[], [], []], [[], [], []]
    for i in range(scene.frame_start - 1, scene.frame_end):
        t = i / fps
        push_in = CAM_THUMP * thump[i] * (1.0 + 2.0 * drop_pulse(i, 0.6))  # a drop hits harder
        p = base_loc + fwd * push_in + right * (CAM_SHAKE * wobble(t, seed + 1.0)) + up * (CAM_SHAKE * wobble(t, seed + 2.3))
        r = (
            base_rot.x + CAM_SHAKE_ROT * wobble(t, seed + 4.1),
            base_rot.y + CAM_SHAKE_ROT * 0.3 * wobble(t, seed + 5.7),
            base_rot.z + CAM_SHAKE_ROT * wobble(t, seed + 7.9),
        )
        for a in range(3):
            loc_pts[a].append((i + 1, p[a]))
            rot_pts[a].append((i + 1, r[a]))
    for a in range(3):
        fcurve_fill(cam, "location", index=a, points=loc_pts[a])
        fcurve_fill(cam, "rotation_euler", index=a, points=rot_pts[a])
print(f"cameras: thump up to {CAM_THUMP * 1000:.0f} mm + handheld drift on {len(cameras)} cameras")

# film grain: re-seed the compositor noise every frame -------------------
comp = bpy.data.node_groups.get("VoidComp")
if comp is not None and comp.nodes.get("Grain") is not None:
    fcurve_fill(comp, 'nodes["Grain"].inputs["W"].default_value', [i * 0.37 for i in range(len(frames))])


# engine + render settings ---------------------------------------------
def use_gpu_for_cycles():
    """Pick the best GPU backend available so a fresh install renders on the card, not the CPU."""
    addon = bpy.context.preferences.addons.get("cycles")
    if addon is None:
        return
    prefs = addon.preferences
    for backend in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
        try:
            prefs.compute_device_type = backend
        except TypeError:
            continue
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type == backend]
        if gpus:
            for d in prefs.devices:
                d.use = d.type == backend
            scene.cycles.device = "GPU"
            print(f"cycles: {backend} on {', '.join(d.name for d in gpus)}")
            return
    print("cycles: no GPU backend found — rendering on CPU")


if args.engine == "cycles":
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32 if args.draft else 128
    use_gpu_for_cycles()
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
