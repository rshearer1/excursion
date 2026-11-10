# Excursion — apply speaker_finish to an already-built scene for a before/after still.
#
#   blender -b blender/scenes/void.blend -P blender/apply_drive.py -P blender/finish_test.py \
#       -P blender/looksheet.py -o out/finish/after_#### -F PNG -f 700 -- <drive.json> --engine cycles
#
# Nothing is saved to the .blend; rebuilding the scene with build_scene.py bakes the same finish in.
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import speaker_finish as sf  # noqa: E402

if os.environ.get("FINISH", "1") != "0":
    sf.drop_hex_bump(bpy.data.materials.get("PlateMat"))
    sf.finish(bpy.data.materials.get("PlateMat"), **sf.PLATE)
    sf.exaggerate_relief(bpy.data.materials.get("PlateMat"), **sf.RELIEF)
    sf.finish(bpy.data.materials.get("CabinetMat"), **sf.CABINET)
    for name in ("WooferMat", "DomeMat"):
        sf.finish(bpy.data.materials.get(name), **sf.DRIVER)
    print("finish_test: speaker finish applied")
