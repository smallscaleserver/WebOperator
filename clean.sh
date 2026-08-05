#!/usr/bin/env bash
# Removes the 5 Docker images this repo builds itself (xc-bank,
# browser-worker-chrome, browser-worker-firefox, worker, worker-firefox)
# plus their containers -- leaves the pulled redis/minio images alone.
# Scripts CleanAll.md's core recommended step. See CleanAll.md for the
# heavier --rmi all variant (also removes redis/minio) and the optional
# local-dev-data wipe -- neither is done here.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "==> docker compose down --rmi local -v --remove-orphans"
docker compose down --rmi local -v --remove-orphans

echo
echo "==> Remaining images:"
docker images

echo
echo "Done. redis/minio (pulled, not built) were left in place."
echo "Next: ./build.sh to rebuild, then:"
echo "  docker compose up -d redis minio xc-bank browser-worker-chrome"
