#!/bin/sh
set -eu

DISPLAY_NUM="${DISPLAY_NUM:-99}"
RESOLUTION="${RESOLUTION:-1366x768x24}"
BROWSER="${BROWSER:-chromium}"
VNC_PASSWORD="${VNC_PASSWORD:-changeme}"
export DISPLAY=":${DISPLAY_NUM}"

PIDS=""

term_handler() {
  echo "Shutting down..."
  for pid in $PIDS; do
    kill "$pid" 2>/dev/null || true
  done
  wait
  exit 0
}
trap term_handler TERM INT

echo "Starting Xvfb on ${DISPLAY} (${RESOLUTION})"
Xvfb "${DISPLAY}" -screen 0 "${RESOLUTION}" -nolisten tcp &
PIDS="$PIDS $!"

# Give Xvfb a moment to create the display socket before anything connects.
for i in $(seq 1 20); do
  if xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo "Starting Fluxbox"
fluxbox >/var/log/fluxbox.log 2>&1 &
PIDS="$PIDS $!"

mkdir -p /data/profile

# Each container run is a fresh host identity (new hostname/PID namespace),
# but the profile dir persists across runs via the bind mount. Browser
# single-instance lock files record the old identity and make the browser
# refuse to start ("profile in use by another process") even though nothing
# else is actually running. Only one browser process is ever launched per
# container by this script, so it's always safe to clear stale locks here.
rm -f /data/profile/Singleton*
rm -f /data/profile/lock /data/profile/.parentlock

# Note: Chromium ignores --remote-debugging-address for a headed instance
# and always binds CDP to 127.0.0.1 only, regardless of the flag. A worker
# container reaches it by joining this container's network namespace
# (docker-compose `network_mode: service:...`), not by publishing the port.
case "${BROWSER}" in
  chromium|chrome)
    echo "Starting Chromium"
    chromium \
      --no-sandbox \
      --disable-gpu \
      --disable-dev-shm-usage \
      --disable-infobars \
      --no-first-run \
      --start-maximized \
      --window-position=0,0 \
      --user-data-dir=/data/profile \
      --remote-debugging-port=9222 \
      --remote-allow-origins=* \
      about:blank >/var/log/browser.log 2>&1 &
    PIDS="$PIDS $!"
    ;;
  firefox)
    echo "Starting Firefox"
    firefox \
      --no-remote \
      --profile /data/profile \
      about:blank >/var/log/browser.log 2>&1 &
    PIDS="$PIDS $!"
    ;;
  *)
    echo "Unknown BROWSER '${BROWSER}', expected 'chromium' or 'firefox'" >&2
    exit 1
    ;;
esac

echo "Starting x11vnc"
x11vnc -storepasswd "${VNC_PASSWORD}" /data/.vncpasswd >/dev/null
x11vnc -display "${DISPLAY}" -forever -shared -rfbport 5900 -rfbauth /data/.vncpasswd >/var/log/x11vnc.log 2>&1 &
PIDS="$PIDS $!"

echo "Starting noVNC (websockify) on :6080"
websockify --web=/usr/share/novnc 6080 localhost:5900 >/var/log/novnc.log 2>&1 &
PIDS="$PIDS $!"

echo "browser-worker ready: open http://localhost:6080/vnc.html"
wait
