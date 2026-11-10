# Wave test: run as a third -P after apply_drive.py and look_test.py (LT_NORENDER=1).
#   A) the LED-wall oscilloscope (a painted plane) is replaced by a real neon tube: a glass tube
#      with an emissive core, bent every frame (and every motion-blur subframe) to the track's
#      actual waveform — mid (L+R) is height, side (L-R) is depth — trigger-locked like a scope.
#   B) the red shell ring outlines go; each kick's shell instead drives a density ripple
#      through the smoke grid and pushes dust motes outward as it passes.
# Env: WT_NAME, WT_OUT, WT_FRAMES "1000,1300,1600" or WT_CLIP "1590,1679", WT_HALF=1,
#      WT_A=0/1, WT_B=0/1 (both default 1). Nothing is saved to the .blend.
import bpy, os, sys, time, json, wave, math
import numpy as np

scene = bpy.context.scene
argv = sys.argv[sys.argv.index("--") + 1:]
drive_path = argv[0]
with open(drive_path, encoding="utf-8") as fh:
    drive = json.load(fh)
fps = drive["fps"]
log = {"name": os.environ.get("WT_NAME", "wave")}
DO_A = os.environ.get("WT_A", "1") == "1"
DO_B = os.environ.get("WT_B", "1") == "1"


def fcurves_of(id_data):
    ad = getattr(id_data, "animation_data", None)
    if not ad or not ad.action:
        return []
    out = list(getattr(ad.action, "fcurves", []) or [])
    if not out:
        for layer in ad.action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    out += list(bag.fcurves)
    return out


