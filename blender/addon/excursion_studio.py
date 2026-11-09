# Excursion Studio — a Blender sidebar for rooms and light rigs (View3D > Sidebar > Excursion).
#
# Install: Edit > Preferences > Add-ons > Install from Disk… > blender/addon/excursion_studio.py,
# tick it, then set "Project folder" to the excursion checkout (it is found by itself when the
# open .blend lives in <project>/blender/scenes/).
#
# Works on the same files as the grid tool's Room and Rig panels:
#   presets/rigs/<name>.json   Load puts the fixtures in the scene (collection ExcursionRig);
#                              move and aim them in the viewport, set role/react in the panel,
#                              Save writes them back. Add fixture drops a light at the 3D cursor;
#                              Adopt selected turns any lights you made into fixtures.
#   presets/rooms/<name>.json  Build & open runs build_scene.py for the room and opens the
#                              result; Save room writes the speakers, extra cameras and lyric
#                              anchors as they sit in the scene now. Add camera / Add speaker
#                              place new ones (a new speaker is a marker until the next build).
# The schema lives in grid-tool/src/engine/rig.ts and room.ts; the Blender side in rigkit.py.
bl_info = {
    "name": "Excursion Studio",
    "author": "Excursion",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "View3D > Sidebar > Excursion",
    "description": "Load, edit and save Excursion rooms and light rigs (presets/rooms, presets/rigs)",
    "category": "Lighting",
}

import importlib
import json
import os
import subprocess
import sys

import bpy
from bpy.props import BoolProperty, EnumProperty, FloatProperty, PointerProperty, StringProperty
from mathutils import Vector

ADDON = __name__


# ---------- the project and rigkit ----------

def project_root(context):
    prefs = context.preferences.addons[ADDON].preferences if ADDON in context.preferences.addons else None
    if prefs and prefs.project_root and os.path.isdir(os.path.join(bpy.path.abspath(prefs.project_root), "blender")):
        return os.path.normpath(bpy.path.abspath(prefs.project_root))
    if bpy.data.filepath:  # <root>/blender/scenes/<room>.blend
        guess = os.path.dirname(os.path.dirname(os.path.dirname(bpy.data.filepath)))
        if os.path.exists(os.path.join(guess, "blender", "rigkit.py")):
            return guess
    return None


def kit(context):
    """rigkit from the project (one copy of the logic for the add-on and apply_drive)."""
    root = project_root(context)
    if root is None:
        raise RuntimeError("set the Excursion project folder in the add-on preferences")
    path = os.path.join(root, "blender")
    if path not in sys.path:
        sys.path.insert(0, path)
    mod = sys.modules.get("rigkit")
    if mod is None or os.path.normcase(os.path.dirname(os.path.abspath(mod.__file__))) != os.path.normcase(path):
        if mod is not None:
            del sys.modules["rigkit"]
        mod = importlib.import_module("rigkit")
    return mod


def _names(context, sub):
    root = project_root(context)
    folder = os.path.join(root, "presets", sub) if root else None
    if not folder or not os.path.isdir(folder):
        return []
    return sorted(f[:-5] for f in os.listdir(folder) if f.endswith(".json"))


_enum_cache = {}


def _enum(sub):
    def items(self, context):
        names = _names(context, sub)
        out = [(n, n, "") for n in names] or [("", f"no {sub} yet", "")]
        _enum_cache[sub] = out  # Blender needs the list kept alive
        return out
    return items


# ---------- properties ----------

ROLE_ITEMS = [
    ("key", "key", "the desk's key lane and the bass, like the softbox"),
    ("rim", "rim", "the rims lane's colour and gain, pulsing on downbeats"),
    ("wash", "wash", "the rims lane's colour and gain, steady"),
    ("back", "back", "the dust-back lane's gain"),
    ("static", "static", "its own colour and power"),
]
REACT_ITEMS = [
    ("none", "none", "steady"),
    ("bass", "bass", "rides the bass level"),
    ("beat", "beat", "flashes on every beat, harder on downbeats"),
    ("kick", "kick", "flashes on tracked kicks"),
]
MOUNT_ITEMS = [("stand", "stand", "on a PMC stand"), ("floor", "floor", "on the floor"), ("height", "height", "this many metres above the floor")]
MODEL_ITEMS = [(m, m, "") for m in ("PMC6-2", "PMC6", "PMC8SUB", "PMC8-2SUB", "PMC8-2INCSTAND")]


