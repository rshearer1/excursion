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
import os
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
ap.add_argument("--test", action="store_true", help="cycles look test: half resolution, 32 samples, full fps (about 3 s a frame)")
ap.add_argument("--sweep", type=float, default=12.0, help="camera orbit arc in degrees (0 = static)")
ap.add_argument("--slate", action="store_true", help="show the orange sync slate above the speaker (flashes on beats)")
ap.add_argument("--shutter", type=float, default=0.5, help="motion blur shutter as a fraction of the frame (0.5 = 180 degrees)")
ap.add_argument("--samples", type=int, default=48, help="cycles samples per pixel (denoised; 48 is clean for this scene)")
ap.add_argument("--mood", default=None, help="override drive.mood: a name in blender/moods/")
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


# mood: blender/moods/<name>.json re-grades the scene at apply time (no rebuild) -------------
# A mood is a palette, a cue list, a smoke setting and a grade. Every knob here reads the
# JSON; anything the file leaves out keeps the scene's built-in value. drive.mood names it,
# --mood overrides; old drives said "smoke", which is the moody default.
MOOD_ALIASES = {"smoke": "moody", "": "moody"}
MOODS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "moods")


def load_mood(name):
    name = MOOD_ALIASES.get(name, name)
    path = os.path.join(MOODS_DIR, f"{name}.json")
    if not os.path.exists(path):
        print(f"mood: no blender/moods/{name}.json — the scene's built-in look")
        return {"name": name}
    with open(path, encoding="utf-8") as fh:
        m = json.load(fh)
    m["name"] = name
    return m


mood = load_mood(args.mood or data.get("mood", "moody"))


def mood_light(name, color=None, gain=None):
    obj = bpy.data.objects.get(name)
    if obj is None or obj.type != "LIGHT":
        return
    if color is not None:
        obj.data.color = tuple(color)
    if gain is not None:
        obj.data.energy *= gain


if "exposure" in mood:
    scene.view_settings.exposure = mood["exposure"]
if "key" in mood:
    mood_light("KeyLight", mood["key"].get("color"), mood["key"].get("gain"))
mood_light("Graze", gain=mood.get("graze_gain"))
mood_light("DustBack", gain=mood.get("dust_back_gain"))
smoke_cfg = mood.get("smoke", {})
_smoke_mat = bpy.data.materials.get("SmokeMat")
if _smoke_mat is not None and _smoke_mat.node_tree is not None:
    for node_name, key in (("Density", "density_gain"), ("Haze", "haze_gain")):
        node = _smoke_mat.node_tree.nodes.get(node_name)
        if node is not None and key in smoke_cfg:
            node.outputs[0].default_value *= smoke_cfg[key]
_scope = bpy.data.materials.get("ScopeMat")
if _scope is not None and _scope.node_tree is not None and mood.get("cues"):
    _scope.node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = (*mood["cues"][0]["trace"], 1.0)
grade = mood.get("grade", {})
comp_tree = scene.compositing_node_group
if comp_tree is not None and grade:
    cn = comp_tree.nodes

    def comp_set(node_name, socket, value):
        node = cn.get(node_name)
        if node is not None:
            sock = next((s for s in node.inputs if s.identifier == socket or s.name == socket), None)
            if sock is not None:
                sock.default_value = value

    if "bloom" in grade:
        comp_set("Bloom", "Strength", grade["bloom"])
    if "chromatic" in grade:
        comp_set("Lens", "Dispersion", grade["chromatic"])
    if "black_lift" in grade and cn.get("Curve") is not None:
        c = cn["Curve"].mapping.curves[3]
        c.points[0].location = (0.0, grade["black_lift"])
        cn["Curve"].mapping.update()
    if "gain" in grade:
        comp_set("Balance", "Color Gain", (*grade["gain"], 1.0))
    if "lift" in grade:
        comp_set("Balance", "Color Lift", (*grade["lift"], 1.0))
    if "saturation" in grade:
        comp_set("Saturation", "Saturation", grade["saturation"])
    if "vignette" in grade:
        comp_set("Vignette", "To Min", 1.0 - grade["vignette"])
    if "grain" in grade:
        comp_set("GrainAmount", "To Min", -grade["grain"])
        comp_set("GrainAmount", "To Max", grade["grain"])
print(f"mood: {mood['name']} — {mood.get('description', 'built-in look')}")


