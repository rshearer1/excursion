# Excursion — rooms and light rigs on the Blender side, shared by apply_drive.py (which adds
# the rig's fixtures to the scene at apply time) and the Excursion add-on (which loads, edits
# and saves rigs and rooms from Blender's sidebar). The file formats are the grid tool's:
# grid-tool/src/engine/rig.ts and room.ts hold the schema and the meaning of every field.
#
#   presets/rigs/<name>.json   { kind: "rig", name, description, replaceBuiltIn, fixtures: [...] }
#   presets/rooms/<name>.json  { kind: "room", name, description, base, walls?, stage?,
#                                speakers?, cameras?, lyricAnchors?, rig? }
#
# Coordinates are Blender's, in metres, the hero speaker's cabinet centre at the origin.
import json
import math
import os
import re

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RIGS_DIR = os.path.join(ROOT, "presets", "rigs")
ROOMS_DIR = os.path.join(ROOT, "presets", "rooms")

RIG_COLLECTION = "ExcursionRig"
BUILT_IN_LIGHTS = ("KeyLight", "Graze", "TopBack", "RimLeft", "RimRight")
BUILT_IN_PREFIXES = ("WallUp_", "PairR_")  # PairR_: the stereo-pair twin's copies of the key, graze and top-back
ROOM_BASES = ("void", "macro", "stack", "concrete")
TYPES = ("spot", "area", "point")
ROLES = ("key", "rim", "wash", "back", "static")
REACTS = ("none", "bass", "beat", "kick")
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")

FIXTURE_DEFAULTS = {
    "type": "spot",
    "pos": [0.0, -1.0, 0.8],
    "aim": [0.0, -0.12, 0.0],
    "power": 300.0,
    "color": [1.0, 1.0, 1.0],
    "cone": 30.0,
    "blend": 0.5,
    "size": 0.05,
    "volume": 0.3,
    "role": "static",
    "react": "none",
    "amount": 0.5,
}


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.strip().lower()).strip("-")


def _vec(v, d):
    if isinstance(v, (list, tuple)) and len(v) == 3 and all(isinstance(x, (int, float)) for x in v):
        return [float(x) for x in v]
    return list(d)


def fixture_with_defaults(raw):
    f = dict(FIXTURE_DEFAULTS)
    for k in ("power", "cone", "blend", "size", "volume", "amount"):
        if isinstance(raw.get(k), (int, float)):
            f[k] = float(raw[k])
    for k in ("pos", "aim", "color"):
        f[k] = _vec(raw.get(k), FIXTURE_DEFAULTS[k])
    for k, options in (("type", TYPES), ("role", ROLES), ("react", REACTS)):
        if raw.get(k) in options:
            f[k] = raw[k]
    f["id"] = raw["id"]
    f["power"] = max(0.0, f["power"])
    f["cone"] = min(180.0, max(1.0, f["cone"]))
    f["blend"] = min(1.0, max(0.0, f["blend"]))
    f["amount"] = min(1.0, max(0.0, f["amount"]))
    return f


def parse_rig(raw):
    """A validated rig dict (defaults filled in). Raises ValueError naming the problem."""
    if raw.get("kind") != "rig":
        raise ValueError('not a rig file (kind must be "rig")')
    if not isinstance(raw.get("name"), str) or not NAME_RE.match(raw["name"]):
        raise ValueError("rig name must be lower-case letters, digits and dashes")
    if not isinstance(raw.get("fixtures"), list):
        raise ValueError("rig needs a fixtures list")
    seen, fixtures = set(), []
    for i, f in enumerate(raw["fixtures"]):
        fid = (f or {}).get("id")
        if not isinstance(fid, str) or not ID_RE.match(fid):
            raise ValueError(f"fixture {i + 1}: id must be letters, digits, _ or -")
        if fid in seen:
            raise ValueError(f"fixture id {fid} is used twice")
        seen.add(fid)
        fixtures.append(fixture_with_defaults(f))
    return {
        "kind": "rig",
        "name": raw["name"],
        "description": raw.get("description", "") if isinstance(raw.get("description"), str) else "",
        "replaceBuiltIn": raw.get("replaceBuiltIn") is True,
        "fixtures": fixtures,
    }


def list_names(folder):
    if not os.path.isdir(folder):
        return []
    return sorted(f[:-5] for f in os.listdir(folder) if f.endswith(".json"))


def read_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def load_rig(name, rigs_dir=RIGS_DIR):
    path = os.path.join(rigs_dir, f"{name}.json")
    if not os.path.exists(path):
        return None
    return parse_rig(read_json(path))


