# Launch: blender.exe --python tools/blender/start_mcp.py
# Enables the Blender MCP addon, turns on Poly Haven and starts the socket server on 9876.
import bpy
import addon_utils


def _start():
    scene = bpy.context.scene
    if scene is None:
        return 0.5
    addon_utils.enable("addon", default_set=True, persistent=True)
    scene.blendermcp_use_polyhaven = True
    srv = getattr(bpy.types, "blendermcp_server", None)
    if not (srv and srv.running):
        bpy.ops.blendermcp.start_server()
    scene.blendermcp_server_running = True
    print("[start_mcp] BlenderMCP server running, Poly Haven enabled")
    return None


bpy.app.timers.register(_start, first_interval=1.0, persistent=True)
