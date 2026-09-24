"""Full arena pipeline inside Blender (Blender MCP `execute_blender_code`):

    exec(open(r"C:\\Code\\shinobi-duel\\tools\\blender\\make_arena.py").read())

build -> AO bake -> save blender/arena.blend -> export blender/cache/arena_raw.glb.
Before: `python tools/blender/prep_textures.py`. After: `node tools/blender/pack_arena.mjs`.
"""
import os
import time

import bpy

_T = r"C:\Code\shinobi-duel\tools\blender"
exec(open(os.path.join(_T, "build_arena.py")).read())
exec(open(os.path.join(_T, "bake_ao.py")).read())

_t0 = time.time()
for _n in ("Camera", "Light", "Cube"):
    if bpy.data.objects.get(_n):
        bpy.data.objects.remove(bpy.data.objects[_n], do_unlink=True)
_stats = build()
_bakes = bake_all()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blender", "arena.blend"), relative_remap=True, compress=True)
_out = export()
print(f"faces {sum(_stats.values())}, bakes {_bakes}, export {_out}, {time.time() - _t0:.1f} s")
