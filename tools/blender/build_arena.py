"""Castle rooftop arena for Shinobi Duel, built procedurally in Blender (5.1).

Run inside Blender (Blender MCP `execute_blender_code`):
    exec(open(r"C:\\Code\\shinobi-duel\\tools\\blender\\build_arena.py").read()); build()

All geometry is generated in three.js coordinates (y up, the fighting floor at y = 0, the ridge along
z = RIDGE_Z) and converted to Blender's z-up on the way in, so the glTF export lands 1:1 in the game.
Meshes are merged per (group, material) to keep draw calls low. Textures are Poly Haven CC0 sets in
blender/tex/ (plus derived ones from prep_textures.py).

Node names the game relies on:
    LanternHang_NN   the swinging part of each lantern (origin = hang pivot); lit ones end in "_L"
    Sun / sky / fog / lanterns lights stay in code.
"""
import math
import os
import random

import bpy
from mathutils import Matrix, Vector

ROOT = r"C:\Code\shinobi-duel"
TEX = os.path.join(ROOT, "blender", "tex")
DER = os.path.join(TEX, "derived")
ARENA_HALF = 11.2
RIDGE_Z = -13.2
# Kawara texture (roof_tiles, 2 m photo of 40 x 12 tiles) stretched so a column is ~0.3 m wide and a
# course ~0.33 m tall, the pitch of real hongawara.
KU, KV = 12.0, 4.0


def P(v):
    return (v[0], -v[2], v[1])


# --------------------------------------------------------------------------------------- batches
class Batch:
    """Merged geometry. An optional 4th geo element is a second UV set, written as the "AO" map."""

    def __init__(self):
        self.v, self.f, self.uv, self.uv2 = [], [], [], []

    def add(self, geo, M=None, uvo=(0.0, 0.0)):
        verts, faces, uvs = geo[:3]
        o = len(self.v)
        if M is not None:
            verts = [tuple(M @ Vector(p)) for p in verts]
        self.v.extend(verts)
        self.f.extend(tuple(i + o for i in f) for f in faces)
        self.uv.extend((u + uvo[0], v + uvo[1]) for u, v in uvs)
        self.uv2.extend(geo[3] if len(geo) > 3 else [(0.0, 0.0)] * len(uvs))


BATCHES = {}


def B(group, mat):
    return BATCHES.setdefault((group, mat), Batch())


def T(x=0.0, y=0.0, z=0.0, rx=0.0, ry=0.0, rz=0.0, s=1.0):
    """three.js-style TRS (Euler XYZ) in three coordinates."""
    R = Matrix.Rotation(rz, 4, "Z") @ Matrix.Rotation(ry, 4, "Y") @ Matrix.Rotation(rx, 4, "X")
    S = Matrix.Diagonal((s, s, s, 1.0)) if not isinstance(s, tuple) else Matrix.Diagonal((*s, 1.0))
    return Matrix.Translation((x, y, z)) @ R @ S


# ------------------------------------------------------------------------------------ primitives
def box(w, h, d, ku=1.0, kv=None):
    kv = kv or ku
    hx, hy, hz = w / 2, h / 2, d / 2
    V, F, U = [], [], []
    faces = [
        ((1, 0, 0), (0, 0, -1), (0, 1, 0), hz, hy),
        ((-1, 0, 0), (0, 0, 1), (0, 1, 0), hz, hy),
        ((0, 1, 0), (1, 0, 0), (0, 0, -1), hx, hz),
        ((0, -1, 0), (1, 0, 0), (0, 0, 1), hx, hz),
        ((0, 0, 1), (1, 0, 0), (0, 1, 0), hx, hy),
        ((0, 0, -1), (-1, 0, 0), (0, 1, 0), hx, hy),
    ]
    ext = Vector((hx, hy, hz))
    for n, r, u, hw, hh in faces:
        n, r, u = Vector(n), Vector(r), Vector(u)
        c = Vector((n.x * ext.x, n.y * ext.y, n.z * ext.z))
        o = len(V)
        for sr, su in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            p = c + r * (sr * hw) + u * (su * hh)
            V.append(tuple(p))
            U.append((p.dot(r) / ku, p.dot(u) / kv))
        F.append((o, o + 1, o + 2, o + 3))
    return V, F, U


def frustum(bx, bz, tx, tz, h, k=1.0, top=True):
    """Battered 4-sided base (ishigaki): bottom half extents (bx, bz) at y=0, top (tx, tz) at y=h."""
    V, F, U = [], [], []
    bot = [(-bx, 0, bz), (bx, 0, bz), (bx, 0, -bz), (-bx, 0, -bz)]
    tp = [(-tx, h, tz), (tx, h, tz), (tx, h, -tz), (-tx, h, -tz)]
    for i in range(4):
        a, b = bot[i], bot[(i + 1) % 4]
        c, d = tp[(i + 1) % 4], tp[i]
        L = math.dist(a, b)
        sl = math.dist(a, d)
        o = len(V)
        V += [a, b, c, d]
        off = (L - math.dist(c, d)) / 2
        U += [(0, 0), (L / k, 0), ((L - off) / k, sl / k), (off / k, sl / k)]
        F.append((o, o + 1, o + 2, o + 3))
    if top:
        o = len(V)
        V += tp
        U += [(p[0] / k, p[2] / k) for p in tp]
        F.append((o, o + 1, o + 2, o + 3))
    return V, F, U


