"""
Character sources -> one GLB per fighter: one armature, every game clip as its own glTF animation.

Headless (no window): `blender.exe -b --factory-startup --python tools/blender/build_char_cli.py -- player mixamo`
(then the same for boss). Or inside a running Blender (Blender MCP `execute_blender_code`):

    WHO = "player"          # or "boss"
    SET = "mixamo"          # "mixamo" (assets/mixamo/<who>/*.fbx) or "ual" (Quaternius fallback)
    exec(open(r"C:\\Code\\shinobi-duel\\tools\\blender\\build_char.py").read())

then `node tools/blender/pack_char.mjs <who>` (WebP + meshopt) -> public/assets/chars/<who>.glb.

- The clip slots and the source-name patterns live in tools/blender/char_map.json (edit that, not
  this file). Each slot takes the first source clip matching one of its patterns that no earlier
  slot took; if all matches are taken it reuses one (a copy of the action).
- Mixamo: the model is the FBX whose name matches `model` (else the first FBX with a mesh); every
  FBX contributes its take, named after the file ("Great Sword Slash (2).fbx" -> "great sword
  slash (2)"). Mixamo bone prefixes (mixamorig:, mixamorig1:) are unified.
- UAL: Quaternius Universal Animation Library 1+2 clips on a Universal Base Character; bones are
  renamed to Mixamo names so the game's config (Hips, Spine2, RightHand, ...) applies unchanged.
- Works in its own scene so the open arena.blend is untouched (nothing is saved).
- Writes blender/cache/<who>_raw.glb and blender/cache/<who>_report.json (slot -> source, lengths,
  unused sources, missing slots).
"""
import json
import os
import re

import bpy

ROOT = r"C:\Code\shinobi-duel"
WHO = globals().get("WHO", "player")
SET = globals().get("SET", "mixamo")
MAP = json.load(open(os.path.join(ROOT, "tools", "blender", "char_map.json"), encoding="utf-8"))
CFG = MAP[SET][WHO]
RAW = os.path.join(ROOT, "blender", "cache", f"{WHO}_raw.glb")
REPORT = os.path.join(ROOT, "blender", "cache", f"{WHO}_report.json")
PREFIX = re.compile(r"mixamorig\d*[:_]")

UAL_TO_MIXAMO = {
    "pelvis": "Hips", "spine_01": "Spine", "spine_02": "Spine1", "spine_03": "Spine2", "neck_01": "Neck", "Head": "Head",
    "clavicle_l": "LeftShoulder", "upperarm_l": "LeftArm", "lowerarm_l": "LeftForeArm", "hand_l": "LeftHand",
    "clavicle_r": "RightShoulder", "upperarm_r": "RightArm", "lowerarm_r": "RightForeArm", "hand_r": "RightHand",
    "thigh_l": "LeftUpLeg", "calf_l": "LeftLeg", "foot_l": "LeftFoot", "ball_l": "LeftToeBase",
    "thigh_r": "RightUpLeg", "calf_r": "RightLeg", "foot_r": "RightFoot", "ball_r": "RightToeBase",
}


# ---------------------------------------------------------------------------- helpers

def fcurves_of(act):
    """Every F-curve of an action (layered/slotted actions in 4.4+, legacy list before)."""
    out = []
    if hasattr(act, "layers") and len(act.layers):
        for lay in act.layers:
            for st in lay.strips:
                for cb in getattr(st, "channelbags", []):
                    out.extend(cb.fcurves)
    if not out and hasattr(act, "fcurves"):
        try:
            out = list(act.fcurves)
        except Exception:
            pass
    return out


def remap_paths(act, table):
    for fc in fcurves_of(act):
        m = re.match(r'pose\.bones\["([^"]+)"\]', fc.data_path)
        if not m:
            continue
        b = m.group(1)
        nb = table(b)
        if nb != b:
            fc.data_path = fc.data_path.replace(f'["{b}"]', f'["{nb}"]', 1)


def import_file(path):
    before = set(bpy.data.objects)
    before_act = set(bpy.data.actions)
    if path.lower().endswith(".fbx"):
        props = bpy.ops.import_scene.fbx.get_rna_type().properties.keys()
        kw = dict(filepath=path, use_anim=True, ignore_leaf_bones=True, automatic_bone_orientation=False)
        bpy.ops.import_scene.fbx(**{k: v for k, v in kw.items() if k in props or k == "filepath"})
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before]
    acts = [a for a in bpy.data.actions if a not in before_act]
    return objs, acts


