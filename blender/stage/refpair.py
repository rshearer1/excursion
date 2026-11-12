# Put the reference photo (left) next to our render composited on white (right), same height.
import os
import sys

import bpy
import numpy as np

S = os.path.dirname(os.path.abspath(__file__))
ref_path, ren_path, out = sys.argv[sys.argv.index("--") + 1:]


def load(p):
    img = bpy.data.images.load(p)
    w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    return a, img


ref, _ = load(ref_path)
ren, _ = load(ren_path)
ys_, xs_ = np.where(ren[..., 3] > 0.5)
ren = ren[ys_.min():ys_.max() + 1, xs_.min():xs_.max() + 1]
ref = ref[:, ::-1]  # the photo is the left-hand (mirrored) speaker
rgb = ren[..., :3] * ren[..., 3:4] + (1.0 - ren[..., 3:4]) * 1.0  # straight alpha over white
ren = np.concatenate([rgb, np.ones_like(ren[..., :1])], axis=-1)


def resize(a, h):
    H, W = a.shape[:2]
    w = int(W * h / H)
    ys = (np.arange(h) * H / h).astype(int)
    xs = (np.arange(w) * W / w).astype(int)
    return a[ys][:, xs]


H = 900
A, B = resize(ref, H), resize(ren, H)
C = np.ones((H, A.shape[1] + B.shape[1] + 20, 4), dtype=np.float32)
C[:, :A.shape[1]] = A
C[:, A.shape[1] + 20:] = B
img = bpy.data.images.new(out, C.shape[1], H)
img.pixels.foreach_set(C.ravel())
img.filepath_raw = os.path.join(S, out)
img.file_format = "PNG"
img.save()
