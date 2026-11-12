# Air and dust trims for look tests, run after apply_drive.py (before wave_test.py renders).
# All default to 1 (no change), so the locked look is untouched unless a value is given:
#   AIR_HAZE     multiplier on the even haze (what light beams are drawn in)
#   AIR_DENSITY  multiplier on the smoke clumps
#   AIR_DUST     multiplier on the dust backlight (how brightly the motes sparkle)
# Values are scaled where they are static and on every keyframe where apply_drive keyed them.
# Nothing is saved.
import json
import math
import os

import bpy

log = {}


def fcurves_of(id_data):
    ad = getattr(id_data, "animation_data", None)
    if not ad or not ad.action:
        return []
    out = list(getattr(ad.action, "fcurves", []) or [])
    if not out:
        for layer in ad.action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    out += list(bag.fcurves)
    return out


def scale_curve(id_data, data_path, k):
    n = 0
    for fc in fcurves_of(id_data):
        if fc.data_path == data_path:
            for kp in fc.keyframe_points:
                kp.co[1] *= k
                kp.handle_left[1] *= k
                kp.handle_right[1] *= k
            fc.update()
            n += 1
    return n


def smoke_input(mod, name):
    tree = mod.node_group
    if tree is None:
        return None
    for item in tree.interface.items_tree:
        if getattr(item, "in_out", None) == "INPUT" and item.name == name:
            return item.identifier
    return None


smoke = bpy.data.objects.get("Smoke")
mod = smoke.modifiers.get("Smoke") if smoke is not None else None
for env, name in (("AIR_HAZE", "Haze"), ("AIR_DENSITY", "Density")):
    k = float(os.environ.get(env, 1.0))
    if k == 1.0 or mod is None:
        continue
    ident = smoke_input(mod, name)
    if ident is None:
        log[name] = "no such smoke input"
        continue
    if hasattr(mod, "properties"):  # Blender 5: as apply_drive.smoke_control does
        slot = getattr(mod.properties.inputs, ident)
        slot.value *= k
        path = f'modifiers["Smoke"].properties.inputs.{ident}.value'
    else:
        mod[ident] = mod[ident] * k
        path = f'modifiers["Smoke"]["{ident}"]'
    log[name] = {"gain": k, "keyed_curves": scale_curve(smoke, path, k)}

k = float(os.environ.get("AIR_DUST", 1.0))
back = bpy.data.objects.get("DustBack")
if k != 1.0 and back is not None:
    back.data.energy *= k
    log["DustBack"] = {"gain": k, "keyed_curves": scale_curve(back.data, "energy", k)}

print("air:", json.dumps(log))

# AIR_BEAMS: multiplier on how strongly every spot light shows in the haze (its volume factor).
# The rig's spots are set low (0.3-0.35) so the room stays dark; rave beams need 1 or more.
k = float(os.environ.get("AIR_BEAMS", 1.0))
if k != 1.0:
    spots = [o for o in bpy.context.scene.objects if o.type == "LIGHT" and o.data.type == "SPOT" and not o.name.startswith("DustBack")]
    for o in spots:
        o.data.volume_factor *= k
    print("air: beams x%g on %d spots: %s" % (k, len(spots), ", ".join("%s %.0fdeg vol %.2f" % (o.name, math.degrees(o.data.spot_size), o.data.volume_factor) for o in spots)))