def _custom_enum(key, items, default):
    names = [i[0] for i in items]

    def get(self):
        v = self.id_data.get(key, default)
        return names.index(v) if v in names else names.index(default)

    def set(self, value):
        self.id_data[key] = names[value]
    return get, set


def _custom_float(key, default):
    def get(self):
        return float(self.id_data.get(key, default))

    def set(self, value):
        self.id_data[key] = float(value)
    return get, set


class ExcursionFixture(bpy.types.PropertyGroup):
    """A light's rig settings, stored as the custom properties rigkit and apply_drive read."""
    role: EnumProperty(name="Role", items=ROLE_ITEMS, get=_custom_enum("rig_role", ROLE_ITEMS, "static")[0], set=_custom_enum("rig_role", ROLE_ITEMS, "static")[1])
    react: EnumProperty(name="React", items=REACT_ITEMS, get=_custom_enum("rig_react", REACT_ITEMS, "none")[0], set=_custom_enum("rig_react", REACT_ITEMS, "none")[1])
    amount: FloatProperty(name="Amount", min=0.0, max=1.0, get=_custom_float("rig_amount", 0.5)[0], set=_custom_float("rig_amount", 0.5)[1])
    aim_dist: FloatProperty(name="Aim distance", min=0.05, max=20.0, unit="LENGTH", description="how far ahead of the light its aim point is saved", get=_custom_float("rig_aim_dist", 1.5)[0], set=_custom_float("rig_aim_dist", 1.5)[1])


def _set_replace(self, context):
    try:
        rk = kit(context)
    except RuntimeError:
        return
    for obj in rk.built_in_lights(context.scene) if self.replace_built_in else [o for o in context.scene.objects if o.get("rig_hidden")]:
        obj.hide_render = obj.hide_viewport = self.replace_built_in
        if self.replace_built_in:
            obj["rig_hidden"] = True
        elif "rig_hidden" in obj:
            del obj["rig_hidden"]


class ExcursionSettings(bpy.types.PropertyGroup):
    rig: EnumProperty(name="Rig", items=_enum("rigs"))
    rig_name: StringProperty(name="Name", description="the rig's file name (lower-case, dashes)")
    rig_description: StringProperty(name="Description")
    replace_built_in: BoolProperty(name="Replace the room's lights", description="hide KeyLight, Graze, TopBack, the rims and the uplights: the rig is all the light", update=_set_replace)
    new_role: EnumProperty(name="Role", items=ROLE_ITEMS, default="static")
    new_type: EnumProperty(name="Type", items=[("SPOT", "spot", ""), ("AREA", "area", ""), ("POINT", "point", "")], default="SPOT")
    room: EnumProperty(name="Room", items=_enum("rooms"))
    room_name: StringProperty(name="Name", description="the room's file name (lower-case, dashes)")
    new_model: EnumProperty(name="Model", items=MODEL_ITEMS, default="PMC6-2")
    new_mount: EnumProperty(name="Mount", items=MOUNT_ITEMS, default="stand")
    new_height: FloatProperty(name="Height", default=0.3, min=0.0, unit="LENGTH")


class ExcursionPrefs(bpy.types.AddonPreferences):
    bl_idname = ADDON
    project_root: StringProperty(name="Project folder", subtype="DIR_PATH", description="the excursion checkout (holds blender/ and presets/)")

    def draw(self, context):
        self.layout.prop(self, "project_root")


# ---------- rig operators ----------

def _report_error(op, e):
    op.report({"ERROR"}, str(e))
    return {"CANCELLED"}


class EXC_OT_rig_load(bpy.types.Operator):
    bl_idname = "excursion.rig_load"
    bl_label = "Load"
    bl_description = "Put the rig's fixtures in the scene (replaces the loaded rig)"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        s = context.scene.excursion
        try:
            rk = kit(context)
            rig = rk.load_rig(s.rig, os.path.join(project_root(context), "presets", "rigs"))
            if rig is None:
                raise RuntimeError(f"no presets/rigs/{s.rig}.json")
            objs = rk.build_rig(rig, context.scene)
        except (RuntimeError, ValueError, OSError) as e:
            return _report_error(self, e)
        s.rig_name, s.rig_description = rig["name"], rig["description"]
        s["replace_built_in"] = rig["replaceBuiltIn"]  # no update callback: build_rig already did it
        self.report({"INFO"}, f"rig {rig['name']}: {len(objs)} fixtures")
        return {"FINISHED"}


