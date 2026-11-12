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
    beam_r = float(os.environ.get("LASER_WIDTH", 0.004))  # metres, beam radius
    glow = float(os.environ.get("LASER_GLOW", 60.0))
    beam_mat = bpy.data.materials.new("TestLaserBeamMat")
    beam_mat.use_nodes = True
    nt = beam_mat.node_tree
    for node in list(nt.nodes):
        if node.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(node)
    out = next(node for node in nt.nodes if node.type == "OUTPUT_MATERIAL")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*color, 1.0)
    em.inputs["Strength"].default_value = glow
    nt.links.new(em.outputs[0], out.inputs["Volume"])  # a glowing volume: soft-edged, see-through, no hard rod look
    dg = bpy.context.evaluated_depsgraph_get()
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
        # the visible beam: a real laser is collimated, so it is as bright at the far end as at the
        # start. A thin glowing rod from the source to the first thing it hits gives that; the spot
        # light above (dimmed) only makes the dot where it lands and a little spill in the haze.
        d = (aim - src).normalized()
        hit, loc, _n, _i, _o, _m = scene.ray_cast(dg, src + d * 0.05, d, distance=12.0)
        length = (loc - src).length if hit else 12.0
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=beam_r, depth=length, location=src + d * (length / 2))
        rod = bpy.context.object
        rod.name = f"TestLaserBeam_{j}"
        rod.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
        rod.data.materials.append(beam_mat)
        rod.visible_shadow = False
        data.energy = power * 0.25
    print(f"laser test: {n} beams, {power:.0f} W, fan {fan} m")
