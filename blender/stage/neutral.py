# Neutral product shot for comparing against a reference photo: studio HDRI, no show lights,
# no haze or dust, no compositor grade, front-on camera. Nothing is saved.
import math
import os

import bpy

scene = bpy.context.scene
for ob in scene.objects:
    if ob.type == "LIGHT":
        ob.hide_render = True
    if ob.name.startswith(("Smoke", "Dust", "Lyric", "Shell_", "Slate")):
        ob.hide_render = True
scene.render.film_transparent = True  # composited on white afterwards, like a product shot
for ob in scene.objects:  # only the hero and its stand
    if ob.type == "MESH" and not any(ob.name.startswith(p) for p in ("Cabinet", "Woofer", "Mid", "Tweeter", "Badge", "Logo", "Vent_", "Waveguide", "Torus", "Plane", "Sphere")):
        ob.hide_render = True
scene.use_nodes = False
try:
    scene.render.use_compositing = False
except AttributeError:
    pass
scene.view_settings.look = "None"
scene.view_settings.exposure = 0.0
world = bpy.data.worlds.new("NeutralWorld")
world.use_nodes = True
nt = world.node_tree
env = nt.nodes.new("ShaderNodeTexEnvironment")
env.image = bpy.data.images.load(r"D:\Rescue\Kingston\Users-ITSM\excursion-current\assets\cache\polyhaven\studio_small_09_2k.hdr")
bg = nt.nodes["Background"]
bg.inputs["Strength"].default_value = float(os.environ.get("HDRI_STRENGTH", "1.0"))
nt.links.new(env.outputs["Color"], bg.inputs["Color"])
scene.world = world
cam_data = bpy.data.cameras.new("NeutralCam")
cam_data.lens = 70
cam_data.dof.use_dof = False
cam = bpy.data.objects.new("NeutralCam", cam_data)
scene.collection.objects.link(cam)
yaw = math.radians(float(os.environ.get("YAW", "0")))
dist = 1.9
from mathutils import Vector  # noqa: E402

cab = bpy.data.objects["Cabinet"]
centre = sum((cab.matrix_world @ Vector(c) for c in cab.bound_box), Vector()) / 8
cam.location = centre + Vector((-dist * math.sin(yaw), -dist * math.cos(yaw), 0.0))
cam.rotation_euler = (math.radians(90), 0, -yaw)
for m in scene.timeline_markers:
    m.camera = None
scene.camera = cam
scene.render.resolution_x = 1200
scene.render.resolution_y = 1100
scene.cycles.samples = 48
print("neutral: set up")

# NEUTRAL_TOP=<watts>: a product-photo softbox in front of the speaker, ~22 degrees above the
# lens axis (the reference photo's light, measured from its dome highlight and channel shading)
if os.environ.get("NEUTRAL_TOP"):
    ld = bpy.data.lights.new("NeutralSoftbox", "AREA")
    ld.shape = "SQUARE"
    ld.size = 1.4
    ld.energy = float(os.environ["NEUTRAL_TOP"])
    lo = bpy.data.objects.new("NeutralSoftbox", ld)
    scene.collection.objects.link(lo)
    el = math.radians(22)
    lo.location = centre + Vector((0.0, -1.6 * math.cos(el), 1.6 * math.sin(el)))
    lo.rotation_euler = (centre - lo.location).to_track_quat("-Z", "Y").to_euler()
    print("neutral: softbox", ld.energy)
