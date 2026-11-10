# Excursion — wear and close-up detail for the speakers: a speaker that has lived in a studio.
# All procedural, in object space (metres), so no UVs are needed and the same values read the
# same on every cabinet. Cycles (the AO node is Cycles-only; EEVEE gets the rest).
#
# wear(material):
#   cavity dust   dust packs into grooves, screw sockets and the vent bezel (local AO)
#   flecks        sparse specks of dust on every surface, a few tenths of a millimetre
#   prints        oily fingerprint smudges: patches a little glossier than the satin around
#                 them, with faint ridge whorls, that only show in a highlight
#   scuffs        fine handling marks: thin streaks of slightly duller satin
# cone_detail(material):
#   uneven fibre density (darker and lighter clouds a few millimetres across), a coarse fibre
#   bump that survives the denoiser, faint concentric pressing rings from the mould, and dust
#   settled in the lower half of the cone. Inside the cone radius only (the woofer/mid pieces
#   carry cone_cx / cone_cz / cone_r).

import math as _m

from speaker_finish import TAG, _rewire

WEAR = {"cavity_dust": 0.55, "flecks": 0.6, "prints": 0.55, "print_scale": 9.0, "print_density": 0.45, "scuffs": 0.35}
CONE = {"mottle": 0.3, "fibre_bump": 0.22, "rings": 0.012, "settled": 0.14}
DUST_COLOUR = (0.32, 0.30, 0.27, 1.0)


def _kit(nt):
    N, L = nt.nodes, nt.links

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

    def ramp(v, lo, hi, smooth=True):
        n = N.new("ShaderNodeMapRange")
        n.interpolation_type = "SMOOTHSTEP" if smooth else "LINEAR"
        n.inputs["From Min"].default_value = lo
        n.inputs["From Max"].default_value = hi
        L.new(v, n.inputs["Value"])
        return n.outputs["Result"]

    def sock(node, ident, outputs=False):
        return next(s for s in (node.outputs if outputs else node.inputs) if s.identifier == ident)

    def mix_rgb(src, default, fac, colour, blend="MIX"):
        m = N.new("ShaderNodeMix")
        m.data_type = "RGBA"
        m.blend_type = blend
        L.new(fac, sock(m, "Factor_Float"))
        if src is not None:
            L.new(src, sock(m, "A_Color"))
        else:
            sock(m, "A_Color").default_value = default
        if isinstance(colour, tuple):
            sock(m, "B_Color").default_value = colour
        else:
            L.new(colour, sock(m, "B_Color"))
        return sock(m, "Result_Color", True)

    def mix_f(src, default, fac, value):
        m = N.new("ShaderNodeMix")
        m.data_type = "FLOAT"
        L.new(fac, sock(m, "Factor_Float"))
        if src is not None:
            L.new(src, sock(m, "A_Float"))
        else:
            sock(m, "A_Float").default_value = default
        if isinstance(value, (int, float)):
            sock(m, "B_Float").default_value = value
        else:
            L.new(value, sock(m, "B_Float"))
        return sock(m, "Result_Float", True)

    return math, ramp, mix_rgb, mix_f


