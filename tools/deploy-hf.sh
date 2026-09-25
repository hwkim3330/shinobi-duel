#!/usr/bin/env bash
# Publish the game + lobby server as a Docker Hugging Face Space.
#   tools/deploy-hf.sh [owner/space]      (default kimhyunwoo/shinobi-duel)
# The Space serves the build and runs server/server.mjs; the GitHub Pages build of the same
# commit talks to this Space's lobby too (netplay pairs only identical builds: same commit).
set -euo pipefail
cd "$(dirname "$0")/.."
SPACE="${1:-kimhyunwoo/shinobi-duel}"
pnpm build
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/server"
cp -r dist "$STAGE/"
cp server/server.mjs server/package.json server/package-lock.json "$STAGE/server/"
cp server/Dockerfile "$STAGE/Dockerfile"
cat > "$STAGE/README.md" <<'MD'
---
title: Shinobi Duel
emoji: ⚔️
colorFrom: red
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: Sekiro-style sword duel in the browser, online 1v1 or vs AI
---

# Shinobi Duel — online

A kunoichi against a samurai general on a snowy castle rooftop at dusk: deflect, break posture,
land the deathblow. Play either side against the AI, or duel another player online (one is the
kunoichi, the other the general). Desktop Chrome / Edge, keyboard and mouse.

Source: https://github.com/hwkim3330/shinobi-duel (fork of StarKnightt/shinobi-duel, MIT).
This Space serves the game and runs the lobby: players meet by room code or quick match, then
fight peer to peer over WebRTC (the Space relays only when a direct link can't be opened).
MD
python3 - "$SPACE" "$STAGE" "deploy $(git rev-parse --short=10 HEAD)" <<'PY'
import sys
from huggingface_hub import HfApi
space, stage, msg = sys.argv[1:]
api = HfApi()
api.create_repo(space, repo_type="space", space_sdk="docker", exist_ok=True)
api.upload_folder(repo_id=space, repo_type="space", folder_path=stage, commit_message=msg, delete_patterns=["dist/*"])
PY
echo "https://huggingface.co/spaces/$SPACE  ·  https://${SPACE/\//-}.hf.space"