def load_room(name, rooms_dir=ROOMS_DIR):
    """The room file for a scene name, or None when there is none (a bare base name still builds)."""
    path = os.path.join(rooms_dir, f"{name}.json")
    if not os.path.exists(path):
        return None
    room = read_json(path)
    if room.get("kind") != "room" or room.get("base") not in ROOM_BASES:
        raise ValueError(f"presets/rooms/{name}.json: kind must be room and base one of {', '.join(ROOM_BASES)}")
    return room


def r4(x):
    return round(float(x), 4) + 0.0


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(obj, indent=2) + "\n")


# ---------- building and capturing fixtures ----------

def _aim_rotation(pos, aim):
    d = Vector(aim) - Vector(pos)
    if d.length < 1e-6:
        d = Vector((0.0, 0.0, -1.0))
    return d.to_track_quat("-Z", "Y").to_euler()


def _rig_collection(scene, create=True):
    col = bpy.data.collections.get(RIG_COLLECTION)
    if col is None and create:
        col = bpy.data.collections.new(RIG_COLLECTION)
        parent = bpy.data.collections.get("MainCol")  # the built scenes keep lights in MainCol
        if parent is not None and parent.name in [c.name for c in scene.collection.children_recursive]:
            parent.children.link(col)
        else:
            scene.collection.children.link(col)
    return col


def clear_rig(scene):
    """Remove the rig's fixtures and bring back any built-in lights a rig had hidden."""
    col = _rig_collection(scene, create=False)
    if col is not None:
        for obj in list(col.objects):
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if data is not None and data.users == 0:
                bpy.data.lights.remove(data)
    for obj in scene.objects:
        if obj.get("rig_hidden"):
            obj.hide_render = False
            obj.hide_viewport = False
            del obj["rig_hidden"]


def built_in_lights(scene):
    return [o for o in scene.objects if o.type == "LIGHT" and (o.name in BUILT_IN_LIGHTS or o.name.startswith(BUILT_IN_PREFIXES))]


def build_fixture(f, col):
    kind = {"spot": "SPOT", "area": "AREA", "point": "POINT"}[f["type"]]
    name = f"Rig_{f['id']}"
    data = bpy.data.lights.new(name, kind)
    data.energy = f["power"]
    data.color = f["color"]
    if hasattr(data, "volume_factor"):
        data.volume_factor = f["volume"]
    if kind == "SPOT":
        data.spot_size = math.radians(f["cone"])
        data.spot_blend = f["blend"]
        data.shadow_soft_size = f["size"]
    elif kind == "AREA":
        data.shape = "SQUARE"
        data.size = max(0.01, f["size"])
        if hasattr(data, "spread"):
            data.spread = math.radians(f["cone"])
    else:
        data.shadow_soft_size = f["size"]
    obj = bpy.data.objects.new(name, data)
    col.objects.link(obj)
    obj.location = f["pos"]
    obj.rotation_euler = _aim_rotation(f["pos"], f["aim"])
    obj["rig_fixture"] = f["id"]
    obj["rig_role"] = f["role"]
    obj["rig_react"] = f["react"]
    obj["rig_amount"] = f["amount"]
    obj["rig_aim_dist"] = max(0.05, (Vector(f["aim"]) - Vector(f["pos"])).length)
    obj["rig_power"] = f["power"]  # the rest value: apply_drive keys energy over it
    obj["rig_color"] = list(f["color"])
    return obj


def build_rig(rig, scene):
    """Replace the scene's rig with this one; returns the fixture objects."""
    clear_rig(scene)
    col = _rig_collection(scene)
    if rig.get("replaceBuiltIn"):
        for obj in built_in_lights(scene):
            obj.hide_render = True
            obj.hide_viewport = True
            obj["rig_hidden"] = True
    objs = [build_fixture(f, col) for f in rig["fixtures"]]
    # light linking as the built-in lights have it (Cycles): the dust backlight lights only the
    # dust, the front lights everything else
    lit = bpy.data.collections.get("LitCol")
    dust = bpy.data.collections.get("DustCol")
    for obj in objs:
        if not hasattr(obj, "light_linking"):
            break
        if obj["rig_role"] == "back" and dust is not None:
            obj.light_linking.receiver_collection = dust
        elif obj["rig_role"] == "key" and lit is not None:
            obj.light_linking.receiver_collection = lit
    scene["excursion_rig"] = rig["name"]
    return objs


def rig_objects(scene):
    col = _rig_collection(scene, create=False)
    return [o for o in col.objects if o.type == "LIGHT"] if col is not None else []