# BEAM_RIG=<count>: narrow hard-edged beams from a bar above and behind the LED wall, fanned
# toward the camera side (a rave back-truss). Test only; colour follows the TopBack light.
n = int(os.environ.get("BEAM_RIG", 0))
if n > 0:
    from mathutils import Vector
    scene = bpy.context.scene
    ref = bpy.data.objects.get("TopBack")
    wall = bpy.data.objects.get("Scope")
    cx = wall.location.x if wall is not None else 0.0
    watts = float(os.environ.get("BEAM_POWER", 900))
    cone = float(os.environ.get("BEAM_CONE", 7))
    aim_z = float(os.environ.get("BEAM_AIM_Z", -0.6))  # raise to send the beams over the speakers
    # BEAM_COLORS="r,g,b;r,g,b": fixed colours, alternated along the bar (else: follow the back light)
    fixed = [tuple(float(v) for v in c.split(",")) for c in os.environ.get("BEAM_COLORS", "").split(";") if c.strip()]
    for j in range(n):
        t = (j / (n - 1) - 0.5) if n > 1 else 0.0
        src = Vector((cx + t * 2.2, 1.0, 1.35))
        aim = Vector((cx + t * 4.5, -2.6, aim_z))
        data = bpy.data.lights.new(f"TestBeam_{j}", "SPOT")
        data.energy = watts
        data.color = tuple(ref.data.color) if ref is not None else (0.6, 0.3, 1.0)
        data.spot_size = math.radians(cone)
        data.spot_blend = 0.15
        data.shadow_soft_size = 0.01
        data.volume_factor = 2.0
        ob = bpy.data.objects.new(f"TestBeam_{j}", data)
        scene.collection.objects.link(ob)
        ob.location = src
        ob.rotation_euler = (aim - src).to_track_quat("-Z", "Y").to_euler()
        if fixed:
            data.color = fixed[j % len(fixed)]
        elif ref is not None and ref.data.animation_data and ref.data.animation_data.action:
            data.animation_data_create()
            data.animation_data.action = ref.data.animation_data.action  # colour and level follow the back light's cues
            data.energy = watts
    # BEAM_MOVE=1: the beams sweep in time with the track (one sweep every 2 bars, neighbours
    # mirrored) and pulse with the bass. Keyed on every frame of the scene range.
    if os.environ.get("BEAM_MOVE") == "1":
        import sys
        drive = json.load(open(sys.argv[sys.argv.index("--") + 1], encoding="utf-8"))
        fps = drive["fps"]
        bar_s = 60.0 / drive["grid"]["bpm"] * drive["grid"].get("beatsPerBar", 4)
        frames = drive["frames"]
        swing = float(os.environ.get("BEAM_SWING", 1.3))
        for j in range(n):
            ob = bpy.data.objects[f"TestBeam_{j}"]
            ob.data.animation_data_clear()
            t = (j / (n - 1) - 0.5) if n > 1 else 0.0
            side = 1.0 if j % 2 == 0 else -1.0
            for f in range(scene.frame_start, scene.frame_end + 1):
                ph = 2 * math.pi * (f / fps) / (bar_s * 2) + j * 0.5
                aim = Vector((cx + t * 4.5 + side * math.sin(ph) * swing, -2.6, aim_z + math.cos(ph * 2) * 0.35))
                ob.rotation_euler = (aim - ob.location).to_track_quat("-Z", "Y").to_euler()
                ob.keyframe_insert("rotation_euler", frame=f)
                bass = frames[min(f, len(frames) - 1)].get("bass", 0.0)
                ob.data.energy = watts * (0.45 + 0.9 * bass)
                ob.data.keyframe_insert("energy", frame=f)
        print("air: beams move, %d frames keyed" % (scene.frame_end - scene.frame_start + 1))
    print("air: beam rig %d beams, %g W, %g deg" % (n, watts, cone))

# AIR_VEIL: multiplier on how much the lights aimed AT the speaker (Graze, KeyLight) light the
# haze in front of it. That lit haze is a milky veil over the speaker; 0 removes it while the
# speaker itself stays lit the same.
if os.environ.get("AIR_VEIL") is not None:
    k = float(os.environ["AIR_VEIL"])
    for name in os.environ.get("AIR_VEIL_LIGHTS", "Graze,KeyLight").split(","):
        o = bpy.data.objects.get(name)
        if o is not None and o.type == "LIGHT":
            o.data.volume_factor *= k
    print("air: veil x%g on %s" % (k, os.environ.get("AIR_VEIL_LIGHTS", "Graze,KeyLight")))
