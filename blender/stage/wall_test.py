# LED video wall test: run after apply_drive.py and look_test.py (LT_NORENDER=1), before
# wave_test.py (WT_A=0, which renders). Replaces the painted Scope plane with a real LED wall:
#   5 x 3 cabinets of 500 x 500 mm, 3 mm seams, a 40 mm black frame, two floor-standing truss
#   uprights with base plates; the face is a pixel grid (3.9 mm pitch: small emitters on black,
#   louvre falloff at grazing angles); the content is the old scope waveform, quantised to the
#   pixel grid and driven by the same keyed Bass/Mid/High/Time values and mood colour.
# Nothing is saved to the .blend; no speaker materials are touched.
import bpy, math, os, json
from mathutils import Vector

scene = bpy.context.scene
log = {}

old = bpy.data.objects.get("Scope")
cx, cy, cz = old.location if old else (0.0, 1.2, 0.12)
for n in ("Scope", "Scope_Glass", "Scope_Bezel"):
    o = bpy.data.objects.get(n)
    if o is not None:
        o.hide_render = True

TILE = 0.5
COLS, ROWS = 5, 3
SEAM = 0.003
PITCH = 0.0039
FRAME = 0.04
DEPTH = 0.09  # cabinet depth
W, H = COLS * TILE, ROWS * TILE
x0, z0 = cx - W / 2, cz - H / 2
floor = bpy.data.objects.get("Floor")
floor_z = floor.location.z if floor else z0 - 0.7

coll = bpy.data.collections.new("LEDWall")
scene.collection.children.link(coll)


def box(name, center, size, mat):
    me = bpy.data.meshes.new(name)
    hx, hy, hz = (s / 2 for s in size)
    v = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz), (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
    f = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7), (3, 2, 1, 0)]
    me.from_pydata(v, [], f)
    me.update()
    ob = bpy.data.objects.new(name, me)
    ob.location = center
    ob.data.materials.append(mat)
    coll.objects.link(ob)
    return ob


