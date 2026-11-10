# Look test overrides, run as a second -P after blender/apply_drive.py (no --render):
#   blender -b blender/scenes/void.blend -P blender/apply_drive.py -P out/look-test/look_test.py -- <drive.json> --engine cycles --samples 48
# Env:
#   LT_NAME     output prefix
#   LT_FIX=1    apply items 1 (real f-stops), 3 (gel rolloff), 4 (1/f handheld)
#   LT_AGX=1    AgX view transform with the Punchy look (else the scene's ACES 2.0)
#   LT_FRAMES   "1000,1300,1600" single stills, or LT_CLIP="1300,1389" an animation range
#   LT_HALF=1   50 % resolution
# Touches nothing on disk except the renders in LT_OUT.
import bpy, os, time, json, colorsys

scene = bpy.context.scene
name = os.environ.get("LT_NAME", "test")
out = os.environ["LT_OUT"]
os.makedirs(out, exist_ok=True)
log = {"name": name}

# item 1: real f-stops per lens (f/1.4 everywhere made the wide shot soft all over)
FSTOPS = {"Cam1_Wide": 5.6, "Cam2_Woofers": 2.8, "Cam3_Macro": 5.6, "Cam6_Side": 2.8, "Cam7_Top": 4.0}

# item 3: highlight rolloff on coloured light. Real gels and LEDs never reach a pure primary;
# pull every light colour (static and keyed) part way toward white, and cap the top light.
GEL_DESAT = 0.35   # fraction of saturation removed
TOPBACK_GAIN = 0.7  # the light that clipped the cabinet top to flat magenta

# item 4: 1/f handheld on top of apply_drive's (tiny, sine) wobble
SHAKE_LOC = 0.004   # metres
SHAKE_ROT = 0.006   # radians (~0.35 deg)


def desat(rgb, k):
    h, s, v = colorsys.rgb_to_hsv(*rgb)
    return colorsys.hsv_to_rgb(h, s * (1 - k), v)


if os.environ.get("LT_FIX") == "1":
    for cam in (o for o in scene.objects if o.type == "CAMERA"):
        if cam.name in FSTOPS and cam.data.dof.use_dof:
            cam.data.dof.aperture_fstop = FSTOPS[cam.name]
    log["fstops"] = FSTOPS

    n_keyed = 0
    for light in (o for o in scene.objects if o.type == "LIGHT"):
        d = light.data
        d.color = desat(tuple(d.color), GEL_DESAT)
        ad = d.animation_data
        if ad and ad.action:
            # keyed colour: rewrite the keyframes channel-wise, frame by frame
            curves = {}
            for fc in getattr(ad.action, "fcurves", []) or []:
                if fc.data_path == "color":
                    curves[fc.array_index] = fc
            if not curves:  # Blender 5 layered actions
                for layer in ad.action.layers:
                    for strip in layer.strips:
                        for bag in strip.channelbags:
                            for fc in bag.fcurves:
                                if fc.data_path == "color":
                                    curves[fc.array_index] = fc
            if len(curves) == 3:
                kps = list(zip(curves[0].keyframe_points, curves[1].keyframe_points, curves[2].keyframe_points))
                for kr, kg, kb in kps:
                    r, g, b = desat((kr.co[1], kg.co[1], kb.co[1]), GEL_DESAT)
                    kr.co[1], kg.co[1], kb.co[1] = r, g, b
                    for k, v in ((kr, r), (kg, g), (kb, b)):
                        k.handle_left[1] = k.handle_right[1] = v
                for fc in curves.values():
                    fc.update()
                n_keyed += 1
        if light.name == "TopBack":
            if ad and ad.action:
                pass
            d.energy *= TOPBACK_GAIN
            for layer in (ad.action.layers if ad and ad.action else []):
                for strip in layer.strips:
                    for bag in strip.channelbags:
                        for fc in bag.fcurves:
                            if fc.data_path == "energy":
                                for k in fc.keyframe_points:
                                    k.co[1] *= TOPBACK_GAIN
                                    k.handle_left[1] *= TOPBACK_GAIN
                                    k.handle_right[1] *= TOPBACK_GAIN
                                fc.update()
    log["gel_desat"] = GEL_DESAT
    log["keyed_light_colours"] = n_keyed

    # 1/f handheld: three octaves of Perlin noise per channel (fcurve NOISE modifiers), a
    # different phase per camera and axis, so no shot repeats the same wobble
    def camera_fcurves(cam):
        ad = cam.animation_data
        if not ad or not ad.action:
            return []
        out_fc = list(getattr(ad.action, "fcurves", []) or [])
        if not out_fc:
            for layer in ad.action.layers:
                for strip in layer.strips:
                    for bag in strip.channelbags:
                        out_fc += list(bag.fcurves)
        return out_fc

    n_shake = 0
    for ci, cam in enumerate(o for o in scene.objects if o.type == "CAMERA" and os.environ.get("LT_NOSHAKE") != "1"):
        tracked = any(c.type == "TRACK_TO" for c in cam.constraints)
        for fc in camera_fcurves(cam):
            if fc.data_path == "location":
                amp = SHAKE_LOC
            elif fc.data_path == "rotation_euler" and not tracked:
                amp = SHAKE_ROT * (0.3 if fc.array_index == 1 else 1.0)
            else:
                continue
            for octave, (scale, share) in enumerate(((48.0, 0.6), (14.0, 0.3), (4.5, 0.1))):
                m = fc.modifiers.new("NOISE")
                m.scale = scale  # frames per noise cycle
                m.strength = 2 * amp * share  # NOISE is +-strength/2
                m.phase = 13.7 * ci + 5.3 * fc.array_index + 31.1 * octave
                m.depth = 1
                m.blend_type = "ADD"
            n_shake += 1
    log["shake_fcurves"] = n_shake

if os.environ.get("LT_AGX") == "1":
    vs = scene.view_settings
    vs.view_transform = "AgX"
    try:
        vs.look = "AgX - Punchy"
    except TypeError:
        vs.look = "Punchy"
    log["view"] = (vs.view_transform, vs.look)
else:
    log["view"] = (scene.view_settings.view_transform, scene.view_settings.look)

if os.environ.get("LT_HALF") == "1":
    scene.render.resolution_percentage = 50
print("lt:", json.dumps(log))

if os.environ.get("LT_NORENDER") != "1":
    times = []
    clip = os.environ.get("LT_CLIP")
    if clip:
        f0, f1 = (int(x) for x in clip.split(","))
        scene.frame_start, scene.frame_end = f0, f1
        scene.render.filepath = os.path.join(out, name, "")
        t = time.perf_counter()
        bpy.ops.render.render(animation=True)
        dt = time.perf_counter() - t
        times.append({"clip": [f0, f1], "s": round(dt, 1), "s_per_frame": round(dt / (f1 - f0 + 1), 2)})
        print(f"lt: {name} clip {f0}..{f1} {dt:.1f}s")
    else:
        for f in (int(x) for x in os.environ["LT_FRAMES"].split(",")):
            scene.frame_set(f)
            scene.render.filepath = os.path.join(out, f"{name}_{f:04d}.png")
            t = time.perf_counter()
            bpy.ops.render.render(write_still=True)
            dt = time.perf_counter() - t
            times.append({"frame": f, "s": round(dt, 2)})
            print(f"lt: {name} frame {f} {dt:.2f}s")
    log["times"] = times
    with open(os.path.join(out, f"{name}.json"), "w") as fh:
        json.dump(log, fh, indent=1)
