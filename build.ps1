# Rebuilds the 5 Docker images this repo builds itself. Usually paired
# with clean.ps1 (run that first if you want a genuinely fresh build,
# not just picking up source changes).
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> docker compose build xc-bank browser-worker-chrome browser-worker-firefox worker worker-firefox"
docker compose build xc-bank browser-worker-chrome browser-worker-firefox worker worker-firefox
if ($LASTEXITCODE -ne 0) { throw "docker compose build failed (exit $LASTEXITCODE)" }

Write-Host ""
Write-Host "Done. Next:"
Write-Host "  docker compose up -d redis minio xc-bank browser-worker-chrome"
Write-Host "See StepByStep.md for the rest (start both Control Panel processes, open http://localhost:4000)."
