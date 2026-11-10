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

if os.environ.get("WEAR", "1") != "0":
    import speaker_wear as sw  # noqa: E402

    for name in ("CabinetMat", "PlateMat", "WooferMat", "DomeMat"):
        sw.wear(bpy.data.materials.get(name), **sw.WEAR)
    for name in ("WooferMat",):
        sw.cone_detail(bpy.data.materials.get(name), **sw.CONE)
    print("finish_test: wear applied")

if os.environ.get("VENTS", "1") != "0":
    # re-open the hero's grilles the way build_scene now does (only the hero sits at the origin)
    import json

    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "kits", "PMC6-2.json"), encoding="utf-8") as fh:
        kit = json.load(fh)
    w, h, d = (v / 1000 for v in kit["size_mm"])
    body = bpy.data.objects.get("Cabinet")
    old = bpy.data.objects.get("Vent_Cavity")
    if body is not None and old is not None and body.location.length < 1e-6:
        cav_mat = old.data.materials[0] if old.data.materials else None
        bpy.data.objects.remove(old)
        for vent in kit.get("vents", []):
            x0, x1 = vent["x0_mm"] / 1000 - w / 2, vent["x1_mm"] / 1000 - w / 2
            z0, z1 = vent["y0_mm"] / 1000 - h / 2, vent["y1_mm"] / 1000 - h / 2
            d0, d1 = (v / 1000 for v in vent["floor_mm"])
            keep = tuple(v / 1000 for v in vent["keep_mm"]) if "keep_mm" in vent else None
            cav, grille, n = sf.open_vent(body, x0, x1, z0, z1, d0, d1, -d / 2, cav_mat, "Vent_Cavity", keep)
            print(f"finish_test: {n} more grille floors opened")
            if grille is not None and os.environ.get("GRILLE_NOSHADOW") == "1":
                grille.visible_shadow = False
            if grille is not None and os.environ.get("GRILLE_NOGLOSSY") == "1":
                grille.visible_glossy = False
            for part, flag in ((grille, "HIDE_GRILLE"), (cav, "HIDE_PORT")):
                if part is not None and os.environ.get(flag) == "1":
                    part.hide_render = True
