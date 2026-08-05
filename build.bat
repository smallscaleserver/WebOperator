@echo off
setlocal
rem Rebuilds the 5 Docker images this repo builds itself. Usually
rem paired with clean.bat (run that first if you want a genuinely
rem fresh build, not just picking up source changes).
cd /d "%~dp0"

echo ==^> docker compose build xc-bank browser-worker-chrome browser-worker-firefox worker worker-firefox
docker compose build xc-bank browser-worker-chrome browser-worker-firefox worker worker-firefox
if errorlevel 1 goto :error

echo.
echo Done. Next:
echo   docker compose up -d redis minio xc-bank browser-worker-chrome
echo See StepByStep.md for the rest (start both Control Panel processes, open http://localhost:4000).
goto :eof

:error
echo.
echo docker compose build failed -- see output above.
exit /b 1
