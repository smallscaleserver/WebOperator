@echo off
setlocal
rem Removes the 5 Docker images this repo builds itself (xc-bank,
rem browser-worker-chrome, browser-worker-firefox, worker,
rem worker-firefox) plus their containers -- leaves the pulled
rem redis/minio images alone. Scripts CleanAll.md's core recommended
rem step. See CleanAll.md for the heavier --rmi all variant (also
rem removes redis/minio) and the optional local-dev-data wipe -- neither
rem is done here.
cd /d "%~dp0"

echo ==^> docker compose down --rmi local -v --remove-orphans
docker compose down --rmi local -v --remove-orphans
if errorlevel 1 goto :error

echo.
echo ==^> Remaining images:
docker images

echo.
echo Done. redis/minio (pulled, not built) were left in place.
echo Next: build.bat to rebuild, then:
echo   docker compose up -d redis minio xc-bank browser-worker-chrome
goto :eof

:error
echo.
echo docker compose down failed -- see output above.
exit /b 1