def _bsdf(material, tag):
    if material is None or not material.use_nodes or material.get(TAG + tag):
        return None
    return next((n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)


def wear(material, cavity_dust=0.55, flecks=0.6, prints=0.55, print_scale=9.0, print_density=0.45, scuffs=0.35):
    bsdf = _bsdf(material, "_wear")
    if bsdf is None:
        return material
    nt = material.node_tree
    N, L = nt.nodes, nt.links
    math, ramp, mix_rgb, mix_f = _kit(nt)
    coord = N.new("ShaderNodeTexCoord").outputs["Object"]

    # cavity dust: wider AO than the finish's, so dust fills a groove rather than lining it
    ao = N.new("ShaderNodeAmbientOcclusion")
    ao.only_local = True
    ao.samples = 4
    ao.inputs["Distance"].default_value = 0.006
    packed = ramp(math("SUBTRACT", 1.0, ao.outputs["AO"]), 0.15, 0.7)
    grit = N.new("ShaderNodeTexNoise")
    grit.inputs["Scale"].default_value = 260.0
    grit.inputs["Detail"].default_value = 6.0
    L.new(coord, grit.inputs["Vector"])
    dust = math("MULTIPLY", math("MULTIPLY", packed, ramp(grit.outputs["Fac"], 0.35, 0.65)), cavity_dust)

    # flecks: sparse Voronoi points, ~0.3 mm
    vor = N.new("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = 700.0
    L.new(coord, vor.inputs["Vector"])
    dot = math("SUBTRACT", 1.0, ramp(vor.outputs["Distance"], 0.06, 0.16))
    pick = N.new("ShaderNodeSeparateColor")
    L.new(vor.outputs["Color"], pick.inputs[0])
    fleck = math("MULTIPLY", dot, math("MULTIPLY", ramp(pick.outputs[0], 0.9, 0.93, smooth=False), flecks))
    dust = math("MAXIMUM", dust, fleck)

    # fingerprints: one candidate per Voronoi cell; a soft blob with warped edges and whorls
    warp = N.new("ShaderNodeTexNoise")
    warp.inputs["Scale"].default_value = 40.0
    warp.inputs["Detail"].default_value = 3.0
    L.new(coord, warp.inputs["Vector"])
    warped = N.new("ShaderNodeVectorMath")
    warped.operation = "MULTIPLY_ADD"
    L.new(warp.outputs["Color"], warped.inputs[0])
    warped.inputs[1].default_value = (0.004, 0.004, 0.004)
    L.new(coord, warped.inputs[2])
    cells = N.new("ShaderNodeTexVoronoi")
    cells.inputs["Scale"].default_value = print_scale
    L.new(warped.outputs[0], cells.inputs["Vector"])
    blob = math("SUBTRACT", 1.0, ramp(cells.outputs["Distance"], 0.08, 0.17))  # ~1.5-2 cm print
    cpick = N.new("ShaderNodeSeparateColor")
    L.new(cells.outputs["Color"], cpick.inputs[0])
    blob = math("MULTIPLY", blob, ramp(cpick.outputs[1], 1.0 - print_density, 1.0 - print_density + 0.02, smooth=False))
    scaled = N.new("ShaderNodeVectorMath")
    scaled.operation = "SCALE"
    L.new(warped.outputs[0], scaled.inputs[0])
    scaled.inputs["Scale"].default_value = 450.0
    ridges = N.new("ShaderNodeTexWave")
    ridges.wave_type = "RINGS"
    ridges.inputs["Scale"].default_value = 3.2
    ridges.inputs["Distortion"].default_value = 4.0
    ridges.inputs["Detail"].default_value = 2.0
    L.new(scaled.outputs[0], ridges.inputs["Vector"])
    print_amt = math("MULTIPLY", math("MULTIPLY", blob, math("ADD", 0.55, math("MULTIPLY", ridges.outputs["Fac"], 0.45))), prints)

    # scuffs: thin stretched streaks in patches
    stretch = N.new("ShaderNodeMapping")
    stretch.inputs["Scale"].default_value = (900.0, 25.0, 900.0)
    stretch.inputs["Rotation"].default_value = (0.0, 0.6, 0.0)
    L.new(coord, stretch.inputs["Vector"])
    streak = N.new("ShaderNodeTexNoise")
    streak.inputs["Scale"].default_value = 1.0
    streak.inputs["Detail"].default_value = 4.0
    L.new(stretch.outputs["Vector"], streak.inputs["Vector"])
    patch = N.new("ShaderNodeTexNoise")
    patch.inputs["Scale"].default_value = 6.0
    L.new(coord, patch.inputs["Vector"])
    scuff = math("MULTIPLY", ramp(streak.outputs["Fac"], 0.62, 0.7), math("MULTIPLY", ramp(patch.outputs["Fac"], 0.55, 0.7), scuffs))

    _rewire(nt, bsdf.inputs["Base Color"], lambda s, d: mix_rgb(s, d, dust, DUST_COLOUR))

    def rough(src, default):
        r = mix_f(src, default, dust, 0.92)
        r = mix_f(r, None, print_amt, 0.16)  # skin oil: glossier
        return mix_f(r, None, scuff, 0.75)  # scuff: duller

    _rewire(nt, bsdf.inputs["Roughness"], rough)
    material[TAG + "_wear"] = True
    return material


def cone_detail(material, mottle=0.35, fibre_bump=0.22, rings=0.05, settled=0.35):
    bsdf = _bsdf(material, "_cone")
    if bsdf is None:
        return material
    nt = material.node_tree
    N, L = nt.nodes, nt.links
    math, ramp, mix_rgb, mix_f = _kit(nt)

    def prop(name):
        a = N.new("ShaderNodeAttribute")
        a.attribute_type = "OBJECT"
        a.attribute_name = name
        return a.outputs["Fac"]

    coord = N.new("ShaderNodeTexCoord").outputs["Object"]
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(coord, sep.inputs[0])
    dx = math("SUBTRACT", sep.outputs[0], prop("cone_cx"))
    dz = math("SUBTRACT", sep.outputs[2], prop("cone_cz"))
    r = math("SQRT", math("ADD", math("MULTIPLY", dx, dx), math("MULTIPLY", dz, dz)))
    inside = N.new("ShaderNodeMapRange")
    inside.interpolation_type = "SMOOTHSTEP"
    L.new(r, inside.inputs["Value"])
    L.new(math("MULTIPLY", prop("cone_r"), 0.93), inside.inputs["From Min"])
    L.new(prop("cone_r"), inside.inputs["From Max"])
    inside.inputs["To Min"].default_value = 1.0
    inside.inputs["To Max"].default_value = 0.0
    # the dust cap is a separate pressed dome: no mould rings or fibre clouds on it
    cap_edge = N.new("ShaderNodeMapRange")
    cap_edge.interpolation_type = "SMOOTHSTEP"
    L.new(r, cap_edge.inputs["Value"])
    L.new(prop("cap_r"), cap_edge.inputs["From Min"])
    L.new(math("MULTIPLY", prop("cap_r"), 1.08), cap_edge.inputs["From Max"])
    no_cap = math("SUBTRACT", 1.0, ramp(prop("cap_r"), 0.0, 0.001))  # the mid has cap_r 0
    mask = math("MULTIPLY", inside.outputs["Result"], math("MAXIMUM", cap_edge.outputs["Result"], no_cap))

    cloud = N.new("ShaderNodeTexNoise")
    cloud.inputs["Scale"].default_value = 160.0
    cloud.inputs["Detail"].default_value = 8.0
    cloud.inputs["Roughness"].default_value = 0.65
    L.new(coord, cloud.inputs["Vector"])
    shade = N.new("ShaderNodeMapRange")
    L.new(cloud.outputs["Fac"], shade.inputs["Value"])
    shade.inputs["From Min"].default_value = 0.3
    shade.inputs["From Max"].default_value = 0.7
    shade.inputs["To Min"].default_value = 1.0 - mottle
    shade.inputs["To Max"].default_value = 1.0 + mottle
    tint = N.new("ShaderNodeCombineColor")
    for i in range(3):
        L.new(shade.outputs["Result"], tint.inputs[i])

    low = ramp(math("MULTIPLY", dz, -1.0), 0.0, 0.03)  # dust settles in the lower half
    patchy = N.new("ShaderNodeTexNoise")
    patchy.inputs["Scale"].default_value = 220.0
    patchy.inputs["Detail"].default_value = 8.0
    L.new(coord, patchy.inputs["Vector"])
    dusty = math("MULTIPLY", math("MULTIPLY", math("MULTIPLY", low, ramp(patchy.outputs["Fac"], 0.35, 0.75)), settled), mask)

    def colour(src, default):
        mott = mix_rgb(src, default, mask, tint.outputs[0], blend="MULTIPLY")
        return mix_rgb(mott, None, dusty, DUST_COLOUR)

    def rough(src, default):
        base = src if src is not None else default
        varied = math("ADD", base, math("MULTIPLY", math("SUBTRACT", cloud.outputs["Fac"], 0.5), math("MULTIPLY", mask, 0.25)))
        return mix_f(varied, None, dusty, 0.9)

    _rewire(nt, bsdf.inputs["Base Color"], colour)
    _rewire(nt, bsdf.inputs["Roughness"], rough)

    fibre = N.new("ShaderNodeTexNoise")
    fibre.inputs["Scale"].default_value = 650.0
    fibre.inputs["Detail"].default_value = 10.0
    fibre.inputs["Roughness"].default_value = 0.7
    L.new(coord, fibre.inputs["Vector"])
    ring_wave = math("SINE", math("MULTIPLY", r, 2 * _m.pi / 0.0016))  # 1.6 mm pitch
    height = math("MULTIPLY", math("ADD", math("MULTIPLY", fibre.outputs["Fac"], fibre_bump), math("MULTIPLY", ring_wave, rings)), mask)
    bmp = N.new("ShaderNodeBump")
    bmp.inputs["Strength"].default_value = 1.0
    bmp.inputs["Distance"].default_value = 0.0004
    L.new(height, bmp.inputs["Height"])
    prev = bsdf.inputs["Normal"].links[0].from_socket if bsdf.inputs["Normal"].links else None
    if prev is not None:
        L.new(prev, bmp.inputs["Normal"])
    for link in list(bsdf.inputs["Normal"].links):
        L.remove(link)
    L.new(bmp.outputs["Normal"], bsdf.inputs["Normal"])
    material[TAG + "_cone"] = True
    return material
