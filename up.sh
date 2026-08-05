#!/usr/bin/env bash
# Starts the 4 core Docker services (does NOT build images -- run
# build.sh first if you want a fresh build) and does NOT start the two
# host Control Panel processes (npm start / npm run worker) -- those
# run in their own visible terminals by design, see StepByStep.md.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "==> docker compose up -d redis minio xc-bank browser-worker-chrome"
docker compose up -d redis minio xc-bank browser-worker-chrome

echo
echo "==> Status:"
docker compose ps

echo
echo "Done. Next (each in its own terminal, see StepByStep.md):"
echo "  cd services/control-panel && npm start"
echo "  cd services/control-panel && npm run worker"
echo "Then open http://localhost:4000"
