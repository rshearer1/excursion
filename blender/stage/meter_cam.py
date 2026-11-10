# Meter-wall test camera: run after wall_test.py / photo_test.py, before wave_test.py.
# Adds one locked-off camera that frames the speaker with the whole LED wall behind it and
# makes it the only camera (timeline camera switches are unbound for this test).
# Env: MC_LOC "x,y,z", MC_AIM "x,y,z", MC_LENS (mm, horizontal 36 mm sensor), MC_FSTOP.
import bpy, os, json
from mathutils import Vector

scene = bpy.context.scene


def vec(name, default):
    return Vector(float(x) for x in os.environ.get(name, default).split(","))


loc = vec("MC_LOC", "0.35,-2.7,0.0")
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
