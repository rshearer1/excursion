# Excursion — "void" scene builder (phase 3: real speaker).
# Run once:  blender -b -P blender/build_scene.py
#
# Builds scenes/void.blend around PMC's official PMC6-2 CAD model when it is in the asset
# cache (node scripts/fetch-assets.mjs blender/scenes/void.manifest.json fetches it from
# pmc-speakers.com/3d-cad-downloads), and falls back to the phase-2 placeholder primitives
# when it is not. Either way the kit-contract object names the pipeline binds to exist:
#   Cabinet, Woofer_L, Woofer_R, Mid (shape key "Excursion"), Tweeter, Slate, Floor, Smoke (SmokeMat),
#   Dust (DustField geometry nodes), KeyLight + KeyTarget (moving spot), Badge + Logo (LogoMat)
# plus cameras Cam1_Wide (scene camera), Cam2_Woofers, Cam3_Macro, Cam4_Rig, Cam5_Low, Cam6_Side
# and Cam7_Top for drive.json cuts (SHOT_ORDER in apply_drive), each with a per-shot "move",
# each with a Focus_* empty carrying a "rack" (focus glides start -> end per shot).
#
# The STL is one closed solid in millimetres with the woofer cones modelled into the body
# (and the baffle triangulated with long slivers, so face picking by radius gives a jagged
# edge). Each driver is therefore cut out with an exact boolean cylinder: intersect gives the
# piece, difference leaves the pocket, and the seam is a true circle on flat baffle where both
# sides share the same box-projected material and normal. Measured in model space (mm):
#   woofers   (107.5, 292.5) and (107.5, 107.5), fitted by concentricity: dust cap + cone r<46,
#             surround roll 46-75 (crest at r~63), flat trim ring 76-88, baffle beyond
#   tweeter   dome centre (260, 314), base r~9.5 at z 359, waveguide floor at z 356
#   body      430 x 400 x 368, front baffle at z = 360-368

import json
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(ROOT, "assets", "cache")
HDRI = os.path.join(CACHE, "polyhaven", "studio_small_09_2k.hdr")
CABINET_TEXTURE = ("Plastic012A", "4K")  # ambientCG id + resolution (see void.manifest.json)
PLASTIC = os.path.join(CACHE, "ambientcg", f"{CABINET_TEXTURE[0]}_{CABINET_TEXTURE[1]}-JPG")
STL = os.path.join(CACHE, "pmc", "PMC6-2.stl")

EXCURSION = 0.014  # metres of cone travel at shape key value 1.0 (a real driver is ~10 mm; exaggerated to read on video)
MID_EXCURSION = 0.003  # the 75 mm mid dome moves far less
SHARP_ANGLE = math.radians(30)
CABINET_ALBEDO = 0.22  # multiplier on the texture's colour map
CABINET_ROUGHNESS = (0.42, 0.68)  # the roughness map is remapped into this range (PMC's finish is a flat textured black)
CABINET_BUMP = 0.22  # displacement-map bump strength on top of the normal map (a fine textured paint, not leather)
SETTLED_DUST = 0.12  # how much dust has settled on the cabinet's up-facing surfaces (0 = none)
SMUDGE = 0.08  # roughness variation from handling: 0 = perfectly uniform (the biggest CGI tell)
# LOOK: "moody" = the single-speaker-in-the-void grade — warm key, dark red rims, almost no
# fill, big soft dust bokeh, crushed blacks, heavy vignette; show fixtures dimmed to sit inside
# it. Set to "show" for a brighter club grade.
LOOK = "moody"
MOODY = LOOK == "moody"
# INTIMATE: one speaker, close cameras, nothing that reads as a stage — the film is about the
# sound. False brings back the whole PMC rig, the truss, lasers, projectors and the LED wall.
INTIMATE = True
BACK_LASERS = 0  # thin beams behind the speaker in the intimate look (0 = none); look B has none
BACK_LASER_COLOR = (1.0, 0.22, 0.08)  # deep red-orange; (0.15, 1.0, 0.25) for classic green
BACK_LASER_POWER = 700  # Cycles scatters beams physically; this reads as faint rays, not a wash
BOKEH_BLADES = 11  # GM lenses are 11-blade: near-round bokeh
BOKEH_ROTATION = 12  # degrees
BOKEH_RATIO = 1.0  # round; 1.5 for anamorphic ovals

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
try:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
except TypeError:
    scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1080
scene.render.resolution_y = 1920
scene.render.fps = 30


def make_material(name, base=(0.015, 0.015, 0.017, 1), rough=0.55, emission=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = base
    bsdf.inputs["Roughness"].default_value = rough
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = 0.0
    return m


def assign(obj, material):
    obj.data.materials.append(material)


def plastic_material(name, scale=22.0):
    """ambientCG PBR set box-projected in object space (the STL has no UVs): colour, roughness,
    normal map and the displacement map as a bump on top, so the surface grain catches the
    raking light. scale = tiles per metre."""
    m = make_material(name, rough=0.5)
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (scale, scale, scale)
    nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])

    def tex(suffix, non_color):
        path = os.path.join(PLASTIC, f"{CABINET_TEXTURE[0]}_{CABINET_TEXTURE[1]}-JPG_{suffix}.jpg")
        if not os.path.exists(path):
            return None
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(path)
        node.projection = "BOX"
        node.projection_blend = 0.25
        if non_color:
            node.image.colorspace_settings.name = "Non-Color"
        nt.links.new(mapping.outputs["Vector"], node.inputs["Vector"])
        return node

    color = tex("Color", False)
    rough = tex("Roughness", True)
    normal = tex("NormalGL", True)
    height = tex("Displacement", True)
    if color:
        # darken the albedo: the cabinet should only show where a beam or reflection lands
        dark = nt.nodes.new("ShaderNodeMix")
        dark.data_type = "RGBA"
        dark.blend_type = "MULTIPLY"
        dark.inputs["Factor"].default_value = 1.0
        dark.inputs["B"].default_value = (CABINET_ALBEDO,) * 3 + (1.0,)
        nt.links.new(color.outputs["Color"], dark.inputs["A"])
        nt.links.new(dark.outputs["Result"], bsdf.inputs["Base Color"])
    if rough:
        # glossier than the scan so the placed lights read as reflections
        gloss = nt.nodes.new("ShaderNodeMapRange")
        gloss.inputs["To Min"].default_value = CABINET_ROUGHNESS[0]
        gloss.inputs["To Max"].default_value = CABINET_ROUGHNESS[1]
        nt.links.new(rough.outputs["Color"], gloss.inputs["Value"])
        # smudges and handling: a slow noise varies the roughness across the surface
        smudge = nt.nodes.new("ShaderNodeTexNoise")
        smudge.inputs["Scale"].default_value = 2.5
        smudge.inputs["Detail"].default_value = 2.0
        nt.links.new(mapping.outputs["Vector"], smudge.inputs["Vector"])
        vary = nt.nodes.new("ShaderNodeMapRange")
        vary.inputs["To Min"].default_value = 1.0 - SMUDGE
        vary.inputs["To Max"].default_value = 1.0 + SMUDGE
        nt.links.new(smudge.outputs["Fac"], vary.inputs["Value"])
        rough_var = nt.nodes.new("ShaderNodeMath")
        rough_var.operation = "MULTIPLY"
        nt.links.new(gloss.outputs["Result"], rough_var.inputs[0])
        nt.links.new(vary.outputs["Result"], rough_var.inputs[1])
        nt.links.new(rough_var.outputs[0], bsdf.inputs["Roughness"])
    shading_normal = None
    if normal:
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = 0.8
        nt.links.new(normal.outputs["Color"], nmap.inputs["Color"])
        shading_normal = nmap.outputs["Normal"]
    if height:
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = CABINET_BUMP
        bump.inputs["Distance"].default_value = 0.0005
        nt.links.new(height.outputs["Color"], bump.inputs["Height"])
        if shading_normal is not None:
            nt.links.new(shading_normal, bump.inputs["Normal"])
        shading_normal = bump.outputs["Normal"]
    if shading_normal is not None:
        nt.links.new(shading_normal, bsdf.inputs["Normal"])
    if not (color or rough or normal):
        print(f"note: {CABINET_TEXTURE[0]} textures not found — flat CabinetMat (run fetch-assets)")
    if SETTLED_DUST > 0:
        # settled dust: up-facing surfaces, patchy, collecting where the grain is rough; it
        # lightens the colour and kills the gloss
        geom = nt.nodes.new("ShaderNodeNewGeometry")
        nsep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(geom.outputs["Normal"], nsep.inputs[0])
        up = nt.nodes.new("ShaderNodeMapRange")
        up.interpolation_type = "SMOOTHSTEP"
        up.inputs["From Min"].default_value = 0.55
        up.inputs["From Max"].default_value = 0.95
        nt.links.new(nsep.outputs[2], up.inputs["Value"])
        grit = nt.nodes.new("ShaderNodeTexNoise")
        grit.inputs["Scale"].default_value = 60.0
        grit.inputs["Detail"].default_value = 3.0
        nt.links.new(mapping.outputs["Vector"], grit.inputs["Vector"])
        patchy = nt.nodes.new("ShaderNodeMapRange")
        patchy.inputs["From Min"].default_value = 0.35
        patchy.inputs["From Max"].default_value = 0.8
        nt.links.new(grit.outputs["Fac"], patchy.inputs["Value"])
        amount = nt.nodes.new("ShaderNodeMath")
        amount.operation = "MULTIPLY"
        nt.links.new(up.outputs["Result"], amount.inputs[0])
        nt.links.new(patchy.outputs["Result"], amount.inputs[1])
        scaled = nt.nodes.new("ShaderNodeMath")
        scaled.operation = "MULTIPLY"
        nt.links.new(amount.outputs[0], scaled.inputs[0])
        scaled.inputs[1].default_value = SETTLED_DUST

        def mix_in(input_name, data_type, b_value):
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = data_type
            ids = {"RGBA": ("A_Color", "B_Color", "Result_Color"), "FLOAT": ("A_Float", "B_Float", "Result_Float")}[data_type]
            a_sock = next(s for s in mix.inputs if s.identifier == ids[0])
            b_sock = next(s for s in mix.inputs if s.identifier == ids[1])
            o_sock = next(s for s in mix.outputs if s.identifier == ids[2])
            nt.links.new(scaled.outputs[0], next(s for s in mix.inputs if s.identifier == "Factor_Float"))
            src = bsdf.inputs[input_name].links[0].from_socket if bsdf.inputs[input_name].links else None
            if src is not None:
                nt.links.new(src, a_sock)
            else:
                a_sock.default_value = bsdf.inputs[input_name].default_value
            b_sock.default_value = b_value
            for link in list(bsdf.inputs[input_name].links):
                nt.links.remove(link)
            nt.links.new(o_sock, bsdf.inputs[input_name])

        mix_in("Base Color", "RGBA", (0.42, 0.4, 0.36, 1.0))
        mix_in("Roughness", "FLOAT", 0.95)
    return m


