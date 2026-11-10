# Excursion — the speakers' surface finish, matched to product photos of the PMC6-2.
#
# What the photos show that the renders were missing:
#   - the honeycomb on the mid/tweeter plate is PMC's own moulding (the CAD already has it,
#     cells ~12 mm across). It reads because every raised edge catches a thin line of light and
#     every groove goes dark. The old 6 mm bump texture drew a second, smaller honeycomb on top,
#     which smeared the real one into noise.
#   - the cabinet is a charcoal satin, not a black hole: edges and screw heads catch light,
#     recesses (vents, screw sockets, the trim gaps) fall off into shadow.
#
# finish() adds both effects to an existing material, from the geometry alone (no UVs needed):
#   edge   a narrow Bevel normal compared with the true normal: 1 on a rounded edge, 0 on a face.
#          Edges get a lighter, glossier satin.
#   cavity Ambient Occlusion limited to this object at a few millimetres: grooves and sockets
#          get darker and rougher (dust and shadow collect there).
# Both are Cycles features (EEVEE treats Bevel as the plain normal, so the edge term is 0 there
# and the material looks as it did). Used by build_scene.py when it builds the scene, and by
# finish_test.py to apply to an already-built .blend for a before/after still.

import bpy

# the honeycomb plate: strong edges and cavity (the pattern should read from the wide shot)
PLATE = {"edge_radius": 0.0015, "edge_gain": 16.0, "edge_lift": 10.0, "edge_gloss": 0.9, "cavity_dist": 0.008, "cavity_dark": 0.9}
# the cabinet and the waveguide: the same, gentler (screws, vents, trim gaps)
CABINET = {"edge_radius": 0.0012, "edge_gain": 10.0, "edge_lift": 4.0, "edge_gloss": 0.6, "cavity_dist": 0.004, "cavity_dark": 0.6}
# the woofer/mid pieces share the cabinet node set; a light cavity only, the cones stay smooth
DRIVER = {"edge_radius": 0.0009, "edge_gain": 4.0, "edge_lift": 1.4, "edge_gloss": 0.2, "cavity_dist": 0.003, "cavity_dark": 0.3}
# edge_gloss is a 0-1 weight: how far an edge's roughness moves toward satin 0.18

TAG = "speaker_finish"  # custom property on a material: finish() is applied once


def _rewire(nt, socket_in, make):
    """Replace whatever feeds socket_in with make(upstream_socket_or_default)."""
    src = socket_in.links[0].from_socket if socket_in.links else None
    default = None if src is not None else socket_in.default_value
    for link in list(socket_in.links):
        nt.links.remove(link)
    out = make(src, default)
    nt.links.new(out, socket_in)


