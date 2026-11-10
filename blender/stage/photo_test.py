# v4 photoreal camera/post test. Run after apply_drive.py, look_test.py (LT_NORENDER=1,
# LT_NOSHAKE=1 when V4_SHAKE=1) and wall_test.py; before wave_test.py (which renders).
# Blender must run with -y (Camera Shakify's drivers are Python expressions).
#   V4_SHAKE=1  Camera Shakify captured handheld on every shot camera (replaces the Perlin noise)
#   V4_LENS=1   OSL physical lens camera (out/look-test/lens.osl) on every DOF camera
#   V4_FILM=1   film finishing in VoidComp: veiling glare + lens dirt, halation, per-channel
#               shadow-weighted grain (re-seeded per frame), gate weave + exposure flicker
# Nothing is saved; speaker materials are untouched.
import bpy, os, json, math

scene = bpy.context.scene
HERE = os.path.dirname(os.path.abspath(__file__))
log = {}
cams = [o for o in scene.objects if o.type == "CAMERA"]


def on(name):
    return os.environ.get(name) == "1"


# ------------------------------------------------------------------ 1. Camera Shakify
if on("V4_SHAKE"):
    import addon_utils
    mod_name = next((m.__name__ for m in addon_utils.modules() if m.__name__.endswith("camera_shakify")), None)
    addon_utils.enable(mod_name, default_set=True)
    import sys
    shk = sys.modules[mod_name]
    profile = os.environ.get("V4_SHAKE_PROFILE", "INVESTIGATION")
    infl = float(os.environ.get("V4_SHAKE_INFLUENCE", "0.6"))
    for k, cam in enumerate(cams):
        s = cam.camera_shakes.add()
        s.shake_type = profile
        s.influence = infl
        s.offset = 37.0 * k  # each camera starts at a different point of the recording
        shk.rebuild_camera_shakes(cam, bpy.context)
    log["shake"] = {"addon": mod_name, "profile": profile, "influence": infl, "cameras": len(cams)}

# ------------------------------------------------------------------ 2. OSL lens camera
if on("V4_LENS"):
    from cycles import osl as cy_osl
    txt = bpy.data.texts.load(os.path.join(HERE, "lens.osl"))
    # barrel distortion by focal length: wide glass bends more
    K1 = {24: -0.05, 35: -0.03, 50: -0.015, 90: -0.005}
    msgs = []
    lensed = []
    for cam in cams:
        d = cam.data
        if d.type != "PERSP":
            continue
        f, fstop = d.lens, (d.dof.aperture_fstop if d.dof.use_dof else 16.0)
        d.type = "CUSTOM"
        d.custom_mode = "INTERNAL"
        d.custom_shader = txt
        ok = cy_osl.update_custom_camera_shader(d, lambda t, m: msgs.append(f"{t}: {m}"))
        cc = d.cycles_custom
        cc["focal_length"] = f
        cc["fstop"] = fstop
        cc["k1"] = min(K1.items(), key=lambda kv: abs(kv[0] - f))[1] * float(os.environ.get("V4_K1_MUL", "1"))
        cc["cat_eye"] = float(os.environ.get("V4_CAT", "0.55"))
        cc["onion"] = float(os.environ.get("V4_ONION", "0.12"))
        cc["bubble"] = float(os.environ.get("V4_BUBBLE", "0.25"))
        rx, ry = scene.render.resolution_x, scene.render.resolution_y
        if d.sensor_fit == "VERTICAL" or (d.sensor_fit == "AUTO" and ry > rx):
            sh = d.sensor_height if d.sensor_fit == "VERTICAL" else d.sensor_width
            cc["sensor_h"], cc["sensor_w"] = sh, sh * rx / ry
        else:
            sw = d.sensor_width
            cc["sensor_w"], cc["sensor_h"] = sw, sw * ry / rx
        d.update_tag()
        lensed.append((cam.name, f, fstop, ok))
    log["lens"] = {"cameras": lensed, "msgs": msgs[:5]}
    # the lens now distorts in the render: the compositor keeps only its dispersion
    comp = scene.compositing_node_group
    if comp is not None and comp.nodes.get("Lens") is not None:
        comp.nodes["Lens"].inputs["Distortion"].default_value = 0.0
    if comp is not None and comp.nodes.get("Vignette") is not None:
        vg = comp.nodes["Vignette"].inputs["To Min"]
        vg.default_value = 1.0 - (1.0 - vg.default_value) * 0.5  # optical vignetting does half of it now