# ---------------------------------------------------------------- A: neon tube
if DO_A:
    for name in ("Scope", "Scope_Glass", "Scope_Bezel"):
        o = bpy.data.objects.get(name)
        if o is not None:
            o.hide_render = True
    scope = bpy.data.objects.get("Scope")
    cx, cy, cz = scope.location if scope else (0.0, 1.2, 0.12)
    half_w = (scope.scale.x / 2 if scope else 1.2) * 0.92
    cab = bpy.data.objects.get("Cabinet")
    if cab is not None and os.environ.get("WT_TUBE_BEHIND", "1") == "1":
        from mathutils import Vector
        bb = [cab.matrix_world @ Vector(c) for c in cab.bound_box]
        back_y = max(v.y for v in bb)
        top_z = max(v.z for v in bb)
        bot_z = min(v.z for v in bb)
        cy = back_y + 0.30 + 0.12  # the tube's centre line ends up ~30 cm behind the back panel
        cz = top_z - 0.25 * (top_z - bot_z)  # below the lid: the cabinet hides its lower swings
        half_w = 0.75
        log["cabinet"] = {"back_y": back_y, "top_z": top_z, "bot_z": bot_z}

    # audio: mid/side, gently low-passed so the tube bends instead of buzzing
    wav = wave.open(os.path.join(os.path.dirname(drive_path), drive["audio"]["file"]))
    sr, nch = wav.getframerate(), wav.getnchannels()
    pcm = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    pcm = pcm.reshape(-1, nch)
    left, right = pcm[:, 0], pcm[:, -1]
    k = np.ones(90, np.float32) / 90  # ~500 Hz low-pass: the tube bends, it does not fizz
    mid = np.convolve((left + right) * 0.5, k, mode="same")
    side = np.convolve((left - right) * 0.5, np.ones(400, np.float32) / 400, mode="same")  # depth moves slower than height
    bassk = np.ones(220, np.float32) / 220  # ~200 Hz, for the trigger only
    bass = np.convolve(mid, bassk, mode="same")
    mid /= max(1e-4, float(np.percentile(np.abs(mid), 99.7)))
    side /= max(1e-4, float(np.percentile(np.abs(side), 99.7)))
    WIN = int(0.05 * sr)  # 50 ms on screen: a couple of bass cycles
    NPTS = 220
    AMP_Z, AMP_Y = 0.20, 0.10  # metres: height swing, depth swing
    taper = np.sin(np.linspace(0, math.pi, NPTS)) ** 0.6  # ends settle to the mounts

    def tube_shape(t):
        i0 = int(t * sr)
        i0 = max(0, min(len(mid) - 2 * WIN - 1, i0))
        seg = bass[i0:i0 + WIN]
        up = np.where((seg[:-1] < 0) & (seg[1:] >= 0))[0]
        start = i0 + (int(up[0]) if len(up) else 0)  # scope trigger: first rising zero crossing
        idx = np.linspace(start, start + WIN, NPTS).astype(int)
        u = np.linspace(-1, 1, NPTS)
        x = cx + u * half_w
        z = cz + AMP_Z * np.clip(mid[idx], -1.4, 1.4) * taper
        # depth: the stereo side, plus a gentle bow toward the camera at the ends
        y = cy - 0.12 + AMP_Y * np.clip(side[idx], -1.4, 1.4) * taper - 0.30 * u ** 4
        return np.stack([x, y, z], 1)

    def make_tube(name, radius, mat):
        cu = bpy.data.curves.new(name, "CURVE")
        cu.dimensions = "3D"
        cu.bevel_depth = radius
        cu.bevel_resolution = 4
        cu.use_fill_caps = True
        sp = cu.splines.new("POLY")
        sp.points.add(NPTS - 1)
        ob = bpy.data.objects.new(name, cu)
        scene.collection.objects.link(ob)
        ob.data.materials.append(mat)
        return ob, sp

    # trace colour follows the mood cues (ScopeMat's keyed emission colour)
    scope_mat = bpy.data.materials.get("ScopeMat")
    col_fc = [fc for fc in fcurves_of(scope_mat.node_tree) if "Emission Color" in fc.data_path] if scope_mat else []
    col_fc.sort(key=lambda fc: fc.array_index)
    base_col = tuple(scope_mat.node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value)[:3] if scope_mat else (0.55, 0.75, 1.0)

    core_mat = bpy.data.materials.new("NeonCore")
    core_mat.use_nodes = True
    cn = core_mat.node_tree.nodes
    cn.remove(cn["Principled BSDF"])
    emit = cn.new("ShaderNodeEmission")
    core_mat.node_tree.links.new(emit.outputs[0], cn["Material Output"].inputs["Surface"])

    glass_mat = bpy.data.materials.new("NeonGlass")
    glass_mat.use_nodes = True
    gb = glass_mat.node_tree.nodes["Principled BSDF"]
    gb.inputs["Base Color"].default_value = (0.95, 0.97, 1.0, 1)
    gb.inputs["Roughness"].default_value = 0.12
    gb.inputs["Transmission Weight"].default_value = 1.0
    gb.inputs["IOR"].default_value = 1.47
    # the phosphor coating: the glass itself glows faintly with the core's colour
    gb.inputs["Emission Strength"].default_value = 0.0

    core, core_sp = make_tube("NeonCore", 0.0035, core_mat)
    glass, glass_sp = make_tube("NeonGlass", 0.009, glass_mat)
    core.visible_shadow = False  # it is inside the glass; the glass casts
    glass.visible_shadow = False  # a lit tube: no hard shadow line on the room

    frames = drive["frames"]
    bass_lvl = [f["bass"] for f in frames]
    env, bass_env = 0.0, []
    for v in bass_lvl:
        env = max(v, env * 0.85)
        bass_env.append(env)

    def update(scn, *_):
        t = (scn.frame_current_final - 1) / fps
        pts = tube_shape(max(0.0, t))
        for sp in (core_sp, glass_sp):
            for p, q in zip(sp.points, pts):
                p.co = (q[0], q[1], q[2], 1.0)
        fi = int(max(0, min(len(frames) - 1, round(scn.frame_current_final - 1))))
        col = tuple(fc.evaluate(scn.frame_current_final) for fc in col_fc) if len(col_fc) == 3 else base_col
        emit.inputs["Color"].default_value = (*col, 1.0)
        emit.inputs["Strength"].default_value = 10.0 + 22.0 * bass_env[fi]
        gb.inputs["Emission Color"].default_value = (*col, 1.0)
        gb.inputs["Emission Strength"].default_value = 0.08 + 0.2 * bass_env[fi]
        core.data.update_tag()
        glass.data.update_tag()

    bpy.app.handlers.frame_change_pre.append(update)
    update(scene)
    log["A"] = {"tube_center": [cx, cy - 0.12, cz], "width_m": 2 * half_w, "points": NPTS, "core_r": 0.0035, "glass_r": 0.009}