def driver_material(name, kind):
    """The cabinet plastic with a driver surface inside each piece's cone radius.

    kind "cone": the woofers' fine woven fibre — a dense isotropic micro-bump with a faint
    crossed-thread grain, slightly glossier than the cabinet.
    kind "dome": the mid's soft fabric dome — matte, velvety (sheen), no visible pattern.
    The pieces (Woofer_L/R, Mid) carry cone_cx / cone_cz / cone_r as custom properties; the
    shader reads them with Attribute nodes, so the trim ring outside the cone keeps the
    box-projected cabinet finish (no seam)."""
    m = plastic_material(name)
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    bsdf = N["Principled BSDF"]

    def math_node(op, a, b=None):
        n = N.new("ShaderNodeMath")
        n.operation = op
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L.new(v, n.inputs[i])
        return n.outputs[0]

    def prop(pname):
        a = N.new("ShaderNodeAttribute")
        a.attribute_type = "OBJECT"
        a.attribute_name = pname
        return a.outputs["Fac"]

    def upstream(socket):
        return socket.links[0].from_socket if socket.links else None

    coord = N.new("ShaderNodeTexCoord").outputs["Object"]
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(coord, sep.inputs[0])
    dx = math_node("SUBTRACT", sep.outputs[0], prop("cone_cx"))
    dz = math_node("SUBTRACT", sep.outputs[2], prop("cone_cz"))
    r = math_node("SQRT", math_node("ADD", math_node("MULTIPLY", dx, dx), math_node("MULTIPLY", dz, dz)))
    edge = N.new("ShaderNodeMapRange")
    edge.interpolation_type = "SMOOTHSTEP"
    L.new(r, edge.inputs["Value"])
    L.new(math_node("MULTIPLY", prop("cone_r"), 0.94), edge.inputs["From Min"])
    L.new(prop("cone_r"), edge.inputs["From Max"])
    edge.inputs["To Min"].default_value = 1.0
    edge.inputs["To Max"].default_value = 0.0
    mask = edge.outputs["Result"]

    # surface grain: dense noise (fibre), plus for the cone a faint crossed thread pattern from
    # two high-frequency waves at +-45 degrees — far below the pitch that reads as rings
    grain = N.new("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = 2200 if kind == "cone" else 1400
    grain.inputs["Detail"].default_value = 3.0
    grain.inputs["Roughness"].default_value = 0.6
    L.new(coord, grain.inputs["Vector"])
    height = grain.outputs["Fac"]
    if kind == "cone":
        diag = math_node("ADD", sep.outputs[0], sep.outputs[2])
        anti = math_node("SUBTRACT", sep.outputs[0], sep.outputs[2])
        threads = math_node(
            "MULTIPLY",
            math_node("SINE", math_node("MULTIPLY", diag, 2 * math.pi * FIBRE_PITCH)),
            math_node("SINE", math_node("MULTIPLY", anti, 2 * math.pi * FIBRE_PITCH)),
        )
        height = math_node("ADD", math_node("MULTIPLY", height, 0.7), math_node("MULTIPLY", threads, 0.15))
    bump = N.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.25 if kind == "cone" else 0.12
    bump.inputs["Distance"].default_value = 0.0002
    L.new(height, bump.inputs["Height"])

    def blend(input_name, data_type, driver_value, mask_socket=None):
        mix = N.new("ShaderNodeMix")
        mix.data_type = data_type
        ids = {"RGBA": ("A_Color", "B_Color", "Result_Color"), "FLOAT": ("A_Float", "B_Float", "Result_Float"), "VECTOR": ("A_Vector", "B_Vector", "Result_Vector")}[data_type]
        a_sock = next(s for s in mix.inputs if s.identifier == ids[0])
        b_sock = next(s for s in mix.inputs if s.identifier == ids[1])
        o_sock = next(s for s in mix.outputs if s.identifier == ids[2])
        L.new(mask_socket if mask_socket is not None else mask, next(s for s in mix.inputs if s.identifier == "Factor_Float"))
        src = upstream(bsdf.inputs[input_name])
        if src is not None:
            L.new(src, a_sock)
        else:
            a_sock.default_value = bsdf.inputs[input_name].default_value
        if isinstance(driver_value, (int, float, tuple)):
            b_sock.default_value = driver_value
        else:
            L.new(driver_value, b_sock)
        for link in list(bsdf.inputs[input_name].links):
            L.remove(link)
        L.new(o_sock, bsdf.inputs[input_name])

    if kind == "cone":
        # doped paper: matte, with a fine speckle in the colour rather than a gloss
        speckle = N.new("ShaderNodeTexNoise")
        speckle.inputs["Scale"].default_value = 1400
        speckle.inputs["Detail"].default_value = 2.0
        L.new(coord, speckle.inputs["Vector"])
        tone = N.new("ShaderNodeMix")
        tone.data_type = "RGBA"
        next(s for s in tone.inputs if s.identifier == "A_Color").default_value = (0.010, 0.010, 0.011, 1.0)
        next(s for s in tone.inputs if s.identifier == "B_Color").default_value = (0.026, 0.025, 0.023, 1.0)
        L.new(speckle.outputs["Fac"], next(s for s in tone.inputs if s.identifier == "Factor_Float"))
        blend("Base Color", "RGBA", next(s for s in tone.outputs if s.identifier == "Result_Color"))
        blend("Roughness", "FLOAT", math_node("ADD", 0.36, math_node("MULTIPLY", 0.12, grain.outputs["Fac"])))
        # the dust cap (real geometry, see add_woofer_details) is the same doped paper, a touch glossier
        cap = N.new("ShaderNodeMapRange")
        cap.interpolation_type = "SMOOTHSTEP"
        L.new(r, cap.inputs["Value"])
        L.new(math_node("MULTIPLY", prop("cap_r"), 0.9), cap.inputs["From Min"])
        L.new(prop("cap_r"), cap.inputs["From Max"])
        cap.inputs["To Min"].default_value = 1.0
        cap.inputs["To Max"].default_value = 0.0
        blend("Roughness", "FLOAT", 0.28, mask_socket=cap.outputs["Result"])
    else:
        blend("Base Color", "RGBA", (0.008, 0.008, 0.009, 1.0))
        blend("Roughness", "FLOAT", 0.75)
        blend("Sheen Weight", "FLOAT", 0.25)  # a little velvety edge glow, as on a fabric dome
    blend("Normal", "VECTOR", bump.outputs["Normal"])

    # the surround: a rubber half-roll between the cone edge and the trim ring — smooth, faint
    # sheen, no grain. Its outer radius is the piece's surround_r property.
    surround_r = prop("surround_r")
    band_in = N.new("ShaderNodeMapRange")
    band_in.interpolation_type = "SMOOTHSTEP"
    L.new(r, band_in.inputs["Value"])
    L.new(math_node("MULTIPLY", prop("cone_r"), 0.97), band_in.inputs["From Min"])
    L.new(math_node("MULTIPLY", prop("cone_r"), 1.03), band_in.inputs["From Max"])
    band_out = N.new("ShaderNodeMapRange")
    band_out.interpolation_type = "SMOOTHSTEP"
    L.new(r, band_out.inputs["Value"])
    L.new(math_node("MULTIPLY", surround_r, 0.96), band_out.inputs["From Min"])
    L.new(surround_r, band_out.inputs["From Max"])
    band_out.inputs["To Min"].default_value = 1.0
    band_out.inputs["To Max"].default_value = 0.0
    band = math_node("MULTIPLY", band_in.outputs["Result"], band_out.outputs["Result"])
    blend("Base Color", "RGBA", (0.018, 0.018, 0.019, 1.0), mask_socket=band)
    blend("Roughness", "FLOAT", 0.42, mask_socket=band)
    flat = N.new("ShaderNodeNewGeometry").outputs["Normal"]
    blend("Normal", "VECTOR", flat, mask_socket=band)
    return m


FIBRE_PITCH = 1600  # crossed threads per metre in the woofer cones (0.6 mm; reads as grain, not rings)


def new_object(name, mesh):
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    return obj


def mark_sharp(bm):
    """Smooth faces + sharp edges above SHARP_ANGLE == 'shade smooth by angle' (Blender 4.1+)."""
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle(0.0) < SHARP_ANGLE


def apply_modifier(obj, mod):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)


def cut_piece(body, name, cx, cz, radius, y_front, y_back):
    """Exact-boolean a cylinder (axis along Y, spanning y_front..y_back) out of body.

    Returns the intersected piece as a new object; body keeps the pocket. The piece is a closed
    solid: front skin + pocket wall + floor, the latter two hidden inside the cabinet."""
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=128,
        radius=radius,
        depth=abs(y_back - y_front),
        location=(cx, (y_front + y_back) / 2, cz),
        rotation=(math.pi / 2, 0, 0),
    )
    cutter = bpy.context.object
    cutter.name = f"{name}_cutter"
    piece = new_object(name, body.data.copy())
    piece.data.name = name
    for target, op in ((piece, "INTERSECT"), (body, "DIFFERENCE")):
        mod = target.modifiers.new(f"cut_{name}", "BOOLEAN")
        mod.operation = op
        mod.solver = "EXACT"
        mod.object = cutter
        apply_modifier(target, mod)
    bpy.data.objects.remove(cutter)
    return piece


def smoothstep(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def add_excursion_key(obj, cx, cz, r_in, r_out, y_skin, amount=EXCURSION):
    """Piston shape key: full travel inside r_in, easing to zero at the surround edge r_out.

    Only the front skin (y < y_skin) moves; the piece's hidden pocket wall and floor stay put."""
    obj.shape_key_add(name="Basis", from_mix=False)
    key = obj.shape_key_add(name="Excursion", from_mix=False)
    for pt in key.data:
        if pt.co.y >= y_skin:
            continue
        r = math.hypot(pt.co.x - cx, pt.co.z - cz)
        w = smoothstep(1.0 - (r - r_in) / (r_out - r_in))
        pt.co.y -= amount * w  # -Y is toward the camera
    return key



# the parts PMC's STL leaves off the woofers, from the product photos: a domed dust cap over
# the centre of each cone, the rubber half-roll surround between cone and chassis, and the
# polished aluminium ring around the chassis edge (the one bright thing on a PMC baffle).
WOOFER_CAP = 0.45  # dust cap radius as a fraction of the cone radius (~22 mm on the 6")
WOOFER_CAP_RISE = 0.35  # cap height as a fraction of its radius
WOOFER_ROLL = 0.42  # half-roll minor radius as a fraction of the cone-to-chassis gap
TRIM_RING = 0.0015  # the polished ring's tube radius


def _skin_y(me, cx, cz, radius, y_skin, tol=0.002):
    ys = sorted(v.co.y for v in me.vertices if v.co.y < y_skin and abs(math.hypot(v.co.x - cx, v.co.z - cz) - radius) < tol)
    return ys[len(ys) // 2] if ys else None


def _join(target, extra):
    """Join extra into target; its faces take target's slot 0 (join would otherwise give an
    unmaterialed primitive its own empty slot, which renders as flat grey)."""
    slots = len(target.data.materials)
    bpy.ops.object.select_all(action="DESELECT")
    extra.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()
    me = target.data
    # the exact boolean already gave the piece an empty slot for the cutter's faces, and join
    # reuses it for the primitive: send every face in an empty slot to slot 0
    for p in me.polygons:
        if p.material_index >= slots or me.materials[p.material_index] is None:
            p.material_index = 0


def add_woofer_details(piece, name, cx, cz, r_cone, r_surround, r_cut, front, y_skin):
    """Cap and roll are joined into the piece before its shape key exists, so they move with
    the cone. Returns the (static) trim ring, a separate object on the chassis edge."""
    me = piece.data
    r_cap = WOOFER_CAP * r_cone
    h = WOOFER_CAP_RISE * r_cap
    y_cap = _skin_y(me, cx, cz, r_cap, y_skin)
    if y_cap is None:
        y_cap = front + 0.012
    R = (r_cap * r_cap + h * h) / (2 * h)  # sphere radius for a cap of base r_cap, height h
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=R, location=(0, 0, 0))
    cap = bpy.context.object
    y_cut = h - R + 0.0015  # keep the front of the sphere (-Y is toward the camera): the cap plus 1.5 mm buried in the cone
    bm = bmesh.new()
    bm.from_mesh(cap.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y > y_cut], context="VERTS")
    bm.to_mesh(cap.data)
    bm.free()
    cap.data.transform(Matrix.Translation((cx, y_cap - h + R, cz)))
    for p in cap.data.polygons:
        p.use_smooth = True
    _join(piece, cap)

    gap = r_surround - r_cone
    r_roll = r_cone + 0.5 * gap
    minor = WOOFER_ROLL * gap
    y_roll = _skin_y(me, cx, cz, r_roll, y_skin)
    if y_roll is None:
        y_roll = front + 0.004
    bpy.ops.mesh.primitive_torus_add(
        major_radius=r_roll, minor_radius=minor, major_segments=160, minor_segments=24,
        location=(cx, y_roll + 0.35 * minor, cz), rotation=(math.pi / 2, 0, 0),
    )
    roll = bpy.context.object
    for p in roll.data.polygons:
        p.use_smooth = True
    _join(piece, roll)

    bpy.ops.mesh.primitive_torus_add(
        major_radius=r_cut - TRIM_RING, minor_radius=TRIM_RING, major_segments=192, minor_segments=16,
        location=(cx, front + 0.0022, cz), rotation=(math.pi / 2, 0, 0),
    )
    ring = bpy.context.object
    ring.name = f"{name}_Trim"
    for p in ring.data.polygons:
        p.use_smooth = True
    assign(ring, trim_mat)
    return ring



# badge + logo: "BIGHECK" engraved into a plate that fills the PMC badge slot ---------------
# The STL has a 60 x 12 mm rounded slot on the mid/tweeter plate, centred at model (260, 76),
# floor ~12 mm below the front face. A satin Badge fills it; the lettering is booleaned 0.8 mm
# into the Badge (a true engraving) and an emissive Logo inlay sits in the cut, so the letters
# read as engraved when dark and as backlit glass when apply_drive flashes them on the beat.
LOGO_TEXT = "BIGHECK"
LOGO_FONTS = [r"C:\Windows\Fonts\impact.ttf", r"C:\Windows\Fonts\ariblk.ttf", r"C:\Windows\Fonts\arialbd.ttf"]
BADGE_CENTRE = (0.045, -0.124)  # scene x, z
BADGE_SIZE = (0.058, 0.0105)  # w, h (the slot is 60 x 12)
BADGE_FRONT = -0.1780  # 0.6 mm proud of the plate at y = -0.1774
BADGE_DEPTH = 0.004
ENGRAVE = 0.0008


def rounded_box(name, cx, cz, w, h, y_front, depth, radius):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, y_front + depth / 2, cz))
    box = bpy.context.object
    box.name = name
    box.scale = (w, depth, h)
    bpy.ops.object.transform_apply(scale=True)
    bevel = box.modifiers.new("Round", "BEVEL")
    bevel.width = radius
    bevel.segments = 8
    bevel.limit_method = "ANGLE"
    apply_modifier(box, bevel)
    return box


