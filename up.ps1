# Starts the 4 core Docker services (does NOT build images -- run
# build.ps1 first if you want a fresh build) and does NOT start the two
# host Control Panel processes (npm start / npm run worker) -- those
# run in their own visible terminals by design, see StepByStep.md.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> docker compose up -d redis minio xc-bank browser-worker-chrome"
docker compose up -d redis minio xc-bank browser-worker-chrome
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed (exit $LASTEXITCODE)" }

Write-Host ""
Write-Host "==> Status:"
docker compose ps

Write-Host ""
Write-Host "Done. Next (each in its own terminal, see StepByStep.md):"
Write-Host "  cd services\control-panel; npm start"
Write-Host "  cd services\control-panel; npm run worker"
Write-Host "Then open http://localhost:4000"