# ---------------------------------------------------------------- B: ripples, no rings
if DO_B:
    shells = sorted((o for o in scene.objects if o.name.startswith("Shell_") and o.type == "MESH"), key=lambda o: o.name)
    for s in shells:
        s.visible_camera = False  # the ring outline goes; the object stays to carry the wave
    RIP_W = float(os.environ.get("WT_RIP_W", 0.12))  # metres: thickness of the compressed shell of air
    SMOKE_GAIN = float(os.environ.get("WT_SMOKE_GAIN", 15.0))  # density multiplier at the crest (times the shell's fading strength)
    HAZE_BUMP = float(os.environ.get("WT_HAZE_BUMP", 0.6))  # extra density at the crest even where the haze is thin
    DUST_PUSH = float(os.environ.get("WT_DUST_PUSH", 0.12))  # metres a mote is shoved outward at the crest

    def add_ripple_field(ng, label):
        """Sum over shells of strength * gaussian(|P - centre| - radius). Returns (field, dir)."""
        N, L = ng.nodes, ng.links
        pos = N.new("GeometryNodeInputPosition").outputs["Position"]
        total, push_vec = None, None
        for s in shells:
            info = N.new("GeometryNodeObjectInfo")
            info.inputs["Object"].default_value = s
            info.transform_space = "ORIGINAL"
            sep = N.new("ShaderNodeSeparateXYZ")
            L.new(info.outputs["Scale"], sep.inputs[0])
            rel = N.new("ShaderNodeVectorMath"); rel.operation = "SUBTRACT"
            L.new(pos, rel.inputs[0]); L.new(info.outputs["Location"], rel.inputs[1])
            dist = N.new("ShaderNodeVectorMath"); dist.operation = "LENGTH"
            L.new(rel.outputs[0], dist.inputs[0])
            d = N.new("ShaderNodeMath"); d.operation = "SUBTRACT"
            L.new(dist.outputs["Value"], d.inputs[0]); L.new(sep.outputs[0], d.inputs[1])
            q = N.new("ShaderNodeMath"); q.operation = "DIVIDE"
            L.new(d.outputs[0], q.inputs[0]); q.inputs[1].default_value = RIP_W
            sq = N.new("ShaderNodeMath"); sq.operation = "MULTIPLY"
            L.new(q.outputs[0], sq.inputs[0]); L.new(q.outputs[0], sq.inputs[1])
            neg = N.new("ShaderNodeMath"); neg.operation = "MULTIPLY"
            L.new(sq.outputs[0], neg.inputs[0]); neg.inputs[1].default_value = -1.0
            g = N.new("ShaderNodeMath"); g.operation = "EXPONENT"
            L.new(neg.outputs[0], g.inputs[0])
            # strength: a driver on the shell material's keyed Alpha (fades over the wave's life)
            val = N.new("ShaderNodeValue"); val.label = f"{label}_{s.name}"
            fc = val.outputs[0].driver_add("default_value")
            fc.driver.type = "AVERAGE"
            var = fc.driver.variables.new()
            var.targets[0].id_type = "MATERIAL"
            var.targets[0].id = s.data.materials[0]
            var.targets[0].data_path = 'node_tree.nodes["Alpha"].outputs[0].default_value'
            a = N.new("ShaderNodeMath"); a.operation = "MULTIPLY"
            L.new(g.outputs[0], a.inputs[0]); L.new(val.outputs[0], a.inputs[1])
            if total is None:
                total = a.outputs[0]
            else:
                add = N.new("ShaderNodeMath"); add.operation = "ADD"
                L.new(total, add.inputs[0]); L.new(a.outputs[0], add.inputs[1])
                total = add.outputs[0]
            nrm = N.new("ShaderNodeVectorMath"); nrm.operation = "NORMALIZE"
            L.new(rel.outputs[0], nrm.inputs[0])
            sc = N.new("ShaderNodeVectorMath"); sc.operation = "SCALE"
            L.new(nrm.outputs[0], sc.inputs[0]); L.new(a.outputs[0], sc.inputs["Scale"])
            if push_vec is None:
                push_vec = sc.outputs[0]
            else:
                vadd = N.new("ShaderNodeVectorMath"); vadd.operation = "ADD"
                L.new(push_vec, vadd.inputs[0]); L.new(sc.outputs[0], vadd.inputs[1])
                push_vec = vadd.outputs[0]
        return total, push_vec

    strength = max((s.data.materials[0].node_tree.nodes["Alpha"].outputs[0].default_value for s in shells), default=0)
    smoke_ng = bpy.data.node_groups.get("SmokeGrid")
    if smoke_ng is not None and shells:
        N, L = smoke_ng.nodes, smoke_ng.links
        cube = next(n for n in N if n.bl_idname == "GeometryNodeVolumeCube")
        dens_link = cube.inputs["Density"].links[0]
        dens = dens_link.from_socket
        L.remove(dens_link)
        rip, _ = add_ripple_field(smoke_ng, "smoke")
        # the crest: existing smoke compressed (multiplied) plus a little haze made visible
        mul = N.new("ShaderNodeMath"); mul.operation = "MULTIPLY_ADD"
        L.new(rip, mul.inputs[0]); mul.inputs[1].default_value = SMOKE_GAIN; mul.inputs[2].default_value = 1.0
        d2 = N.new("ShaderNodeMath"); d2.operation = "MULTIPLY"
        L.new(dens, d2.inputs[0]); L.new(mul.outputs[0], d2.inputs[1])
        bump = N.new("ShaderNodeMath"); bump.operation = "MULTIPLY_ADD"
        L.new(rip, bump.inputs[0]); bump.inputs[1].default_value = HAZE_BUMP; L.new(d2.outputs[0], bump.inputs[2])
        L.new(bump.outputs[0], cube.inputs["Density"])
        log["B_smoke"] = {"width_m": RIP_W, "gain": SMOKE_GAIN, "haze_bump": HAZE_BUMP}
    dust_ng = bpy.data.node_groups.get("DustField")
    if dust_ng is not None and shells:
        N, L = dust_ng.nodes, dust_ng.links
        setp = next(n for n in N if n.bl_idname == "GeometryNodeSetPosition")
        outs = [l.to_socket for l in setp.outputs["Geometry"].links]
        _, push = add_ripple_field(dust_ng, "dust")
        scale = N.new("ShaderNodeVectorMath"); scale.operation = "SCALE"
        L.new(push, scale.inputs[0]); scale.inputs["Scale"].default_value = DUST_PUSH / max(0.05, strength or 0.3)
        sp2 = N.new("GeometryNodeSetPosition")
        L.new(setp.outputs["Geometry"], sp2.inputs["Geometry"])
        L.new(scale.outputs[0], sp2.inputs["Offset"])
        for s in outs:
            L.new(sp2.outputs["Geometry"], s)
        log["B_dust"] = {"push_m": DUST_PUSH}
    log["B_shells"] = len(shells)
    cab = bpy.data.objects.get("Cabinet")
    if cab is not None and shells and os.environ.get("WT_BACKLIGHT", "1") == "1":
        from mathutils import Vector
        bb = [cab.matrix_world @ Vector(c) for c in cab.bound_box]
        ctr = sum(bb, Vector()) / 8
        back_y = max(v.y for v in bb)
        front_y = min(v.y for v in bb)
        ld = bpy.data.lights.new("RippleBack", "SPOT")
        ld.spot_size = math.radians(38)
        ld.spot_blend = 0.6
        ld.shadow_soft_size = 0.15
        ld.volume_factor = 1.0
        ld.diffuse_factor = 0.15  # it is there to light the air, not the room
        ld.specular_factor = 0.1
        rim = next((o.data.color for o in scene.objects if o.name == "RimLeft"), (1, 0.3, 0.3))
        ld.color = tuple(rim)
        lo = bpy.data.objects.new("RippleBack", ld)
        scene.collection.objects.link(lo)
        lo.location = (ctr.x, back_y + 0.3, ctr.z + 0.9)  # high behind: rakes down through the wave zone, never into the lens
        aim = Vector((ctr.x, front_y - 0.35, ctr.z - 0.1)) - lo.location  # graze the air just in front of the woofers
        lo.rotation_euler = aim.to_track_quat("-Z", "Y").to_euler()
        fc = ld.driver_add("energy")
        fc.driver.type = "SCRIPTED"
        fc.driver.expression = "8 + 700 * (" + " + ".join(f"a{i}" for i in range(len(shells))) + ")"
        for i, s in enumerate(shells):
            var = fc.driver.variables.new()
            var.name = f"a{i}"
            var.targets[0].id_type = "MATERIAL"
            var.targets[0].id = s.data.materials[0]
            var.targets[0].data_path = 'node_tree.nodes["Alpha"].outputs[0].default_value'
        log["B_backlight"] = {"loc": list(lo.location), "energy": "8 + 700*sum(alpha)"}

