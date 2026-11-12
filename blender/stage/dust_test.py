# Dust trims for look tests, run after apply_drive.py. Each is off unless its variable is set,
# so the saved look is untouched. Nothing is saved.
#   DUST_LINT=<0..1>     fraction of motes that are lint (the squiggly flecks); the scene has 0.07
#   DUST_COLOR="r,g,b"   colour of the dust backlight (the scene's is warm, 1.0,0.9,0.78)
#   DUST_NEAR=<metres>   adds a second copy of the dust field shifted this far toward the camera,
#                        so a few motes float close to the lens and blur into soft discs
#   DUST_NEAR_SIZE=<k>   radius multiplier for the near copy (default 1)
#   DUST_NEAR_COUNT=<n>  how many motes in the near copy (default: as many as the main field; 12000 x4 size was a snowstorm)
import os

import bpy

log = {}
dust = bpy.data.objects.get("Dust")
group = bpy.data.node_groups.get("DustField")

if os.environ.get("DUST_LINT") is not None and group is not None:
    k = float(os.environ["DUST_LINT"])
    hits = 0
    for node in group.nodes:  # the lint switch: a LESS_THAN compare node whose threshold is DUST_LINT (0.07)
        if node.bl_idname == "FunctionNodeCompare" and node.operation == "LESS_THAN" and abs(node.inputs[1].default_value - 0.07) < 1e-6 and not node.inputs[1].is_linked:
            node.inputs[1].default_value = k
            hits += 1
    log["lint"] = {"value": k, "nodes": hits}

if os.environ.get("DUST_COLOR"):
    back = bpy.data.objects.get("DustBack")
    if back is not None:
        back.data.color = tuple(float(v) for v in os.environ["DUST_COLOR"].split(","))
        log["color"] = list(back.data.color)

near = float(os.environ.get("DUST_NEAR", 0))
if os.environ.get("DUST_AUTO") == "1" and os.path.splitext(os.path.basename(bpy.data.filepath))[0] not in ("void", "void-pair"):
    near = 0  # the look's default near motes are placed for the void cameras only
    log["near"] = "default skipped in this room"
if near > 0 and dust is not None:
    twin = dust.copy()
    twin.name = "DustNear"
    for col in dust.users_collection:
        col.objects.link(twin)
    twin.location.y -= near
    twin.location.x += 0.137  # so the copy is not the same pattern straight in front of the original
    twin.location.z += 0.091
    size = float(os.environ.get("DUST_NEAR_SIZE", 1.0))
    count = int(os.environ.get("DUST_NEAR_COUNT", 0))  # 0 = as many as the main field
    if (size != 1.0 or count > 0) and group is not None:
        import math
        big = group.copy()  # own node group so only the near copy changes
        big.name = "DustFieldNear"
        grown = 0
        if count > 0:
            for node in big.nodes:
                sock = node.inputs.get("Count") if hasattr(node, "inputs") else None
                if sock is not None and not sock.is_linked and sock.default_value > 1000:
                    sock.default_value = count
                    log["near_count"] = count
        for node in big.nodes:  # the log-normal radius: a random value between log(r_min) and log(r_max)
            if node.bl_idname == "FunctionNodeRandomValue" and "Min" in node.inputs and "Max" in node.inputs:
                for sock in (s for s in node.inputs if s.name in ("Min", "Max") and s.type == "VALUE"):
                    if -12.0 < sock.default_value < -5.0:  # log of 6 micron .. 7 mm: only the radius node
                        sock.default_value += math.log(size)
                        grown += 1
        twin.modifiers["Dust"].node_group = big
        log["near_size"] = {"x": size, "sockets": grown}
    log["near"] = {"shift_m": near, "collections": [c.name for c in twin.users_collection]}

print("dust:", log)