def cylinder(rt, rb, h, n=16, capped=True, th0=0.0, th1=2 * math.pi, ku=1.0, kv=1.0, axis="y"):
    V, F, U = [], [], []
    for i in range(n + 1):
        a = th0 + (th1 - th0) * i / n
        for y, r in ((-h / 2, rb), (h / 2, rt)):
            V.append((math.sin(a) * r, y, math.cos(a) * r))
            U.append((a * (rt + rb) / 2 / ku, (y + h / 2) / kv))
    for i in range(n):
        a = i * 2
        F.append((a, a + 2, a + 3, a + 1))
    if capped:
        for y, r, flip in ((-h / 2, rb, True), (h / 2, rt, False)):
            o = len(V)
            ring = []
            for i in range(n):
                a = th0 + (th1 - th0) * i / n
                V.append((math.sin(a) * r, y, math.cos(a) * r))
                U.append((math.sin(a) * r / ku, math.cos(a) * r / ku))
                ring.append(o + i)
            F.append(tuple(reversed(ring)) if flip else tuple(ring))
    if axis != "y":
        rot = Matrix.Rotation(math.pi / 2, 4, "Z") if axis == "x" else Matrix.Rotation(math.pi / 2, 4, "X")
        V = [tuple(rot @ Vector(p)) for p in V]
    return V, F, U


def lathe(profile, n=20, kv=1.0):
    V, F, U = [], [], []
    for i in range(n + 1):
        a = 2 * math.pi * i / n
        for j, (r, y) in enumerate(profile):
            V.append((math.sin(a) * r, y, math.cos(a) * r))
            U.append((i / n, j / (len(profile) - 1) * kv))
    m = len(profile)
    for i in range(n):
        for j in range(m - 1):
            a = i * m + j
            F.append((a, a + m, a + m + 1, a + 1))
    return V, F, U


def cone(r, h, n=8):
    return cylinder(0.0001, r, h, n, capped=True)


def grid(nu, nv, fn):
    """fn(u, v) -> ((x, y, z), (s, t)); u, v in [0, 1]. Faces point toward +y for a floor laid +x/+z."""
    V, F, U = [], [], []
    for j in range(nv + 1):
        for i in range(nu + 1):
            p, t = fn(i / nu, j / nv)
            V.append(p)
            U.append(t)
    W = nu + 1
    for j in range(nv):
        for i in range(nu):
            a = j * W + i
            F.append((a, a + W, a + W + 1, a + 1))
    return V, F, U


def curved_roof(hx, hz, rise, curl, thick=0.35, N=24):
    """Concave hip roof with upturned corners (footprint half extents include the overhang).
    Returns (top surface, underside + fascia)."""
    ridge = max(0.0, (hx - hz) / hx)

    def top(u, v):
        au, av = abs(u), abs(v)
        mu = max(0.0, (au - ridge) / (1 - ridge)) if ridge < 1 else 0.0
        m = max(mu, av)
        y = rise * (1 - m) ** 1.55
        y += curl * (au * av) ** 4 + curl * 0.18 * m**6
        return y, mu, av

    V, F, U = [], [], []
    V2, F2, U2 = [], [], []
    W = N + 1
    for j in range(W):
        for i in range(W):
            u = i / N * 2 - 1
            v = j / N * 2 - 1
            x, z = u * hx, v * hz
            y, mu, av = top(u, v)
            V.append((x, y, z))
            V2.append((x, y - thick, z))
            # Tile columns run down the slope on every face.
            if mu > av:
                U.append((z / KU, x / KV))
            else:
                U.append((x / KU, z / KV))
            U2.append((x / 3.0, z / 3.0))
    for j in range(N):
        for i in range(N):
            a = j * W + i
            F.append((a, a + W, a + 1))
            F.append((a + 1, a + W, a + W + 1))
            F2.append((a, a + 1, a + W))
            F2.append((a + 1, a + W + 1, a + W))
    # Fascia band around the perimeter (belongs to the underside/wood batch).
    ring = [i for i in range(N)] + [j * W + N for j in range(N)] + [N * W + i for i in range(N, 0, -1)] + [j * W for j in range(N, 0, -1)]
    o = len(V2)
    s = 0.0
    for k, idx in enumerate(ring + [ring[0]]):
        x, y, z = V[idx]
        if k:
            s += math.dist(V[ring[k - 1]][::2], (x, z))
        V2 += [(x, y, z), (x, y - thick, z)]
        U2 += [(s / 2.0, 0.0), (s / 2.0, thick / 2.0)]
    for k in range(len(ring)):
        a = o + k * 2
        F2.append((a, a + 2, a + 3, a + 1))
    return (V, F, U), (V2, F2, U2)


# ------------------------------------------------------------------------------------- materials
def _img(path, colorspace):
    name = os.path.basename(path)
    im = bpy.data.images.get(name)
    if im is None:
        im = bpy.data.images.load(path, check_existing=True)
    else:
        im.reload()
    im.colorspace_settings.name = colorspace
    return im


def gltf_output_group():
    g = bpy.data.node_groups.get("glTF Material Output")
    if g is None:
        g = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        g.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
        g.nodes.new("NodeGroupInput")
    return g