def finish(material, edge_radius, edge_gain, edge_lift, edge_gloss, cavity_dist, cavity_dark):
    if material is None or not material.use_nodes or material.get(TAG):
        return material
    nt = material.node_tree
    N, L = nt.nodes, nt.links
    bsdf = next((n for n in N if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return material

    def math(op, a, b=None, clamp=False):
        n = N.new("ShaderNodeMath")
        n.operation = op
        n.use_clamp = clamp
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L.new(v, n.inputs[i])
        return n.outputs[0]

    # edge mask: 1 - (bevelled normal . true normal), scaled up and clamped
    bevel = N.new("ShaderNodeBevel")
    bevel.samples = 4
    bevel.inputs["Radius"].default_value = edge_radius
    geo = N.new("ShaderNodeNewGeometry")
    dot = N.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    L.new(bevel.outputs["Normal"], dot.inputs[0])
    L.new(geo.outputs["Normal"], dot.inputs[1])
    edge = math("MULTIPLY", math("SUBTRACT", 1.0, dot.outputs["Value"]), edge_gain, clamp=True)

    # cavity: local AO, 1 in the open, toward 0 in grooves
    ao = N.new("ShaderNodeAmbientOcclusion")
    ao.only_local = True
    ao.samples = 4
    ao.inputs["Distance"].default_value = cavity_dist
    occ = math("SUBTRACT", 1.0, ao.outputs["AO"], clamp=True)  # 0 open, 1 deep in a groove

    # colour: lift on edges, darken in cavities
    def colour(src, default):
        lift = N.new("ShaderNodeMix")
        lift.data_type = "RGBA"
        lift.blend_type = "MULTIPLY"
        fac = next(s for s in lift.inputs if s.identifier == "Factor_Float")
        a = next(s for s in lift.inputs if s.identifier == "A_Color")
        b = next(s for s in lift.inputs if s.identifier == "B_Color")
        L.new(edge, fac)
        if src is not None:
            L.new(src, a)
        else:
            a.default_value = default
        b.default_value = (edge_lift,) * 3 + (1.0,)
        dark = N.new("ShaderNodeMix")
        dark.data_type = "RGBA"
        dark.blend_type = "MULTIPLY"
        L.new(math("MULTIPLY", occ, cavity_dark), next(s for s in dark.inputs if s.identifier == "Factor_Float"))
        L.new(next(s for s in lift.outputs if s.identifier == "Result_Color"), next(s for s in dark.inputs if s.identifier == "A_Color"))
        next(s for s in dark.inputs if s.identifier == "B_Color").default_value = (0.0, 0.0, 0.0, 1.0)
        return next(s for s in dark.outputs if s.identifier == "Result_Color")

    # roughness: edges a touch glossier (handled, polished), grooves rougher
    def rough(src, default):
        # edge_gloss (0-1) pulls the edges toward a satin 0.18, so they catch the key as a line
        base = src if src is not None else default
        w = math("MULTIPLY", edge, edge_gloss)
        r = math("ADD", math("MULTIPLY", base, math("SUBTRACT", 1.0, w)), math("MULTIPLY", w, 0.18))
        return math("ADD", r, math("MULTIPLY", occ, 0.15), clamp=True)

    _rewire(nt, bsdf.inputs["Base Color"], colour)
    _rewire(nt, bsdf.inputs["Roughness"], rough)
    material[TAG] = True
    return material


# The CAD honeycomb on the hero plate is only 0.25 mm deep: the plate face sits 3.10 mm behind
# the baffle and the cell floors 3.35 mm (measured from the STL). Too shallow to catch light, so
# the shader exaggerates it: anything below the plate face is a cell floor, darker and rougher,
# and the step between them becomes a strong bump, so every cell wall draws a crisp line.
PLATE_FACE_Y = -0.17748  # object-space y of the plate face on the hero cabinet
PLATE_CELL_Y = -0.17723  # object-space y of the cell floors
RELIEF = {"floor_dark": 0.45, "floor_rough": 0.75, "face_rough": 0.32, "bump": 0.6, "bump_dist": 0.0012}


def exaggerate_relief(material, face_y=PLATE_FACE_Y, cell_y=PLATE_CELL_Y, floor_dark=0.45, floor_rough=0.75, face_rough=0.32, bump=0.6, bump_dist=0.0012):
    if material is None or not material.use_nodes or material.get(TAG + "_relief"):
        return material
    nt = material.node_tree
    N, L = nt.nodes, nt.links
    bsdf = next((n for n in N if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return material
    coord = N.new("ShaderNodeTexCoord")
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(coord.outputs["Object"], sep.inputs[0])
    floor = N.new("ShaderNodeMapRange")  # 0 on the plate face, 1 on a cell floor
    floor.interpolation_type = "SMOOTHSTEP"
    floor.inputs["From Min"].default_value = face_y + 0.3 * (cell_y - face_y)
    floor.inputs["From Max"].default_value = face_y + 0.7 * (cell_y - face_y)
    L.new(sep.outputs[1], floor.inputs["Value"])
    # only the honeycomb band: deeper recesses (tweeter pocket, waveguide seat) keep their look
    deep = N.new("ShaderNodeMapRange")
    deep.interpolation_type = "SMOOTHSTEP"
    deep.inputs["From Min"].default_value = cell_y + 0.0002
    deep.inputs["From Max"].default_value = cell_y + 0.0005
    deep.inputs["To Min"].default_value = 1.0
    deep.inputs["To Max"].default_value = 0.0
    L.new(sep.outputs[1], deep.inputs["Value"])
    band = N.new("ShaderNodeMath")
    band.operation = "MULTIPLY"
    L.new(floor.outputs["Result"], band.inputs[0])
    L.new(deep.outputs["Result"], band.inputs[1])
    mask = band.outputs[0]

    def mix_into(socket_in, data_type, value):
        mix = N.new("ShaderNodeMix")
        mix.data_type = data_type
        if data_type == "RGBA":
            mix.blend_type = "MULTIPLY"
        ids = {"RGBA": ("A_Color", "B_Color", "Result_Color"), "FLOAT": ("A_Float", "B_Float", "Result_Float")}[data_type]
        a = next(s for s in mix.inputs if s.identifier == ids[0])
        b = next(s for s in mix.inputs if s.identifier == ids[1])
        o = next(s for s in mix.outputs if s.identifier == ids[2])
        L.new(mask, next(s for s in mix.inputs if s.identifier == "Factor_Float"))
        src = socket_in.links[0].from_socket if socket_in.links else None
        if src is not None:
            L.new(src, a)
        else:
            a.default_value = socket_in.default_value
        b.default_value = value
        for link in list(socket_in.links):
            L.remove(link)
        L.new(o, socket_in)
        return a

    mix_into(bsdf.inputs["Base Color"], "RGBA", (floor_dark,) * 3 + (1.0,))
    # the plate face a satin, the floors matte: the pattern reads in the highlight too
    face = N.new("ShaderNodeMath")
    face.operation = "MINIMUM"
    face.inputs[1].default_value = face_rough
    src = bsdf.inputs["Roughness"].links[0].from_socket if bsdf.inputs["Roughness"].links else None
    if src is not None:
        L.new(src, face.inputs[0])
    else:
        face.inputs[0].default_value = bsdf.inputs["Roughness"].default_value
    for link in list(bsdf.inputs["Roughness"].links):
        L.remove(link)
    L.new(face.outputs[0], bsdf.inputs["Roughness"])
    mix_into(bsdf.inputs["Roughness"], "FLOAT", floor_rough)
    # the step as a bump on top of whatever normal is there
    bmp = N.new("ShaderNodeBump")
    bmp.invert = True  # floors are lower
    bmp.inputs["Strength"].default_value = bump
    bmp.inputs["Distance"].default_value = bump_dist
    L.new(mask, bmp.inputs["Height"])
    prev = bsdf.inputs["Normal"].links[0].from_socket if bsdf.inputs["Normal"].links else None
    if prev is not None:
        L.new(prev, bmp.inputs["Normal"])
    for link in list(bsdf.inputs["Normal"].links):
        L.remove(link)
    L.new(bmp.outputs["Normal"], bsdf.inputs["Normal"])
    material[TAG + "_relief"] = True
    return material


def drop_hex_bump(material):
    """Bypass the old 6 mm HexTile bump on an already-built PlateMat (finish_test only)."""
    if material is None or not material.use_nodes:
        return
    nt = material.node_tree
    for node in list(nt.nodes):
        if node.type == "TEX_IMAGE" and node.image is not None and node.image.name.startswith("HexTile"):
            for link in list(node.outputs["Color"].links):
                relief = link.to_node
                for out in relief.outputs:
                    for l2 in list(out.links):
                        sock = l2.to_socket
                        nt.links.remove(l2)
                        if hasattr(sock, "default_value") and isinstance(sock.default_value, float):
                            sock.default_value = 0.0
