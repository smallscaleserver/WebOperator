FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    tzdata \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends \
    xvfb \
    x11-utils \
    fluxbox \
    x11vnc \
    novnc \
    websockify \
    chromium \
    nodejs \
    fonts-liberation \
    fonts-noto-cjk \
    dbus-x11 \
    && ln -sf /usr/share/novnc/vnc.html /usr/share/novnc/index.html \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
# tzdata (above) makes the IANA zoneinfo database available so a
# runtime `TZ` environment variable (set per-service in
# docker-compose.yml, same pattern as RESOLUTION/VNC_PASSWORD) can
# resolve a real zone name like "Asia/Bangkok" -- glibc/Node/Chromium
# all honor TZ directly, no baked-in default or /etc/localtime setup
# needed here. Container-level, not a per-script CDP override --
# found from a real report: transaction times on the real SCB page
# didn't match actual Thailand time. SCB's own UI explicitly formats
# displayed dates using the browser's *local* timezone (its own
# disclaimer banner says exactly this), so the container's real OS
# timezone leaks straight into what a real site displays -- fixing it
# once here covers every script/workflow/manual noVNC session
# uniformly, unlike a per-script override that only helps scripts that
# remember to call it.

RUN mkdir -p /data/profile /var/log
VOLUME ["/data/profile"]

# Firefox automation needs Playwright's own patched Firefox build -- it does
# not speak CDP and cannot automate the vanilla firefox-esr apt package, so
# that package is deliberately not installed above.
WORKDIR /app
COPY firefox-launcher/package.json ./
RUN npm install && ./node_modules/.bin/playwright-core install firefox --with-deps
COPY firefox-launcher/launch-firefox.js ./

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 6080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