def pbr(name, diff=None, nor=None, rough=None, color=(0.8, 0.8, 0.8), rough_v=0.8, metal=0.0,
        emis=None, emis_strength=0.0, nor_strength=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (-300, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough_v
    bsdf.inputs["Metallic"].default_value = metal
    y = 300
    if diff:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = _img(diff, "sRGB")
        t.location = (-800, y)
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        y -= 300
    if rough:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = _img(rough, "Non-Color")
        t.location = (-800, y)
        nt.links.new(t.outputs["Color"], bsdf.inputs["Roughness"])
        y -= 300
    if nor:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = _img(nor, "Non-Color")
        t.location = (-800, y)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.location = (-500, y)
        nm.inputs["Strength"].default_value = nor_strength
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
        y -= 300
    if emis:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = _img(emis, "sRGB")
        t.location = (-800, y)
        nt.links.new(t.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = emis_strength
    return m


def materials():
    j = lambda *p: os.path.join(TEX, *p)  # noqa: E731
    d = lambda *p: os.path.join(DER, *p)  # noqa: E731
    M = {}
    M["kawara"] = pbr("kawara", d("kawara_diff.jpg"), j("roof_tiles_nor_gl_2k.jpg"), j("roof_tiles_rough_2k.jpg"))
    # The floor's round tiles: each tile samples one photographed tile of the same set.
    M["clay"] = pbr("clay_tiles", d("kawara_diff.jpg"), j("roof_tiles_nor_gl_2k.jpg"), j("roof_tiles_rough_2k.jpg"), nor_strength=0.5)
    M["stone"] = pbr("stone", j("japanese_stone_wall_diff_2k.jpg"), j("japanese_stone_wall_nor_gl_2k.jpg"), j("japanese_stone_wall_rough_2k.jpg"))
    M["plaster"] = pbr("plaster", j("plastered_wall_02_diff_1k.jpg"), j("plastered_wall_02_nor_gl_1k.jpg"), j("plastered_wall_02_rough_1k.jpg"))
    M["wood"] = pbr("wood_dark", d("wood_dark_diff.jpg"), j("weathered_planks_nor_gl_1k.jpg"), j("weathered_planks_rough_1k.jpg"))
    M["snow"] = pbr("snow", j("snow_02_diff_1k.jpg"), j("snow_02_nor_gl_1k.jpg"), j("snow_02_rough_1k.jpg"), nor_strength=0.6)
    M["window"] = pbr("window", d("lattice_diff.png"), rough_v=0.9, emis=d("lattice_diff.png"), emis_strength=1.4)
    M["paper"] = pbr("lantern_paper", d("paper_diff.png"), rough_v=0.9, emis=d("paper_diff.png"), emis_strength=2.2)
    M["lacquer"] = pbr("lacquer", color=(0.012, 0.01, 0.009), rough_v=0.45)
    M["gold"] = pbr("gold", color=(0.78, 0.55, 0.2), rough_v=0.35, metal=1.0)
    M["needles"] = pbr("pine_needles", color=(0.012, 0.03, 0.02), rough_v=1.0)
    return M


# -------------------------------------------------------------------------------------- the roof
def roof_height_snow(x, z):
    hn = math.sin(x * 0.61 + z * 0.23) * 0.5 + math.sin(x * 1.7 - z * 0.9 + 1.3) * 0.3 + math.sin(x * 4.1 + z * 3.3) * 0.2
    edge = min(1.0, max(abs(x) / 13.7, 1 - (z - RIDGE_Z) / 3, z / 14))
    mid = math.exp(-(x * x + (z + 1) * (z + 1)) / 40)
    # Wind-packed patches 3-5 m across that bury the tile courses (kept off the centre line).
    patch = sum(a * math.exp(-((x - px) ** 2 + (z - pz) ** 2) / (r * r)) for px, pz, r, a in DRIFT_PATCHES)
    return -0.014 + 0.045 * hn + 0.15 * edge**2 - 0.025 * mid + patch


DRIFT_PATCHES = ((-7.5, 4.5, 2.2, 0.075), (7.0, -6.0, 1.8, 0.07), (-4.0, -9.0, 2.4, 0.08), (8.5, 8.0, 2.0, 0.07))


def build_floor(R):
    G = "Roof"
    # Pan layer: the channels between the round tiles.
    B(G, "kawara").add(box(27.5, 0.6, 27.5, 0.6, 0.6), T(0, -0.35, 0))
    # Round cover tiles: tapered, overlapping segments laid in 90 columns.
    segL = 0.34
    n_seg = 6
    r0, r1 = 0.094, 0.106

    cols = 90
    rows = int((14 - (RIDGE_Z + 0.75)) / segL)

    def segment(uo, vo, ci, rj):
        """One tile. UV0 samples one photographed tile; UV1 ("AO") is this tile's own atlas cell."""
        V, F, U, A = [], [], [], []

        def cell(s, t):
            return ((ci + 0.08 + 0.84 * s) / cols, (rj + 0.08 + 0.84 * t) / rows)

        for k in range(2):
            z = -segL / 2 - 0.01 if k == 0 else segL / 2 + 0.01
            r = r0 if k == 0 else r1
            for i in range(n_seg + 1):
                a = math.pi * i / n_seg
                V.append((math.cos(a) * r, math.sin(a) * r, z))
                U.append((uo + (i / n_seg) / 40.0, vo + k / 12.0))
                A.append(cell(i / n_seg, 0.75 * k))
        W = n_seg + 1
        for i in range(n_seg):
            F.append((i, i + 1, W + i + 1, W + i))
        # Front lip: a thick bead where this tile overlaps the next one down the course.
        o = len(V)
        for k, (dz, dr) in enumerate(((segL / 2 - 0.02, 0.0), (segL / 2 - 0.005, 0.017), (segL / 2 + 0.016, 0.0))):
            for i in range(n_seg + 1):
                a = math.pi * i / n_seg
                rr = r1 + dr
                V.append((math.cos(a) * rr, math.sin(a) * rr, dz))
                U.append((uo + (i / n_seg) / 40.0, vo + (0.9 + k * 0.045) / 12.0))
                A.append(cell(i / n_seg, 0.8 + 0.1 * k))
        for k in range(2):
            for i in range(n_seg):
                a = o + k * W + i
                F.append((a, a + 1, a + W + 1, a + W))
        return V, F, U, A

    tiles = B(G, "clay")
    for i in range(cols):
        for j in range(rows):
            z = RIDGE_Z + 0.75 + (j + 0.5) * segL
            M = T(-13.5 + i * 0.3 + 0.15 + (R.random() - 0.5) * 0.012, -0.06 + (R.random() - 0.5) * 0.024, z,
                  rx=-(0.035 + (R.random() - 0.5) * 0.03), ry=(R.random() - 0.5) * 0.03, rz=(R.random() - 0.5) * 0.035)
            tiles.add(segment(R.randrange(40) / 40.0, R.randrange(12) / 12.0, i, j), M)
    # Snow banked in the channels.
    x0, x1 = -13.7, 13.7
    z0, z1 = RIDGE_Z + 0.6, 14.0

    def snow_fn(u, v):
        x = x0 + (x1 - x0) * u
        z = z0 + (z1 - z0) * v
        return (x, roof_height_snow(x, z), z), (x / 2.0, z / 2.0)

    B(G, "snow").add(grid(170, 170, snow_fn))
    # Nokigawara: round end caps along the front eave.
    for i in range(cols):
        B(G, "kawara").add(cylinder(0.12, 0.12, 0.05, 12, True, axis="z", ku=0.3, kv=0.3), T(-13.5 + i * 0.3 + 0.15, -0.02, 14.02))
    # Wind-blown drifts banked against the ridge and the eaves.
    for _ in range(90):
        k = R.random()
        ridge = k < 0.55
        if ridge:
            x, z = -13 + R.random() * 26, RIDGE_Z + 0.9 + R.random() * 0.8
        elif k < 0.75:
            x, z = (-1 if R.random() < 0.5 else 1) * (12.6 + R.random() * 1.2), -12 + R.random() * 25
        else:
            x, z = -13 + R.random() * 26, 12.8 + R.random() * 1.2
        dome = lathe([(math.cos(t * math.pi / 2), math.sin(t * math.pi / 2)) for t in (0, 0.25, 0.5, 0.75, 1.0)], 12)
        # Piled higher against the ridge parapet.
        hy = 0.14 + R.random() * 0.18 if ridge else 0.07 + R.random() * 0.12
        B(G, "snow").add(dome, T(x, -0.02, z, ry=R.random() * 3, s=(0.5 + R.random() * 1.4, hy, 0.35 + R.random() * 0.7)))


def onigawara():
    """Oni end tile: a bell-arched slab with a raised rim and a round boss, facing +x."""
    V, F, U = [], [], []
    prof = []
    for i in range(17):
        t = i / 16
        a = math.pi * t
        # Arched outline in (z, y): straight sides, rounded shoulders, a peak.
        z = -0.8 * math.cos(a)
        y = 1.15 + 0.75 * math.sin(a) ** 0.7
        prof.append((z, y))
    outline = [(-0.8, 0.0)] + prof + [(0.8, 0.0)]
    n = len(outline)
    for side, x in ((0, 0.25), (1, -0.25)):
        for z, y in outline:
            V.append((x, y, z))
            # A small window of the tile photo: reads as fired clay, not as courses.
            U.append((z * 0.02 + 0.3, y * 0.02 + 0.4))
    F.append(tuple(range(n)))
    F.append(tuple(reversed([i + n for i in range(n)])))
    for i in range(n):
        a, b = i, (i + 1) % n
        F.append((a, a + n, b + n, b))
    return V, F, U


def build_ridge(R):
    G = "Roof"
    ry = -0.08
    for w, h in ((1.5, 0.24), (1.24, 0.22), (1.0, 0.24)):
        B(G, "kawara").add(box(28, h, w, KU / 3, KV / 12), T(0, ry + h / 2, RIDGE_Z))
        B(G, "lacquer").add(box(28.02, 0.035, w + 0.02), T(0, ry + 0.02, RIDGE_Z))
        ry += h
    B(G, "kawara").add(cylinder(0.34, 0.34, 28, 16, False, ku=KU / 6, kv=KV / 2, axis="x"), T(0, ry + 0.1, RIDGE_Z))
    # Lumpy snow crest.
    crest = []
    V, F, U = [], [], []
    NS, NR = 90, 10
    for i in range(NS + 1):
        x = -13.8 + 27.6 * i / NS
        k = 0.75 + 0.25 * math.sin(x * 1.7) * math.sin(x * 0.63 + 1) + 0.08 * math.sin(x * 7.1)
        for j in range(NR + 1):
            a = math.pi * j / NR
            V.append((x, math.sin(a) * 0.44 * (0.55 + 0.45 * k), math.cos(a) * 0.44 * k))
            U.append((x / 2, j / NR))
    for i in range(NS):
        for j in range(NR):
            a = i * (NR + 1) + j
            F.append((a, a + 1, a + NR + 2, a + NR + 1))
    crest = (V, F, U)
    B(G, "snow").add(crest, T(0, ry + 0.2, RIDGE_Z))
    for s in (-1, 1):
        B(G, "kawara").add(onigawara(), T(s * 14.1, -0.1, RIDGE_Z, ry=0 if s > 0 else math.pi))
        B(G, "kawara").add(cylinder(0.42, 0.42, 0.14, 20, True, axis="x"), T(s * 14.38, 1.05, RIDGE_Z))
        B(G, "kawara").add(cylinder(0.28, 0.28, 0.1, 16, True, axis="x"), T(s * 14.46, 1.05, RIDGE_Z))
        B(G, "snow").add(lathe([(0.9, 0), (0.75, 0.12), (0.4, 0.2), (0.0, 0.22)], 12), T(s * 14.1, 1.83, RIDGE_Z, s=(0.35, 1, 0.9)))
        for h in (-1, 1):
            B(G, "kawara").add(cone(0.13, 0.7, 8), T(s * 14.1, 2.05, RIDGE_Z + h * 0.45, rx=-h * 0.5))


def skirt(G, side, inner, outer_w, drop, curl, z_from=None, N=40, M=10):
    """Upturned eave skirt on one side (+x, -x or +z): a trapezoid strip from the floor edge `inner`
    out by `outer_w`, dropping `drop`, the corners curling up. Top is kawara, underside + fascia wood."""
    top, und = [], []
    V, F, U = [], [], []
    V2, F2, U2 = [], [], []
    for j in range(M + 1):
        t = j / M
        half = inner + t * outer_w
        for i in range(N + 1):
            e = i / N * 2 - 1
            if side == "+z":
                along, a0 = e * half, None
            else:
                lo = z_from if z_from is not None else -half
                along = lo + (half - lo) * (e + 1) / 2
            c = abs(e) ** 8 if side == "+z" else ((e + 1) / 2) ** 8
            y = -0.1 - drop * t**1.35 + curl * c * t**2 + curl * 0.12 * t**4
            d = inner + t * outer_w
            if side == "+z":
                p = (along, y, d)
            elif side == "+x":
                p = (d, y, along)
            else:
                p = (-d, y, along)
            V.append(p)
            V2.append((p[0], p[1] - 0.22, p[2]))
            U.append((along / KU, t * math.hypot(outer_w, drop) / KV))
            U2.append((along / 3, t * outer_w / 3))
    W = N + 1
    flip = side == "-x"
    for j in range(M):
        for i in range(N):
            a = j * W + i
            q = (a, a + 1, a + W + 1, a + W)
            if side == "+z":
                q = (a, a + W, a + W + 1, a + 1)
            if flip:
                q = tuple(reversed(q))
            F.append(q)
            F2.append(tuple(reversed(q)))
    # Fascia along the outer edge.
    o = len(V2)
    for i in range(N + 1):
        p = V[M * W + i]
        V2 += [p, (p[0], p[1] - 0.42, p[2])]
        U2 += [(i / N * 28 / 3, 0), (i / N * 28 / 3, 0.14)]
    for i in range(N):
        a = o + i * 2
        q = (a, a + 1, a + 3, a + 2)
        if side == "+x":
            q = tuple(reversed(q))
        F2.append(q)
    B(G, "kawara").add((V, F, U))
    B(G, "wood").add((V2, F2, U2))


def build_eaves(R):
    G = "Roof"
    skirt(G, "+z", 13.9, 3.4, 2.3, 2.3)
    skirt(G, "+x", 13.9, 3.4, 2.3, 2.3, z_from=RIDGE_Z - 0.2)
    skirt(G, "-x", 13.9, 3.4, 2.3, 2.3, z_from=RIDGE_Z - 0.2)
    # Floor-edge fascia + lip tile.
    for x, z, wx, wz in ((14, 0, 0, 28), (-14, 0, 0, 28), (0, 14, 28, 0)):
        B(G, "wood").add(box(wx or 0.3, 0.45, wz or 0.3, 1.5), T(x, -0.35, z))
    # Far slope beyond the ridge (the other face of the roof).
    def far(u, v):
        x = -17.3 + 34.6 * u
        d = v * 9.0
        y = -0.15 - d * 0.62 + 0.9 * (abs(x) / 17.3) ** 6 * v**2
        return (x, y, RIDGE_Z - 0.7 - d), (x / KU, d / KV)

    V, F, U = grid(40, 10, far)
    F = [tuple(reversed(f)) for f in F]
    B(G, "kawara").add((V, F, U))
    # The building's upper storey below the eaves: plaster, black clapboard skirt, lattice windows.
    B(G, "plaster").add(box(26, 6, 26, 2.2), T(0, -4.3, 0))
    B(G, "wood").add(box(26.1, 2.0, 26.1, 1.5), T(0, -6.35, 0))
    B(G, "wood").add(box(26.4, 0.5, 26.4, 1.5), T(0, -1.55, 0))
    for side in range(4):
        rot = side * math.pi / 2
        for k in range(6):
            lit = R.random() < 0.5
            x = -10.4 + k * 4.16
            geo = box(1.6, 1.3, 0.06)
            V, F, U = geo
            U = [((0.02 + (u / 1.6 + 0.5) * 0.46) + (0 if lit else 0.5), v / 1.3 + 0.5) for u, v in U]
            B(G, "window").add((V, F, U), T(0, 0, 0, ry=rot) @ T(x, -4.0, 13.03))
    # Lower roof skirt around the storey and the stone base below (ishigaki).
    top, und = curved_roof(19, 19, 1.8, 0.9, 0.35, 24)
    B(G, "kawara").add(top, T(0, -9.5, 0))
    B(G, "wood").add(und, T(0, -9.5, 0))
    B(G, "stone").add(frustum(18.5, 18.5, 15.5, 15.5, 8.5, 4.0), T(0, -18.3, 0))


# ------------------------------------------------------------------------------------ the castle
def snow_slab(G, hx, hz, rise, curl, M):
    top, und = curved_roof(hx * 0.95, hz * 0.93, rise * 0.97, curl * 0.85, 0.28, 16)
    V, F, U = top
    U = [(x / 2, z / 2) for x, _, z in V]
    B(G, "snow").add((V, F, U), M @ T(0, 0.14, 0))
    V2, F2, _ = und
    B(G, "snow").add((V2, F2, [(0, 0)] * len(V2)), M @ T(0, 0.14, 0))


def wall_windows(G, M, w, d, y0, h, R, lit_p=0.45):
    for face in range(4):
        L = w if face % 2 == 0 else d
        dist = (d if face % 2 == 0 else w) / 2 + 0.04
        bays = max(2, int(L / 2.8))
        for k in range(bays):
            lit = R.random() < lit_p
            x = -L / 2 + (k + 0.5) * L / bays
            V, F, U = box(min(1.5, L / bays * 0.55), h * 0.32, 0.05)
            U = [((0.02 + (u / 1.5 + 0.5) * 0.46) + (0 if lit else 0.5), v / (h * 0.32) + 0.5) for u, v in U]
            B(G, "window").add((V, F, U), M @ T(ry=face * math.pi / 2) @ T(x, y0 + h * 0.48, dist))


def tier_block(G, M, w, d, y0, h):
    B(G, "plaster").add(box(w, h, d, 2.2), M @ T(0, y0 + h / 2, 0))
    B(G, "wood").add(box(w + 0.06, h * 0.3, d + 0.06, 1.5), M @ T(0, y0 + h * 0.15, 0))
    B(G, "wood").add(box(w + 0.4, 0.5, d + 0.4, 1.5), M @ T(0, y0 + h - 0.1, 0))


def roof_on(G, M, hx, hz, rise, curl, thick, y):
    top, und = curved_roof(hx, hz, rise, curl, thick, 16)
    B(G, "kawara").add(top, M @ T(0, y, 0))
    B(G, "wood").add(und, M @ T(0, y, 0))
    snow_slab(G, hx, hz, rise, curl, M @ T(0, y, 0))


def keep(G, M, R):
    B(G, "stone").add(frustum(17.5, 14.0, 14.2, 11.4, 13.0, 4.0), M)
    y = 13.0
    tiers = [
        (22.0, 16.0, 5.2, 2.6, 3.6, 1.4, True),
        (18.2, 13.2, 4.6, 2.3, 3.2, 1.3, False),
        (15.0, 10.9, 4.2, 2.1, 3.0, 1.25, True),
        (12.4, 9.0, 3.9, 1.9, 2.8, 1.2, False),
        (10.2, 7.5, 3.8, 1.8, 3.2, 1.3, False),
    ]
    for i, (w, d, h, over, rise, curl, gable) in enumerate(tiers):
        tier_block(G, M, w, d, y, h)
        wall_windows(G, M, w, d, y, h, R, 0.0 if i == 0 else 0.45)
        y += h
        roof_on(G, M, w / 2 + over, d / 2 + over, rise, curl, 0.6, y - 0.35)
        if gable:
            # Chidori-hafu: a triangular gable on the arena-facing slope.
            gw, gh = w * 0.42, rise * 0.9
            zf = d / 2 + over * 0.45
            V = [(-gw / 2, 0, 0), (gw / 2, 0, 0), (0, gh, 0)]
            B(G, "plaster").add((V, [(0, 1, 2)], [(0, 0), (1, 0), (0.5, 1)]), M @ T(0, y - 0.1, zf))
            slope = math.atan2(gh, gw / 2)
            L = math.hypot(gw / 2, gh) + 0.9
            for s in (-1, 1):
                B(G, "kawara").add(box(L, 0.3, over * 1.4 + 1, KU / 4, KV / 4), M @ T(s * gw / 4, y - 0.1 + gh / 2 + 0.15, zf - 0.1, rz=-s * slope))
                B(G, "snow").add(box(L * 0.95, 0.12, over * 1.2 + 0.8, 2), M @ T(s * gw / 4, y - 0.1 + gh / 2 + 0.36, zf - 0.1, rz=-s * slope))
        if i == len(tiers) - 1:
            ry_ = y - 0.35 + rise + 0.1
            B(G, "kawara").add(box(w * 0.55, 0.5, 0.6, KU / 4, KV / 4), M @ T(0, ry_, 0))
            for s in (-1, 1):
                # Shachihoko: gold fish finials curling up at each ridge end.
                B(G, "gold").add(cone(0.32, 1.6, 10), M @ T(s * w * 0.55 / 2, ry_ + 0.8, 0, rz=s * 0.45))
                B(G, "gold").add(cone(0.2, 0.8, 8), M @ T(s * w * 0.55 / 2 - s * 0.35, ry_ + 1.6, 0, rz=-s * 0.9))


def long_roof(G, M, length, depth, wall_h, R):
    tier_block(G, M, length, depth, 0, wall_h)
    wall_windows(G, M, length, depth, 0, wall_h, R, 0.0)
    roof_on(G, M, length / 2 + 1.6, depth / 2 + 1.6, 2.6, 0.8, 0.35, wall_h - 0.2)


def turret(G, M, R):
    B(G, "stone").add(frustum(10.5 * 0.72, 10.5 * 0.72, 7.5 * 0.72, 7.5 * 0.72, 9.0, 4.0), M @ T(0, -9.0, 0))
    y = 0.0
    for w, d, h, over, rise, curl in ((10, 8, 4.2, 1.8, 2.6, 1.0), (8.2, 6.6, 3.4, 1.5, 2.8, 1.1)):
        tier_block(G, M, w, d, y, h)
        wall_windows(G, M, w, d, y, h, R, 0.4)
        y += h
        roof_on(G, M, w / 2 + over, d / 2 + over, rise, curl, 0.5, y - 0.3)


# The compound sits well below the rooftop so the duel reads as the top of the castle.
DROP = 8.0


def build_castle(R):
    G = "Castle"
    # The keeps flank the setting sun (SUN_DIR is ~17 deg left of -z) instead of hiding it.
    keep(G, T(-60, -24, -100, ry=0.3, s=1.45), R)
    keep(G, T(-10, -26, -128, ry=0.6, s=0.85), R)
    for x, y, z, ry, s in ((-96, -14, -84, 0.3, 1.25), (-30, -13, -78, -0.2, 1.1), (12, -18, -104, 0.5, 0.95)):
        turret(G, T(x, y, z, ry=ry, s=s), R)
    for x, y, z, ry, ln in ((-62, -17, -68, 0.1, 30), (-2, -19, -110, 0.9, 26)):
        long_roof(G, T(x, y, z, ry=ry), ln, 7, 4.5, R)
    # The compound: halls and walls stepping down around the rooftop, on stone bases.
    halls = [
        (-30, -9, 26, 0.3, 30, 8), (4, -11, 40, -0.05, 44, 9), (42, -10, 24, -0.5, 30, 8),
        (52, -9, -20, 1.4, 40, 8), (-50, -8, -8, 1.7, 36, 9), (-62, -17, 40, 0.8, 30, 8),
        (30, -18, 70, -0.3, 50, 9), (-20, -20, 78, 0.15, 40, 8), (78, -20, 30, -1.0, 40, 8),
        (-86, -22, -30, 1.3, 44, 9), (70, -22, -60, 0.9, 40, 9), (-12, -7.5, -36, 0.02, 30, 7),
    ]
    for x, y, z, ry, ln, dep in halls:
        y -= DROP
        long_roof("Compound", T(x, y, z, ry=ry), ln, dep, 4 + R.random() * 2, R)
        B("Compound", "stone").add(frustum(ln / 2 + 2.6, dep / 2 + 2.6, ln / 2 + 2, dep / 2 + 2, 18, 4.0, top=False), T(x, y - 18, z, ry=ry))
    for x, y, z, ry, s in ((36, -8, 44, 0.7, 0.9), (-44, -9, 30, 0.4, 0.85), (60, -12, -36, 1.2, 1.0),
                           (-68, -14, -44, 0.1, 1.1), (18, -16, 90, 0.3, 1.0), (-58, -18, 72, 1.0, 0.9)):
        turret("Compound", T(x, y - DROP, z, ry=ry, s=s), R)


# ------------------------------------------------------------------------------------------ pines
def pine_tier():
    V, F, U = [], [], []
    n = 9
    V.append((0, 0.55, 0))
    U.append((0.5, 1))
    for i in range(n * 2):
        a = math.pi * i / n
        k = 1 + (0.14 if i % 2 == 0 else -0.1)
        V.append((math.cos(a) * k, -0.08 * (i % 2 == 0), math.sin(a) * k))
        U.append((i / (2 * n), 0))
    for i in range(n * 2):
        F.append((0, 1 + (i + 1) % (2 * n), 1 + i))
    return V, F, U


def build_pines(R):
    G = "Pines"
    tier = pine_tier()
    count, far_n = 120, 170
    for i in range(count + far_n):
        distant = i >= count
        a = (math.floor(R.random() * 9) * 0.7 + R.random() * 0.35) if distant else R.random() * math.pi * 2
        r = 130 + R.random() * 90 if distant else 34 + R.random() * 110
        x, z = math.cos(a) * r, math.sin(a) * r
        if z < -50 and abs(x + 50) < (50 if distant else 35):
            continue
        H = 11 + R.random() * 9 if distant else 5 + R.random() * 8
        base = (-16 + R.random() * 6 if distant else -20 - R.random() * 6 + min(0, (r - 60) * -0.05)) - 10
        for j in range(5):
            t = j / 5
            rad = (1 - t * 0.78) * H * 0.3
            M = T(x + (R.random() - 0.5) * 0.3, base + H * (0.18 + t * 0.62), z + (R.random() - 0.5) * 0.3,
                  rx=(R.random() - 0.5) * 0.1, ry=R.random() * 3, rz=(R.random() - 0.5) * 0.1, s=(rad, H * 0.32, rad))
            B(G, "needles").add(tier, M)
            # Snow resting on the upper face of each tier.
            B(G, "snow").add(tier, M @ T(0, 0.02, 0, s=(0.85, 1.08, 0.85)))
        B(G, "wood").add(cylinder(0.12 * H / 8, 0.2 * H / 8, H * 0.3, 6, False), T(x, base + H * 0.12, z))


# --------------------------------------------------------------------------------------- lanterns
def lantern_spots():
    spots = []
    for z in (-9, -3, 3, 9):
        spots += [(-12.4, z, math.pi / 2), (12.4, z, -math.pi / 2)]
    spots += [(x, 12.4, math.pi) for x in (-7, 0, 7)]
    spots += [(x, RIDGE_Z + 0.9, 0.0) for x in (-9, 9)]
    return spots


LIT = {0, 1, 4, 5, 9, 11, 12}


def build_lanterns(R, M, coll):
    G = "Roof"
    # Chochin: an elongated ribbed paper body between lacquered caps.
    prof = [(0.1 + math.sin(t / 16 * math.pi) ** 0.8 * 0.13, -0.37 + t / 16 * 0.74) for t in range(17)]
    for i, (x, z, rot) in enumerate(lantern_spots()):
        base = T(x, 0, z, ry=rot)
        B(G, "wood").add(box(0.12, 2.4, 0.12, 0.6), base @ T(0, 1.2, 0))
        B(G, "wood").add(box(0.08, 0.08, 0.7, 0.6), base @ T(0, 2.3, 0.3))
        B(G, "snow").add(box(0.14, 0.03, 0.72, 0.5), base @ T(0, 2.355, 0.3))
        B(G, "snow").add(lathe([(0.35, 0), (0.25, 0.08), (0.0, 0.1)], 10), base @ T(0, -0.01, 0))
        # The swinging part: its own object, origin at the hang pivot.
        hb = {"paper": Batch(), "lacquer": Batch()}
        hb["paper"].add(lathe(prof, 20), T(0, -0.45, 0))
        hb["lacquer"].add(cylinder(0.1, 0.12, 0.07, 14), T(0, -0.1, 0))
        hb["lacquer"].add(cylinder(0.12, 0.1, 0.07, 14), T(0, -0.8, 0))
        hb["lacquer"].add(cylinder(0.008, 0.008, 0.08, 5), T(0, -0.035, 0))
        hb["snow"] = Batch()
        hb["snow"].add(lathe([(0.1, 0), (0.07, 0.025), (0.0, 0.035)], 10), T(0, -0.065, 0))
        name = f"LanternHang_{i:02d}" + ("_L" if i in LIT else "")
        obj = mesh_object(name, hb, M, coll)
        pivot = base @ Vector((0, 2.26, 0.6))
        obj.location = P(pivot)
        obj.rotation_euler = (0, 0, rot)


# ------------------------------------------------------------------------------------- finishing
def _mesh(name, batch):
    me = bpy.data.meshes.new(name)
    me.from_pydata([P(p) for p in batch.v], [], batch.f)
    uvl = me.uv_layers.new(name="UVMap")
    import array

    idx = array.array("i", [0]) * len(me.loops)
    me.loops.foreach_get("vertex_index", idx)
    flat = array.array("f", [0.0]) * (len(me.loops) * 2)
    for k, vi in enumerate(idx):
        u, v = batch.uv[vi]
        flat[2 * k] = u
        flat[2 * k + 1] = v
    uvl.data.foreach_set("uv", flat)
    if any(p != (0.0, 0.0) for p in batch.uv2[:64]):
        ao = me.uv_layers.new(name="AO")
        for k, vi in enumerate(idx):
            u, v = batch.uv2[vi]
            flat[2 * k] = u
            flat[2 * k + 1] = v
        ao.data.foreach_set("uv", flat)
        me.uv_layers.active = uvl
        uvl.active_render = True
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.validate(clean_customdata=False)
    me.set_sharp_from_angle(angle=math.radians(38))
    return me


def mesh_object(name, batches, M, coll):
    """One object from several (material -> Batch) parts, material slot per part."""
    merged = Batch()
    mat_idx = []
    for k, (mk, b) in enumerate(batches.items()):
        start = len(merged.f)
        merged.add((b.v, b.f, b.uv, b.uv2))
        mat_idx += [k] * (len(merged.f) - start)
    me = _mesh(name, merged)
    for mk in batches:
        me.materials.append(M[mk])
    me.polygons.foreach_set("material_index", mat_idx)
    obj = bpy.data.objects.new(name, me)
    coll.objects.link(obj)
    return obj


def collection(name, parent):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c.name not in parent.children:
        parent.children.link(c)
    return c


def clear():
    root = bpy.data.collections.get("Arena")
    if root:
        for c in list(root.children_recursive) + [root]:
            for o in list(c.objects):
                bpy.data.objects.remove(o, do_unlink=True)
    for o in list(bpy.data.objects):
        if o.name in ("Cube",):
            bpy.data.objects.remove(o, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)
    BATCHES.clear()


def build(parts=("floor", "ridge", "eaves", "castle", "pines", "lanterns")):
    clear()
    M = materials()
    scene = bpy.context.scene
    root = collection("Arena", scene.collection)
    R = random.Random(5)
    if "floor" in parts:
        build_floor(R)
    if "ridge" in parts:
        build_ridge(R)
    if "eaves" in parts:
        build_eaves(random.Random(77))
    if "castle" in parts:
        build_castle(random.Random(100))
    if "pines" in parts:
        build_pines(random.Random(404))
    if "lanterns" in parts:
        build_lanterns(random.Random(17), M, collection("Lanterns", root))
    for (g, mk), b in BATCHES.items():
        me = _mesh(f"{g}_{mk}", b)
        me.materials.append(M[mk])
        obj = bpy.data.objects.new(f"{g}_{mk}", me)
        collection(g, root).objects.link(obj)
    stats = {o.name: len(o.data.polygons) for o in root.all_objects if o.type == "MESH"}
    return stats


def export(path=os.path.join(ROOT, "blender", "cache", "arena_raw.glb")):
    """Raw GLB of the Arena collection (JPEG/PNG textures, no compression). tools/blender/pack_arena.mjs
    then resizes to WebP, meshopt-compresses and writes public/assets/arena.glb."""
    for o in list(bpy.data.objects):
        o.select_set(False)
    root = bpy.data.collections["Arena"]
    for o in root.all_objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
    )
    return path, os.path.getsize(path)