def _refresh(scene):
    """World matrices are only current after a depsgraph update (a moved light reads its old place otherwise)."""
    for layer in scene.view_layers:
        layer.update()


def capture_fixture(obj):
    """A fixture dict from a light object as it sits in the scene now."""
    data = obj.data
    pos = obj.matrix_world.translation
    forward = obj.matrix_world.to_quaternion() @ Vector((0.0, 0.0, -1.0))
    aim = pos + forward * float(obj.get("rig_aim_dist", 1.5))
    kind = {"SPOT": "spot", "AREA": "area", "POINT": "point"}.get(data.type, "point")
    if kind == "spot":
        cone, size = math.degrees(data.spot_size), data.shadow_soft_size
    elif kind == "area":
        cone, size = math.degrees(getattr(data, "spread", math.pi)), data.size
    else:
        cone, size = 30.0, data.shadow_soft_size
    fid = obj.get("rig_fixture") or re.sub(r"[^A-Za-z0-9_-]+", "-", obj.name.removeprefix("Rig_")).strip("-") or "light"
    # after apply_drive the energy and colour are keyed; the rest values are kept on the object
    animated = bool(data.animation_data and data.animation_data.action)
    power = float(obj.get("rig_power", data.energy)) if animated else data.energy
    color = list(obj.get("rig_color", data.color)) if animated else list(data.color)
    return {
        "id": fid,
        "type": kind,
        "pos": [r4(v) for v in pos],
        "aim": [r4(v) for v in aim],
        "power": r4(power),
        "color": [r4(c) for c in color],
        "cone": r4(cone),
        "blend": r4(getattr(data, "spot_blend", 0.5)),
        "size": r4(size),
        "volume": r4(getattr(data, "volume_factor", 1.0)),
        "role": obj.get("rig_role", "static") if obj.get("rig_role") in ROLES else "static",
        "react": obj.get("rig_react", "none") if obj.get("rig_react") in REACTS else "none",
        "amount": r4(obj.get("rig_amount", 0.5)),
    }


def capture_rig(scene, name, description="", replace_built_in=False, objects=None):
    """The scene's rig (or the given light objects) as a rig dict, ready to write."""
    _refresh(scene)
    objs = objects if objects is not None else rig_objects(scene)
    fixtures, seen = [], set()
    for obj in sorted(objs, key=lambda o: o.name):
        f = capture_fixture(obj)
        base, n = f["id"], 2
        while f["id"] in seen:
            f["id"] = f"{base}-{n}"
            n += 1
        seen.add(f["id"])
        fixtures.append(f)
    return {"kind": "rig", "name": name, "description": description, "replaceBuiltIn": bool(replace_built_in), "fixtures": fixtures}


# ---------- the drive's motion on the fixtures ----------

def react_series(react, amount, n, bass=None, beat=None, kick=None):
    """Per-frame multipliers in [1 - amount, 1] for a fixture's react (signals are 0..1 lists)."""
    sig = {"bass": bass, "beat": beat, "kick": kick}.get(react)
    if react == "none" or not sig or amount <= 0:
        return [1.0] * n
    peak = max(sig[:n]) or 1.0
    return [1.0 - amount + amount * min(1.0, sig[i] / peak) for i in range(n)]


def flash_series(times, fps, n, decay=0.8):
    """1 on each time, decaying by `decay` per frame."""
    out = [0.0] * n
    for t in times:
        i, level = round(t * fps), 1.0
        while 0 <= i < n and level > 0.01:
            out[i] = max(out[i], level)
            level *= decay
            i += 1
    return out


# ---------- rooms ----------

