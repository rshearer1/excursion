# Debug: switch named lights off for a test render (run before wave_test.py, which renders).
#   CB_LIGHTS_OFF="KeyLight,Graze"   or "ALL" for every lamp (the LED wall and emission stay on)
#   CB_WALL_OFF=1                    hide the LED wall faces too
import bpy, os, json

scene = bpy.context.scene
names = [n.strip() for n in os.environ.get("CB_LIGHTS_OFF", "").split(",") if n.strip()]
off = []
for o in scene.objects:
    if o.type == "LIGHT" and ("ALL" in names or o.name in names):
        o.hide_render = True
        off.append(o.name)
    if os.environ.get("CB_WALL_OFF") == "1" and o.name.startswith("LEDFace_"):
        o.hide_render = True
print("debug_lights:", json.dumps({"off": off, "wall_off": os.environ.get("CB_WALL_OFF") == "1"}))
