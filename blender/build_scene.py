# Excursion — placeholder "void" scene builder (phase 2).
# Run once:  blender -b -P blender/build_scene.py
# Creates scenes/void.blend with the kit-contract object names the pipeline binds to:
#   Cabinet, Woofer_L, Woofer_R (shape key "Excursion"), Tweeter, Slate.
# Uses the fetched studio HDRI if assets/cache has it; falls back to a dark world.

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
HDRI = os.path.join(ROOT, "assets", "cache", "polyhaven", "studio_small_09_2k.hdr")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
try:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
except TypeError:
    scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1080
scene.render.resolution_y = 1920
scene.render.fps = 30


def make_material(name, base=(0.015, 0.015, 0.017, 1), rough=0.55, emission=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = base
    bsdf.inputs["Roughness"].default_value = rough
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = 0.0
    return m


def assign(obj, material):
    obj.data.materials.append(material)


# cabinet ---------------------------------------------------------------
bpy.ops.mesh.primitive_cube_add(location=(0, 0, 0))
cabinet = bpy.context.object
cabinet.name = "Cabinet"
cabinet.dimensions = (0.30, 0.24, 0.55)
bevel = cabinet.modifiers.new("Bevel", "BEVEL")
bevel.width = 0.008
bevel.segments = 3
assign(cabinet, make_material("CabinetMat", rough=0.5))

# woofers (stacked on the right, like the reference monitor) ------------
woofer_mat = make_material("WooferMat", base=(0.01, 0.01, 0.01, 1), rough=0.8)
for name, z in (("Woofer_L", 0.05), ("Woofer_R", -0.13)):
    bpy.ops.mesh.primitive_cylinder_add(
        radius=0.085, depth=0.02, location=(0.06, -0.125, z), rotation=(math.pi / 2, 0, 0)
    )
    woofer = bpy.context.object
    woofer.name = name
    assign(woofer, woofer_mat)
    woofer.shape_key_add(name="Basis")
    key = woofer.shape_key_add(name="Excursion")
    for v in key.data:
        v.co.z += 0.006  # local +Z is world -Y after the rotation: toward the camera

# tweeter ---------------------------------------------------------------
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.028, location=(-0.07, -0.125, 0.16))
tweeter = bpy.context.object
tweeter.name = "Tweeter"
assign(tweeter, make_material("TweeterMat", base=(0.02, 0.02, 0.02, 1), emission=(0.9, 0.95, 1.0, 1)))

# sync slate — a flat panel that flashes on beats (the phase-2 proof) ---
bpy.ops.mesh.primitive_plane_add(size=0.5, location=(0, 0.05, 0.48), rotation=(math.pi / 2, 0, 0))
slate = bpy.context.object
slate.name = "Slate"
assign(slate, make_material("SlateMat", base=(0, 0, 0, 1), emission=(1.0, 0.55, 0.18, 1)))

# camera ----------------------------------------------------------------
bpy.ops.object.camera_add(location=(0, -1.05, 0.03), rotation=(math.pi / 2, 0, 0))
cam = bpy.context.object
cam.name = "Camera"
cam.data.lens = 60
scene.camera = cam

# lights ----------------------------------------------------------------
bpy.ops.object.light_add(type="AREA", location=(0.7, -0.7, 0.7))
key_light = bpy.context.object
key_light.name = "KeyLight"
key_light.data.energy = 120
key_light.rotation_euler = (math.radians(55), 0, math.radians(45))

bpy.ops.object.light_add(type="AREA", location=(-0.8, 0.4, 0.4))
rim = bpy.context.object
rim.name = "RimLight"
rim.data.energy = 60
rim.data.color = (0.55, 0.85, 0.9)
rim.rotation_euler = (math.radians(70), 0, math.radians(-130))

# world -----------------------------------------------------------------
world = bpy.data.worlds.new("VoidWorld")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
if os.path.exists(HDRI):
    env = world.node_tree.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(HDRI)
    world.node_tree.links.new(env.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.25
else:
    bg.inputs["Color"].default_value = (0.004, 0.005, 0.006, 1)
    print("note: HDRI not found — run: node scripts/fetch-assets.mjs blender/scenes/void.manifest.json")

out = os.path.join(HERE, "scenes", "void.blend")
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
print(f"saved {out}")