class EXC_OT_rig_clear(bpy.types.Operator):
    bl_idname = "excursion.rig_clear"
    bl_label = "Clear"
    bl_description = "Remove the rig's fixtures and bring back the room's own lights"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        try:
            kit(context).clear_rig(context.scene)
        except RuntimeError as e:
            return _report_error(self, e)
        context.scene.excursion["replace_built_in"] = False
        return {"FINISHED"}


class EXC_OT_rig_save(bpy.types.Operator):
    bl_idname = "excursion.rig_save"
    bl_label = "Save rig"
    bl_description = "Write the fixtures in ExcursionRig to presets/rigs/<name>.json"

    def execute(self, context):
        s = context.scene.excursion
        try:
            rk = kit(context)
            name = rk.slug(s.rig_name)
            if not name:
                raise RuntimeError("give the rig a name")
            rig = rk.capture_rig(context.scene, name, s.rig_description, s.replace_built_in)
            if not rig["fixtures"]:
                raise RuntimeError("no fixtures in the ExcursionRig collection — Add fixture or Adopt selected first")
            path = os.path.join(project_root(context), "presets", "rigs", f"{name}.json")
            rk.write_json(path, rig)
        except (RuntimeError, OSError) as e:
            return _report_error(self, e)
        s.rig_name = name
        try:
            s.rig = name
        except TypeError:
            pass
        self.report({"INFO"}, f"saved presets/rigs/{name}.json ({len(rig['fixtures'])} fixtures)")
        return {"FINISHED"}


class EXC_OT_rig_add(bpy.types.Operator):
    bl_idname = "excursion.rig_add"
    bl_label = "Add fixture"
    bl_description = "A new fixture at the 3D cursor, aimed at the hero"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        s = context.scene.excursion
        try:
            rk = kit(context)
        except RuntimeError as e:
            return _report_error(self, e)
        taken = {o.get("rig_fixture") for o in rk.rig_objects(context.scene)}
        n, fid = 1, s.new_role
        while fid in taken:
            n += 1
            fid = f"{s.new_role}-{n}"
        pos = list(context.scene.cursor.location)
        if Vector(pos).length < 0.05:
            pos = [0.0, -1.2, 0.8]  # the cursor sits on the hero: start in front of it instead
        f = rk.fixture_with_defaults({"id": fid, "type": s.new_type.lower(), "role": s.new_role, "pos": pos, "aim": [0.0, -0.12, 0.0]})
        obj = rk.build_fixture(f, rk._rig_collection(context.scene))
        for o in context.selected_objects:
            o.select_set(False)
        obj.select_set(True)
        context.view_layer.objects.active = obj
        return {"FINISHED"}


class EXC_OT_rig_adopt(bpy.types.Operator):
    bl_idname = "excursion.rig_adopt"
    bl_label = "Adopt selected"
    bl_description = "Move the selected lights into the rig (they keep their place, colour and power)"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        try:
            rk = kit(context)
        except RuntimeError as e:
            return _report_error(self, e)
        col = rk._rig_collection(context.scene)
        n = 0
        for obj in context.selected_objects:
            if obj.type != "LIGHT" or obj.name in col.objects:
                continue
            for c in list(obj.users_collection):
                c.objects.unlink(obj)
            col.objects.link(obj)
            for key, value in (("rig_role", "static"), ("rig_react", "none"), ("rig_amount", 0.5), ("rig_aim_dist", 1.5)):
                if key not in obj:
                    obj[key] = value
            n += 1
        self.report({"INFO"}, f"{n} light{'s' if n != 1 else ''} adopted into the rig")
        return {"FINISHED"}


# ---------- room operators ----------

def _room_dict(context, rk):
    """The room the open scene was built from (or the picked room file)."""
    raw = context.scene.get("excursion_room")
    if raw:
        return json.loads(raw)
    s = context.scene.excursion
    room = rk.load_room(s.room, os.path.join(project_root(context), "presets", "rooms")) if s.room else None
    if room is None:
        raise RuntimeError("this .blend was not built from a room — pick a room and Build & open it first")
    return room


