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
PLATE = {"edge_radius": 0.0015, "edge_gain": 6.0, "edge_lift": 2.0, "edge_gloss": 0.4, "cavity_dist": 0.008, "cavity_dark": 0.9}  # 2026-11-11: the strong edge glow made the engraved hex lines look embossed
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


# CAD truth (measured 2026-11-11): the plate face is flat at 6.47 mm and the honeycomb is its
# OUTLINES only: engraved lines 0.8 mm wide and 0.25 mm deep (6.72 mm), as is the "6-2" under
# the badge. The cells are not sunk. The product photo shows them as thin dark lines.
def seam_groove(material, px, pz, face_y=None, half_strip=0.0498, disc_r=0.07275, disc_half_h=0.053, width=0.0007, dark=0.1, bump=0.8):
    """The panel gap round the mid/tweeter plate as a visible dark groove. In the CAD it is a
    0.5 mm slot that follows the plate outline (a 99.6 mm wide strip merged with a 145.5 mm
    disc round the mid, centre px/pz in object x/z); real, but under two pixels wide in a
    full-front frame, so it vanished while the product photo shows a clear dark line. This
    darkens and dents a band `width` either side of that outline, on front faces at plate level."""
    if material is None or not material.use_nodes or material.get(TAG + "_seam"):
        return material
    face_y = PLATE_FACE_Y if face_y is None else face_y
    nt = material.node_tree
    N, L = nt.nodes, nt.links
    bsdf = next((n for n in N if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return material

    def math(op, a, b=None):
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

    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(N.new("ShaderNodeTexCoord").outputs["Object"], sep.inputs[0])
    ax = math("ABSOLUTE", math("SUBTRACT", sep.outputs[0], px))
    az = math("ABSOLUTE", math("SUBTRACT", sep.outputs[2], pz))
    d_strip = math("ABSOLUTE", math("SUBTRACT", ax, half_strip))
    r = math("SQRT", math("ADD", math("MULTIPLY", ax, ax), math("MULTIPLY", az, az)))
    d_disc = math("ABSOLUTE", math("SUBTRACT", r, disc_r))
    in_disc = math("LESS_THAN", az, disc_half_h)  # beside the mid the outline is the disc, elsewhere the strip
    d = math("ADD", d_strip, math("MULTIPLY", in_disc, math("SUBTRACT", d_disc, d_strip)))
    band = N.new("ShaderNodeMapRange")
    band.interpolation_type = "SMOOTHSTEP"
    band.inputs["From Min"].default_value = width * 0.35
    band.inputs["From Max"].default_value = width
    band.inputs["To Min"].default_value = 1.0
    band.inputs["To Max"].default_value = 0.0
    L.new(d, band.inputs["Value"])
    level = math("LESS_THAN", math("ABSOLUTE", math("SUBTRACT", sep.outputs[1], face_y)), 0.002)
    mask = math("MULTIPLY", band.outputs["Result"], level)

    def colour(src, default):
        mix = N.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        L.new(mask, next(s for s in mix.inputs if s.identifier == "Factor_Float"))
        a = next(s for s in mix.inputs if s.identifier == "A_Color")
        if src is not None:
            L.new(src, a)
        else:
            a.default_value = default
        next(s for s in mix.inputs if s.identifier == "B_Color").default_value = (dark,) * 3 + (1.0,)
        return next(s for s in mix.outputs if s.identifier == "Result_Color")

    def normal(src, default):
        bmp = N.new("ShaderNodeBump")
        bmp.invert = True  # the groove is below the surface
        bmp.inputs["Strength"].default_value = bump
        bmp.inputs["Distance"].default_value = width
        L.new(mask, bmp.inputs["Height"])
        if src is not None:
            L.new(src, bmp.inputs["Normal"])
        return bmp.outputs["Normal"]

    _rewire(nt, bsdf.inputs["Base Color"], colour)
    _rewire(nt, bsdf.inputs["Normal"], normal)
    material[TAG + "_seam"] = True
    return material


def round_edges(material, radius=0.00025, samples=6):
    """Shade every sharp edge as a small real radius (Bevel node on the final normal). Unlike
    finish()'s edge lift, which brightens edges everywhere, a rounded edge only glints where it
    mirrors a light: the product photo's hex lines shine as thin bright outlines on one side of
    the field and stay dark on the other. Call it last, after every bump has been added."""
    if material is None or not material.use_nodes or material.get(TAG + "_round"):
        return material
    nt = material.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return material

    def make(src, default):
        bevel = nt.nodes.new("ShaderNodeBevel")
        bevel.samples = samples
        bevel.inputs["Radius"].default_value = radius
        if src is not None:
            nt.links.new(src, bevel.inputs["Normal"])
        return bevel.outputs["Normal"]

    _rewire(nt, bsdf.inputs["Normal"], make)
    material[TAG + "_round"] = True
    return material


# The CAD honeycomb on the hero plate is only 0.25 mm deep: the plate face sits 3.10 mm behind
# the baffle and the cell floors 3.35 mm (measured from the STL). Too shallow to catch light, so
# the shader exaggerates it: anything below the plate face is a cell floor, darker and rougher,
# and the step between them becomes a strong bump, so every cell wall draws a crisp line.
PLATE_FACE_Y = -0.17748  # object-space y of the plate face on the hero cabinet
PLATE_CAD_CELL_Y = -0.17723  # object-space y of the cell floors as the CAD has them
HEX_DEEPEN = 0.0012  # build_scene pushes the engraved line floors this much deeper (real depth, real shadows)
PLATE_CELL_Y = PLATE_CAD_CELL_Y + HEX_DEEPEN  # object-space y of the cell floors after that
# The photo's lines are dark over most of the plate but shine as bright outlines where they
# mirror the light: the engraved floors are bare, semi-polished material (floor_metal), black
# where they reflect a dark room and bright where they reflect a lamp. Matte pits never shine,
# and a plain glossy plastic floor reflects too little to beat the plate around it (both tried).
# Note: under a bright all-round fill (a studio HDRI) they shine everywhere; judge them in a
# dark room with lamps, which is also what the show scenes are.
# 2026-11-11: three tries at that shine (rounded edges, glossy plastic floors, metallic floors at
# several strengths) either lit every line on the plate or washed the lines out; the settings
# below are the verified dark-line look. floor_metal / floor_spec / round_edges() stay available.
RELIEF = {"floor_dark": 0.12, "floor_rough": 0.75, "face_rough": 0.5, "bump": 0.6, "bump_dist": 0.0012}


def exaggerate_relief(material, face_y=PLATE_FACE_Y, cell_y=PLATE_CELL_Y, floor_dark=0.45, floor_rough=0.75, face_rough=0.32, bump=0.6, bump_dist=0.0012, floor_metal=0.0, floor_spec=None, lines=True):
    # lines=False: only the plate face's satin roughness cap, no engraved-line treatment (the horn
    # and the tweeter dish: same moulding and sheen as the plate face, but no lines)
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
        if data_type == "RGBA" and not floor_metal:
            mix.blend_type = "MULTIPLY"  # matte pits: darken; reflective floors: floor_dark is their own grey
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

    if lines:
        mix_into(bsdf.inputs["Base Color"], "RGBA", (floor_dark,) * 3 + (1.0,))
    if lines and floor_metal:
        mix_into(bsdf.inputs["Metallic"], "FLOAT", floor_metal)
    if lines and floor_spec is not None and "Specular IOR Level" in bsdf.inputs:
        mix_into(bsdf.inputs["Specular IOR Level"], "FLOAT", floor_spec)
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
    if not lines:
        material[TAG + "_relief"] = True
        return material
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


VENT_DEPTH = 0.085  # metres of black port behind an opened grille
GRILLE_WEB = 0.0004  # thickness given to the grille faces: the CAD web is 2 mm wide (top face kept), so the bars come out ~2.4 mm
VENT_INSET = 0.008  # the grille field starts this far inside the vent rectangle (inside is the bezel)


def open_vent(body, x0, x1, z0, z1, d0, d1, front, cavity_mat, name, keep=None, grille_mat=None):
    """Open a honeycomb grille (object-local coords on body's mesh): delete every front-facing
    face between depths d0 and d1 behind the baffle, then add an open-fronted black port box
    behind it, so the cells read as holes with depth, not a black floor. The box's mesh is
    baked in place (object at the origin) so build_speaker can set location/rotation."""
    import bmesh

    me = body.data
    bm = bmesh.new()
    bm.from_mesh(me)
    doomed = []
    for f in bm.faces:
        c = f.calc_center_median()
        depth = c.y - front
        if keep is not None and keep[0] <= depth <= keep[1]:
            continue  # the grille's own front face (the honeycomb webs)
        # inset: the bezel's inner ledge (14.5 mm deep, within ~8 mm of the vent edge) stays
        if f.normal.y < -0.9 and x0 + VENT_INSET < c.x < x1 - VENT_INSET and z0 + VENT_INSET < c.z < z1 - VENT_INSET and d0 <= depth <= d1:
            doomed.append(f)
        elif f.normal.y < -0.9 and x0 < c.x < x1 and z0 < c.z < z1 and d1 - 0.0012 <= depth <= d1:
            # cell floors inside the inset band too (the ledge the inset protects is 7 mm shallower):
            # left in, they showed as a pale wedge behind the bottom row of the lower grille
            doomed.append(f)
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    # The CAD grille is solid: each cell is a hex plug and the webs are only the gaps between
    # plugs. With the plug tops gone, what is left of each plug is a ring of zero-thickness walls,
    # invisible edge-on from the front. Move those walls into their own object and give them a
    # real thickness (Solidify), so the webs read as a honeycomb with holes behind.
    walls = []
    for f in bm.faces:
        c = f.calc_center_median()
        depth = c.y - front
        top = keep is not None and f.normal.y < -0.9 and keep[0] <= depth <= keep[1]  # a web's own front face
        if (abs(f.normal.y) < 0.5 or top) and all(  # every corner inside: the STL's long slivers reach the bezel
            x0 + VENT_INSET < v.co.x < x1 - VENT_INSET and z0 + VENT_INSET < v.co.z < z1 - VENT_INSET and d0 <= v.co.y - front <= d1
            for v in f.verts
        ):
            walls.append(f)
    grille = None
    if walls:
        bm.verts.index_update()
        gbm = bmesh.new()
        vmap = {}
        for f in walls:
            vs = []
            for v in f.verts:
                if v.index not in vmap:
                    vmap[v.index] = gbm.verts.new(v.co)
                vs.append(vmap[v.index])
            try:
                gbm.faces.new(vs)
            except ValueError:
                pass
        bmesh.ops.delete(bm, geom=walls, context="FACES_ONLY")
        gmesh = bpy.data.meshes.new(name.replace("Cavity", "Grille"))
        gbm.to_mesh(gmesh)
        gbm.free()
        grille = bpy.data.objects.new(gmesh.name, gmesh)
        for coll in body.users_collection:
            coll.objects.link(grille)
        for m in ([grille_mat] if grille_mat is not None else body.data.materials[:1]):
            gmesh.materials.append(m)
        sol = grille.modifiers.new("Webs", "SOLIDIFY")
        sol.thickness = GRILLE_WEB
        sol.offset = 0.0
        sol.use_even_offset = False  # even offset spikes at the STL's sliver corners (streaks across the bezel)
        sol.use_quality_normals = True
    bm.to_mesh(me)
    bm.free()
    # the port: five walls (no front), normals facing in, from just behind the grille walls
    pad = 0.003
    xa, xb, za, zb = x0 - pad, x1 + pad, z0 - pad, z1 + pad
    ya, yb = front + d1, front + d1 + VENT_DEPTH  # starts behind the grille: no wall cuts the bezel
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in (
        (xa, ya, za), (xb, ya, za), (xb, ya, zb), (xa, ya, zb),
        (xa, yb, za), (xb, yb, za), (xb, yb, zb), (xa, yb, zb),
    )]
    for quad in ((4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
        bm.faces.new([v[i] for i in quad])
    bm.normal_update()
    centre = ((xa + xb) / 2, (ya + yb) / 2, (za + zb) / 2)
    for f in bm.faces:  # point every wall inward, toward the box centre
        c = f.calc_center_median()
        if f.normal.dot(type(c)(centre) - c) < 0:
            f.normal_flip()
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    cav = bpy.data.objects.new(name, mesh)
    for coll in body.users_collection:
        coll.objects.link(cav)
    mesh.materials.append(cavity_mat)
    return cav, grille, len(doomed)


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
