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
if os.environ.get("BEAM_AUTO") == "1" and os.path.splitext(os.path.basename(bpy.data.filepath))[0] not in ("void", "void-pair"):
    n = 0  # the default beams are for the void rooms only; an explicit BEAM_RIG still works anywhere
    print("air: default beams skipped in this room")
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

# SOFT_FRONT=1: the lights aimed at the speaker front (Graze, KeyLight; twins share their data)
# become soft sources that draw no beam in the haze. As hard spots they showed as a white cone
# and a hot blob beside the speaker from side angles (Robert, 2026-11-12).
if os.environ.get("SOFT_FRONT") == "1":
    size = float(os.environ.get("SOFT_FRONT_SIZE", 0.35))
    done = []
    for name in ("Graze", "KeyLight"):
        o = bpy.data.objects.get(name)
        if o is not None and o.type == "LIGHT":
            o.data.volume_factor = 0.0
            if hasattr(o.data, "shadow_soft_size"):
                o.data.shadow_soft_size = max(o.data.shadow_soft_size, size)
            if o.data.type == "SPOT":
                o.data.spot_blend = max(o.data.spot_blend, 0.8)
            done.append(name)
    print("air: soft front lights", done)

# AMBIENT_FRONT=<watts>: no spotlights on the speakers at all (Robert, 2026-11-12). KeyLight,
# Graze, their twins and the WallWash spot are switched off, and one big soft panel in front
# and above passively lights the speaker faces and the screen. It draws nothing in the haze.
_amb = float(os.environ.get("AMBIENT_FRONT", 0))
if os.environ.get("AMBIENT_AUTO") == "1" and os.path.splitext(os.path.basename(bpy.data.filepath))[0] not in ("void", "void-pair"):
    _amb = 0  # the look's default ambient light is for the void rooms only (approved there)
    print("air: default ambient light skipped in this room")
if _amb > 0:
    from mathutils import Vector as _V
    off = []
    for o in bpy.context.scene.objects:
        if o.type == "LIGHT" and (o.name.endswith(("KeyLight", "Graze")) or o.name == "WallWash"):
            o.hide_render = True
            o.hide_viewport = True
            for _c in list(o.users_collection):  # out of the scene altogether: hide_render alone left a hot glow beside the twin
                _c.objects.unlink(o)
            off.append(o.name)
    _scope = bpy.data.objects.get("Scope")
    _cx = _scope.location.x if _scope is not None else 0.0
    _d = bpy.data.lights.new("AmbientFront", "AREA")
    _d.shape = "RECTANGLE"
    _d.size, _d.size_y = 3.0, 2.0
    _d.energy = _amb
    _d.color = tuple(float(v) for v in os.environ.get("AMBIENT_COLOR", "1.0,0.93,0.88").split(","))
    _d.volume_factor = 0.0
    _o = bpy.data.objects.new("AmbientFront", _d)
    bpy.context.scene.collection.objects.link(_o)
    _o.location = _V((_cx, -3.0, 1.3))
    _o.rotation_euler = (_V((_cx, 0.2, 0.0)) - _o.location).to_track_quat("-Z", "Y").to_euler()
    # keep it off the dust (front-lit motes turn into a snowstorm): light only what the old front
    # lights lit (LitCol) plus the LED wall
    _lit = bpy.data.collections.get("LitCol")
    _wallc = bpy.data.collections.get("LEDWall")
    if _lit is not None and hasattr(_o, "light_linking"):
        _rc = bpy.data.collections.new("AmbientCol")
        _rc.children.link(_lit)
        if _wallc is not None:
            _rc.children.link(_wallc)
        _o.light_linking.receiver_collection = _rc
    # AMBIENT_PULSE=<k>: the soft light swells with the bass (fast up, slow down, so it breathes
    # rather than flickers): energy = watts * (1 - k/2 + k * envelope). 0 = steady.
    _k = float(os.environ.get("AMBIENT_PULSE", 0))
    if _k > 0:
        import sys as _sys
        _drive = json.load(open(_sys.argv[_sys.argv.index("--") + 1], encoding="utf-8"))
        _fr = _drive["frames"]
        _sc = bpy.context.scene
        _env = 0.0
        _lo = max(0, _sc.frame_start - 48)  # run in, so the envelope is settled at the first frame
        for _f in range(_lo, _sc.frame_end + 1):
            _b = _fr[min(_f, len(_fr) - 1)].get("bass", 0.0)
            _env = _b if _b > _env else _env * 0.86 + _b * 0.14
            if _f >= _sc.frame_start:
                _d.energy = _amb * (1.0 - _k / 2 + _k * min(_env, 1.0))
                _d.keyframe_insert("energy", frame=_f)
        print("air: ambient pulse %g" % _k)
    print("air: ambient front %g W; off: %s" % (_amb, ", ".join(off)))

# WORLD_GAIN=<k>: multiplier on the world's light (the void world carries a faint studio image
# for reflections; its bright lamp mirrors in the glossy floor as a white blob from side angles).
_world_skip = os.environ.get("WORLD_AUTO") == "1" and os.path.splitext(os.path.basename(bpy.data.filepath))[0] not in ("void", "void-pair")
if os.environ.get("WORLD_GAIN") is not None and not _world_skip:
    k = float(os.environ["WORLD_GAIN"])
    w = bpy.context.scene.world
    n = 0
    if w is not None and w.node_tree is not None:
        for node in w.node_tree.nodes:
            if node.type == "BACKGROUND" and not node.inputs["Strength"].is_linked:
                node.inputs["Strength"].default_value *= k
                n += 1
    print("air: world x%g on %d background nodes" % (k, n))
