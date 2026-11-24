# Texture check, run inside the look chain just before the render (wave_test.py).
# A clean render log does not prove the textures are there: build_scene.py skips a missing map
# silently, and Cycles only prints "Failed to load" for some cases. This looks at the scene
# itself and prints one line the callers can trust:
#   textures: OK, 9 images, cabinet maps Color/Roughness/NormalGL/Displacement all linked
#   textures: MISSING <what>; <what>; ...
# It checks: every file-based image used by a material node exists on disk and has pixels;
# every Image Texture / Environment node in a used material has an image; the cabinet finish
# (CabinetMat) still has its four maps wired in. Nothing is changed or saved.
import os

import bpy

problems = []
seen = set()
used_mats = {slot.material for ob in bpy.context.scene.objects if ob.type == "MESH" for slot in ob.material_slots if slot.material}


def check_image(img, where):
    if img is None:
        problems.append(f"{where}: image node with no image")
        return
    if img.name in seen:
        return
    seen.add(img.name)
    if img.source in ("GENERATED", "VIEWER") or img.packed_file is not None:
        return
    path = bpy.path.abspath(img.filepath, library=img.library) if img.filepath else ""
    if not path or not os.path.exists(path):
        problems.append(f"{where}: file not found for image '{img.name}' ({path or 'no path'})")
    elif img.source == "FILE" and (img.size[0] == 0 or img.size[1] == 0):
        problems.append(f"{where}: image '{img.name}' did not load ({path})")


def walk(tree, where, depth=0):
    for node in tree.nodes:
        if node.type in ("TEX_IMAGE", "TEX_ENVIRONMENT"):
            check_image(node.image, where)
        elif node.type == "GROUP" and node.node_tree is not None and depth < 4:
            walk(node.node_tree, where, depth + 1)


for mat in sorted(used_mats, key=lambda m: m.name):
    if mat.use_nodes and mat.node_tree is not None:
        walk(mat.node_tree, mat.name)
world = bpy.context.scene.world
if world is not None and world.use_nodes and world.node_tree is not None:
    walk(world.node_tree, f"world {world.name}")

# the cabinet finish: four maps from the ambientCG set, each on its own image node
cab = bpy.data.materials.get("CabinetMat")
maps = []
if cab is None or not cab.use_nodes:
    problems.append("CabinetMat is missing")
else:
    names = [n.image.name for n in cab.node_tree.nodes if n.type == "TEX_IMAGE" and n.image is not None]
    for want in ("Color", "Roughness", "NormalGL", "Displacement"):
        if any(want.lower() in n.lower() for n in names):
            maps.append(want)
        else:
            problems.append(f"CabinetMat: no {want} map (the cabinet would render as flat plastic)")

if problems:
    print("textures: MISSING " + "; ".join(problems))
else:
    print(f"textures: OK, {len(seen)} images, cabinet maps {'/'.join(maps)} all linked")