# ------------------------------------------------------------------ 3. film finishing
if on("V4_FILM"):
    ng = scene.compositing_node_group
    N, L = ng.nodes, ng.links

    def sock(node, name, outputs=False):
        coll = node.outputs if outputs else node.inputs
        for s in coll:
            if s.identifier == name or s.name == name:
                return s
        raise KeyError(f"{node.bl_idname} has no {'output' if outputs else 'input'} {name}: {[s.name for s in coll]}")

    def mix(blend, a, b, fac=1.0):
        m = N.new("ShaderNodeMix")
        m.data_type = "RGBA"
        m.blend_type = blend
        m.inputs["Factor"].default_value = fac
        L.new(a, sock(m, "A_Color"))
        if isinstance(b, tuple):
            sock(m, "B_Color").default_value = (*b, 1.0)
        else:
            L.new(b, sock(m, "B_Color"))
        return sock(m, "Result_Color", True)

    def drive(socket, expr):
        fc = socket.driver_add("default_value")
        fc.driver.type = "SCRIPTED"
        fc.driver.expression = expr

    curve = N["Curve"]
    in_link = sock(curve, "Image").links[0]
    img = in_link.from_socket
    L.remove(in_link)

    # (a) veiling glare: a faint wide fog glow, so bright sources lift the blacks around them
    veil = N.new("CompositorNodeGlare")
    sock(veil, "Type").default_value = "Fog Glow"
    sock(veil, "Highlights Threshold").default_value = 0.6
    sock(veil, "Strength").default_value = 0.035
    sock(veil, "Size").default_value = 1.0
    L.new(img, sock(veil, "Image"))
    img = sock(veil, "Image", True)

    # (b) lens dirt: smudges on the front element, lit only where a big bloom of the highlights is
    dirt_glow = N.new("CompositorNodeGlare")
    sock(dirt_glow, "Type").default_value = "Bloom"
    sock(dirt_glow, "Highlights Threshold").default_value = 0.8
    sock(dirt_glow, "Strength").default_value = 1.0
    sock(dirt_glow, "Size").default_value = 1.0
    L.new(img, sock(dirt_glow, "Image"))
    glare_only = sock(dirt_glow, "Glare", True)
    tc = N.new("ShaderNodeTexCoord") if False else None
    smudge = N.new("ShaderNodeTexNoise")
    smudge.noise_dimensions = "2D"
    sock(smudge, "Scale").default_value = 3.5
    sock(smudge, "Detail").default_value = 4.0
    sock(smudge, "Roughness").default_value = 0.65
    spots = N.new("ShaderNodeTexVoronoi")
    spots.voronoi_dimensions = "2D"
    spots.feature = "SMOOTH_F1"
    sock(spots, "Scale").default_value = 22.0
    dm = N.new("ShaderNodeMapRange")
    L.new(sock(smudge, "Fac", True), sock(dm, "Value"))
    dm.inputs["From Min"].default_value, dm.inputs["From Max"].default_value = 0.45, 0.8
    sm = N.new("ShaderNodeMapRange")
    L.new(sock(spots, "Distance", True), sock(sm, "Value"))
    sm.inputs["From Min"].default_value, sm.inputs["From Max"].default_value = 0.12, 0.0
    dirt = N.new("ShaderNodeMath")
    dirt.operation = "MAXIMUM"
    L.new(sock(dm, "Result", True), dirt.inputs[0])
    L.new(sock(sm, "Result", True), dirt.inputs[1])
    dirt_amt = N.new("ShaderNodeMath")
    dirt_amt.operation = "MULTIPLY"
    L.new(dirt.outputs[0], dirt_amt.inputs[0])
    dirt_amt.inputs[1].default_value = float(os.environ.get("V4_DIRT", "0.35"))
    lit_dirt = mix("MULTIPLY", glare_only, dirt_amt.outputs[0])
    img = mix("ADD", img, lit_dirt)

    # (c) halation: highlights, blurred wide, pushed red-orange, screened back over the image
    hal_src = N.new("CompositorNodeGlare")
    sock(hal_src, "Type").default_value = "Bloom"
    sock(hal_src, "Highlights Threshold").default_value = 0.7
    sock(hal_src, "Strength").default_value = 1.0
    sock(hal_src, "Size").default_value = 0.35
    L.new(img, sock(hal_src, "Image"))
    hal = mix("MULTIPLY", sock(hal_src, "Glare", True), (1.0, 0.32, 0.1))
    # added, not screened: Screen breaks on scene-linear values above 1 (it inverts them)
    img = mix("ADD", img, hal, fac=float(os.environ.get("V4_HALATION", "0.3")))

    # (d) grain in scene-linear: per channel, weighted to shadows and mids, re-seeded per frame
    gnoise = N.new("ShaderNodeTexNoise")
    gnoise.noise_dimensions = "4D"
    sock(gnoise, "Scale").default_value = 1400.0  # about 1.4 px grain at 1080 wide
    sock(gnoise, "Detail").default_value = 0.0
    drive(sock(gnoise, "W"), "frame * 1.37")
    centred = mix("SUBTRACT", sock(gnoise, "Color", True), (0.5, 0.5, 0.5))
    lum = N.new("CompositorNodeRGBToBW") if hasattr(bpy.types, "CompositorNodeRGBToBW") else None
    if lum is not None:
        L.new(img, lum.inputs[0])
        lum_out = lum.outputs[0]
    else:
        sep = N.new("ShaderNodeSeparateColor")
        L.new(img, sep.inputs[0])
        lum_out = sep.outputs[1]
    w = N.new("ShaderNodeMapRange")  # 1 in the shadows/mids, 0.35 in the highlights
    w.interpolation_type = "SMOOTHSTEP"
    L.new(lum_out, sock(w, "Value"))
    w.inputs["From Min"].default_value, w.inputs["From Max"].default_value = 0.15, 1.2
    w.inputs["To Min"].default_value, w.inputs["To Max"].default_value = 1.0, 0.35
    gamt = N.new("ShaderNodeMath")
    gamt.operation = "MULTIPLY"
    L.new(sock(w, "Result", True), gamt.inputs[0])
    gamt.inputs[1].default_value = float(os.environ.get("V4_GRAIN", "0.22"))
    gscaled = mix("MULTIPLY", centred, gamt.outputs[0])
    # multiplicative (film grain lives in the density) plus a floor so true blacks still breathe
    one_plus = mix("ADD", gscaled, (1.0, 1.0, 1.0))
    img = mix("MULTIPLY", img, one_plus)
    floor_g = mix("MULTIPLY", centred, (0.004, 0.004, 0.004))
    img = mix("ADD", img, floor_g)
    if N.get("GrainAmount") is not None:  # the old grey grain goes
        N["GrainAmount"].inputs["To Min"].default_value = 0.0
        N["GrainAmount"].inputs["To Max"].default_value = 0.0

    # (e) gate weave + exposure flicker: tiny, only visible in motion
    weave = N.new("CompositorNodeTranslate")
    try:
        weave.interpolation = "BILINEAR"
    except Exception:
        pass
    L.new(img, sock(weave, "Image"))
    drive(sock(weave, "X"), "0.35 * sin(frame * 0.71) + 0.2 * sin(frame * 1.93 + 1.0)")
    drive(sock(weave, "Y"), "0.45 * sin(frame * 0.53 + 2.0) + 0.25 * sin(frame * 2.31)")
    img = sock(weave, "Image", True)
    flick = N.new("ShaderNodeValue")
    drive(flick.outputs[0], "1.0 + 0.008 * sin(frame * 2.9) + 0.006 * sin(frame * 7.3 + 0.5)")
    img = mix("MULTIPLY", img, flick.outputs[0])

    L.new(img, sock(curve, "Image"))
    log["film"] = {"veil": 0.035, "dirt": float(os.environ.get("V4_DIRT", "0.35")), "halation": float(os.environ.get("V4_HALATION", "0.3")),
                   "grain": float(os.environ.get("V4_GRAIN", "0.22")), "weave_px": 0.55, "flicker": 0.014}

print("v4:", json.dumps(log))