if os.environ.get("WT_HALF") == "1":
    scene.render.resolution_percentage = 50
print("wt:", json.dumps(log))

out = os.environ["WT_OUT"]
os.makedirs(out, exist_ok=True)
name = log["name"]
times = []
clip = os.environ.get("WT_CLIP")
if clip:
    f0, f1 = (int(x) for x in clip.split(","))
    scene.frame_start, scene.frame_end = f0, f1
    scene.render.filepath = os.path.join(out, name, "")
    t0 = time.perf_counter()
    bpy.ops.render.render(animation=True)
    dt = time.perf_counter() - t0
    times.append({"clip": [f0, f1], "s": round(dt, 1), "s_per_frame": round(dt / (f1 - f0 + 1), 2)})
    print(f"wt: {name} clip {f0}..{f1} {dt:.1f}s")
else:
    for f in (int(x) for x in os.environ["WT_FRAMES"].split(",")):
        scene.frame_set(f)
        scene.render.filepath = os.path.join(out, f"{name}_{f:04d}.png")
        t0 = time.perf_counter()
        bpy.ops.render.render(write_still=True)
        dt = time.perf_counter() - t0
        times.append({"frame": f, "s": round(dt, 2)})
        print(f"wt: {name} frame {f} {dt:.2f}s")
log["times"] = times
with open(os.path.join(out, f"{name}.json"), "w") as fh:
    json.dump(log, fh, indent=1)