def text_mesh(name, text, size, extrude):
    bpy.ops.object.text_add(location=(0, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.data.body = text
    obj.data.size = size
    obj.data.extrude = extrude / 2  # extrude is applied both ways
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    for font in LOGO_FONTS:
        if os.path.exists(font):
            obj.data.font = bpy.data.fonts.load(font)
            break
    else:
        print("note: no bold system font found — logo uses Blender's default font")
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    obj.data.name = name
    return obj


def build_logo(cabinet_mat):
    cx, cz = BADGE_CENTRE
    w, h = BADGE_SIZE
    badge = rounded_box("Badge", cx, cz, w, h, BADGE_FRONT, BADGE_DEPTH, 0.0015)
    badge_mat = make_material("BadgeMat", base=(0.02, 0.02, 0.022, 1), rough=0.35)
    assign(badge, badge_mat)

    # text in the XY plane facing +Z, then measured, scaled to fit, and stood up facing -Y
    text = text_mesh("Logo", LOGO_TEXT, 0.01, ENGRAVE + 0.002)
    xs = [v.co.x for v in text.data.vertices]
    ys = [v.co.y for v in text.data.vertices]
    fit = min((w - 0.006) / (max(xs) - min(xs)), (h - 0.0025) / (max(ys) - min(ys)))
    centre = Vector(((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, 0))
    text.data.transform(
        Matrix.Rotation(math.pi / 2, 4, "X") @ Matrix.Scale(fit, 4) @ Matrix.Translation(-centre)
    )
    # front face of the extrusion sits at the badge face; the rest goes back into the badge
    front = min(v.co.y for v in text.data.vertices)
    text.data.transform(Matrix.Translation((cx, BADGE_FRONT - front - 0.001, cz)))
    text.location = (0, 0, 0)

    cutter = new_object("Logo_cutter", text.data.copy())
    cutter.data.transform(Matrix.Translation((0, 0, 0)))
    mod = badge.modifiers.new("engrave", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.object = cutter
    # the cutter extends 1 mm in front of the badge (already) and ENGRAVE behind its face
    for v in cutter.data.vertices:
        if v.co.y > BADGE_FRONT + 0.0001:
            v.co.y = BADGE_FRONT + ENGRAVE
    apply_modifier(badge, mod)
    bpy.data.objects.remove(cutter)

    # the inlay: same letters, 4 % smaller so no face is coplanar with the pocket walls, front
    # 0.3 mm below the badge face (inside the 0.8 mm engraving), back buried in the badge
    for v in text.data.vertices:
        v.co.x = cx + (v.co.x - cx) * 0.96
        v.co.z = cz + (v.co.z - cz) * 0.96
        v.co.y = BADGE_FRONT + 0.0003 if v.co.y < BADGE_FRONT + ENGRAVE else BADGE_FRONT + BADGE_DEPTH - 0.0005
    logo_mat = make_material("LogoMat", base=(0.9, 0.55, 0.3, 1), rough=0.4, emission=(1.0, 0.62, 0.3, 1))
    logo_mat.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.0
    assign(text, logo_mat)
    print(f"logo: '{LOGO_TEXT}' engraved {ENGRAVE * 1000:.1f} mm into the badge at scene ({cx}, {cz})")
    return badge, text


def build_placeholder():
    bpy.ops.mesh.primitive_cube_add(location=(0, 0, 0))
    cabinet = bpy.context.object
    cabinet.name = "Cabinet"
    cabinet.dimensions = (0.30, 0.24, 0.55)
    bevel = cabinet.modifiers.new("Bevel", "BEVEL")
    bevel.width = 0.008
    bevel.segments = 3
    assign(cabinet, make_material("CabinetMat", rough=0.5))

    woofer_mat = make_material("WooferMat", base=(0.01, 0.01, 0.01, 1), rough=0.8)
    for name, z in (("Woofer_L", 0.05), ("Woofer_R", -0.13)):
        bpy.ops.mesh.primitive_cylinder_add(
            radius=0.085, depth=0.02, location=(0.06, -0.125, z), rotation=(math.pi / 2, 0, 0)
        )
        woofer = bpy.context.object
        woofer.name = name
        assign(woofer, woofer_mat)
        woofer.shape_key_add(name="Basis")
        key = woofer.shape_key_add(name="Excursion")
        for v in key.data:
            v.co.z += 0.006  # local +Z is world -Y after the rotation: toward the camera

    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.028, location=(-0.07, -0.125, 0.16))
    tweeter = bpy.context.object
    tweeter.name = "Tweeter"
    assign(tweeter, make_material("TweeterMat", base=(0.02, 0.02, 0.022, 1), rough=0.2))
    return cabinet


def add_camera(name, location, target, lens):
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = lens
    cam_data.sensor_fit = "VERTICAL"  # a full-frame body turned portrait, cropped to 9:16
    cam_data.sensor_height = 36.0
    cam = new_object(name, cam_data)
    cam.location = location
    cam.rotation_euler = (Vector(target) - Vector(location)).to_track_quat("-Z", "Y").to_euler()
    return cam


# ---------------------------------------------------------------------------------------
# ---------------------------------------------------------------------------------------
# Speakers are built from kits: blender/kits/<Model>.json, written by measure_kit.py from the
# PMC STL (cabinet size, front face, every driver's centre and radii). build_speaker() imports
# the STL centred on its own origin with the baffle facing -Y, cuts each driver out with an
# exact boolean cylinder, keys it, and places the whole assembly in the rig. The hero PMC6-2
# sits at the origin; everything else is positioned relative to it (see RIG below).
KITS = os.path.join(HERE, "kits")
PMC_DIR = os.path.join(CACHE, "pmc")
STAND_STL = os.path.join(PMC_DIR, "PMC8-2STAND.stl")
STAND_SIZE = (0.540, 1.090, 0.400)  # w, h, d of the PMC8-2 stand
PLATE_REGION = (0.0, 0.135, -0.18, 0.2, 0.0065)  # hero mid/tweeter plate: local x0, x1, z0, z1, depth
PLATE_HEX_TOP, PLATE_HEX_BOTTOM = 0.133, -0.142  # local z: honeycomb above the tweeter ring / below the badge


def load_kit(model):
    with open(os.path.join(KITS, f"{model}.json"), encoding="utf-8") as fh:
        return json.load(fh)


def kit_ready(model):
    if not os.path.exists(os.path.join(KITS, f"{model}.json")):
        return False
    return os.path.exists(os.path.join(ROOT, *load_kit(model)["stl"].split("/")))


def hex_tile_image(path, R=40, nx=6, ny=4):
    """A seamless pointy-top honeycomb height map: raised cells with bevelled edges."""
    W, H = int(round(math.sqrt(3) * R * nx)), 3 * R * ny
    R_x = W / (math.sqrt(3) * nx)  # slightly adjusted radius so the tile wraps exactly in x
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
    best = np.full((H, W), np.inf)
    for row in range(-1, ny * 2 + 2):
        cy = 1.5 * R * row
        off = (math.sqrt(3) * R_x / 2) if row % 2 else 0.0
        for col in range(-1, nx + 2):
            cx = math.sqrt(3) * R_x * col + off
            dx, dy = np.abs(xs - cx), np.abs(ys - cy)
            d = np.maximum(dy, (math.sqrt(3) * dx + dy) / 2)  # hex metric, apothem = sqrt3/2 R
            best = np.minimum(best, d)
    edge = math.sqrt(3) / 2 * R - best  # distance to the cell edge
    height = np.clip(edge / (0.09 * R), 0, 1)  # flat tops, narrow bevels
    height = height * height * (3 - 2 * height)
    rgba = np.empty((H, W, 4), dtype=np.float32)
    rgba[..., :3] = height[..., None]
    rgba[..., 3] = 1.0
    img = bpy.data.images.new("HexTile", W, H, alpha=False, float_buffer=True)
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    img.colorspace_settings.name = "Non-Color"
    return img, (W, H)


def plate_material(name, cell_mm=6.0):
    """The hero's mid/tweeter plate: the cabinet finish with a machined honeycomb relief."""
    m = plastic_material(name)
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    bsdf = N["Principled BSDF"]
    path = os.path.join(ROOT, "assets", "generated", "hex_tile.png")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img, (W, H) = hex_tile_image(path)
    R_mm = cell_mm / math.sqrt(3)
    tile_w, tile_h = W / (math.sqrt(3) * 40) * math.sqrt(3) * R_mm / 1000, H / (3 * 40) * 3 * R_mm / 1000
    coord = N.new("ShaderNodeTexCoord")
    mapping = N.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (1 / tile_w, 1 / tile_h, 1 / tile_h)
    L.new(coord.outputs["Object"], mapping.inputs["Vector"])
    tex = N.new("ShaderNodeTexImage")
    tex.image = img
    tex.projection = "BOX"
    L.new(mapping.outputs["Vector"], tex.inputs["Vector"])
    # on the real plate the honeycomb is only above the tweeter and below the badge; the
    # middle, around the mid dome and the tweeter, is plain
    zsep = N.new("ShaderNodeSeparateXYZ")
    L.new(coord.outputs["Object"], zsep.inputs[0])
    top = N.new("ShaderNodeMapRange")
    top.interpolation_type = "SMOOTHSTEP"
    top.inputs["From Min"].default_value = PLATE_HEX_TOP
    top.inputs["From Max"].default_value = PLATE_HEX_TOP + 0.004
    L.new(zsep.outputs[2], top.inputs["Value"])
    bottom = N.new("ShaderNodeMapRange")
    bottom.interpolation_type = "SMOOTHSTEP"
    bottom.inputs["From Min"].default_value = PLATE_HEX_BOTTOM
    bottom.inputs["From Max"].default_value = PLATE_HEX_BOTTOM - 0.004
    L.new(zsep.outputs[2], bottom.inputs["Value"])
    zone = N.new("ShaderNodeMath")
    zone.operation = "MAXIMUM"
    L.new(top.outputs["Result"], zone.inputs[0])
    L.new(bottom.outputs["Result"], zone.inputs[1])
    relief = N.new("ShaderNodeMath")
    relief.operation = "MULTIPLY"
    L.new(tex.outputs["Color"], relief.inputs[0])
    L.new(zone.outputs[0], relief.inputs[1])
    bump = N.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.2
    bump.inputs["Distance"].default_value = 0.00025
    L.new(relief.outputs[0], bump.inputs["Height"])
    prev = bsdf.inputs["Normal"].links[0].from_socket if bsdf.inputs["Normal"].links else None
    if prev is not None:
        L.new(prev, bump.inputs["Normal"])
    for link in list(bsdf.inputs["Normal"].links):
        L.remove(link)
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Metallic"].default_value = 0.12  # anodised, not chrome
    # the cell tops sit a touch glossier than the edges
    gloss = N.new("ShaderNodeMapRange")
    gloss.inputs["To Min"].default_value = 0.5
    gloss.inputs["To Max"].default_value = 0.4
    L.new(relief.outputs[0], gloss.inputs["Value"])
    for link in list(bsdf.inputs["Roughness"].links):
        L.remove(link)
    L.new(gloss.outputs["Result"], bsdf.inputs["Roughness"])
    return m

# the mid's N-compass waveguide, modelled: PMC's CAD has it as a coarse eight-tooth cog. The
# real part is a smooth flared horn with eight soft petals (valleys on the 45-degree lines,
# ridges between). The cog faces are deleted from the cabinet and this surface sits in the
# hole, from the dome pocket out to a thin flange on the plate. Profiles were read off the
# CAD: ridges run from ~18 mm deep at the dome to the plate at 3.3 mm, valleys stay ~18 mm
# deep out to r 38 mm then climb to meet the ridges at the rim.
WAVEGUIDE_R_IN = 0.0273  # just outside the mid pocket wall (r_cut 27 mm), so the seam is covered
WAVEGUIDE_R_OUT = 0.052  # where the horn meets the plate
WAVEGUIDE_FLANGE = 0.054  # the flange's outer radius, a hair proud of the plate to hide the cut
WAVEGUIDE_PLATE = 0.0033  # plate surface depth around the mid (metres below the baffle)
WAVEGUIDE_PETALS = 8


def _wg_depth(r, theta):
    span = WAVEGUIDE_R_OUT - WAVEGUIDE_R_IN
    u = min(1.0, max(0.0, (WAVEGUIDE_R_OUT - r) / span))  # 1 at the dome, 0 at the rim
    ridge = WAVEGUIDE_PLATE + 0.015 * u ** 2.2
    v = min(1.0, max(0.0, (WAVEGUIDE_R_OUT - r) / 0.014))
    valley = max(ridge, min(0.018, WAVEGUIDE_PLATE + 0.015 * v ** 1.6))
    m = 0.5 + 0.5 * math.cos(WAVEGUIDE_PETALS * theta)
    m = m * m * (3 - 2 * m)  # rounded lobes, not a sine
    return ridge + (valley - ridge) * m


def build_waveguide(body, cx, cz, front, prefix):
    """Delete the CAD cog from body around (cx, cz) and return the modelled horn object."""
    me = body.data
    bm = bmesh.new()
    bm.from_mesh(me)
    doomed = []
    for f in bm.faces:
        c = f.calc_center_median()
        r = math.hypot(c.x - cx, c.z - cz)
        depth = c.y - front
        if 0.0274 < r < 0.0505 and 0.0025 < depth < 0.030:
            doomed.append(f)
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bm.to_mesh(me)
    bm.free()
    print(f"waveguide: {len(doomed)} cog faces removed from {prefix or 'hero'}")

    n_t, rings = 256, []
    # ring radii: an inner lip down the pocket, the horn, then the flange
    radii = [(0.0270, "lip"), (WAVEGUIDE_R_IN, "horn")]
    for k in range(1, 41):
        radii.append((WAVEGUIDE_R_IN + (WAVEGUIDE_R_OUT - WAVEGUIDE_R_IN) * k / 40, "horn"))
    radii.append((WAVEGUIDE_FLANGE, "flange"))
    radii.append((WAVEGUIDE_FLANGE + 0.0002, "skirt"))  # a wall down into the plate: no gap from any angle
    bm = bmesh.new()
    for r, kind in radii:
        ring = []
        for j in range(n_t):
            t = 2 * math.pi * j / n_t
            if kind == "lip":
                depth = 0.027
            elif kind == "flange":
                depth = WAVEGUIDE_PLATE - 0.0003
            elif kind == "skirt":
                depth = 0.012
            else:
                depth = _wg_depth(r, t)
            ring.append(bm.verts.new((cx + r * math.cos(t), front + depth, cz + r * math.sin(t))))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for j in range(n_t):
            bm.faces.new((a[j], a[(j + 1) % n_t], b[(j + 1) % n_t], b[j]))
    bm.normal_update()
    bm.faces.ensure_lookup_table()
    # faces wind so normals point out of the cabinet (-Y): flip if the first face looks inward
    if bm.faces[0].normal.y > 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    for f in bm.faces:
        f.smooth = True
    mesh = bpy.data.meshes.new(f"{prefix}Waveguide")
    bm.to_mesh(mesh)
    bm.free()
    obj = new_object(f"{prefix}Waveguide", mesh)
    assign(obj, cabinet_mat)
    return obj



def build_speaker(model, prefix, location, yaw=0.0, hero=False, scale=(1, 1, 1)):
    kit = load_kit(model)
    stl = os.path.join(ROOT, *kit["stl"].split("/"))
    w, h, d = (v / 1000 for v in kit["size_mm"])
    bpy.ops.wm.stl_import(filepath=stl, global_scale=0.001)
    body = bpy.context.selected_objects[0]
    body.name = f"{prefix}Cabinet"
    me = body.data
    me.name = body.name
    me.transform(Matrix.Rotation(math.pi / 2, 4, "X") @ Matrix.Translation((-w / 2, -h / 2, -d / 2)) @ body.matrix_world)
    body.matrix_world = Matrix.Identity(4)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    mark_sharp(bm)
    bm.to_mesh(me)
    bm.free()
    assign(body, cabinet_mat)
    front = -d / 2
    parts = [body]
    # vents: the honeycomb grilles are modelled solid; delete each cell floor so the grille is
    # open, and put a black cavity behind it
    for vent in kit.get("vents", []):
        x0, x1 = vent["x0_mm"] / 1000 - w / 2, vent["x1_mm"] / 1000 - w / 2
        z0, z1 = vent["y0_mm"] / 1000 - h / 2, vent["y1_mm"] / 1000 - h / 2
        d0, d1 = (v / 1000 for v in vent["floor_mm"])
        bm = bmesh.new()
        bm.from_mesh(me)
        doomed = [
            f for f in bm.faces
            if f.normal.y < -0.9
            and x0 < f.calc_center_median().x < x1
            and z0 < f.calc_center_median().z < z1
            and d0 <= f.calc_center_median().y - front <= d1
        ]
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        bm.to_mesh(me)
        bm.free()
        bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, front + d1 + 0.035, (z0 + z1) / 2))
        cavity = bpy.context.object
        cavity.name = f"{prefix}Vent_Cavity"
        cavity.scale = (x1 - x0 + 0.01, 0.07, z1 - z0 + 0.01)
        assign(cavity, cavity_mat)
        parts.append(cavity)
        print(f"vents: {len(doomed)} cell floors opened on {prefix or 'hero'}")
    if hero:
        me.materials.append(plate_material("PlateMat"))
        x0, x1, z0, z1, depth = PLATE_REGION
        n = 0
        for poly in me.polygons:
            c = poly.center
            if x0 < c.x < x1 and z0 < c.z < z1 and abs(c.y - (front + depth)) < 0.0004 and poly.normal.y < -0.95:
                poly.material_index = 1
                n += 1
        print(f"plate: {n} faces get the honeycomb finish")

    def names_for(kind):
        if kind == "woofer" and hero:
            base = ["Woofer_L", "Woofer_R"]
        else:
            base = []
        first = {"woofer": "Woofer", "mid": "Mid", "tweeter": "Tweeter"}[kind]
        return iter(base + [f"{prefix}{first}" if k == 0 else f"{prefix}{first}_{k}" for k in range(9)])

    names = {k: names_for(k) for k in ("woofer", "mid", "tweeter")}
    info = {"front_y": front, "w": w, "h": h, "d": d, "drivers": []}
    mid_centre = None
    for drv in kit["drivers"]:
        cx = drv["x_mm"] / 1000 - w / 2
        cz = drv["y_mm"] / 1000 - h / 2
        r_cone, r_surround, r_cut = (drv[k] / 1000 for k in ("r_cone_mm", "r_surround_mm", "r_cut_mm"))
        back = front + drv.get("back_mm", 20.0) / 1000 + 0.008  # the cutter reaches behind the deepest point
        name = next(names[drv["kind"]])
        piece = cut_piece(body, name, cx, cz, r_cut, front - 0.02, back)
        if drv["kind"] == "tweeter":
            piece.data.materials[0] = tweeter_mat
        else:
            amount = EXCURSION if drv["kind"] == "woofer" else MID_EXCURSION
            if drv["kind"] == "woofer":
                parts.append(add_woofer_details(piece, name, cx, cz, r_cone, r_surround, r_cut, front, y_skin=back - 0.002))
            add_excursion_key(piece, cx, cz, r_cone, r_surround, y_skin=back - 0.002, amount=amount)
            piece.data.materials[0] = woofer_mat if drv["kind"] == "woofer" else dome_mat
            piece["cone_cx"], piece["cone_cz"], piece["cone_r"] = cx, cz, r_cone
            piece["surround_r"] = r_surround
            piece["cap_r"] = WOOFER_CAP * r_cone if drv["kind"] == "woofer" else 0.0
        parts.append(piece)
        info["drivers"].append({"kind": drv["kind"], "name": name, "x": cx, "z": cz, "r": r_cone})
        if drv["kind"] == "mid":
            mid_centre = (cx, cz)
    if hero and mid_centre is not None:
        parts.append(build_waveguide(body, mid_centre[0], mid_centre[1], front, prefix))
    for obj in parts:
        obj.location = location
        obj.rotation_euler = (0, 0, yaw)
        obj.scale = Vector(obj.scale) * Vector(scale)  # keep a part's own size (the vent cavity)
    print(f"{model} -> {prefix or 'hero'}: {len(kit['drivers'])} drivers cut, {len(me.polygons)} faces")
    return body, info


def place_stand(name, x, y, floor_z, width_scale):
    bpy.ops.wm.stl_import(filepath=STAND_STL, global_scale=0.001)
    stand = bpy.context.selected_objects[0]
    stand.name = name
    w, h, d = STAND_SIZE
    stand.data.transform(Matrix.Rotation(math.pi / 2, 4, "X") @ Matrix.Translation((-w / 2, 0, -d / 2)) @ stand.matrix_world)
    stand.matrix_world = Matrix.Identity(4)
    bm = bmesh.new()
    bm.from_mesh(stand.data)
    mark_sharp(bm)
    bm.to_mesh(stand.data)
    bm.free()
    assign(stand, stand_mat)
    stand.location = (x, y, floor_z)
    stand.scale = (width_scale, 1, 1)
    return stand


cabinet_mat = plastic_material("CabinetMat")
woofer_mat = driver_material("WooferMat", "cone")
dome_mat = driver_material("DomeMat", "dome")
tweeter_mat = make_material("TweeterMat", base=(0.012, 0.012, 0.013, 1), rough=0.45)
tweeter_mat.node_tree.nodes["Principled BSDF"].inputs["Sheen Weight"].default_value = 0.3  # coated fabric dome
stand_mat = make_material("StandMat", base=(0.03, 0.03, 0.032, 1), rough=0.35)
cavity_mat = make_material("CavityMat", base=(0.003, 0.003, 0.003, 1), rough=0.95)
trim_mat = make_material("TrimMat", base=(0.78, 0.79, 0.8, 1), rough=0.38)  # brushed aluminium chassis ring (a mirror would only reflect the void)
trim_mat.node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = 1.0
stand_mat.node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = 0.9

# the rig: a stage. Model, object-name prefix, (x, y) of the cabinet centre, yaw
# (degrees, + faces right), and how it stands: "stand" (a PMC stand under it), "floor", "desk"
# (on the console), or a z offset above the floor. y > 0 is behind the hero's baffle. Layout,
# left to right: PMC8-2 main on its stand with its PMC8-2 SUB on the floor inboard, the hero
# PMC6-2 on a stand, a centre fill stack (PMC8 SUB with the two PMC6 on top), the twin PMC6-2,
# its PMC8-2 SUB, the right PMC8-2 main. Mains and fills are toed in toward the floor.
RIG_SPACING = 1.4  # hero (left) to its twin (right)
RISER_H = 0.0
RIG = [] if INTIMATE else [
    ("PMC6-2", "R6-2_", (RIG_SPACING, 0.0), 0.0, "stand"),
    ("PMC8-2INCSTAND", "L8-2_", (-1.35, 0.30), 15.0, "floor"),
    ("PMC8-2INCSTAND", "R8-2_", (RIG_SPACING + 1.35, 0.30), -15.0, "floor"),
    ("PMC8-2SUB", "LSUB_", (-0.62, 0.15), 15.0, "floor"),
    ("PMC8-2SUB", "RSUB_", (RIG_SPACING + 0.62, 0.15), -15.0, "floor"),
    ("PMC8SUB", "MSUB_", (RIG_SPACING / 2, 0.15), 0.0, "floor"),
    ("PMC6", "LFILL_", (RIG_SPACING / 2 - 0.14, 0.15), 12.0, 0.266),
    ("PMC6", "RFILL_", (RIG_SPACING / 2 + 0.14, 0.15), -12.0, 0.266),
]




if kit_ready("PMC6-2"):
    cabinet, hero = build_speaker("PMC6-2", "", (0, 0, 0), hero=True)
    front_y, top_z, half_w = hero["front_y"], hero["h"] / 2, hero["w"] / 2
    woofers = [drv for drv in hero["drivers"] if drv["kind"] == "woofer"]
    woofer_x = woofers[0]["x"]
    woofer_zs = [drv["z"] for drv in woofers]
    woofer_z_mid, woofer_z_half = (max(woofer_zs) + min(woofer_zs)) / 2, (max(woofer_zs) - min(woofer_zs)) / 2
    tw = next(drv for drv in hero["drivers"] if drv["kind"] == "tweeter")
    tweeter_xz, badge_xz = (tw["x"], tw["z"]), BADGE_CENTRE
    build_logo(cabinet_mat)
    floor_z = -top_z - STAND_SIZE[1] if os.path.exists(STAND_STL) else -top_z
    if os.path.exists(STAND_STL):
        place_stand("Stand_L", 0, 0, floor_z, hero["w"] / STAND_SIZE[0])
    rig_built = []
    for model, prefix, (x, y), yaw, how in RIG:
        if not kit_ready(model):
            print(f"note: {model} not cached — skipped (run fetch-assets + measure_kit)")
            continue
        h = load_kit(model)["size_mm"][1] / 1000
        if how == "stand":
            if os.path.exists(STAND_STL):
                place_stand(f"{prefix}Stand", x, y, floor_z, load_kit(model)["size_mm"][0] / 1000 / STAND_SIZE[0])
            z = floor_z + STAND_SIZE[1] + h / 2
        elif how == "floor":
            z = floor_z + h / 2
        else:
            z = floor_z + how + h / 2
        build_speaker(model, prefix, (x, y, z), math.radians(yaw))
        rig_built.append(prefix.rstrip("_"))
    rig_x0 = min([x - load_kit(m)["size_mm"][0] / 2000 for m, _, (x, _y), _, how in RIG] + [-half_w])
    rig_x1 = max([x + load_kit(m)["size_mm"][0] / 2000 for m, _, (x, _y), _, how in RIG] + [half_w])
    print(f"rig: hero + {', '.join(rig_built) or 'nothing'}; floor at z={floor_z:.3f}")
else:
    print(
        "note: PMC6-2 kit/STL not cached — building placeholder primitives "
        "(run: node scripts/fetch-assets.mjs blender/scenes/void.manifest.json)"
    )
    cabinet = build_placeholder()
    front_y, top_z, half_w = -0.12, 0.275, 0.15
    woofer_x, woofer_z_mid, woofer_z_half = 0.06, -0.04, 0.09
    tweeter_xz, badge_xz = (-0.07, 0.16), (0.06, -0.24)
    floor_z = -top_z
    rig_x0, rig_x1 = -half_w, half_w

# sync slate — a flat panel above the speaker that flashes on beats (the phase-2 proof) ---
bpy.ops.mesh.primitive_plane_add(size=0.3, location=(0, 0.05, top_z + 0.17), rotation=(math.pi / 2, 0, 0))
slate = bpy.context.object
slate.name = "Slate"
slate_mat = make_material("SlateMat", base=(0, 0, 0, 1), rough=1.0, emission=(1.0, 0.55, 0.18, 1))
slate_mat.node_tree.nodes["Principled BSDF"].inputs["Specular IOR Level"].default_value = 0.0  # dark when idle
assign(slate, slate_mat)
slate.hide_render = True  # apply_drive shows it only with --slate

# floor: dark satin ground under the speaker — contact shadow, and the red rims reflect in it
bpy.ops.mesh.primitive_plane_add(size=16, location=((rig_x0 + rig_x1) / 2, 0, floor_z - 0.0005))
floor = bpy.context.object
floor.name = "Floor"
floor_mat = make_material("FloorMat", base=(0.012, 0.012, 0.014, 1), rough=0.3)
_fn = floor_mat.node_tree.nodes
_fl = floor_mat.node_tree.links
_noise = _fn.new("ShaderNodeTexNoise")
_noise.inputs["Scale"].default_value = 2.5
_noise.inputs["Detail"].default_value = 3
_fl.new(_fn.new("ShaderNodeTexCoord").outputs["Object"], _noise.inputs["Vector"])
_rough = _fn.new("ShaderNodeMapRange")
_rough.inputs["To Min"].default_value = 0.1
_rough.inputs["To Max"].default_value = 0.26
_fl.new(_noise.outputs["Fac"], _rough.inputs["Value"])
_fl.new(_rough.outputs["Result"], _fn["Principled BSDF"].inputs["Roughness"])
assign(floor, floor_mat)

# cameras: sorted by name, apply_drive cycles drive.json cuts round-robin over them ---------
# Both hang off CamRig, an empty at the speaker's centre; apply_drive swings its Z rotation
# across the render range, so every camera orbits the speaker together (the sweep).
rig = bpy.data.objects.new("CamRig", None)
scene.collection.objects.link(rig)


def add_focus(name, location):
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_size = 0.02
    empty.location = location
    scene.collection.objects.link(empty)
    return empty


def set_dof(cam, focus, fstop, rack=None):
    """Depth of field with a bladed, slightly anamorphic aperture so highlights bloom into
    lens-shaped bokeh. rack=(start, end): apply_drive glides the focus point from start to end
    over every shot this camera gets."""
    dof = cam.data.dof
    dof.use_dof = True
    dof.focus_object = focus
    dof.aperture_fstop = fstop
    dof.aperture_blades = BOKEH_BLADES
    dof.aperture_rotation = math.radians((sum(map(ord, cam.name)) % 9) - 4)  # a small, fixed, per-lens twist
    dof.aperture_ratio = BOKEH_RATIO
    cam.parent = rig
    if rack:
        focus["rack"] = [c for point in rack for c in point]


upper, lower = woofer_z_mid + woofer_z_half, woofer_z_mid - woofer_z_half
wide = add_camera("Cam1_Wide", (0, front_y - 1.30, 0.02), (0, front_y, 0.0), 50)
set_dof(
    wide,
    add_focus("Focus_Wide", (woofer_x, front_y, upper)),
    1.4,  # the 50 GM feel: subject isolation, motes into discs
    rack=((woofer_x, front_y, upper), (badge_xz[0], front_y, badge_xz[1])),
)
# close-up: a long lens further back flattens the perspective and avoids the edge-on framing
close = add_camera("Cam2_Woofers", (woofer_x + 0.05, front_y - 0.40, 0.06), (woofer_x, front_y, woofer_z_mid), 35)
set_dof(
    close,
    add_focus("Focus_Woofers", (woofer_x, front_y, upper)),
    1.4,  # FE 35 mm f/1.4 GM, up close: wide and intimate
    rack=((woofer_x - 0.16, front_y - 0.03, upper + 0.02), (woofer_x, front_y, lower)),
)
# macro: tweeter and badge from the right; focus racks down the plate from the dome to the logo
macro = add_camera(
    "Cam3_Macro",
    (tweeter_xz[0] + 0.12, front_y - 0.34, 0.0),
    (tweeter_xz[0], front_y, (tweeter_xz[1] + badge_xz[1]) / 2),
    50,
)
set_dof(
    macro,
    add_focus("Focus_Macro", (tweeter_xz[0], front_y, tweeter_xz[1])),
    1.4,  # FE 50 mm f/1.4 GM at a third of a metre
    rack=((tweeter_xz[0], front_y, tweeter_xz[1]), (badge_xz[0], front_y, badge_xz[1])),
)
rig_mid_x = (rig_x0 + rig_x1) / 2


def aim(cam, target):
    c = cam.constraints.new("TRACK_TO")
    c.target = target
    c.track_axis = "TRACK_NEGATIVE_Z"
    c.up_axis = "UP_Y"


# each camera carries a "move": how far it travels (in the rig's space, metres) over every
# shot it gets, eased in and out by apply_drive. Tracked cameras keep aiming at their target.
wide["move"] = [0.0, 0.28, 0.0]  # slow push-in
close["move"] = [0.14, 0.04, -0.03]  # slide across the woofers
macro["move"] = [0.0, 0.02, -0.05]  # drift down the plate with the rack
if not INTIMATE:
    rig_cam = add_camera("Cam4_Rig", (rig_mid_x, front_y - 5.6, 1.3), (rig_mid_x, 0.3, -0.55), 22)
    set_dof(rig_cam, add_focus("Focus_Rig", (0.0, front_y, 0.0)), 5.6, rack=((rig_mid_x, front_y, -0.3), (0.0, front_y, 0.0)))
    aim(rig_cam, add_focus("Aim_Rig", (rig_mid_x, 0.2, -0.5)))
    rig_cam["move"] = [0.0, 0.9, -1.5]  # crane down and in
    low = add_camera("Cam5_Low", (rig_mid_x - 1.6, front_y - 2.2, floor_z + 0.25), (rig_mid_x, -0.5, floor_z + 2.0), 24)
    set_dof(low, add_focus("Focus_Low", (0.0, front_y, 0.0)), 4.0)
    aim(low, add_focus("Aim_Low", (rig_mid_x, -0.4, floor_z + 1.9)))
    low["move"] = [2.4, 0.0, 0.0]  # low dolly along the rig, looking up through the beams
if INTIMATE:
    # close, slow, all on the hero: a track along the baffle at woofer height, and a slow fall
    # from above the cabinet down onto the drivers
    side = add_camera("Cam6_Side", (-half_w - 0.32, front_y - 0.36, 0.02), (woofer_x, front_y, 0.0), 35)
    set_dof(side, add_focus("Focus_Side", (woofer_x, front_y, 0.0)), 1.4)  # 35 mm f/1.4 GM, low across the baffle
    aim(side, add_focus("Aim_Side", (woofer_x, front_y, 0.0)))
    side["move"] = [0.3, -0.03, 0.0]  # track across the woofers from the left edge
    top = add_camera("Cam7_Top", (0.28, front_y - 0.5, 0.62), (0.0, front_y, 0.0), 24)
    set_dof(top, add_focus("Focus_Top", (0.0, front_y, top_z)), 1.4, rack=((0.0, front_y, top_z), (woofer_x, front_y, 0.0)))  # 24 mm f/1.4 GM from above
    aim(top, add_focus("Aim_Top", (0.0, front_y, 0.02)))
    top["move"] = [-0.3, 0.06, -0.35]  # fall from above the cabinet onto the drivers
else:
    side = add_camera("Cam6_Side", (rig_x0 - 1.0, front_y - 0.9, 0.05), (rig_mid_x, 0.0, -0.1), 40)
    set_dof(side, add_focus("Focus_Side", (0.0, front_y, 0.0)), 2.8)
    aim(side, add_focus("Aim_Side", (0.0, front_y, 0.0)))
    side["move"] = [0.9, 0.0, 0.05]  # track in along the line of cabinets
    top = add_camera("Cam7_Top", (rig_mid_x + 0.6, front_y - 1.3, floor_z + 2.5), (0.0, front_y, 0.0), 35)
    set_dof(top, add_focus("Focus_Top", (0.0, front_y, 0.0)), 3.5)
    aim(top, add_focus("Aim_Top", (0.0, front_y, -0.1)))
    top["move"] = [-1.1, 0.2, -0.3]  # from the truss, sweeping across and down onto the hero
scene.camera = wide

# lights: no ambient at all — every highlight comes from an aimed spot ---------------------
# The world is black and EEVEE's bounce light is off, so what is not in a beam stays black.
#   KeyLight  warm, high front-left, tracks KeyTarget: apply_drive glides the target along
#             KeyTarget["path"] over the reel, so the pool of light travels across the drivers
#             and its beam sweeps through the smoke and dust
#   Graze     low from the left, raking across the baffle: the surround rolls catch it, so
#             every cone movement shows as a moving highlight
#   TopBack   dark red, behind and above: traces the top edges, glows through the haze behind
#   RimLeft / RimRight  dark red, behind each side at a grazing angle: their reflections
#             streak down the side panels as the camera orbits past
def add_spot(name, location, target, watts, color, cone_deg, blend=0.3, radius=0.02, volume=1.0):
    data = bpy.data.lights.new(name, "SPOT")
    data.energy = watts
    data.color = color
    data.spot_size = math.radians(cone_deg)
    data.spot_blend = blend
    data.shadow_soft_size = radius  # small source: hard shadows; larger: readable reflections
    data.volume_factor = volume  # how much the beam lights the smoke
    light = new_object(name, data)
    light.location = location
    light.rotation_euler = (Vector(target) - Vector(location)).to_track_quat("-Z", "Y").to_euler()
    return light


WARM, DARK_RED = (1.0, 0.84, 0.66), (0.55, 0.035, 0.02)
COOL = (0.4, 0.6, 1.0)
RIM_COLOR = COOL  # look B: cool rims and back light against the warm key (DARK_RED for the red look)
upper = woofer_z_mid + woofer_z_half
lower = woofer_z_mid - woofer_z_half

key_target = bpy.data.objects.new("KeyTarget", None)
key_target.empty_display_size = 0.03
key_target.location = (woofer_x, front_y, upper)
scene.collection.objects.link(key_target)
# the pool's route across the baffle: above the upper woofer -> mid dome -> lower woofer -> tweeter
key_target["path"] = [
    woofer_x - 0.10, front_y, upper + 0.08,
    0.04, front_y, woofer_z_mid,
    woofer_x + 0.02, front_y, lower,
    0.05, front_y, upper + 0.03,
]
key = add_spot("KeyLight", (-0.30, front_y - 0.85, 0.70), key_target.location, 380 if MOODY else 450, WARM, 18, blend=0.6)
track = key.constraints.new("TRACK_TO")
track.target = key_target
track.track_axis = "TRACK_NEGATIVE_Z"
track.up_axis = "UP_Y"

add_spot("Graze", (-0.80, front_y - 0.12, -0.02), (0.10, front_y - 0.02, 0.0), 150 if MOODY else 220, (1.0, 0.95, 0.9), 22, radius=0.01)
rig_mid = (rig_x0 + rig_x1) / 2
add_spot("TopBack", (rig_mid + 0.1, 0.9, 1.2), (rig_mid, -0.12, top_z - 0.3), 1800, RIM_COLOR, 40, blend=0.8, radius=0.08, volume=0.35)
add_spot("RimLeft", (rig_x0 - 0.9, 0.9, 0.35), (rig_x0, 0.3, -0.2), 900, RIM_COLOR, 28, blend=0.8, radius=0.08, volume=0.05)
add_spot("RimRight", (rig_x1 + 0.9, 0.9, -0.05), (rig_x1, 0.3, -0.2), 800, RIM_COLOR, 28, blend=0.8, radius=0.08, volume=0.05)
# the wall: a wide, soft, warm fill from front-above so the whole rig reads, and a dark-red
# wash from high behind that catches the tops and the stands. Both far dimmer than the hero's key.
if not INTIMATE:
    add_spot("RigFill", (rig_mid, front_y - 4.5, 2.4), (rig_mid, 0.0, -0.6), 260 if MOODY else 1400, (1.0, 0.85, 0.7), 85, blend=0.9, radius=0.35, volume=0.05)
    add_spot("RigWash", (rig_mid, 0.9, 3.0), (rig_mid, 0.2, -0.8), 1100 if MOODY else 2200, DARK_RED, 95, blend=0.9, radius=0.4, volume=0.1)

# the set: a room corner behind the rig — dark plaster walls, a riser under the sub stack,
# red uplights along the wall base, and a neon BIGHECK on the wall that beats with the track
SET_WALLS = False  # True: plaster room corner; False: black void
WALL_Y = 1.35  # back wall plane (behind the set-back PMC8-2s)
WALL_H = 3.2
ROOM_MARGIN = 1.5  # side walls this far outside the rig



# the LED wall (intimate look): a big screen behind the speaker showing the oscilloscope trace.
# In Cycles it is a real light — its cool glow is what edges the cabinet, lights the dust and
# reflects in the floor, so the blue in the frame has a source you can see.
LED_WALL = (2.4, 1.35)  # metres, 16:9
LED_WALL_POS = (0.0, 1.2, 0.12)  # behind the hero
LED_TRACE = (0.55, 0.75, 1.0)  # cool white-blue
LED_PANEL_GLOW = 0.06  # the panel's own faint glow between the traces


def build_led_wall(x, y, z, w, h):
    bpy.ops.mesh.primitive_plane_add(size=1, location=(x, y, z), rotation=(math.pi / 2, 0, 0))
    screen = bpy.context.object
    screen.name = "Scope"
    screen.scale = (w, h, 1)
    m = bpy.data.materials.new("ScopeMat")
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    bsdf = N["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.004, 0.005, 0.008, 1)
    bsdf.inputs["Roughness"].default_value = 0.35  # a glass front: the key reflects in it
    bsdf.inputs["Specular IOR Level"].default_value = 0.6

    def math_node(op, a, b=None):
        n = N.new("ShaderNodeMath")
        n.operation = op
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L.new(v, n.inputs[i])
        return n.outputs[0]

    def value(name):
        n = N.new("ShaderNodeValue")
        n.name = n.label = name
        n.outputs[0].default_value = 0.0
        return n.outputs[0]

    def gauss(d, width):
        return math_node("EXPONENT", math_node("MULTIPLY", -1.0, math_node("POWER", math_node("DIVIDE", d, width), 2.0)))

    B, M, H, T = value("Bass"), value("Mid"), value("High"), value("Time")
    gen = N.new("ShaderNodeTexCoord").outputs["Generated"]
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(gen, sep.inputs[0])
    u, v = sep.outputs[0], sep.outputs[1]
    two_pi = 2 * math.pi
    wave = math_node(
        "ADD",
        math_node("MULTIPLY", B, math_node("SINE", math_node("ADD", math_node("MULTIPLY", u, two_pi * 3), math_node("MULTIPLY", T, 6.0)))),
        math_node(
            "ADD",
            math_node("MULTIPLY", math_node("MULTIPLY", M, 0.6), math_node("SINE", math_node("SUBTRACT", math_node("MULTIPLY", u, two_pi * 11), math_node("MULTIPLY", T, 15.0)))),
            math_node("MULTIPLY", math_node("MULTIPLY", H, 0.3), math_node("SINE", math_node("ADD", math_node("MULTIPLY", u, two_pi * 29), math_node("MULTIPLY", T, 40.0)))),
        ),
    )
    f = math_node("ADD", 0.5, math_node("MULTIPLY", wave, 0.30))
    d = math_node("ABSOLUTE", math_node("SUBTRACT", v, f))
    trace = math_node("ADD", gauss(d, 0.010), math_node("MULTIPLY", 0.15, gauss(d, 0.06)))
    # an LED wall is a grid of pixels: a faint pixel-pitch pattern over everything
    pitch = math_node("MULTIPLY", math_node("SINE", math_node("MULTIPLY", u, two_pi * 240)), math_node("SINE", math_node("MULTIPLY", v, two_pi * 135)))
    pixels = math_node("ADD", 0.7, math_node("MULTIPLY", 0.3, pitch))
    glow = math_node("MULTIPLY", math_node("ADD", math_node("MULTIPLY", trace, LED_TRACE_STRENGTH), LED_PANEL_GLOW), pixels)
    bsdf.inputs["Emission Color"].default_value = (*LED_TRACE, 1)
    L.new(glow, bsdf.inputs["Emission Strength"])
    screen.data.materials.append(m)
    # a thin dark bezel and a slab behind, so it reads as a panel, not a floating rectangle
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y + 0.04, z))
    bezel = bpy.context.object
    bezel.name = "Scope_Bezel"
    bezel.scale = (w + 0.06, 0.07, h + 0.06)
    assign(bezel, make_material("BezelMat", base=(0.02, 0.02, 0.022, 1), rough=0.5))
    return screen


