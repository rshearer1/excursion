# Laser test: thin beams through the haze, for judging how well the air carries a beam.
# Run after apply_drive.py. Off unless LASERS=<count> is set; nothing is saved.
#   LASERS        how many beams (0 = none)
#   LASER_COLOR   "r,g,b" (default classic green 0.15,1.0,0.25)
#   LASER_POWER   watts per beam (default 2500)
#   LASER_FAN     total fan width in metres where the beams land (default 2.4)
# The beams start above and behind the LED wall and fan forward over the speaker toward the
# camera side: haze scatters light mostly forward (a hazer's ~1 micron droplets), so a beam
# is brightest when it travels toward the lens.
import math
import os

import bpy
from mathutils import Vector

n = int(os.environ.get("LASERS", 0))
if n > 0:
    scene = bpy.context.scene
    color = tuple(float(v) for v in os.environ.get("LASER_COLOR", "0.15,1.0,0.25").split(","))
    power = float(os.environ.get("LASER_POWER", 2500))
    fan = float(os.environ.get("LASER_FAN", 2.4))
    wall = bpy.data.objects.get("Scope")
    cx = wall.location.x if wall is not None else 0.0
    src = Vector((cx, 1.05, 1.25))
    for j in range(n):
        t = (j / (n - 1) - 0.5) if n > 1 else 0.0
        aim = Vector((cx + t * fan, -2.6, -0.75))
        data = bpy.data.lights.new(f"TestLaser_{j}", "SPOT")
        # note: Blender spot cones cannot go below 1 degree, so the beam fades with distance (1/r);
        # moving the lamp far back to fake a collimated beam just gives a wide wash (tried 2026-11-11)
        data.energy = power
        data.color = color
        data.spot_size = math.radians(1.0)
        data.spot_blend = 0.0
        data.shadow_soft_size = 0.0
        data.volume_factor = 6.0
        ob = bpy.data.objects.new(f"TestLaser_{j}", data)
        scene.collection.objects.link(ob)
        ob.location = src
        ob.rotation_euler = (aim - src).to_track_quat("-Z", "Y").to_euler()
    print(f"laser test: {n} beams, {power:.0f} W, fan {fan} m")