def armature_of(objs):
    return next((o for o in objs if o.type == "ARMATURE"), None)


def drop(objs):
    for o in objs:
        if o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)


def norm(name):
    return re.sub(r"\s+", " ", name.replace("_", " ")).strip().lower()


def frame_len(act):
    a, b = act.frame_range
    return (b - a) / bpy.context.scene.render.fps


# ---------------------------------------------------------------------------- scene

if bpy.context.window:
    scene = bpy.data.scenes.get("char_build") or bpy.data.scenes.new("char_build")
    bpy.context.window.scene = scene
else:  # blender -b: the startup scene
    scene = bpy.context.scene
for o in list(scene.collection.all_objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene.render.fps = 30
for a in list(bpy.data.actions):
    if a.get("char_build"):
        bpy.data.actions.remove(a)

sources = {}  # normalized clip name -> action
rig = None
meshes = []

if SET == "mixamo":
    src_dir = os.path.join(ROOT, "assets", "mixamo", WHO)
    files = sorted((f for f in os.listdir(src_dir) if f.lower().endswith(".fbx")), key=lambda f: os.path.splitext(f)[0].lower())
    model_re = re.compile(CFG["model"], re.I)
    model_file = (
        next((f for f in files if os.path.splitext(f)[0].lower() == "character"), None)
        or next((f for f in files if model_re.search(f)), None)
        or (files[0] if files else None)
    )
    assert model_file, f"no FBX in {src_dir}"
    objs, acts = import_file(os.path.join(src_dir, model_file))
    rig = armature_of(objs)
    assert rig, f"{model_file} has no armature"
    for o in objs:
        if o.name not in scene.collection.all_objects:
            scene.collection.objects.link(o)
    meshes = [o for o in objs if o.type == "MESH"]
    main_prefix = next((PREFIX.match(b.name).group(0) for b in rig.data.bones if PREFIX.match(b.name)), "")
    if acts:
        sources[norm(os.path.splitext(model_file)[0])] = acts[0]
    for f in files:
        if f == model_file:
            continue
        objs, acts = import_file(os.path.join(src_dir, f))
        src = armature_of(objs)
        act = src.animation_data.action if src and src.animation_data and src.animation_data.action else (acts[0] if acts else None)
        if act:
            p = next((PREFIX.match(b.name).group(0) for b in src.data.bones if PREFIX.match(b.name)), "") if src else ""
            if p != main_prefix:
                remap_paths(act, lambda b: main_prefix + b[len(p):] if p and b.startswith(p) else b)
            act.use_fake_user = True
            sources[norm(os.path.splitext(f)[0])] = act
        drop(objs)
else:
    # Quaternius fallback: base character + UAL1 + UAL2 (same skeleton), bones renamed to Mixamo names.
    objs, _ = import_file(os.path.join(ROOT, CFG["model"]))
    rig = armature_of(objs)
    assert rig, "base character has no armature"
    meshes = [o for o in objs if o.type == "MESH"]
    # Remove whatever else came with the file (lights, cameras, extra rigs' children).
    for o in objs:
        if o.type not in ("MESH", "ARMATURE"):
            bpy.data.objects.remove(o, do_unlink=True)
    for lib in CFG["anims"]:
        o2, acts = import_file(os.path.join(ROOT, lib))
        for a in acts:
            n = norm(re.sub(r"\|.*$", "", a.name))
            a.use_fake_user = True
            sources.setdefault(n, a)
        drop(o2)
    for b in rig.data.bones:
        if b.name in UAL_TO_MIXAMO:
            b.name = UAL_TO_MIXAMO[b.name]
    for a in sources.values():
        remap_paths(a, lambda b: UAL_TO_MIXAMO.get(b, b))

# ---------------------------------------------------------------------------- slots

used = set()
slots = {}
missing = []
for slot, pats in CFG["clips"].items():
    # A source already named after the slot (attack1.fbx -> "attack1") always wins.
    res = [re.compile("^" + re.escape(slot.replace("_", " ")) + "$", re.I)] + [re.compile(p, re.I) for p in pats]
    cands = [n for r in res for n in sorted(sources) if r.search(n)]
    pick = next((n for n in cands if n not in used), cands[0] if cands else None)
    if not pick:
        missing.append(slot)
        continue
    used.add(pick)
    act = sources[pick].copy()
    act.name = slot
    act["char_build"] = 1
    act.use_fake_user = False
    slots[slot] = (pick, act)

# Mixamo extras: every file no slot took ships under its own name (hit_heavy.fbx -> "hit_heavy"),
# so skinnedConfig.ts can use it (variants, turn-in-place, ...) without another mapping entry.
if SET == "mixamo":
    for n in sorted(sources):
        if n in used or n == "character":
            continue
        slot = re.sub(r"[^a-z0-9]+", "_", n).strip("_")
        if slot in slots:
            continue
        act = sources[n].copy()
        act.name = slot
        act["char_build"] = 1
        slots[slot] = (n, act)
        used.add(n)

# Drop the per-file actions (only the slot copies are exported).
for a in list(bpy.data.actions):
    if a in [s[1] for s in slots.values()]:
        continue
    if a.users == 0 or a.use_fake_user:
        if any(a is s for s in sources.values()):
            a.use_fake_user = False
            if a.users == 0:
                bpy.data.actions.remove(a)

# ---------------------------------------------------------------------------- materials

for m in meshes:
    for slot in m.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf:
            continue
        look = CFG.get("look", {})
        rule = next((v for k, v in look.items() if k != "*" and re.search(k, mat.name, re.I)), look.get("*"))
        if not rule:
            continue
        if "tint" in rule:
            c = bsdf.inputs["Base Color"]
            if c.is_linked:
                mix = mat.node_tree.nodes.new("ShaderNodeMix")
                mix.data_type = "RGBA"
                mix.blend_type = "MULTIPLY"
                mix.inputs["Factor"].default_value = 1.0
                src_sock = c.links[0].from_socket
                mat.node_tree.links.new(src_sock, mix.inputs[6])
                mix.inputs[7].default_value = (*rule["tint"], 1)
                mat.node_tree.links.new(mix.outputs[2], c)
            else:
                c.default_value = (*rule["tint"], 1)
        for key, inp in (("rough", "Roughness"), ("metal", "Metallic")):
            if key in rule and inp in bsdf.inputs and not bsdf.inputs[inp].is_linked:
                bsdf.inputs[inp].default_value = rule[key]

# ---------------------------------------------------------------------------- NLA + export

if not rig.animation_data:
    rig.animation_data_create()
ad = rig.animation_data
for tr in list(ad.nla_tracks):
    ad.nla_tracks.remove(tr)
ad.action = None
for slot, (pick, act) in slots.items():
    tr = ad.nla_tracks.new()
    tr.name = slot
    st = tr.strips.new(slot, int(act.frame_range[0]), act)
    if hasattr(st, "action_slot") and st.action_slot is None and len(getattr(act, "slots", [])):
        st.action_slot = act.slots[0]
    tr.mute = True

os.makedirs(os.path.dirname(RAW), exist_ok=True)
gl = bpy.ops.export_scene.gltf.get_rna_type().properties
opts = dict(
    filepath=RAW,
    export_format="GLB",
    use_selection=True,
    use_active_scene=True,
    export_animations=True,
    export_skins=True,
    export_yup=True,
    export_force_sampling=True,
    export_frame_range=False,
    export_anim_single_armature=True,
    export_def_bones=True,
    export_morph=False,
    export_cameras=False,
    export_lights=False,
    export_optimize_animation_size=True,
)
if "export_animation_mode" in gl.keys():
    modes = [i.identifier for i in gl["export_animation_mode"].enum_items]
    opts["export_animation_mode"] = "NLA_TRACKS" if "NLA_TRACKS" in modes else modes[0]
bpy.ops.object.select_all(action="DESELECT")
vl = bpy.context.view_layer.objects
meshes = [m for m in meshes if m.name in vl and any(md.type == "ARMATURE" for md in m.modifiers)]
for o in [rig, *meshes]:
    o.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(**{k: v for k, v in opts.items() if k in gl.keys() or k == "filepath"})

report = {
    "who": WHO,
    "set": SET,
    "slots": {s: {"source": p, "seconds": round(frame_len(a), 3)} for s, (p, a) in slots.items()},
    "missing": missing,
    "unused": sorted(n for n in sources if n not in used),
    "bones": [b.name for b in rig.data.bones][:80],
    "meshes": [m.name for m in meshes],
    "materials": sorted({s.material.name for m in meshes for s in m.material_slots if s.material}),
}
json.dump(report, open(REPORT, "w"), indent=1)
print(json.dumps({"slots": len(slots), "missing": missing, "unused": report["unused"][:40]}))