LED_TRACE_STRENGTH = 8.0
if INTIMATE:
    build_led_wall(LED_WALL_POS[0], LED_WALL_POS[1], LED_WALL_POS[2], LED_WALL[0], LED_WALL[1])


def plaster_material(name, base=0.035, rough=0.85):
    m = make_material(name, base=(base, base, base * 1.05, 1), rough=rough)
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    bsdf = N["Principled BSDF"]
    coord = N.new("ShaderNodeTexCoord").outputs["Object"]
    fine = N.new("ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = 180
    fine.inputs["Detail"].default_value = 4
    L.new(coord, fine.inputs["Vector"])
    bump = N.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.3
    bump.inputs["Distance"].default_value = 0.002
    L.new(fine.outputs["Fac"], bump.inputs["Height"])
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    coarse = N.new("ShaderNodeTexNoise")
    coarse.inputs["Scale"].default_value = 1.2
    coarse.inputs["Detail"].default_value = 2
    L.new(coord, coarse.inputs["Vector"])
    tint = N.new("ShaderNodeMapRange")
    tint.inputs["To Min"].default_value = base * 0.6
    tint.inputs["To Max"].default_value = base * 1.4
    L.new(coarse.outputs["Fac"], tint.inputs["Value"])
    L.new(tint.outputs["Result"], bsdf.inputs["Base Color"])
    return m


def wall(name, size, location, rotation):
    bpy.ops.mesh.primitive_plane_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (size[0], size[1], 1)
    assign(obj, wall_mat)
    return obj


if not INTIMATE:
    # SET_WALLS: the room corner. Off = the rig floats in a black void with only the floor, the
    # haze and the light — the more intentional look.
    if SET_WALLS:
        wall_mat = plaster_material("WallMat")
        room_w = (rig_x1 - rig_x0) + 2 * ROOM_MARGIN
        wall("Wall_Back", (room_w, WALL_H), (rig_mid, WALL_Y, floor_z + WALL_H / 2), (math.pi / 2, 0, 0))
        wall("Wall_Left", (WALL_Y + 6.0, WALL_H), (rig_x0 - ROOM_MARGIN, WALL_Y - 3.0, floor_z + WALL_H / 2), (math.pi / 2, 0, math.pi / 2))
        wall("Wall_Right", (WALL_Y + 6.0, WALL_H), (rig_x1 + ROOM_MARGIN, WALL_Y - 3.0, floor_z + WALL_H / 2), (math.pi / 2, 0, math.pi / 2))

    # riser under the centre stack
    if RISER_H > 0:
        bpy.ops.mesh.primitive_cube_add(size=1, location=(rig_mid, 0.15, floor_z + RISER_H / 2))
        riser = bpy.context.object
        riser.name = "Riser"
        riser.scale = (0.75, 0.62, RISER_H)
        bevel = riser.modifiers.new("Bevel", "BEVEL")
        bevel.width = 0.006
        bevel.segments = 3
        assign(riser, make_material("RiserMat", base=(0.02, 0.02, 0.022, 1), rough=0.4))

    # red uplights along the wall base (with the walls) or behind the rig, firing up into the haze
    for k, x in enumerate((rig_x0 + 0.1, rig_mid - 0.7, rig_mid + 0.7, rig_x1 - 0.1)):
        add_spot(f"WallUp_{k}", (x, WALL_Y - 0.25, floor_z + 0.04), (x, WALL_Y, floor_z + 2.6), 260 if SET_WALLS else 60, RIM_COLOR, 55, blend=0.9, radius=0.05, volume=0.3)

    # neon BIGHECK on the back wall above the rig
    neon = text_mesh("Neon", LOGO_TEXT, 0.34, 0.03)
    neon.data.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
    xs = [v.co.x for v in neon.data.vertices]
    neon.location = (rig_mid - (max(xs) + min(xs)) / 2, WALL_Y - 0.03, floor_z + 2.35)
    neon_mat = make_material("NeonMat", base=(0.9, 0.35, 0.12, 1), rough=0.3, emission=(1.0, 0.42, 0.14, 1))
    neon_mat.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.6
    assign(neon, neon_mat)
    if hasattr(neon, "visible_shadow"):
        neon.visible_shadow = False

    # the light show: a truss across the room above the rig carrying six moving heads, two laser
    # units and two blinders; projectors throwing the name onto the side walls; an LED wall behind
    # the rig with a live oscilloscope trace. apply_drive keys all of it from the track.
    TRUSS_Z = 3.0  # above the floor
    TRUSS_Y = -0.9
    SHOW_HEADS = 4
    LASER_BEAMS = 4
    HEAD_POWER = 520 if MOODY else 1400
    LASER_POWER = 3000 if MOODY else 7000
    PROJECTOR_POWER = 140 if MOODY else 260

    truss_mat = make_material("TrussMat", base=(0.05, 0.05, 0.052, 1), rough=0.4)
    truss_mat.node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = 0.85
    fixture_mat = make_material("FixtureMat", base=(0.02, 0.02, 0.022, 1), rough=0.5)


    def tube(name, a, b, r=0.024):
        a, b = Vector(a), Vector(b)
        d = b - a
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=r, depth=d.length, location=(a + b) / 2)
        obj = bpy.context.object
        obj.name = name
        obj.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
        assign(obj, truss_mat)
        return obj


    def build_truss(x0, x1, y, z, section=0.29):
        s = section / 2
        corners = ((-s, -s), (s, -s), (-s, s), (s, s))
        for k, (dy, dz) in enumerate(corners):
            tube(f"Truss_Chord_{k}", (x0, y + dy, z + dz), (x1, y + dy, z + dz))
        n = max(1, int((x1 - x0) / 0.5))
        for i in range(n + 1):
            x = x0 + (x1 - x0) * i / n
            for k, ((dy0, dz0), (dy1, dz1)) in enumerate((((-s, -s), (-s, s)), ((s, -s), (s, s)), ((-s, -s), (s, -s)), ((-s, s), (s, s)))):
                tube(f"Truss_Bar_{i}_{k}", (x, y + dy0, z + dz0), (x, y + dy1, z + dz1), r=0.011)
            if i < n:
                xn = x0 + (x1 - x0) * (i + 1) / n
                tube(f"Truss_Diag_{i}", (x, y - s, z - s), (xn, y - s, z + s), r=0.011)
                tube(f"Truss_DiagB_{i}", (x, y - s, z - s), (xn, y + s, z - s), r=0.011)


    def track_to(obj, target):
        c = obj.constraints.new("TRACK_TO")
        c.target = target
        c.track_axis = "TRACK_NEGATIVE_Z"
        c.up_axis = "UP_Y"


    def target_empty(name, location):
        e = bpy.data.objects.new(name, None)
        e.empty_display_size = 0.05
        e.location = location
        scene.collection.objects.link(e)
        return e


    def moving_head(k, x, y, z, aim):
        target = target_empty(f"HeadTarget_{k}", aim)
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.075, depth=0.26, location=(x, y, z - 0.33))
        body = bpy.context.object
        body.name = f"Head_{k}_Body"
        assign(body, fixture_mat)
        track_to(body, target)
        bpy.ops.mesh.primitive_circle_add(vertices=24, radius=0.058, fill_type="NGON", location=(0, 0, -0.131))
        lens = bpy.context.object
        lens.name = f"Head_{k}_Lens"
        lens_mat = make_material(f"HeadLens_{k}", base=(0, 0, 0, 1), emission=(1, 1, 1, 1))
        lens_mat.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 4.0
        assign(lens, lens_mat)
        lens.parent = body
        tube(f"Head_{k}_Yoke", (x, y, z - 0.145), (x, y, z - 0.2), r=0.02)
        data = bpy.data.lights.new(f"Head_{k}", "SPOT")
        data.energy = HEAD_POWER
        data.color = (1.0, 0.3, 0.9)
        data.spot_size = math.radians(14)
        data.spot_blend = 0.15
        data.shadow_soft_size = 0.03
        data.volume_factor = 1.0
        light = new_object(f"Head_{k}", data)
        # the light rides on the body's front face (a light inside the body would be shadowed by it)
        light.parent = body
        light.location = (0, 0, -0.145)
        return light


    def laser_unit(k, x, y, z, fan_centre):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z - 0.23))
        box = bpy.context.object
        box.name = f"Laser_{k}_Unit"
        box.scale = (0.22, 0.16, 0.12)
        assign(box, fixture_mat)
        tube(f"Laser_{k}_Mount", (x, y, z - 0.145), (x, y, z - 0.17), r=0.015)
        for j in range(LASER_BEAMS):
            target = target_empty(f"LaserTarget_{k}_{j}", (fan_centre[0] + (j - (LASER_BEAMS - 1) / 2) * 0.5, fan_centre[1], fan_centre[2]))
            data = bpy.data.lights.new(f"Laser_{k}_{j}", "SPOT")
            data.energy = LASER_POWER
            data.color = (0.15, 1.0, 0.25)
            data.spot_size = math.radians(0.9)
            data.spot_blend = 0.0
            data.shadow_soft_size = 0.002
            data.volume_factor = 6.0
            light = new_object(f"Laser_{k}_{j}", data)
            light.location = (x, y, z - 0.315)  # just below the unit, clear of its box
            track_to(light, target)


    def projector(side, x, y, floor_z, size=0.7):
        """A projector on the truss throws the name onto the floor in front of the rig: an
        emissive decal lying on the floor plus the beam that appears to draw it."""
        text = text_mesh(f"Proj_{side}", LOGO_TEXT, size, 0.004)
        xs = [v.co.x for v in text.data.vertices]
        text.location = (x - (max(xs) + min(xs)) / 2, y, floor_z + 0.004)
        mat = make_material(f"ProjMat_{side}", base=(0, 0, 0, 1), emission=(1.0, 0.62, 0.3, 1) if MOODY else (0.7, 0.85, 1.0, 1))
        mat.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 1.2 if MOODY else 1.8
        assign(text, mat)
        if hasattr(text, "visible_shadow"):
            text.visible_shadow = False
        data = bpy.data.lights.new(f"Proj_{side}_Beam", "SPOT")
        data.energy = PROJECTOR_POWER
        data.color = (1.0, 0.62, 0.3) if MOODY else (0.7, 0.85, 1.0)
        data.spot_size = math.radians(22)
        data.spot_blend = 0.1
        data.shadow_soft_size = 0.01
        data.volume_factor = 0.9
        light = new_object(f"Proj_{side}_Beam", data)
        light.location = (x, TRUSS_Y, floor_z + TRUSS_Z - 0.25)
        track_to(light, target_empty(f"ProjTarget_{side}", (x, y, floor_z)))


    def blinder(k, x, y, z, aim):
        data = bpy.data.lights.new(f"Blinder_{k}", "SPOT")
        data.energy = 0.0
        data.color = (1.0, 0.85, 0.7)
        data.spot_size = math.radians(30)
        data.spot_blend = 0.5
        data.shadow_soft_size = 0.08
        data.volume_factor = 0.4
        light = new_object(f"Blinder_{k}", data)
        light.location = (x, y, z - 0.3)
        track_to(light, target_empty(f"BlinderTarget_{k}", aim))


    def build_scope(x, y, z, w, h):
        """The LED wall: an oscilloscope trace drawn in the shader from Bass/Mid/High/Time values."""
        bpy.ops.mesh.primitive_plane_add(size=1, location=(x, y, z), rotation=(math.pi / 2, 0, 0))
        screen = bpy.context.object
        screen.name = "Scope"
        screen.scale = (w, h, 1)
        m = bpy.data.materials.new("ScopeMat")
        m.use_nodes = True
        nt = m.node_tree
        N, L = nt.nodes, nt.links
        bsdf = N["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = (0.005, 0.01, 0.006, 1)
        bsdf.inputs["Roughness"].default_value = 0.6

        def math_node(op, a, b=None):
            n = N.new("ShaderNodeMath")
            n.operation = op
            for i, v in enumerate((a, b)):
                if v is None:
                    continue
                if isinstance(v, (int, float)):
                    n.inputs[i].default_value = v
                else:
                    L.new(v, n.inputs[i])
            return n.outputs[0]

        def value(name):
            n = N.new("ShaderNodeValue")
            n.name = n.label = name
            n.outputs[0].default_value = 0.0
            return n.outputs[0]

        def gauss(d, width):
            return math_node("EXPONENT", math_node("MULTIPLY", -1.0, math_node("POWER", math_node("DIVIDE", d, width), 2.0)))

        B, M, H, T = value("Bass"), value("Mid"), value("High"), value("Time")
        gen = N.new("ShaderNodeTexCoord").outputs["Generated"]
        sep = N.new("ShaderNodeSeparateXYZ")
        L.new(gen, sep.inputs[0])
        u, v = sep.outputs[0], sep.outputs[1]
        two_pi = 2 * math.pi
        wave = math_node(
            "ADD",
            math_node("MULTIPLY", B, math_node("SINE", math_node("ADD", math_node("MULTIPLY", u, two_pi * 3), math_node("MULTIPLY", T, 6.0)))),
            math_node(
                "ADD",
                math_node("MULTIPLY", math_node("MULTIPLY", M, 0.6), math_node("SINE", math_node("SUBTRACT", math_node("MULTIPLY", u, two_pi * 11), math_node("MULTIPLY", T, 15.0)))),
                math_node("MULTIPLY", math_node("MULTIPLY", H, 0.3), math_node("SINE", math_node("ADD", math_node("MULTIPLY", u, two_pi * 29), math_node("MULTIPLY", T, 40.0)))),
            ),
        )
        f = math_node("ADD", 0.5, math_node("MULTIPLY", wave, 0.30))
        d = math_node("ABSOLUTE", math_node("SUBTRACT", v, f))
        trace = math_node("ADD", gauss(d, 0.012), math_node("MULTIPLY", 0.12, gauss(d, 0.08)))

        def grid_lines(coord, n):
            fr = math_node("FRACT", math_node("MULTIPLY", coord, n))
            near = math_node("MINIMUM", fr, math_node("SUBTRACT", 1.0, fr))
            g = N.new("ShaderNodeMapRange")
            g.interpolation_type = "SMOOTHSTEP"
            L.new(near, g.inputs["Value"])
            g.inputs["From Min"].default_value = 0.004
            g.inputs["From Max"].default_value = 0.012
            g.inputs["To Min"].default_value = 1.0
            g.inputs["To Max"].default_value = 0.0
            return g.outputs["Result"]

        glow = math_node("MULTIPLY", trace, 6.0)
        bsdf.inputs["Emission Color"].default_value = (1.0, 0.45, 0.15, 1) if MOODY else (0.25, 1.0, 0.4, 1)
        L.new(glow, bsdf.inputs["Emission Strength"])
        L.new(math_node("MINIMUM", glow, 1.0), bsdf.inputs["Alpha"])  # only the trace exists
        m.surface_render_method = "BLENDED"
        if hasattr(screen, "visible_shadow"):
            screen.visible_shadow = False
        screen.data.materials.append(m)
        return screen


    truss_x0, truss_x1 = rig_x0 - 0.6, rig_x1 + 0.6
    truss_z = floor_z + TRUSS_Z
    build_truss(truss_x0, truss_x1, TRUSS_Y, truss_z)
    for k in range(SHOW_HEADS):
        hx = truss_x0 + 0.5 + (truss_x1 - truss_x0 - 1.0) * k / (SHOW_HEADS - 1)
        moving_head(k, hx, TRUSS_Y, truss_z, (rig_mid, -0.6, floor_z + 0.4))
    laser_unit(0, truss_x0 + 0.25, TRUSS_Y, truss_z, (rig_mid - 0.5, -2.4, floor_z + 0.15))
    laser_unit(1, truss_x1 - 0.25, TRUSS_Y, truss_z, (rig_mid + 0.5, -2.4, floor_z + 0.15))
    blinder(0, truss_x0 + 1.0, TRUSS_Y - 0.2, truss_z, (rig_mid, -5.0, floor_z + 0.6))
    blinder(1, truss_x1 - 1.0, TRUSS_Y - 0.2, truss_z, (rig_mid, -5.0, floor_z + 0.6))
    projector("L", rig_mid - 1.7, -2.3, floor_z)
    projector("R", rig_mid + 1.7, -2.3, floor_z)
    build_scope(rig_mid, 1.0, floor_z + 1.75, 3.6, 1.0)

if INTIMATE and BACK_LASERS:
    # a few thin beams far behind the speaker, fanning slowly through the haze: depth, not a show
    for j in range(BACK_LASERS):
        target = bpy.data.objects.new(f"LaserTarget_0_{j}", None)
        target.empty_display_size = 0.05
        # a curtain of beams just behind the cabinet, crossing above and beside it
        target.location = (2.6, 0.42, 0.26 + 0.42 * j / max(1, BACK_LASERS - 1))
        scene.collection.objects.link(target)
        data = bpy.data.lights.new(f"Laser_0_{j}", "SPOT")
        data.energy = BACK_LASER_POWER
        data.color = BACK_LASER_COLOR
        data.spot_size = math.radians(1.3)
        data.spot_blend = 0.0
        data.shadow_soft_size = 0.002
        data.volume_factor = 3.0
        light = new_object(f"Laser_0_{j}", data)
        light.location = (-2.6, 0.5, -0.1 + 0.05 * j)
        light["fan"] = list(target.location)  # apply_drive scans the beam around this point
        c = light.constraints.new("TRACK_TO")
        c.target = target
        c.track_axis = "TRACK_NEGATIVE_Z"
        c.up_axis = "UP_Y"

if hasattr(slate, "visible_shadow"):
    slate.visible_shadow = False  # the sync slate must never shadow the back light


# dust: thousands of tiny glossy motes floating in front of the speaker ---------------------
# Geometry nodes, so every frame is computed on its own (no particle cache): random points in
# a box, drifting toward camera, streamed and puffed by the woofers' air (see build_dust) and
# wandering on 4D noise over Time. They carry no emission — they only sparkle where a beam
# catches them, and out of focus they open into soft bokeh shapes.
DUST_COUNT = 25000  # the plan's void row is 50-100k; 25k reads right at this distance
DUST_BOX = ((rig_x0 - 0.7, -0.50, floor_z), (rig_x1 + 0.7, 1.2, 0.80))  # from well behind the speaker to just short of the close-up lens
DUST_RADIUS = (0.00025, 0.0007)  # metres, log-normal: in focus they are sub-pixel, out of focus they bloom
DUST_LINT = 0.07  # fraction of motes that are lint: flattened, elongated, randomly turned
DUST_BACKLIGHT = 110  # W, the dedicated dust backlight


def dust_material(name):
    """Matte, warm mid-grey, half translucent: no specular at all (glints read as glitter), so a
    mote only shows where a backlight shines through it or the lens blurs it into a disc."""
    m = make_material(name, base=(0.55, 0.5, 0.44, 1), rough=1.0)
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    bsdf = N["Principled BSDF"]
    bsdf.inputs["Specular IOR Level"].default_value = 0.0
    out = N["Material Output"]
    trans = N.new("ShaderNodeBsdfTranslucent")
    trans.inputs["Color"].default_value = (1.0, 0.9, 0.78, 1)
    mix = N.new("ShaderNodeMixShader")
    mix.inputs["Fac"].default_value = 0.5
    L.new(bsdf.outputs["BSDF"], mix.inputs[1])
    L.new(trans.outputs["BSDF"], mix.inputs[2])
    for link in list(out.inputs["Surface"].links):
        L.remove(link)
    L.new(mix.outputs["Shader"], out.inputs["Surface"])
    return m


def build_dust(front, wx, wz_mid, wz_half, half_w, half_h, back):
    """Dust field with wind from the woofers. Inputs keyed by apply_drive:
    Drift  slow room drift toward camera (shared with the smoke)
    Gust   running total of air the cones have moved: motes in the column in front of the
           woofers stream toward camera at a speed that follows the bass, and wrap round
    Push   the current hit (decaying): motes just in front of a cone jump forward and outward
    Time   turbulence"""
    ng = bpy.data.node_groups.new("DustField", "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    for name in ("Drift", "Gust", "Push", "Time"):
        ng.interface.new_socket(name, in_out="INPUT", socket_type="NodeSocketFloat")
    N, L = ng.nodes, ng.links
    gin = N.new("NodeGroupInput")
    gout = N.new("NodeGroupOutput")

    def math_node(op, *inputs):
        n = N.new("ShaderNodeMath")
        n.operation = op
        for i, v in enumerate(inputs):
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L.new(v, n.inputs[i])
        return n.outputs[0]

    def map_range(v, fmin, fmax, tmin, tmax):
        n = N.new("ShaderNodeMapRange")
        n.interpolation_type = "SMOOTHSTEP"
        n.clamp = True
        L.new(v, n.inputs["Value"])
        for key, val in (("From Min", fmin), ("From Max", fmax), ("To Min", tmin), ("To Max", tmax)):
            n.inputs[key].default_value = val
        return n.outputs["Result"]

    (x0, y0, z0), (x1, y1, z1) = DUST_BOX
    rand_pos = N.new("FunctionNodeRandomValue")
    rand_pos.data_type = "FLOAT_VECTOR"
    rand_pos.inputs["Min"].default_value = (x0, y0, z0)
    rand_pos.inputs["Max"].default_value = (x1, y1, z1)
    rand_pos.inputs["Seed"].default_value = 7

    points = N.new("GeometryNodePoints")
    points.inputs["Count"].default_value = DUST_COUNT
    L.new(rand_pos.outputs["Value"], points.inputs["Position"])

    pos = N.new("GeometryNodeInputPosition").outputs[0]
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(pos, sep.inputs[0])
    px, py, pz = sep.outputs[0], sep.outputs[1], sep.outputs[2]

    # the wind column: a stadium around the two woofer axes, 1 on axis fading to 0 at 16 cm
    dx = math_node("SUBTRACT", px, wx)
    dz_signed = math_node("SUBTRACT", pz, wz_mid)
    dz = math_node("MAXIMUM", math_node("SUBTRACT", math_node("ABSOLUTE", dz_signed), wz_half), 0.0)
    r = math_node("SQRT", math_node("ADD", math_node("MULTIPLY", dx, dx), math_node("MULTIPLY", dz, dz)))
    column = map_range(r, 0.05, 0.16, 1.0, 0.0)
    r_safe = math_node("MAXIMUM", r, 0.01)
    nx = math_node("DIVIDE", dx, r_safe)
    nz = math_node("DIVIDE", math_node("MULTIPLY", math_node("SIGN", dz_signed), dz), r_safe)

    # forward travel: room drift everywhere, plus the stream inside the column; wrap round
    stream = math_node("MULTIPLY", math_node("MULTIPLY", gin.outputs["Gust"], DUST_STREAM), column)
    y = math_node("WRAP", math_node("SUBTRACT", math_node("SUBTRACT", py, math_node("MULTIPLY", gin.outputs["Drift"], 0.5)), stream), y1, y0)

    # the room's air goes around the cabinet, not through it: motes in the cabinet's footprint
    # are eased sideways as they approach from behind, and none exist inside it
    px_abs = math_node("ABSOLUTE", px)
    in_x = map_range(px_abs, half_w + 0.08, half_w + 0.02, 0.0, 1.0)
    in_z = map_range(math_node("ABSOLUTE", pz), half_h + 0.08, half_h + 0.02, 0.0, 1.0)
    near_y = math_node("MULTIPLY", map_range(y, back + 0.6, back + 0.1, 0.0, 1.0), map_range(y, front - 0.02, front + 0.02, 0.0, 1.0))
    around = math_node("MULTIPLY", math_node("MULTIPLY", in_x, in_z), near_y)
    push_out = math_node("MULTIPLY", around, math_node("ADD", math_node("SUBTRACT", half_w + 0.1, px_abs), 0.0))
    px = math_node("ADD", px, math_node("MULTIPLY", math_node("SIGN", math_node("ADD", px, 0.001)), push_out))

    # the puff: motes just ahead of a cone jump forward and spread outward on a hit
    ahead = math_node("SUBTRACT", front, y)
    axial = math_node("MULTIPLY", map_range(ahead, -0.01, 0.02, 0.0, 1.0), map_range(ahead, 0.06, 0.22, 1.0, 0.0))
    puff = math_node("MULTIPLY", math_node("MULTIPLY", column, axial), gin.outputs["Push"])
    spread = math_node("MULTIPLY", puff, DUST_SPREAD)
    comb = N.new("ShaderNodeCombineXYZ")
    L.new(math_node("ADD", px, math_node("MULTIPLY", nx, spread)), comb.inputs[0])
    L.new(math_node("SUBTRACT", y, math_node("MULTIPLY", puff, DUST_PUFF)), comb.inputs[1])
    L.new(math_node("ADD", pz, math_node("MULTIPLY", nz, spread)), comb.inputs[2])

    noise = N.new("ShaderNodeTexNoise")
    noise.noise_dimensions = "4D"
    noise.inputs["Scale"].default_value = 1.5
    noise.inputs["Detail"].default_value = 1.0
    L.new(comb.outputs[0], noise.inputs["Vector"])
    L.new(math_node("MULTIPLY", gin.outputs["Time"], 0.06), noise.inputs["W"])
    centred = N.new("ShaderNodeVectorMath")
    centred.operation = "SUBTRACT"
    L.new(noise.outputs["Color"], centred.inputs[0])
    centred.inputs[1].default_value = (0.5, 0.5, 0.5)
    wander = N.new("ShaderNodeVectorMath")
    wander.operation = "SCALE"
    L.new(centred.outputs[0], wander.inputs[0])
    wander.inputs["Scale"].default_value = 0.12
    moved = N.new("ShaderNodeVectorMath")
    moved.operation = "ADD"
    L.new(comb.outputs[0], moved.inputs[0])
    L.new(wander.outputs[0], moved.inputs[1])

    set_pos = N.new("GeometryNodeSetPosition")
    L.new(points.outputs[0], set_pos.inputs["Geometry"])
    L.new(moved.outputs[0], set_pos.inputs["Position"])

    # the motes: tiny spheres with a log-normal size spread, plus a few percent of lint —
    # flattened, elongated, randomly turned. Warm light grey, part translucent, so the
    # backlight glows through them (DustBack, light-linked to this collection in Cycles).
    dust_mat = dust_material("DustMat")
    mote = N.new("GeometryNodeMeshIcoSphere")
    mote.inputs["Radius"].default_value = 1.0
    mote.inputs["Subdivisions"].default_value = 1
    mat_node = N.new("GeometryNodeSetMaterial")
    L.new(mote.outputs["Mesh"], mat_node.inputs["Geometry"])
    mat_node.inputs["Material"].default_value = dust_mat
    lint_shape = N.new("GeometryNodeTransform")
    L.new(mat_node.outputs["Geometry"], lint_shape.inputs["Geometry"])
    lint_shape.inputs["Scale"].default_value = (3.2, 0.35, 1.0)

    log_r = N.new("FunctionNodeRandomValue")
    log_r.data_type = "FLOAT"
    log_r.inputs["Min"].default_value = math.log(DUST_RADIUS[0])
    log_r.inputs["Max"].default_value = math.log(DUST_RADIUS[1])
    log_r.inputs["Seed"].default_value = 3
    radius = math_node("EXPONENT", log_r.outputs["Value"])

    pick = N.new("FunctionNodeRandomValue")
    pick.data_type = "FLOAT"
    pick.inputs["Seed"].default_value = 11
    is_lint = N.new("FunctionNodeCompare")
    is_lint.data_type = "FLOAT"
    is_lint.operation = "LESS_THAN"
    L.new(pick.outputs["Value"], is_lint.inputs[0])
    is_lint.inputs[1].default_value = DUST_LINT
    not_lint = N.new("FunctionNodeBooleanMath")
    not_lint.operation = "NOT"
    L.new(is_lint.outputs[0], not_lint.inputs[0])

    inst = N.new("GeometryNodeInstanceOnPoints")
    L.new(set_pos.outputs["Geometry"], inst.inputs["Points"])
    L.new(not_lint.outputs[0], inst.inputs["Selection"])
    L.new(mat_node.outputs["Geometry"], inst.inputs["Instance"])
    L.new(radius, inst.inputs["Scale"])

    spin = N.new("FunctionNodeRandomValue")
    spin.data_type = "FLOAT_VECTOR"
    spin.inputs["Max"].default_value = (6.283, 6.283, 6.283)
    spin.inputs["Seed"].default_value = 17
    lint = N.new("GeometryNodeInstanceOnPoints")
    L.new(set_pos.outputs["Geometry"], lint.inputs["Points"])
    L.new(is_lint.outputs[0], lint.inputs["Selection"])
    L.new(lint_shape.outputs["Geometry"], lint.inputs["Instance"])
    L.new(spin.outputs["Value"], lint.inputs["Rotation"])
    L.new(math_node("MULTIPLY", radius, 1.6), lint.inputs["Scale"])

    join = N.new("GeometryNodeJoinGeometry")
    L.new(lint.outputs["Instances"], join.inputs[0])
    L.new(inst.outputs["Instances"], join.inputs[0])
    L.new(join.outputs[0], gout.inputs["Geometry"])

    obj = new_object("Dust", bpy.data.meshes.new("Dust"))
    mod = obj.modifiers.new("Dust", "NODES")
    mod.node_group = ng
    obj.data.materials.append(dust_mat)
    return obj


DUST_STREAM = 0.0  # the conveyor stream out of the woofers read as the speaker emitting dust; off
DUST_PUFF = 0.05  # metres a mote right in front of a cone jumps on a full hit
DUST_SPREAD = 0.025  # metres it spreads outward at the same time
build_dust(front_y, woofer_x, woofer_z_mid, woofer_z_half, half_w, top_z, -front_y)

# world: black to camera and to lighting. Raise WORLD_STRENGTH to bring back the studio HDRI
# as soft fill / reflections. --------------------------------------------------------------
WORLD_STRENGTH = 0.0
world = bpy.data.worlds.new("VoidWorld")
scene.world = world
world.use_nodes = True
wn, wl = world.node_tree.nodes, world.node_tree.links
bg = wn["Background"]
black = wn.new("ShaderNodeBackground")
black.inputs["Color"].default_value = (0, 0, 0, 1)
black.inputs["Strength"].default_value = 0.0
light_path = wn.new("ShaderNodeLightPath")
mix = wn.new("ShaderNodeMixShader")
wl.new(light_path.outputs["Is Camera Ray"], mix.inputs["Fac"])
wl.new(bg.outputs["Background"], mix.inputs[1])
wl.new(black.outputs["Background"], mix.inputs[2])
wl.new(mix.outputs["Shader"], wn["World Output"].inputs["Surface"])
bg.inputs["Strength"].default_value = WORLD_STRENGTH
if WORLD_STRENGTH > 0 and os.path.exists(HDRI):
    env = wn.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(HDRI)
    wl.new(env.outputs["Color"], bg.inputs["Color"])
else:
    bg.inputs["Color"].default_value = (0, 0, 0, 1)
scene.eevee.use_raytracing = False
scene.eevee.use_fast_gi = False

# motion blur: the per-frame cone vibration from apply_drive smears like a real driver
scene.view_settings.view_transform = "ACES 2.0"  # pinned by the plan; grade through it, never change it mid-project
scene.view_settings.exposure = -0.55 if MOODY else 0.0
scene.render.use_motion_blur = True
scene.render.motion_blur_shutter = 0.5
scene.eevee.motion_blur_steps = 3  # real time slices: the cone moves along the view axis, which vector blur cannot show


# smoke: a procedural volume the woofers shove forward ---------------------------------------
# apply_drive keys three Value nodes per frame: Push (kick transient, bends the smoke out of
# the woofers), Drift (running sum of bass, the whole cloud creeps toward camera) and Time
# (slow turbulence). No simulation bake, so it renders the same way for every track.
def build_smoke(front, wx, wz_mid, wz_half):
    # y -1.0 .. +0.02: stops short of the wide camera, and ends just behind the baffle so
    # nothing lit sits behind the slate (it would silhouette)
    # y from -3.2 (past the cameras) to +2.0 (behind the speaker, where the back lasers live)
    bpy.ops.mesh.primitive_cube_add(size=1, location=((rig_x0 + rig_x1) / 2, -0.6, (floor_z + 3.3) / 2))
    smoke = bpy.context.object
    smoke.name = "Smoke"
    smoke.scale = (rig_x1 - rig_x0 + 3.0, 5.2, 3.3 - floor_z)
    m = bpy.data.materials.new("SmokeMat")
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    N.remove(N["Principled BSDF"])
    out_node = N["Material Output"]

    def math_node(op, a, b=None):
        n = N.new("ShaderNodeMath")
        n.operation = op
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L.new(v, n.inputs[i])
        return n.outputs[0]

    def map_range(v, fmin, fmax, tmin, tmax):
        n = N.new("ShaderNodeMapRange")
        n.interpolation_type = "SMOOTHSTEP"
        n.clamp = True
        L.new(v, n.inputs["Value"])
        for key, val in (("From Min", fmin), ("From Max", fmax), ("To Min", tmin), ("To Max", tmax)):
            n.inputs[key].default_value = val
        return n.outputs["Result"]

    def value(name):
        n = N.new("ShaderNodeValue")
        n.name = n.label = name
        n.outputs[0].default_value = 0.0
        return n.outputs[0]

    push, drift, time = value("Push"), value("Drift"), value("Time")

    pos = N.new("ShaderNodeNewGeometry").outputs["Position"]
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(pos, sep.inputs[0])
    px, py, pz = sep.outputs[0], sep.outputs[1], sep.outputs[2]

    # jet mask: 1 on the woofer axes just in front of the baffle, 0 away from them
    dx = math_node("SUBTRACT", px, wx)
    dz = math_node("SUBTRACT", math_node("ABSOLUTE", math_node("SUBTRACT", pz, wz_mid)), wz_half)
    r = math_node("SQRT", math_node("ADD", math_node("MULTIPLY", dx, dx), math_node("MULTIPLY", dz, dz)))
    radial = map_range(r, 0.03, 0.17, 1.0, 0.0)
    ahead = math_node("SUBTRACT", front, py)  # metres in front of the baffle
    axial = math_node("MULTIPLY", map_range(ahead, -0.02, 0.01, 0.0, 1.0), map_range(ahead, 0.05, 0.75, 1.0, 0.0))
    jet = math_node("MULTIPLY", radial, axial)
    kick = math_node("MULTIPLY", push, jet)

    # sample the noise at a shifted point: a +y offset slides the pattern toward the camera (-y)
    shove = math_node("ADD", drift, math_node("MULTIPLY", kick, 0.09))
    comb = N.new("ShaderNodeCombineXYZ")
    L.new(shove, comb.inputs["Y"])
    coord = N.new("ShaderNodeVectorMath")
    coord.operation = "ADD"
    L.new(pos, coord.inputs[0])
    L.new(comb.outputs[0], coord.inputs[1])

    noise = N.new("ShaderNodeTexNoise")
    noise.noise_dimensions = "4D"
    noise.inputs["Scale"].default_value = 2.4
    noise.inputs["Detail"].default_value = 6.0
    noise.inputs["Roughness"].default_value = 0.58
    noise.inputs["Distortion"].default_value = 0.35
    L.new(coord.outputs[0], noise.inputs["Vector"])
    L.new(math_node("MULTIPLY", time, 0.07), noise.inputs["W"])
    wisps = map_range(noise.outputs["Fac"], 0.5, 0.85, 0.0, 1.0)

    # large, slow clumps so the smoke has gaps of clean black between banks
    clumps = N.new("ShaderNodeTexNoise")
    clumps.noise_dimensions = "4D"
    clumps.inputs["Scale"].default_value = 0.9
    clumps.inputs["Detail"].default_value = 1.0
    L.new(coord.outputs[0], clumps.inputs["Vector"])
    L.new(math_node("MULTIPLY", time, 0.03), clumps.inputs["W"])
    wisps = math_node("MULTIPLY", wisps, map_range(clumps.outputs["Fac"], 0.42, 0.62, 0.0, 1.0))

    # fade to nothing at the box walls so the domain never reads as a shape
    gen = N.new("ShaderNodeTexCoord").outputs["Generated"]
    inv = N.new("ShaderNodeVectorMath")
    inv.operation = "SUBTRACT"
    inv.inputs[0].default_value = (1, 1, 1)
    L.new(gen, inv.inputs[1])
    edge = N.new("ShaderNodeVectorMath")
    edge.operation = "MINIMUM"
    L.new(gen, edge.inputs[0])
    L.new(inv.outputs[0], edge.inputs[1])
    esep = N.new("ShaderNodeSeparateXYZ")
    L.new(edge.outputs[0], esep.inputs[0])
    wall = math_node("MINIMUM", math_node("MINIMUM", esep.outputs[0], esep.outputs[1]), esep.outputs[2])
    fade = map_range(wall, 0.0, 0.2, 0.0, 1.0)

    base = value("Density")
    base.node.outputs[0].default_value = SMOKE_DENSITY
    thickness = math_node("MULTIPLY", base, math_node("ADD", 1.0, math_node("MULTIPLY", kick, 2.0)))
    haze = value("Haze")
    haze.node.outputs[0].default_value = SMOKE_HAZE
    gsep = N.new("ShaderNodeSeparateXYZ")
    L.new(gen, gsep.inputs[0])
    floor_fog = math_node("ADD", 1.0, math_node("MULTIPLY", SMOKE_FLOOR_FOG, math_node("POWER", math_node("SUBTRACT", 1.0, gsep.outputs[2]), 3.0)))
    density = math_node("ADD", math_node("MULTIPLY", math_node("MULTIPLY", wisps, fade), thickness), math_node("MULTIPLY", math_node("MULTIPLY", fade, haze), floor_fog))

    vol = N.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (0.8, 0.8, 0.82, 1)
    vol.inputs["Anisotropy"].default_value = 0.45  # forward scatter: backlights bloom through it
    L.new(density, vol.inputs["Density"])
    L.new(vol.outputs["Volume"], out_node.inputs["Volume"])
    smoke.data.materials.append(m)
    return smoke


SMOKE_DENSITY = 0.35  # a big room now; beams need haze, not fog
SMOKE_HAZE = 0.03 if MOODY else 0.16  # even haze under the clumps: what beams and lasers are drawn in
SMOKE_FLOOR_FOG = 1.5  # extra haze pooling on the floor (times haze at the floor, fading up)
build_smoke(front_y, woofer_x, woofer_z_mid, woofer_z_half)
ee = scene.eevee
ee.use_volumetric_shadows = True
ee.volumetric_tile_size = "4"
ee.volumetric_samples = 96
ee.use_volume_custom_range = True
ee.volumetric_start = 0.1
ee.volumetric_end = 12.0  # out to the rig camera

# view layers: the dust renders on its own layer so the denoiser cannot eat it (the plan's
# "denoiser eats motes" rule), composited over the main layer. Everything else goes into
# MainCol (held out on the dust layer so the cabinet still occludes motes), the smoke into
# SmokeCol (excluded from the dust layer), the dust into DustCol (excluded from the main
# layer). The dedicated dust backlight is light-linked to DustCol in Cycles.
main_col = bpy.data.collections.new("MainCol")
smoke_col = bpy.data.collections.new("SmokeCol")
dust_col = bpy.data.collections.new("DustCol")
for col in (main_col, smoke_col, dust_col):
    scene.collection.children.link(col)
for obj in list(scene.collection.objects):
    scene.collection.objects.unlink(obj)
    if obj.name == "Dust":
        dust_col.objects.link(obj)
    elif obj.name == "Smoke":
        smoke_col.objects.link(obj)
    else:
        main_col.objects.link(obj)


def layer_col(view_layer, collection):
    return next(c for c in view_layer.layer_collection.children if c.collection == collection)


main_layer = scene.view_layers[0]
main_layer.name = "Main"
layer_col(main_layer, dust_col).exclude = True
dust_layer = scene.view_layers.new("Dust")
layer_col(dust_layer, main_col).holdout = True
layer_col(dust_layer, smoke_col).exclude = True
if hasattr(dust_layer, "cycles"):
    dust_layer.cycles.use_denoising = False  # motes are signal, not noise
scene.render.film_transparent = True  # both layers carry alpha; the compositor lays them over black

# the dust backlight: small, behind and to the side of the speaker, pointing back toward the
# cameras, and (in Cycles) lighting nothing but the dust. Forward-scatter through translucent
# motes is where the sparkle comes from; a front key makes dust invisible.
back = bpy.data.lights.new("DustBack", "SPOT")
back.energy = DUST_BACKLIGHT
back.color = (1.0, 0.9, 0.78)
back.spot_size = math.radians(70)
back.spot_blend = 0.6
back.shadow_soft_size = 0.04
back.volume_factor = 0.0
backlight = bpy.data.objects.new("DustBack", back)
main_col.objects.link(backlight)
backlight.location = (half_w + 0.45, front_y + 0.55, top_z + 0.25)
backlight.rotation_euler = (Vector((0.0, front_y - 1.2, -0.1)) - backlight.location).to_track_quat("-Z", "Y").to_euler()
if hasattr(backlight, "light_linking"):
    backlight.light_linking.receiver_collection = dust_col
    # the front lights never touch the dust (a front-lit mote is a speck; a backlit one is a glow):
    # they light everything except DustCol via a linking collection holding the other two
    lit_col = bpy.data.collections.new("LitCol")
    lit_col.children.link(main_col)
    lit_col.children.link(smoke_col)
    for name in ("KeyLight", "Graze"):
        light = bpy.data.objects.get(name)
        if light is not None:
            light.light_linking.receiver_collection = lit_col

# compositor: the lens finish — bloom on the logo and glints, a touch of chromatic aberration
# and barrel distortion, a vignette, film grain (apply_drive re-seeds it every frame) and a
# gentle S-curve. Cheap enough to stay on for drafts. ----------------------------------------
COMP_BLOOM = 0.08
COMP_CHROMATIC = 0.012
COMP_VIGNETTE = 0.15  # corners to ~0.85: a soft lens vignette, not a spotlight (0 = off)
COMP_GRAIN = 0.012  # fine sensor noise, enough to break banding in the blacks


def build_compositor():
    ng = bpy.data.node_groups.new("VoidComp", "CompositorNodeTree")
    scene.compositing_node_group = ng
    scene.render.use_compositing = True
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    N, L = ng.nodes, ng.links
    main_rl = N.new("CompositorNodeRLayers")
    main_rl.layer = "Main"
    dust_rl = N.new("CompositorNodeRLayers")
    dust_rl.layer = "Dust"

    def over(top_img, top_alpha, under_img):
        # premultiplied alpha-over built from mix nodes: under * (1 - a) + top
        keep = N.new("ShaderNodeMix")
        keep.data_type = "RGBA"
        keep.blend_type = "MULTIPLY"
        keep.inputs["Factor"].default_value = 1.0
        inv = N.new("ShaderNodeMath")
        inv.operation = "SUBTRACT"
        inv.inputs[0].default_value = 1.0
        L.new(top_alpha, inv.inputs[1])
        L.new(under_img, next(s for s in keep.inputs if s.identifier == "A_Color"))
        L.new(inv.outputs[0], next(s for s in keep.inputs if s.identifier == "B_Color"))
        add = N.new("ShaderNodeMix")
        add.data_type = "RGBA"
        add.blend_type = "ADD"
        add.inputs["Factor"].default_value = 1.0
        L.new(next(s for s in keep.outputs if s.identifier == "Result_Color"), next(s for s in add.inputs if s.identifier == "A_Color"))
        L.new(top_img, next(s for s in add.inputs if s.identifier == "B_Color"))
        return next(s for s in add.outputs if s.identifier == "Result_Color")

    black = N.new("ShaderNodeValue")
    black.outputs[0].default_value = 0.0
    img = over(main_rl.outputs["Image"], main_rl.outputs["Alpha"], black.outputs[0])
    img = over(dust_rl.outputs["Image"], dust_rl.outputs["Alpha"], img)

    # every stage is named: apply_drive re-grades these from the mood JSON (blender/moods/)
    glare = N.new("CompositorNodeGlare")
    glare.name = glare.label = "Bloom"
    glare.inputs["Type"].default_value = "Bloom"
    glare.inputs["Highlights Threshold"].default_value = 1.0
    glare.inputs["Strength"].default_value = COMP_BLOOM
    L.new(img, glare.inputs["Image"])
    img = glare.outputs["Image"]

    lens = N.new("CompositorNodeLensdist")
    lens.name = lens.label = "Lens"
    lens.inputs["Distortion"].default_value = 0.005
    lens.inputs["Dispersion"].default_value = COMP_CHROMATIC
    L.new(img, lens.inputs["Image"])
    img = lens.outputs["Image"]

    curve = N.new("CompositorNodeCurveRGB")
    curve.name = curve.label = "Curve"
    c = curve.mapping.curves[3]  # combined
    c.points[0].location = (0.0, 0.02)  # blacks a touch above full crush: Instagram butchers crushed gradients
    c.points.new(0.25, 0.22)
    c.points.new(0.75, 0.78)
    curve.mapping.update()
    L.new(img, curve.inputs["Image"])
    img = curve.outputs["Image"]
    # split tone: warm the highlights, cool nothing, so the frame lives between amber and dark
    # red (the moody default; a mood JSON can set any lift/gain pair)
    warm = N.new("CompositorNodeColorBalance")
    warm.name = warm.label = "Balance"
    gain = (1.06, 0.96, 0.86, 1.0) if MOODY else (1.0, 1.0, 1.0, 1.0)
    lift = (1.0, 0.985, 0.97, 1.0) if MOODY else (1.0, 1.0, 1.0, 1.0)
    next(s for s in warm.inputs if s.identifier == "Color Gain").default_value = gain
    next(s for s in warm.inputs if s.identifier == "Color Lift").default_value = lift
    L.new(img, warm.inputs["Image"])
    img = warm.outputs["Image"]
    sat = N.new("CompositorNodeHueSat")
    sat.name = sat.label = "Saturation"
    sat.inputs["Saturation"].default_value = 1.0
    L.new(img, sat.inputs["Image"])
    img = sat.outputs["Image"]

    if COMP_VIGNETTE > 0:
        mask = N.new("CompositorNodeEllipseMask")
        mask.inputs["Size"].default_value = (1.15, 1.15)
        blur = N.new("CompositorNodeBlur")
        blur.inputs["Size"].default_value = (420, 420)
        L.new(mask.outputs["Mask"], blur.inputs["Image"])
        lift = N.new("ShaderNodeMapRange")
        lift.name = lift.label = "Vignette"
        lift.inputs["To Min"].default_value = 1.0 - COMP_VIGNETTE
        L.new(blur.outputs["Image"], lift.inputs["Value"])
        vig = N.new("ShaderNodeMix")
        vig.data_type = "RGBA"
        vig.blend_type = "MULTIPLY"
        vig.inputs["Factor"].default_value = 1.0
        L.new(img, vig.inputs["A"])
        L.new(lift.outputs["Result"], vig.inputs["B"])
        img = vig.outputs["Result"]

    if COMP_GRAIN > 0:
        noise = N.new("ShaderNodeTexNoise")
        noise.name = noise.label = "Grain"
        noise.noise_dimensions = "4D"
        noise.inputs["Scale"].default_value = 3200
        noise.inputs["Detail"].default_value = 0.0
        grain = N.new("ShaderNodeMapRange")
        grain.name = grain.label = "GrainAmount"
        grain.inputs["To Min"].default_value = -COMP_GRAIN
        grain.inputs["To Max"].default_value = COMP_GRAIN
        L.new(noise.outputs["Fac"], grain.inputs["Value"])
        add = N.new("ShaderNodeMix")
        add.data_type = "RGBA"
        add.blend_type = "ADD"
        add.inputs["Factor"].default_value = 1.0
        L.new(img, add.inputs["A"])
        L.new(grain.outputs["Result"], add.inputs["B"])
        img = add.outputs["Result"]

    L.new(img, N.new("NodeGroupOutput").inputs[0])


build_compositor()

out = os.path.join(HERE, "scenes", "void.blend")
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=out)
print(f"saved {out}")
