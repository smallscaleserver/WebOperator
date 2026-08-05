# Removes the 5 Docker images this repo builds itself (xc-bank,
# browser-worker-chrome, browser-worker-firefox, worker, worker-firefox)
# plus their containers -- leaves the pulled redis/minio images alone.
# Scripts CleanAll.md's core recommended step. See CleanAll.md for the
# heavier --rmi all variant (also removes redis/minio) and the optional
# local-dev-data wipe -- neither is done here.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> docker compose down --rmi local -v --remove-orphans"
docker compose down --rmi local -v --remove-orphans
if ($LASTEXITCODE -ne 0) { throw "docker compose down failed (exit $LASTEXITCODE)" }

Write-Host ""
Write-Host "==> Remaining images:"
docker images

Write-Host ""
Write-Host "Done. redis/minio (pulled, not built) were left in place."
Write-Host "Next: .\build.ps1 to rebuild, then:"
Write-Host "  docker compose up -d redis minio xc-bank browser-worker-chrome"
