# Excursion — the live frame server (phase 12): one Blender process that stays open and
# renders small EEVEE frames on request, so the desk in the grid tool can scrub and see the
# true look in about a second instead of paying Blender's start-up for every frame.
#
#   blender -b -P blender/live_server.py
#
# Reads one JSON object per line on stdin:
#   {"drive": "<path to drive.json>", "frame": 931, "out": "<png path>", "scene": "void",
#    "mood": "crimson", "percent": 25}
# and answers one line per request on stdout: {"ok": true, "out": ..., "ms": 1234} or
# {"ok": false, "error": "..."}. The scene is reopened and the drive re-applied only when the
# drive file's content, the scene or the mood changed since the last request; a scrub on the
# same drive is just a frame change and a render. The helper (grid-tool/server/render.ts) owns
# the process and serialises requests.
import hashlib
import json
import os
import sys
import time
import traceback

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
APPLY = os.path.join(HERE, "apply_drive.py")
LOG = open(os.path.join(HERE, "live_server.log"), "a", encoding="utf-8")
state = {"key": None}


def say(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def bind(req):
    scene_name = req.get("scene") or "void"
    blend = os.path.join(HERE, "scenes", f"{scene_name}.blend")
    if not os.path.exists(blend):
        raise FileNotFoundError(f"no scene {scene_name}")
    bpy.ops.wm.open_mainfile(filepath=blend)
    argv = [req["drive"], "--engine", "eevee", "--draft"]
    if req.get("mood"):
        argv += ["--mood", req["mood"]]
    sys.argv = ["blender", "--"] + argv
    code = compile(open(APPLY, encoding="utf-8").read(), APPLY, "exec")
    exec(code, {"__name__": "__main__", "__file__": APPLY})  # apply_drive is a script, not a module


def handle(req):
    t0 = time.time()
    with open(req["drive"], "rb") as fh:
        digest = hashlib.sha1(fh.read()).hexdigest()
    blend = os.path.join(HERE, "scenes", f"{req.get('scene') or 'void'}.blend")
    built = os.path.getmtime(blend) if os.path.exists(blend) else 0  # a rebuilt room reopens
    key = (digest, req.get("scene") or "void", req.get("mood") or "", built)
    rebound = key != state["key"]
    if rebound:
        bind(req)
        state["key"] = key
    scene = bpy.context.scene
    scene.render.resolution_percentage = int(req.get("percent", 25))
    # a live frame is a look check, not a render: few samples, no motion blur
    scene.eevee.taa_render_samples = 8
    scene.eevee.volumetric_samples = 32
    scene.render.use_motion_blur = False
    scene.frame_set(max(scene.frame_start, min(scene.frame_end, int(req["frame"]))))
    scene.render.filepath = req["out"]
    bpy.ops.render.render(write_still=True)
    return {"ok": True, "out": req["out"], "frame": scene.frame_current, "rebound": rebound, "ms": int((time.time() - t0) * 1000)}


say({"ok": True, "ready": True})
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    if line == "quit":
        break
    real_stdout = sys.stdout
    try:
        req = json.loads(line)
        sys.stdout = LOG  # apply_drive prints a lot; stdout is for answers only
        try:
            result = handle(req)
        finally:
            sys.stdout = real_stdout
        say(result)
    except Exception as e:  # noqa: BLE001 — report to the helper, keep serving
        sys.stdout = real_stdout
        LOG.write(traceback.format_exc())
        LOG.flush()
        state["key"] = None
        say({"ok": False, "error": str(e)})
