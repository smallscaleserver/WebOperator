FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11-utils \
    fluxbox \
    x11vnc \
    novnc \
    websockify \
    chromium \
    firefox-esr \
    ca-certificates \
    fonts-liberation \
    fonts-noto-cjk \
    dbus-x11 \
    && ln -sf /usr/share/novnc/vnc.html /usr/share/novnc/index.html \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /data/profile /var/log
VOLUME ["/data/profile"]

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 6080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
