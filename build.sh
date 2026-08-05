#!/usr/bin/env bash
# Rebuilds the 5 Docker images this repo builds itself. Usually paired
# with clean.sh (run that first if you want a genuinely fresh build,
# not just picking up source changes).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "==> docker compose build xc-bank browser-worker-chrome browser-worker-firefox worker worker-firefox"
docker compose build xc-bank browser-worker-chrome browser-worker-firefox worker worker-firefox

echo
echo "Done. Next:"
echo "  docker compose up -d redis minio xc-bank browser-worker-chrome"
echo "See StepByStep.md for the rest (start both Control Panel processes, open http://localhost:4000)."