class EXC_OT_room_build(bpy.types.Operator):
    bl_idname = "excursion.room_build"
    bl_label = "Build & open"
    bl_description = "Run build_scene.py for the room (a minute or so) and open blender/scenes/<room>.blend — unsaved changes here are lost"

    def invoke(self, context, event):
        return context.window_manager.invoke_confirm(self, event)

    def execute(self, context):
        s = context.scene.excursion
        root = project_root(context)
        if not root or not s.room:
            self.report({"ERROR"}, "set the project folder and pick a room")
            return {"CANCELLED"}
        env = dict(os.environ, EXCURSION_SCENE=s.room)
        proc = subprocess.run([bpy.app.binary_path, "-b", "-P", os.path.join(root, "blender", "build_scene.py")], cwd=root, env=env, capture_output=True, text=True)
        blend = os.path.join(root, "blender", "scenes", f"{s.room}.blend")
        if proc.returncode != 0 or not os.path.exists(blend):
            print(proc.stdout[-4000:], proc.stderr[-4000:])
            self.report({"ERROR"}, f"build failed ({proc.returncode}) — see the system console")
            return {"CANCELLED"}
        bpy.ops.wm.open_mainfile(filepath=blend)
        return {"FINISHED"}


class EXC_OT_room_save(bpy.types.Operator):
    bl_idname = "excursion.room_save"
    bl_label = "Save room"
    bl_description = "Write the speakers, extra cameras and lyric anchors as they sit now to presets/rooms/<name>.json (rebuild to see new speakers as real models)"

    def execute(self, context):
        s = context.scene.excursion
        try:
            rk = kit(context)
            name = rk.slug(s.room_name)
            if not name:
                raise RuntimeError("give the room a name")
            room = rk.capture_room(context.scene, _room_dict(context, rk))
            room["name"] = name
            path = os.path.join(project_root(context), "presets", "rooms", f"{name}.json")
            rk.write_json(path, room)
        except (RuntimeError, OSError, ValueError) as e:
            return _report_error(self, e)
        context.scene["excursion_room"] = json.dumps(room)
        self.report({"INFO"}, f"saved presets/rooms/{name}.json — Build & open to rebuild it")
        return {"FINISHED"}


class EXC_OT_room_add_camera(bpy.types.Operator):
    bl_idname = "excursion.room_add_camera"
    bl_label = "Add camera"
    bl_description = "A new shot camera where the viewport looks from, aimed at the hero; it joins the cuts after the built-in shots"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        taken = {o.name for o in bpy.data.objects}
        n = 9
        while f"Cam{n}_Custom" in taken:
            n += 1
        name = f"Cam{n}_Custom"
        rv3d = context.region_data
        pos = rv3d.view_matrix.inverted().translation if rv3d else Vector((0.0, -2.0, 0.2))
        target = Vector((0.0, -0.18, 0.0))
        data = bpy.data.cameras.new(name)
        data.lens = 35
        data.sensor_fit = "VERTICAL"
        data.sensor_height = 36.0
        data.dof.use_dof = True
        data.dof.aperture_fstop = 2.8
        cam = bpy.data.objects.new(name, data)
        context.scene.collection.objects.link(cam)
        cam.location = pos
        aim = bpy.data.objects.new(f"Aim_{name}", None)
        aim.empty_display_size = 0.03
        aim.location = target
        context.scene.collection.objects.link(aim)
        c = cam.constraints.new("TRACK_TO")
        c.target = aim
        c.track_axis = "TRACK_NEGATIVE_Z"
        c.up_axis = "UP_Y"
        data.dof.focus_object = aim
        cam["move"] = [0.0, 0.0, 0.0]
        cam["custom_shot"] = True
        for o in context.selected_objects:
            o.select_set(False)
        cam.select_set(True)
        context.view_layer.objects.active = cam
        return {"FINISHED"}


class EXC_OT_room_add_speaker(bpy.types.Operator):
    bl_idname = "excursion.room_add_speaker"
    bl_label = "Add speaker"
    bl_description = "A speaker marker at the 3D cursor; Save room, then Build & open, to get the real model there"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        s = context.scene.excursion
        taken = set()
        for o in context.scene.objects:
            if o.get("excursion_speaker"):
                taken.add(json.loads(o["excursion_speaker"])["id"])
        stem = s.new_model.replace("-", "")
        n, sid = 1, stem
        while sid in taken:
            n += 1
            sid = f"{stem}-{n}"
        mount = s.new_height if s.new_mount == "height" else s.new_mount
        marker = bpy.data.objects.new(f"{sid}_Marker", None)
        marker.empty_display_type = "CUBE"
        marker.empty_display_size = 0.2
        marker.location = (context.scene.cursor.location.x, context.scene.cursor.location.y, 0.0)
        marker["excursion_speaker"] = json.dumps({"id": sid, "model": s.new_model, "mount": mount})
        context.scene.collection.objects.link(marker)
        for o in context.selected_objects:
            o.select_set(False)
        marker.select_set(True)
        context.view_layer.objects.active = marker
        return {"FINISHED"}