def plain(name, color, rough, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


cab_mat = plain("LEDCabinetMat", (0.012, 0.012, 0.013), 0.55)  # powder-coated die-cast aluminium
truss_mat = plain("LEDTrussMat", (0.55, 0.56, 0.58), 0.32, 1.0)  # bare aluminium truss

# ---- the face material: pixel grid on black, content quantised to the grid
m = bpy.data.materials.new("LEDFaceMat")
m.use_nodes = True
nt = m.node_tree
N, L = nt.nodes, nt.links
bsdf = N["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.006, 0.006, 0.007, 1)  # the black face between emitters
bsdf.inputs["Roughness"].default_value = 0.5
bsdf.inputs["Specular IOR Level"].default_value = 0.35


def mnode(op, a, b=None):
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


scope_mat = bpy.data.materials.get("ScopeMat")


def driven_value(name, path, idx=None):
    n = N.new("ShaderNodeValue")
    n.name = n.label = name
    fc = n.outputs[0].driver_add("default_value")
    fc.driver.type = "AVERAGE"
    var = fc.driver.variables.new()
    var.targets[0].id_type = "MATERIAL"
    var.targets[0].id = scope_mat
    var.targets[0].data_path = path if idx is None else f"{path}[{idx}]"
    return n.outputs[0]


B = driven_value("Bass", 'node_tree.nodes["Bass"].outputs[0].default_value')
M = driven_value("Mid", 'node_tree.nodes["Mid"].outputs[0].default_value')
Hh = driven_value("High", 'node_tree.nodes["High"].outputs[0].default_value')
T = driven_value("Time", 'node_tree.nodes["Time"].outputs[0].default_value')
col_path = 'node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value'
rgb = N.new("ShaderNodeCombineColor")
for i, ch in enumerate(("Red", "Green", "Blue")):
    L.new(driven_value(f"Col{i}", col_path, i), rgb.inputs[ch])

# wall coordinates in metres from the bottom-left of the whole wall (world position)
geo = N.new("ShaderNodeNewGeometry")
sep = N.new("ShaderNodeSeparateXYZ")
L.new(geo.outputs["Position"], sep.inputs[0])
ux = mnode("SUBTRACT", sep.outputs[0], x0)
vz = mnode("SUBTRACT", sep.outputs[2], z0)
# pixel index and position inside the pixel
px = mnode("DIVIDE", ux, PITCH)
pz = mnode("DIVIDE", vz, PITCH)
cell_x = mnode("FLOOR", px)
cell_z = mnode("FLOOR", pz)
fx = mnode("SUBTRACT", px, cell_x)
fz = mnode("SUBTRACT", pz, cell_z)
# content sampled at the pixel centre, in 0..1 wall units
u = mnode("DIVIDE", mnode("MULTIPLY", mnode("ADD", cell_x, 0.5), PITCH), W)
v = mnode("DIVIDE", mnode("MULTIPLY", mnode("ADD", cell_z, 0.5), PITCH), H)
two_pi = 2 * math.pi
wave = mnode(
    "ADD",
    mnode("MULTIPLY", B, mnode("SINE", mnode("ADD", mnode("MULTIPLY", u, two_pi * 3), mnode("MULTIPLY", T, 6.0)))),
    mnode(
        "ADD",
        mnode("MULTIPLY", mnode("MULTIPLY", M, 0.6), mnode("SINE", mnode("SUBTRACT", mnode("MULTIPLY", u, two_pi * 11), mnode("MULTIPLY", T, 15.0)))),
        mnode("MULTIPLY", mnode("MULTIPLY", Hh, 0.3), mnode("SINE", mnode("ADD", mnode("MULTIPLY", u, two_pi * 29), mnode("MULTIPLY", T, 40.0)))),
    ),
)
f = mnode("ADD", 0.5, mnode("MULTIPLY", wave, 0.30))
d = mnode("ABSOLUTE", mnode("SUBTRACT", v, f))
# line about 4 px thick with a short soft fall-off: what a VJ trace on an LED wall looks like
core = mnode("EXPONENT", mnode("MULTIPLY", -1.0, mnode("POWER", mnode("DIVIDE", d, 0.011), 2.0)))
halo = mnode("MULTIPLY", 0.12, mnode("EXPONENT", mnode("MULTIPLY", -1.0, mnode("POWER", mnode("DIVIDE", d, 0.04), 2.0))))
# background content: a dim, slowly drifting colour field, so the wall reads as a lit screen
bgn = N.new("ShaderNodeTexNoise")
bgn.noise_dimensions = "3D"
bgn.inputs["Scale"].default_value = 1.6
bgn.inputs["Detail"].default_value = 1.0
bcomb = N.new("ShaderNodeCombineXYZ")
L.new(u, bcomb.inputs["X"]); L.new(v, bcomb.inputs["Y"]); L.new(mnode("MULTIPLY", T, 0.05), bcomb.inputs["Z"])
L.new(bcomb.outputs[0], bgn.inputs["Vector"])
background = mnode("MULTIPLY", float(os.environ.get("WALL_BG", 0.05)), mnode("ADD", 0.5, bgn.outputs["Fac"]))
# cabinet-to-cabinet calibration mismatch: each 500 mm cabinet a few % off its neighbours
cab_i = mnode("ADD", mnode("FLOOR", mnode("DIVIDE", ux, TILE)), mnode("MULTIPLY", 7.0, mnode("FLOOR", mnode("DIVIDE", vz, TILE))))
hashv = mnode("FRACT", mnode("MULTIPLY", mnode("SINE", mnode("MULTIPLY", cab_i, 12.9898)), 43758.5453))
calib = mnode("ADD", 0.94, mnode("MULTIPLY", 0.12, hashv))
content = mnode("MULTIPLY", mnode("ADD", mnode("ADD", core, halo), background), calib)


def box_mask(fr, lo, hi):
    a = N.new("ShaderNodeMapRange")
    a.interpolation_type = "SMOOTHSTEP"
    a.clamp = True
    L.new(fr, a.inputs["Value"])
    a.inputs["From Min"].default_value, a.inputs["From Max"].default_value = lo, lo + 0.08
    b = N.new("ShaderNodeMapRange")
    b.interpolation_type = "SMOOTHSTEP"
    b.clamp = True
    L.new(fr, b.inputs["Value"])
    b.inputs["From Min"].default_value, b.inputs["From Max"].default_value = hi, hi - 0.08
    return mnode("MULTIPLY", a.outputs["Result"], b.outputs["Result"])


# an SMD emitter fills about 40 % of each pixel's width; the rest is black face
emitter = mnode("MULTIPLY", box_mask(fx, 0.2, 0.8), box_mask(fz, 0.2, 0.8))
# louvres: the face dims toward grazing angles
lw = N.new("ShaderNodeLayerWeight")
lw.inputs["Blend"].default_value = 0.5
louvre = mnode("POWER", mnode("SUBTRACT", 1.0, lw.outputs["Facing"]), 0.7)
NITS = float(os.environ.get("WALL_GAIN", 60.0))
strength = mnode("MULTIPLY", mnode("MULTIPLY", mnode("MULTIPLY", content, emitter), louvre), NITS)
WALL_IMAGE = os.environ.get("WALL_IMAGE")
if WALL_IMAGE:
    # screen content from an image sequence (e.g. the meter dashboard), one image per scene
    # frame, sampled at each LED's centre so it lands on the pixel grid
    img = bpy.data.images.load(WALL_IMAGE)
    img.source = "SEQUENCE"
    tex = N.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Closest"
    tex.extension = "CLIP"
    first = int(os.path.splitext(os.path.basename(WALL_IMAGE))[0])
    count = len([f for f in os.listdir(os.path.dirname(WALL_IMAGE)) if f.endswith(".png")])
    iu = tex.image_user
    iu.frame_start = first
    iu.frame_offset = first - 1
    iu.frame_duration = count
    iu.use_auto_refresh = True
    uvc = N.new("ShaderNodeCombineXYZ")
    L.new(u, uvc.inputs["X"])
    L.new(v, uvc.inputs["Y"])
    L.new(uvc.outputs[0], tex.inputs["Vector"])
    # the image is display-referred: a little gain lifts its whites to LED brightness
    L.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
    img_strength = mnode("MULTIPLY", mnode("MULTIPLY", mnode("MULTIPLY", emitter, louvre), calib), float(os.environ.get("WALL_IMG_GAIN", 6.0)))
    # WALL_SPILL: how much harder the screen lights the room and the haze than it shows to the lens.
    # 1 = physically what the lens sees. The emitters are tiny dots on black, so at 1 the screen
    # throws almost no light into the haze; a real LED wall visibly glows in mist.
    spill = float(os.environ.get("WALL_SPILL", 1.0))
    if spill != 1.0:
        lp = N.new("ShaderNodeLightPath")
        img_strength = mnode("MULTIPLY", img_strength, mnode("ADD", spill, mnode("MULTIPLY", lp.outputs["Is Camera Ray"], 1.0 - spill)))
        log["spill"] = spill
    L.new(img_strength, bsdf.inputs["Emission Strength"])
    log["image"] = {"seq": WALL_IMAGE, "frames": count, "first": first}
else:
    L.new(rgb.outputs[0], bsdf.inputs["Emission Color"])
    L.new(strength, bsdf.inputs["Emission Strength"])

# ---- geometry: one face plane per cabinet, set into a black cabinet body; frame; truss
face_y = cy - DEPTH / 2 - 0.0005
for r in range(ROWS):
    for c in range(COLS):
        tx = x0 + (c + 0.5) * TILE
        tz = z0 + (r + 0.5) * TILE
        box(f"LEDCab_{r}_{c}", (tx, cy, tz), (TILE - 0.001, DEPTH, TILE - 0.001), cab_mat)
        me = bpy.data.meshes.new(f"LEDFace_{r}_{c}")
        s = (TILE - SEAM) / 2
        me.from_pydata([(-s, 0, -s), (s, 0, -s), (s, 0, s), (-s, 0, s)], [], [(0, 1, 2, 3)])
        me.update()
        ob = bpy.data.objects.new(f"LEDFace_{r}_{c}", me)
        ob.location = (tx, face_y, tz)
        ob.data.materials.append(m)
        coll.objects.link(ob)
# frame: four flat bars round the edge, proud of the face
fy = cy - DEPTH / 2 + 0.01
box("LEDFrame_T", (cx, fy, z0 + H + FRAME / 2), (W + 2 * FRAME, DEPTH + 0.02, FRAME), cab_mat)
box("LEDFrame_B", (cx, fy, z0 - FRAME / 2), (W + 2 * FRAME, DEPTH + 0.02, FRAME), cab_mat)
box("LEDFrame_L", (x0 - FRAME / 2, fy, cz), (FRAME, DEPTH + 0.02, H), cab_mat)
box("LEDFrame_R", (x0 + W + FRAME / 2, fy, cz), (FRAME, DEPTH + 0.02, H), cab_mat)
# ground support: two 290 mm box-truss uprights behind the wall on base plates
TR = 0.29
for side in (-1, 1):
    ux_ = cx + side * (W / 2 - 0.45)
    uy = cy + DEPTH / 2 + TR / 2 + 0.02
    top = z0 + H + 0.1
    hgt = top - floor_z
    for dx in (-1, 1):
        for dy in (-1, 1):
            box(f"Truss_{side}_{dx}_{dy}", (ux_ + dx * (TR / 2 - 0.025), uy + dy * (TR / 2 - 0.025), floor_z + hgt / 2), (0.05, 0.05, hgt), truss_mat)
    for k in range(int(hgt / 0.5) + 1):  # horizontal rungs every 0.5 m
        zz = floor_z + 0.1 + k * 0.5
        if zz > top:
            break
        box(f"TrussRung_{side}_{k}_a", (ux_, uy - TR / 2 + 0.025, zz), (TR, 0.02, 0.02), truss_mat)
        box(f"TrussRung_{side}_{k}_b", (ux_, uy + TR / 2 - 0.025, zz), (TR, 0.02, 0.02), truss_mat)
    box(f"TrussBase_{side}", (ux_, uy, floor_z + 0.006), (0.8, 0.8, 0.012), truss_mat)

log["wall"] = {"size_m": [W, H], "cabinets": f"{COLS}x{ROWS} @ {TILE * 1000:.0f} mm", "pitch_mm": PITCH * 1000, "centre": [cx, cy, cz], "gain": NITS}
print("wall:", json.dumps(log))
