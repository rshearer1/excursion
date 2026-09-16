# Excursion — look variants for design-stage stills.
#
#   blender -b blender/scenes/void.blend -P blender/apply_drive.py -P blender/looksheet.py \
#       -o out/looksheet/<variant>_#### -F PNG -f 700 -- <drive.json> --engine cycles
#   with the variant chosen by the LOOK_VARIANT environment variable.
#
# Runs after apply_drive has keyed everything, and overrides lights / haze / grade for one
# frame so a handful of directions can be compared on one contact sheet (see the loop in
# HOME.md). Nothing here is saved to the .blend.
import os

import bpy

variant = os.environ.get("LOOK_VARIANT", "current")
scene = bpy.context.scene

# LOOK_CAMERA=<name> renders the still from that camera whatever the cuts say
cam_name = os.environ.get("LOOK_CAMERA")
if cam_name:
    cam = bpy.data.objects.get(cam_name)
    if cam is None:
        print(f"looksheet: no camera {cam_name!r}")
    else:
        for m in scene.timeline_markers:
            m.camera = None
        scene.camera = cam


def light(name):
    o = bpy.data.objects.get(name)
    return o.data if o is not None else None


def set_light(name, energy=None, color=None, radius=None):
    d = light(name)
    if d is None:
        return
    d.animation_data_clear()  # the still gets a fixed value, not apply_drive's keyed one
    if energy is not None:
        d.energy = energy
    if color is not None:
        d.color = color
    if radius is not None:
        d.shadow_soft_size = radius


def haze(mult):
    smoke = bpy.data.objects.get("Smoke")
    mod = smoke.modifiers.get("Smoke") if smoke else None
    if mod is not None and mod.node_group is not None:  # grid smoke: a modifier input
        ident = next(i.identifier for i in mod.node_group.interface.items_tree if i.item_type == "SOCKET" and i.name == "Haze")
        slot = getattr(mod.properties.inputs, ident)
        slot.value *= mult
        return
    nt = bpy.data.materials["SmokeMat"].node_tree
    node = nt.nodes.get("Haze")
    if node is not None:
        node.outputs[0].default_value *= mult


def lasers(mult):
    for o in bpy.data.objects:
        if o.type == "LIGHT" and o.name.startswith("Laser_"):
            o.data.animation_data_clear()
            o.data.energy *= mult


def exposure(delta):
    scene.view_settings.exposure += delta


if variant == "current":
    pass
elif variant == "cool-rims":
    # complementary: warm key against cool blue rims instead of dark red
    for n in ("RimLeft", "RimRight", "TopBack"):
        set_light(n, color=(0.4, 0.6, 1.0))
    for o in bpy.data.objects:
        if o.name.startswith("WallUp_"):
            set_light(o.name, color=(0.4, 0.6, 1.0))
    lasers(0.0)
elif variant == "hard-key":
    # one small hard source, deep shadows; nothing else in front
    set_light("KeyLight", energy=700, radius=0.004)
    set_light("Graze", energy=0)
    set_light("RimLeft", energy=120)
    set_light("RimRight", energy=100)
elif variant == "soft-key":
    # a big soft key from the side, gentle wrap, low contrast
    set_light("KeyLight", energy=420, radius=0.45)
    set_light("Graze", energy=60, radius=0.3)
elif variant == "rays":
    # thick haze, the beams and lasers do the drawing
    haze(3.5)
    lasers(2.5)
    set_light("TopBack", energy=1400)
elif variant == "mono-warm":
    # no red at all: warm key + backlight only, near monochrome
    for n in ("RimLeft", "RimRight", "TopBack"):
        set_light(n, energy=0)
    for o in bpy.data.objects:
        if o.name.startswith("WallUp_"):
            set_light(o.name, energy=0)
    lasers(0.0)
    set_light("DustBack", energy=220)
elif variant == "brighter":
    exposure(0.7)
else:
    print(f"looksheet: unknown variant {variant!r}")
print(f"looksheet: variant {variant}")
