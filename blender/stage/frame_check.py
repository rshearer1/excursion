# Framing check, no render: where the speakers' key points land in the frame for a camera.
#   blender -b blender/scenes/void-pair.blend -P blender/stage/frame_check.py -- "loc;aim;lens" ...
# loc and aim are "x,y,z" in metres, lens in mm (36 mm sensor across the 1080 px width, as
# meter_cam.py). Prints each point as (x, y) in frame fractions from the top-left corner:
# thirds lines are at 0.33 and 0.67; outside 0..1 is out of frame.
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

scene = bpy.context.scene
scene.render.resolution_x, scene.render.resolution_y = 1080, 1920
dg = bpy.context.evaluated_depsgraph_get()


def centre(name):
    o = bpy.data.objects.get(name)
    if o is None:
        return None
    e = o.evaluated_get(dg)
    return sum((e.matrix_world @ Vector(c) for c in e.bound_box), Vector()) / 8


def corners(name):
    o = bpy.data.objects.get(name)
    if o is None:
        return []
    e = o.evaluated_get(dg)
    return [e.matrix_world @ Vector(c) for c in e.bound_box]


for spec in sys.argv[sys.argv.index("--") + 1:]:
    loc, aim, lens = spec.split(";")
    loc = Vector(float(v) for v in loc.split(","))
    aim = Vector(float(v) for v in aim.split(","))
    cd = bpy.data.cameras.new("FrameCheck")
    cd.sensor_fit, cd.sensor_width, cd.lens = "HORIZONTAL", 36.0, float(lens)
    cam = bpy.data.objects.new("FrameCheck", cd)
    scene.collection.objects.link(cam)
    cam.location = loc
    cam.rotation_euler = (aim - loc).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()

    def uv(p):
        v = world_to_camera_view(scene, cam, p)
        return (round(v.x, 2), round(1 - v.y, 2)) if v.z > 0 else ("behind", "behind")

    print("FRAME cam %s" % spec)
    for prefix, label in (("", "left speaker"), ("PairR_", "right speaker")):
        box = [uv(p) for p in corners(prefix + "Cabinet")]
        xs = [b[0] for b in box if b[0] != "behind"]
        ys = [b[1] for b in box if b[1] != "behind"]
        if xs:
            print("FRAME   %-13s cabinet x %.2f..%.2f  y %.2f..%.2f" % (label, min(xs), max(xs), min(ys), max(ys)))
        for part in ("Woofer_L", "Woofer_R", "Mid", "Tweeter", "Logo"):
            c = centre(prefix + part)
            if c is not None:
                print("FRAME     %-9s %s" % (part, uv(c)))
    wall = corners("Scope")
    if wall:
        box = [uv(p) for p in wall]
        xs = [b[0] for b in box if b[0] != "behind"]
        ys = [b[1] for b in box if b[1] != "behind"]
        if xs:
            print("FRAME   screen        x %.2f..%.2f  y %.2f..%.2f" % (min(xs), max(xs), min(ys), max(ys)))
    bpy.data.objects.remove(cam)