# smoke: kicks shove it out of the woofers, bass keeps the cloud drifting ----
smoke = bpy.data.objects.get("Smoke")
smoke_mat = bpy.data.materials.get("SmokeMat")
if smoke is not None and smoke_mat is not None:
    smoke.hide_render = not smoke_cfg.get("show", True)
    if smoke.hide_render:
        print(f"smoke: hidden for mood {mood['name']!r}")
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
        # the plan's rule: the push is the cone's velocity, signed — the outward stroke shoves,
        # the return stroke sucks. frames[].cone gives the exposure's [first, second] extremes,
        # so their difference is the stroke during the shutter. Old drives fall back to the
        # smoke's kick transient.
        if frames and "cone" in frames[0]:
            vel = [f["cone"][1] - f["cone"][0] for f in frames]
            peak = max(0.05, max(abs(v) for v in vel))
            dust_push = [max(-1.0, min(1.0, 1.2 * v / peak)) for v in vel]
        else:
            dust_push = push
        if "Gust" in ids:
            fcurve_fill(dust, dust_path("Gust"), gust)
            fcurve_fill(dust, dust_path("Push"), dust_push)
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

neon_mat = bpy.data.materials.get("NeonMat")
if neon_mat is not None and neon_mat.node_tree is not None:
    fcurve_fill(
        neon_mat.node_tree,
        'nodes["Principled BSDF"].inputs["Emission Strength"].default_value',
        [max(v, 9.0 * drop_pulse(i, 0.5)) for i, v in enumerate(beat_flash(2.6, 4.5, 0.6, floor=0.9))],
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
rim_level = [0.6 + 0.7 * p + 0.5 * drop_pulse(i, 3.0) for i, p in enumerate(downbeat_pulse)]

# lighting cues: the look steps through LOOK_CUES, one every CUE_BARS bars, with a short
# crossfade. Each cue sets the rim/back-light colour and gain, the dust backlight gain and the
# LED wall's trace colour, so the whole room changes together.
#   B  cool rims against the warm key, blue trace
#   A  dark red rims, red trace
#   F  warm only: rims off, backlight up, amber trace
# The list, the bar count and the fade come from the mood JSON (blender/moods/); this is
# the built-in fallback when the mood has no cues.
DEFAULT_CUES = [
    {"rim": (0.4, 0.6, 1.0), "rim_gain": 1.0, "back_gain": 1.0, "trace": (0.55, 0.75, 1.0)},
    {"rim": (0.55, 0.035, 0.02), "rim_gain": 1.0, "back_gain": 1.0, "trace": (1.0, 0.32, 0.18)},
    {"rim": (1.0, 0.7, 0.4), "rim_gain": 0.0, "back_gain": 2.2, "trace": (1.0, 0.68, 0.38)},
]
LOOK_CUES = [
    {"rim": tuple(c["rim"]), "rim_gain": c.get("rim_gain", 1.0), "back_gain": c.get("back_gain", 1.0), "trace": tuple(c["trace"])}
    for c in mood.get("cues", [])
] or DEFAULT_CUES
CUE_BARS = max(1, int(mood.get("cue_bars", 2)))
CUE_FADE = max(1, int(mood.get("cue_fade", 6)))  # frames
downbeats_fr = sorted(round(t * fps) for t in data.get("downbeats", []))


def cue_weights(i):
    """Blend weights over LOOK_CUES at frame i (crossfading over CUE_FADE frames at each change)."""
    bar = sum(1 for d in downbeats_fr if d <= i)
    step = bar // CUE_BARS
    cur = step % len(LOOK_CUES)
    prev = (step - 1) % len(LOOK_CUES)
    # frames since this step began
    since = i - max([d for d in downbeats_fr if d <= i and ((sum(1 for e in downbeats_fr if e <= d)) // CUE_BARS) == step] or [i])
    t = min(1.0, since / CUE_FADE) if step > 0 else 1.0
    w = [0.0] * len(LOOK_CUES)
    w[cur] += t
    w[prev] += 1.0 - t
    return w


def cue_mix(key, i):
    ws = cue_weights(i)
    vals = [c[key] for c in LOOK_CUES]
    if isinstance(vals[0], tuple):
        return tuple(sum(w * v[k] for w, v in zip(ws, vals)) for k in range(3))
    return sum(w * v for w, v in zip(ws, vals))


if True:  # one cue is still a cue: the rims take its colour and gain
    n_frames = len(frames)
    rim_gain = [cue_mix("rim_gain", i) for i in range(n_frames)]
    rim_col = [cue_mix("rim", i) for i in range(n_frames)]
    for name in ("RimLeft", "RimRight", "TopBack"):
        light = bpy.data.objects.get(name)
        if light is not None:
            base = light.data.energy
            fcurve_fill(light.data, "energy", [base * lvl * g for lvl, g in zip(rim_level, rim_gain)])
            for axis in range(3):
                fcurve_fill(light.data, "color", [c[axis] for c in rim_col], index=axis)
    for obj in scene.objects:
        if obj.type == "LIGHT" and obj.name.startswith("WallUp_"):
            base = obj.data.energy
            fcurve_fill(obj.data, "energy", [base * g for g in rim_gain])
            for axis in range(3):
                fcurve_fill(obj.data, "color", [c[axis] for c in rim_col], index=axis)
    back = bpy.data.objects.get("DustBack")
    if back is not None:
        base = back.data.energy
        fcurve_fill(back.data, "energy", [base * cue_mix("back_gain", i) for i in range(n_frames)])
    scope = bpy.data.materials.get("ScopeMat")
    if scope is not None and scope.node_tree is not None:
        trace = [cue_mix("trace", i) for i in range(n_frames)]
        for axis in range(3):
            fcurve_fill(scope.node_tree, 'nodes["Principled BSDF"].inputs["Emission Color"].default_value', [c[axis] for c in trace], index=axis)
    print(f"cues: {len(LOOK_CUES)} looks, one every {CUE_BARS} bars, {CUE_FADE}-frame crossfade")
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

# the light show ------------------------------------------------------------
LASER_BEAMS_N = 4
BLINDER_POWER = 9000.0
# Moving heads sweep the rig on slow figure-eights (each with its own phase), change colour on
# every bar and pulse on the beat; lasers fan across the floor and scan, only while there is
# bass; blinders hit on downbeats; projectors breathe; the LED wall's scope draws the track.
floor_obj = bpy.data.objects.get("Floor")
floor_z = floor_obj.location.z if floor_obj is not None else -1.29
rig_mid = floor_obj.location.x if floor_obj is not None else 0.0
# moving-head colours, one step per bar: deep reds and purples
PALETTE = [(0.75, 0.04, 0.08), (0.42, 0.04, 0.62), (0.9, 0.12, 0.18), (0.3, 0.02, 0.45)]
beat_pulse = beat_flash(1.0, 1.0, 0.7)
downbeat_frames = sorted(round(t * fps) for t in data.get("downbeats", []))
bar_of = []
n_bar = 0
for i in range(len(frames)):
    while n_bar < len(downbeat_frames) and downbeat_frames[n_bar] <= i:
        n_bar += 1
    bar_of.append(n_bar)
frame_span = range(scene.frame_start - 1, scene.frame_end)


def key_light(light, energies=None, colors=None):
    if energies is not None:
        fcurve_fill(light.data, "energy", points=[(i + 1, e) for i, e in zip(frame_span, energies)])
    if colors is not None:
        for axis in range(3):
            fcurve_fill(light.data, "color", index=axis, points=[(i + 1, c[axis]) for i, c in zip(frame_span, colors)])


def key_target(empty, positions):
    for axis in range(3):
        fcurve_fill(empty, "location", index=axis, points=[(i + 1, p[axis]) for i, p in zip(frame_span, positions)])


heads = sorted((o for o in scene.objects if o.type == "LIGHT" and o.name.startswith("Head_") and o.name.count("_") == 1), key=lambda o: o.name)
for k, head in enumerate(heads):
    target = bpy.data.objects.get(f"HeadTarget_{k}")
    phase = k * 2 * math.pi / max(1, len(heads))
    base = head.data.energy
    positions, energies, colors = [], [], []
    for i in frame_span:
        t = i / fps
        slow = 0.5 if in_break[i] else 1.0
        positions.append(
            (
                rig_mid + 2.0 * math.sin(2 * math.pi * t / 6.9 * slow + phase),
                -0.7 + 1.1 * math.sin(2 * math.pi * t / 4.3 * slow + 2 * phase),
                floor_z + 0.4 + 0.9 * (0.5 + 0.5 * math.sin(2 * math.pi * t / 5.1 * slow + phase)),
            )
        )
        energies.append(base * (0.3 + 0.7 * beat_pulse[i]) * (0.45 if in_break[i] else 1.0) * (1.0 + 1.5 * drop_pulse(i, 1.0)))
        colors.append(PALETTE[(bar_of[i] + k) % len(PALETTE)])
    if target is not None:
        key_target(target, positions)
    key_light(head, energies, colors)

lasers = [o for o in scene.objects if o.type == "LIGHT" and o.name.startswith("Laser_")]
for laser in lasers:
    _, k, j = laser.name.split("_")
    k, j = int(k), int(j)
    target = bpy.data.objects.get(f"LaserTarget_{k}_{j}")
    if target is None:
        continue
    base = laser.data.energy
    fan_centre = tuple(laser["fan"]) if "fan" in laser else None
    positions, energies = [], []
    for i in frame_span:
        t = i / fps
        if fan_centre is not None:  # background beams: a slow, narrow sway around their own point
            positions.append(
                (
                    fan_centre[0],
                    fan_centre[1] + 0.3 * math.sin(2 * math.pi * t / 9.5 + j * 1.7),
                    fan_centre[2] + 0.28 * math.sin(2 * math.pi * t / 6.5 + j * 0.9),
                )
            )
        else:
            fan = (j - (LASER_BEAMS_N - 1) / 2) * 0.5
            positions.append(
                (
                    rig_mid + (-0.5 if k == 0 else 0.5) + fan + 1.3 * math.sin(2 * math.pi * t / 2.3 + k * math.pi + j * 0.15),
                    -2.4 + 0.9 * math.sin(2 * math.pi * t / 3.7 + j * 0.4),
                    floor_z + 0.15,
                )
            )
        on = 0.0 if in_break[i] else 1.0
        energies.append(base * on * (0.45 + 0.55 * beat_pulse[i]) * (1.0 + 2.0 * drop_pulse(i, 0.8)))
    key_target(target, positions)
    key_light(laser, energies)

for k in range(2):
    blinder = bpy.data.objects.get(f"Blinder_{k}")
    if blinder is None:
        continue
    hits = set()
    for fr in downbeat_frames:
        hits.update((fr, fr + 1))
    key_light(blinder, [(BLINDER_POWER if i in hits and not in_break[i] else 0.0) for i in frame_span])

for side in ("L", "R"):
    beam = bpy.data.objects.get(f"Proj_{side}_Beam")
    if beam is not None:
        base = beam.data.energy
        key_light(beam, [base * (0.75 + 0.25 * beat_pulse[i]) for i in frame_span])

scope_mat = bpy.data.materials.get("ScopeMat")
if scope_mat is not None:
    nt = scope_mat.node_tree
    for name, values in (("Bass", bass), ("Mid", [f["mid"] for f in frames]), ("High", [f["high"] for f in frames]), ("Time", [i / fps for i in range(len(frames))])):
        if nt.nodes.get(name) is not None:
            fcurve_fill(nt, f'nodes["{name}"].outputs[0].default_value', values)
if heads or lasers:
    print(f"show: {len(heads)} moving heads, {len(lasers)} laser beams, blinders on downbeats, scope live")


# camera cuts: timeline markers bound round-robin over all cameras -------
cuts = data.get("cuts", [])
cameras = sorted((o for o in scene.objects if o.type == "CAMERA"), key=lambda o: o.name)
# the shot order: open on the rig reveal, then alternate the hero's close-ups with the moving
# wide views, so no two similar shots sit next to each other
SHOT_ORDER = ["Cam1_Wide", "Cam2_Woofers", "Cam7_Top", "Cam3_Macro", "Cam6_Side", "Cam4_Rig", "Cam5_Low"]
shot_cams = [bpy.data.objects[n] for n in SHOT_ORDER if n in bpy.data.objects] or cameras
if cuts and len(cameras) > 1:
    cut_frames = sorted(fr for fr in ({scene.frame_start} | {round(t * fps) + 1 for t in cuts}) if scene.frame_start <= fr <= scene.frame_end)
    if len(cut_frames) > 1 and cut_frames[1] - cut_frames[0] < fps:
        cut_frames.pop(1)  # a cut within a second of the start would make the opening shot a flash
    n = 0
    for fr in cut_frames:
        if fr < scene.frame_start or fr > scene.frame_end:
            continue
        marker = scene.timeline_markers.new(f"cut{n}", frame=fr)
        marker.camera = shot_cams[n % len(shot_cams)]
        n += 1
    print(f"cuts: {n} camera switches over {len(cameras)} cameras")
elif cuts:
    print(f"note: {len(cuts)} cuts in drive but the scene has one camera — add more cameras to use them")

# focus racks + camera thump + handheld ---------------------------------
# Each focus empty carries a "rack" (start xyz, end xyz) from build_scene; over every shot its
# camera gets, the focus point glides start -> end. Every camera also pushes in toward its
# subject on cone hits (a thump you feel) and drifts a little like a handheld rig.
VOLUME_RANGE = 12.0  # metres of volumetrics in front of each camera
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


shots_by_cam = {}
for cam, f0, f1 in segments:
    shots_by_cam.setdefault(cam.name, []).append((f0, f1))


def smoothstep(u):
    u = max(0.0, min(1.0, u))
    return u * u * (3 - 2 * u)


for cam in cameras:
    base_loc, base_rot = cam.location.copy(), cam.rotation_euler.copy()
    move = Vector(tuple(cam["move"])) if "move" in cam else Vector((0, 0, 0))
    tracked = any(c.type == "TRACK_TO" for c in cam.constraints)
    cam_shots = shots_by_cam.get(cam.name, [])

    def shot_offset(i):
        for f0, f1 in cam_shots:
            if f0 - 1 <= i <= f1 - 1:
                return move * smoothstep((i - (f0 - 1)) / max(1, f1 - f0))
        return Vector((0, 0, 0))

    axes = cam.matrix_basis.to_3x3()
    fwd, right, up = axes @ Vector((0, 0, -1)), axes @ Vector((1, 0, 0)), axes @ Vector((0, 1, 0))
    seed = sum(map(ord, cam.name)) % 7  # deterministic per camera
    loc_pts, rot_pts = [[], [], []], [[], [], []]
    for i in range(scene.frame_start - 1, scene.frame_end):
        t = i / fps
        push_in = CAM_THUMP * thump[i] * (1.0 + 2.0 * drop_pulse(i, 0.6))  # a drop hits harder
        p = base_loc + shot_offset(i) + fwd * push_in + right * (CAM_SHAKE * wobble(t, seed + 1.0)) + up * (CAM_SHAKE * wobble(t, seed + 2.3))
        jitter = 0.0 if tracked else 1.0  # a tracked camera's aim is the constraint's
        r = (
            base_rot.x + jitter * CAM_SHAKE_ROT * wobble(t, seed + 4.1),
            base_rot.y + jitter * CAM_SHAKE_ROT * 0.3 * wobble(t, seed + 5.7),
            base_rot.z + jitter * CAM_SHAKE_ROT * wobble(t, seed + 7.9),
        )
        for a in range(3):
            loc_pts[a].append((i + 1, p[a]))
            rot_pts[a].append((i + 1, r[a]))
    for a in range(3):
        fcurve_fill(cam, "location", index=a, points=loc_pts[a])
        fcurve_fill(cam, "rotation_euler", index=a, points=rot_pts[a])
print(f"cameras: {len(cameras)} cameras, per-shot moves, thump up to {CAM_THUMP * 1000:.0f} mm + handheld drift")

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
    cy = scene.cycles
    # a fast profile: few samples cleaned by the denoiser, adaptive sampling so black areas stop
    # early, short light paths (nothing here needs deep bounces), coarse volume steps, and the
    # scene kept in memory between frames instead of being rebuilt for each one
    cy.samples = 16 if args.draft else (min(args.samples, 32) if args.test else args.samples)
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.05
    cy.use_denoising = True
    cy.use_animated_seed = True  # noise moves like grain instead of sitting still on the frame
    try:
        cy.denoiser = "OPTIX"
        cy.denoising_prefilter = "ACCURATE"
    except TypeError:
        pass
    cy.max_bounces = 6
    cy.diffuse_bounces = 2
    cy.glossy_bounces = 3
    cy.transmission_bounces = 2
    cy.volume_bounces = 0
    cy.transparent_max_bounces = 4
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    cy.volume_step_rate = 2.0
    cy.volume_max_steps = 256
    cy.light_sampling_threshold = 0.05
    scene.render.use_persistent_data = True
    use_gpu_for_cycles()
else:
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = 16 if args.draft else 64
        # the volume (smoke, beams, lasers) must be computed out to the rig camera, 6 m away
        scene.eevee.volumetric_end = max(scene.eevee.volumetric_end, VOLUME_RANGE)
        scene.eevee.volumetric_samples = 96 if args.draft else 160
scene.render.resolution_percentage = 50 if (args.draft or args.test) else 100
scene.render.image_settings.file_format = "PNG"

if args.render:
    scene.render.filepath = args.out.rstrip("/\\") + "/"
    print(f"rendering {len(frames)} frames to {scene.render.filepath} ({args.engine}{' draft' if args.draft else ''})")
    bpy.ops.render.render(animation=True)
else:
    print(f"applied {len(frames)} frames of {args.drive} — no --render flag, scene left keyframed")
