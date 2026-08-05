@echo off
setlocal
rem Starts the 4 core Docker services (does NOT build images -- run
rem build.bat first if you want a fresh build) and does NOT start the
rem two host Control Panel processes (npm start / npm run worker) --
rem those run in their own visible terminals by design, see
rem StepByStep.md.
cd /d "%~dp0"

echo ==^> docker compose up -d redis minio xc-bank browser-worker-chrome
docker compose up -d redis minio xc-bank browser-worker-chrome
if errorlevel 1 goto :error

echo.
echo ==^> Status:
docker compose ps

echo.
echo Done. Next (each in its own terminal, see StepByStep.md):
echo   cd services\control-panel ^&^& npm start
echo   cd services\control-panel ^&^& npm run worker
echo Then open http://localhost:4000
goto :eof

:error
echo.
echo docker compose up failed -- see output above.
exit /b 1
