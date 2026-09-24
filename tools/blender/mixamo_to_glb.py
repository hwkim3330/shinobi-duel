"""
Mixamo FBX folder -> one GLB per character with every clip on a single armature.

Run inside Blender (via the Blender MCP `execute_blender_code`, or Blender's text editor) with
WHO / SRC / DST set, e.g.:

    WHO = "player"
    SRC = r"C:\\Code\\shinobi-duel\\assets\\mixamo\\player"
    DST = r"C:\\Code\\shinobi-duel\\public\\assets\\chars\\player.glb"
    exec(open(r"C:\\Code\\shinobi-duel\\tools\\blender\\mixamo_to_glb.py").read())

- character.fbx (downloaded "With Skin") provides the mesh + armature.
- Every other *.fbx contributes its animation, renamed to the file's basename (idle, attack1, ...).
- Bone prefixes from separate Mixamo uploads (mixamorig:, mixamorig1:, ...) are remapped onto the
  character's armature so every action binds.
- Root motion is left in the Hips track; the game strips its x/z at load.
Not run yet (Blender wasn't open). Enum identifiers are read from the running Blender, not
hard-coded, so it survives version differences.
"""
import os
import re

import bpy

WHO = globals().get("WHO", "player")
SRC = globals()["SRC"]
DST = globals()["DST"]
MODEL = globals().get("MODEL", "character")

PREFIX = re.compile(r"mixamorig\d*[:_]")


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.actions, bpy.data.materials):
        for b in list(coll):
            coll.remove(b)


def import_fbx(path):
    before = set(bpy.data.objects)
    kw = dict(filepath=path, use_anim=True, ignore_leaf_bones=True, automatic_bone_orientation=False)
    props = bpy.ops.import_scene.fbx.get_rna_type().properties.keys()
    bpy.ops.import_scene.fbx(**{k: v for k, v in kw.items() if k in props or k == "filepath"})
    return [o for o in bpy.data.objects if o not in before]


def armature_of(objs):
    return next((o for o in objs if o.type == "ARMATURE"), None)


def bone_prefix(arm):
    for b in arm.data.bones:
        m = PREFIX.match(b.name)
        if m:
            return m.group(0)
    return ""


clear_scene()
bpy.context.scene.render.fps = 30
files = sorted(f for f in os.listdir(SRC) if f.lower().endswith(".fbx"))
model_file = next(f for f in files if os.path.splitext(f)[0].lower() == MODEL)
objs = import_fbx(os.path.join(SRC, model_file))
rig = armature_of(objs)
assert rig, "character.fbx has no armature"
main_prefix = bone_prefix(rig)
actions = []

# The character's own take (usually a T-pose or idle) is kept under the file's name.
if rig.animation_data and rig.animation_data.action:
    rig.animation_data.action.name = MODEL
    actions.append(rig.animation_data.action)

for f in files:
    name = os.path.splitext(f)[0].lower()
    if f == model_file:
        continue
    new = import_fbx(os.path.join(SRC, f))
    src = armature_of(new)
    act = src.animation_data.action if src and src.animation_data else None
    if act:
        act.name = name
        act.use_fake_user = True
        p = bone_prefix(src)
        if p and p != main_prefix:
            for fc in act.fcurves:
                fc.data_path = fc.data_path.replace(f'"{p}', f'"{main_prefix}')
        actions.append(act)
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)

# One NLA track per clip on the single armature (what the glTF exporter reads per action).
if not rig.animation_data:
    rig.animation_data_create()
rig.animation_data.action = None
for act in actions:
    tr = rig.animation_data.nla_tracks.new()
    tr.name = act.name
    tr.strips.new(act.name, int(act.frame_range[0]), act)
    tr.mute = True

os.makedirs(os.path.dirname(DST), exist_ok=True)
gl = bpy.ops.export_scene.gltf.get_rna_type().properties
opts = dict(
    filepath=DST,
    export_format="GLB",
    export_animations=True,
    export_skins=True,
    export_yup=True,
    export_force_sampling=True,
    export_frame_range=False,
    export_anim_single_armature=True,
)
if "export_animation_mode" in gl.keys():
    modes = [i.identifier for i in gl["export_animation_mode"].enum_items]
    opts["export_animation_mode"] = "NLA_TRACKS" if "NLA_TRACKS" in modes else modes[0]
bpy.ops.object.select_all(action="DESELECT")
for o in bpy.data.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(**{k: v for k, v in opts.items() if k in gl.keys() or k == "filepath"})
print(f"[mixamo_to_glb] {WHO}: {len(actions)} clips -> {DST}: {', '.join(a.name for a in actions)}")
