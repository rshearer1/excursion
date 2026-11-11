# Meter-wall test camera: run after wall_test.py / photo_test.py, before wave_test.py.
# Adds one locked-off camera that frames the speaker with the whole LED wall behind it and
# makes it the only camera (timeline camera switches are unbound for this test).
# Env: MC_LOC "x,y,z", MC_AIM "x,y,z", MC_LENS (mm, horizontal 36 mm sensor), MC_FSTOP.
import bpy, os, json
from mathutils import Vector

scene = bpy.context.scene


def vec(name, default):
    return Vector(float(x) for x in os.environ.get(name, default).split(","))


loc = vec("MC_LOC", "0.18,-1.3,0.02")  # 1.3 m back: the speaker fills the frame, the wall crops at the sides (Robert, 2026-11-11)
aim = vec("MC_AIM", "0.0,0.6,0.1")
cd = bpy.data.cameras.new("MeterCam")
cd.sensor_fit = "HORIZONTAL"
cd.sensor_width = 36.0
cd.lens = float(os.environ.get("MC_LENS", 40))
cd.clip_start = 0.05
cam = bpy.data.objects.new("MeterCam", cd)
scene.collection.objects.link(cam)
cam.location = loc
cam.rotation_euler = (aim - loc).to_track_quat("-Z", "Y").to_euler()

# focus on the speaker so the wall sits just soft behind it, like a real stage shot
hero = next((o for o in scene.objects if o.type == "MESH" and o.name.lower().startswith(("body", "speaker", "pmc"))), None)
cd.dof.use_dof = True
cd.dof.aperture_fstop = float(os.environ.get("MC_FSTOP", 4.0))
cd.dof.focus_distance = (Vector(hero.matrix_world.translation) - loc).length if hero else (Vector((0, 0, 0)) - loc).length

for mk in scene.timeline_markers:
    mk.camera = None
scene.camera = cam
print("mc:", json.dumps({"loc": list(loc), "aim": list(aim), "lens": cd.lens, "focus": round(cd.dof.focus_distance, 2), "hero": hero.name if hero else None, "res": [scene.render.resolution_x, scene.render.resolution_y]}))

# The wide meter shot looks straight at the key-lit front, which the soft key turns grey; the
# show cameras see it at an angle. Scale the key (static value and its bass-driven keys) here only.
KEY_GAIN = float(os.environ.get("MC_KEY_GAIN", 0.2))  # Robert, 2026-11-11: 0.1 with haze looked washed out; 0.2 with the back light down sits in
key = bpy.data.objects.get("KeyLight")
if key is not None and KEY_GAIN != 1.0:
    key.data.energy *= KEY_GAIN
    ad = key.data.animation_data
    curves = list(getattr(ad.action, "fcurves", []) or []) if ad and ad.action else []
    if ad and ad.action and not curves:
        for layer in ad.action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    curves += list(bag.fcurves)
    for fc in curves:
        if fc.data_path == "energy":
            for k in fc.keyframe_points:
                k.co[1] *= KEY_GAIN
                k.handle_left[1] *= KEY_GAIN
                k.handle_right[1] *= KEY_GAIN
            fc.update()
    print("mc: key gain", KEY_GAIN, "keyed curves", len([c for c in curves if c.data_path == "energy"]))
