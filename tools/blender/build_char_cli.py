"""blender -b --factory-startup --python tools/blender/build_char_cli.py -- <player|boss> [mixamo|ual]"""
import os
import sys

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
WHO = argv[0] if argv else "player"
SET = argv[1] if len(argv) > 1 else "mixamo"
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "build_char.py"), encoding="utf-8").read())
