# Air and dust trims for look tests, run after apply_drive.py (before wave_test.py renders).
# All default to 1 (no change), so the locked look is untouched unless a value is given:
#   AIR_HAZE     multiplier on the even haze (what light beams are drawn in)
#   AIR_DENSITY  multiplier on the smoke clumps
#   AIR_DUST     multiplier on the dust backlight (how brightly the motes sparkle)
# Values are scaled where they are static and on every keyframe where apply_drive keyed them.
# Nothing is saved.
import json
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
