FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
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
