"""Ambient-occlusion bake for the arena (Cycles, GPU), run after build_arena.py in the same session:

    exec(open(r"C:\\Code\\shinobi-duel\\tools\\blender\\bake_ao.py").read()); bake_all()

Every baked object gets a second UV map "AO" (a per-tile atlas written by the build for the floor
tiles, top-down planar for the snow sheet, Smart UV Project for the rest), its own copy of its material (named "<material>__<object>") and an AO image wired
into a "glTF Material Output" group, so the exporter writes occlusionTexture on TEXCOORD_1. three.js
reads it as aoMap: it darkens the ambient / hemisphere / environment light in the crevices, while the
sun and the lanterns stay real-time (the fighters need their shadows and the grade is tuned in code).
"""
import math
import os

import bpy

AO_DIR = os.path.join(r"C:\Code\shinobi-duel", "blender", "tex", "ao")

# object -> (image size, AO ray distance in metres, UV mode)
TARGETS = {
    # One atlas cell per tile, written by build_arena.py (Smart UV packs 7000 islands into specks).
    "Roof_clay": (2048, 0.6, "keep"),
    "Roof_snow": (2048, 1.2, "planar"),
    "Roof_kawara": (2048, 1.5, "smart"),
    "Roof_wood": (1024, 1.0, "smart"),
    "Castle_kawara": (1024, 3.0, "smart"),
    "Castle_plaster": (1024, 3.0, "smart"),
    "Castle_wood": (1024, 3.0, "smart"),
    "Castle_stone": (512, 4.0, "smart"),
    "Castle_snow": (1024, 3.0, "smart"),
    "Compound_kawara": (1024, 3.0, "smart"),
    "Compound_plaster": (1024, 3.0, "smart"),
    "Compound_wood": (1024, 3.0, "smart"),
    "Compound_snow": (1024, 3.0, "smart"),
}


def _view3d():
    for win in bpy.context.window_manager.windows:
        for a in win.screen.areas:
            if a.type == "VIEW_3D":
                return win, a, [r for r in a.regions if r.type == "WINDOW"][0]
    raise RuntimeError("no 3D view")


def _select_only(obj):
    # Right after a rebuild the view layer can still hold removed objects until it is refreshed.
    bpy.context.view_layer.update()
    for o in bpy.context.view_layer.objects:
        if o is not None:
            o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def add_ao_uv(obj, mode):
    me = obj.data
    if mode == "keep":
        if "AO" not in me.uv_layers:
            raise RuntimeError(f"{obj.name} has no AO UV map from the build")
        return
    uv = me.uv_layers.get("AO") or me.uv_layers.new(name="AO")
    me.uv_layers.active = uv
    if mode == "planar":
        # Blender (x, y) = three (x, -z): the 28.6 m roof square.
        import array

        n = len(me.loops)
        vi = array.array("i", [0]) * n
        me.loops.foreach_get("vertex_index", vi)
        co = array.array("f", [0.0]) * (len(me.vertices) * 3)
        me.vertices.foreach_get("co", co)
        flat = array.array("f", [0.0]) * (n * 2)
        for k, v in enumerate(vi):
            flat[2 * k] = (co[3 * v] + 14.3) / 28.6
            flat[2 * k + 1] = (co[3 * v + 1] + 14.3) / 28.6
        uv.data.foreach_set("uv", flat)
    else:
        win, area, reg = _view3d()
        _select_only(obj)
        with bpy.context.temp_override(window=win, area=area, region=reg, active_object=obj, selected_objects=[obj]):
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, scale_to_bounds=True)
            bpy.ops.object.mode_set(mode="OBJECT")
    me.uv_layers.active = me.uv_layers[0]
    uv.active_render = False
    me.uv_layers[0].active_render = True


def own_material(obj):
    base = obj.data.materials[0]
    root = base.name.split("__")[0]
    name = f"{root}__{obj.name}"
    m = bpy.data.materials.get(name)
    if m is None:
        m = base.copy()
        m.name = name
    obj.data.materials[0] = m
    return m


def gltf_output_group():
    g = bpy.data.node_groups.get("glTF Material Output")
    if g is None:
        g = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        g.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
        g.nodes.new("NodeGroupInput")
    return g


def ao_nodes(mat, img):
    nt = mat.node_tree
    for n in [n for n in nt.nodes if n.name.startswith("AO_")]:
        nt.nodes.remove(n)
    uvn = nt.nodes.new("ShaderNodeUVMap")
    uvn.name = "AO_uv"
    uvn.uv_map = "AO"
    uvn.location = (-1200, -900)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.name = "AO_tex"
    tex.image = img
    tex.location = (-900, -900)
    nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    sep.name = "AO_sep"
    sep.location = (-600, -900)
    nt.links.new(tex.outputs["Color"], sep.inputs["Color"])
    grp = nt.nodes.new("ShaderNodeGroup")
    grp.name = "AO_gltf"
    grp.node_tree = gltf_output_group()
    grp.location = (-300, -900)
    nt.links.new(sep.outputs[0], grp.inputs["Occlusion"])
    for n in nt.nodes:
        n.select = False
    tex.select = True
    nt.nodes.active = tex
    return tex


def setup_cycles(samples=96):
    sc = bpy.context.scene
    try:
        sc.render.engine = "CYCLES"
    except TypeError as e:
        raise RuntimeError(f"Cycles unavailable: {e}")
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == "OPTIX"
    sc.cycles.device = "GPU"
    sc.cycles.samples = samples
    sc.render.bake.margin = 8


def bake(obj_name, size, dist, mode):
    obj = bpy.data.objects[obj_name]
    add_ao_uv(obj, mode)
    mat = own_material(obj)
    img_name = f"ao_{obj_name}"
    img = bpy.data.images.get(img_name)
    if img is None or tuple(img.size) != (size, size):
        if img:
            bpy.data.images.remove(img)
        img = bpy.data.images.new(img_name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"
    ao_nodes(mat, img)
    bpy.context.scene.world.light_settings.distance = dist
    obj.data.uv_layers["AO"].active = True
    _select_only(obj)
    win, area, reg = _view3d()
    with bpy.context.temp_override(window=win, area=area, region=reg, active_object=obj, selected_objects=[obj]):
        bpy.ops.object.bake(type="AO", margin=8, use_clear=True, uv_layer="AO")
    obj.data.uv_layers.active = obj.data.uv_layers[0]
    os.makedirs(AO_DIR, exist_ok=True)
    img.filepath_raw = os.path.join(AO_DIR, f"{img_name}.png")
    img.file_format = "PNG"
    img.save()
    return img.filepath_raw


def bake_all(names=None):
    import time

    if bpy.context.scene.world is None:
        bpy.context.scene.world = bpy.data.worlds.new("World")
    setup_cycles()
    out = {}
    for name, (size, dist, mode) in TARGETS.items():
        if names and name not in names:
            continue
        if name not in bpy.data.objects:
            continue
        t = time.time()
        bake(name, size, dist, mode)
        out[name] = round(time.time() - t, 1)
    try:
        bpy.context.scene.render.engine = "BLENDER_EEVEE"
    except TypeError:
        pass
    return out