# ---------- the panel ----------

class EXC_PT_studio(bpy.types.Panel):
    bl_label = "Excursion"
    bl_idname = "EXC_PT_studio"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Excursion"

    def draw(self, context):
        layout = self.layout
        s = context.scene.excursion
        root = project_root(context)
        if root is None:
            layout.label(text="Set the project folder", icon="ERROR")
            layout.label(text="Preferences > Add-ons > Excursion Studio")
            return
        layout.label(text=os.path.basename(root), icon="FILE_FOLDER")

        box = layout.box()
        box.label(text="Light rig", icon="LIGHT_SPOT")
        row = box.row(align=True)
        row.prop(s, "rig", text="")
        row.operator("excursion.rig_load", text="", icon="IMPORT")
        row.operator("excursion.rig_clear", text="", icon="X")
        box.prop(s, "rig_name")
        box.prop(s, "rig_description", text="")
        box.prop(s, "replace_built_in")
        row = box.row(align=True)
        row.prop(s, "new_type", text="")
        row.prop(s, "new_role", text="")
        row = box.row(align=True)
        row.operator("excursion.rig_add", icon="ADD")
        row.operator("excursion.rig_adopt", icon="EXPORT")
        box.operator("excursion.rig_save", icon="FILE_TICK")

        obj = context.active_object
        if obj is not None and obj.type == "LIGHT":
            sub = layout.box()
            in_rig = any(c.name == "ExcursionRig" for c in obj.users_collection)
            sub.label(text=f"{obj.name}" + ("" if in_rig else " (not in the rig — Adopt it)"), icon="LIGHT")
            d = obj.data
            sub.prop(d, "energy")
            sub.prop(d, "color")
            if d.type == "SPOT":
                sub.prop(d, "spot_size")
                sub.prop(d, "spot_blend")
                sub.prop(d, "shadow_soft_size", text="Size")
            elif d.type == "AREA":
                sub.prop(d, "size")
                if hasattr(d, "spread"):
                    sub.prop(d, "spread")
            if hasattr(d, "volume_factor"):
                sub.prop(d, "volume_factor", text="Smoke")
            if in_rig:
                sub.prop(obj.excursion_fixture, "role")
                row = sub.row(align=True)
                row.prop(obj.excursion_fixture, "react", text="")
                row.prop(obj.excursion_fixture, "amount", slider=True)
                sub.prop(obj.excursion_fixture, "aim_dist")
                if d.animation_data and d.animation_data.action:
                    sub.label(text="Keyed by a drive: Save uses the rest power and colour", icon="INFO")

        box = layout.box()
        box.label(text="Room", icon="HOME")
        built = context.scene.get("excursion_room")
        if built:
            r = json.loads(built)
            box.label(text=f"open: {r.get('name')} (base {r.get('base')})")
        row = box.row(align=True)
        row.prop(s, "room", text="")
        row.operator("excursion.room_build", text="", icon="FILE_REFRESH")
        box.prop(s, "room_name")
        row = box.row(align=True)
        row.operator("excursion.room_add_camera", icon="CAMERA_DATA")
        row.operator("excursion.room_add_speaker", icon="SPEAKER")
        row = box.row(align=True)
        row.prop(s, "new_model", text="")
        row.prop(s, "new_mount", text="")
        if s.new_mount == "height":
            box.prop(s, "new_height")
        box.operator("excursion.room_save", icon="FILE_TICK")


CLASSES = (
    ExcursionFixture,
    ExcursionSettings,
    ExcursionPrefs,
    EXC_OT_rig_load,
    EXC_OT_rig_clear,
    EXC_OT_rig_save,
    EXC_OT_rig_add,
    EXC_OT_rig_adopt,
    EXC_OT_room_build,
    EXC_OT_room_save,
    EXC_OT_room_add_camera,
    EXC_OT_room_add_speaker,
    EXC_PT_studio,
)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Scene.excursion = PointerProperty(type=ExcursionSettings)
    bpy.types.Object.excursion_fixture = PointerProperty(type=ExcursionFixture)


def unregister():
    del bpy.types.Object.excursion_fixture
    del bpy.types.Scene.excursion
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
