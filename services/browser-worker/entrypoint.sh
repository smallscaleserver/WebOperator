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

# Same reasoning as the Chromium profile-lock cleanup below: a prior
# Xvfb instance dying (crash, OOM, or a plain `docker compose restart`/
# `stop`+`up` cycle, which reuses the same container filesystem/tmpfs
# rather than a fresh one) can leave /tmp/.X99-lock behind even though
# nothing is actually listening on that display anymore. Xvfb then
# refuses to start at all ("Fatal server error: Server is already
# active for display 99"), and the rest of this script (Fluxbox,
# Chromium, x11vnc) still launches anyway against a display that was
# never actually created -- CDP then never becomes reachable, with no
# clear error surfaced to whoever's waiting on it. Found this the hard
# way, repeatedly, during a single heavy testing session. Only one
# Xvfb is ever launched per container by this script, so it's always
# safe to clear a stale lock here.
rm -f "/tmp/.X${DISPLAY_NUM}-lock" "/tmp/.X11-unix/X${DISPLAY_NUM}"

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

# Give Fluxbox a moment to actually register as the window manager
# (sets the standard EWMH _NET_SUPPORTING_WM_CHECK root property once
# ready) before launching the browser -- found live, via a real crash
# loop on the scb-business-anywhere-1 lane, that Chromium's own
# --start-maximized/--window-position=0,0 flags need a window manager
# that's actually ready to negotiate window placement; launching
# Chromium immediately after merely backgrounding Fluxbox (no
# readiness check existed here before, unlike Xvfb's own xdpyinfo poll
# just above) is a real race -- Chromium exits silently and immediately
# if it loses that race, with no crash trace in its own log and no
# error surfaced anywhere in this script. Confirmed directly: manually
# launching Chromium against an already-settled Fluxbox worked and
# stayed up 60+s every time; launching it in the immediate aftermath
# of `fluxbox &` intermittently didn't.
for i in $(seq 1 20); do
  if xprop -root _NET_SUPPORTING_WM_CHECK >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

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
    # Automating Firefox needs Playwright's own patched build, launched via
    # its launchServer()/connect() protocol, not bare firefox + a debugging
    # flag -- see docs/PROJECT_PLAN.md decision log. That protocol doesn't
    # support a persistent --profile the way this used to, in exchange for
    # a worker container being able to connect from a separate process at
    # all; storageState (already proven elsewhere in this project) is the
    # real session-continuity mechanism, not the profile dir.
    echo "Starting Firefox (via Playwright launch server)"
    node /app/launch-firefox.js >/var/log/browser.log 2>&1 &
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