def capture_room(scene, room):
    """The room dict with its speakers, extra cameras and lyric anchors read back from the scene.
    Speakers carry their model and mount on the cabinet (build_scene tags them); the hero stays."""
    _refresh(scene)
    room = dict(room)
    speakers = []
    for obj in scene.objects:
        tag = obj.get("excursion_speaker")
        if not tag:
            continue
        info = json.loads(tag)
        speakers.append({
            "id": info["id"],
            "model": info["model"],
            "pos": [r4(obj.location.x), r4(obj.location.y)],
            "yaw": r4(math.degrees(obj.rotation_euler.z)),
            "mount": info["mount"],
        })
    # a speaker the room lists but the build skipped (its STL was not cached) is kept as it was
    built = set(json.loads(scene.get("excursion_built_speakers", "[]")))
    found = {s["id"] for s in speakers}
    speakers += [s for s in room.get("speakers") or [] if s["id"] not in found and s["id"] not in built]
    if speakers or room.get("speakers") is not None:
        room["speakers"] = sorted(speakers, key=lambda s: s["id"])
    cams = []
    for obj in scene.objects:
        if obj.type != "CAMERA" or not obj.get("custom_shot"):
            continue
        aim = bpy.data.objects.get(f"Aim_{obj.name}")
        pos = obj.matrix_world.translation
        target = aim.matrix_world.translation if aim else pos + obj.matrix_world.to_quaternion() @ Vector((0.0, 0.0, -1.0))
        cams.append({
            "name": obj.name,
            "pos": [r4(v) for v in pos],
            "target": [r4(v) for v in target],
            "lens": r4(obj.data.lens),
            "fstop": r4(obj.data.dof.aperture_fstop),
            "move": [r4(v) for v in obj.get("move", (0.0, 0.0, 0.0))],
        })
    if cams or room.get("cameras") is not None:
        room["cameras"] = sorted(cams, key=lambda c: c["name"])
    anchors = {o.name[len("Lyric_"):]: [r4(v) for v in o.location] for o in scene.objects if o.type == "EMPTY" and o.name.startswith("Lyric_")}
    if anchors:
        room["lyricAnchors"] = dict(sorted(anchors.items()))
    return room


# ---------- the live link: the grid tool's playhead and desk on the open scene ----------
# The browser posts { time, fps, lanes: { key: {gain, color}, rims: {gain, color}, wall: {trace},
# dustback: {gain}, smoke: {density, haze}, shells: {strength}, camera: {camera} } } with only the
# lanes it has values for. Values are set directly (not keyed), relative to each light's rest
# value, so the viewport shows the look at the playhead and nothing is written into the file
# until you save it yourself. A render still goes through make_reel / apply_drive as before.

RIM_NAMES = ("RimLeft", "RimRight", "TopBack")


def _rest(obj, key="live_rest"):
    """A light's rest energy, remembered the first time the live link touches it."""
    if key not in obj:
        obj[key] = float(obj.get("rig_power", obj.data.energy))
    return float(obj[key])


def _lights(scene, names=(), prefixes=(), roles=()):
    out = []
    for o in scene.objects:
        if o.type != "LIGHT" or o.hide_render:
            continue
        if o.name in names or (prefixes and o.name.startswith(prefixes)) or o.get("rig_role") in roles:
            out.append(o)
    return out


def apply_live(scene, state):
    """Set the scene to the browser's playhead and desk values. Returns a short summary."""
    done = []
    fps = state.get("fps") or scene.render.fps
    if isinstance(state.get("time"), (int, float)):
        frame = max(scene.frame_start, round(state["time"] * fps) + 1)
        if frame != scene.frame_current:
            scene.frame_set(frame)
        done.append(f"frame {frame}")
    lanes = state.get("lanes") or {}
    key = lanes.get("key")
    if key:
        for o in _lights(scene, names=("KeyLight",), roles=("key",)):
            o.data.energy = _rest(o) * float(key.get("gain", 1.0))
            if "color" in key:
                o.data.color = key["color"]
        done.append("key")
    rims = lanes.get("rims")
    if rims:
        for o in _lights(scene, names=RIM_NAMES, prefixes=("WallUp_",), roles=("rim", "wash")):
            o.data.energy = _rest(o) * float(rims.get("gain", 1.0))
            if "color" in rims:
                o.data.color = rims["color"]
        done.append("rims")
    back = lanes.get("dustback")
    if back:
        for o in _lights(scene, names=("DustBack",), roles=("back",)):
            o.data.energy = _rest(o) * float(back.get("gain", 1.0))
        done.append("dust back")
    wall = lanes.get("wall")
    scope = bpy.data.materials.get("ScopeMat")
    if wall and "trace" in wall and scope is not None and scope.node_tree is not None:
        bsdf = scope.node_tree.nodes.get("Principled BSDF")
        if bsdf is not None:
            bsdf.inputs["Emission Color"].default_value = (*wall["trace"], 1.0)
            done.append("wall")
    cam = (lanes.get("camera") or {}).get("camera")
    if cam and cam in bpy.data.objects and bpy.data.objects[cam].type == "CAMERA":
        scene.camera = bpy.data.objects[cam]
        done.append(cam)
    return ", ".join(done) or "nothing to set"


def reset_live(scene):
    """Put every light the live link touched back to its rest energy."""
    for o in scene.objects:
        if o.type == "LIGHT" and "live_rest" in o:
            o.data.energy = float(o["live_rest"])
            del o["live_rest"]
