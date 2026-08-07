const NOVNC_CHROME_URL = "http://localhost:6080/vnc.html";

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatIntervalText(data) {
  if (!data.intervalMs) return "";
  const seconds = Math.round(data.intervalMs / 1000);
  const jitterSeconds = Math.round((data.jitterMs || 0) / 1000);
  return jitterSeconds > 0 ? `~${seconds}s (±${jitterSeconds}s jitter)` : `~${seconds}s`;
}

function setStatusUi(data) {
  const running = !!data.running;
  const paused = !!data.paused;
  const error = data.lastError || data.error || null;

  const dot = document.getElementById("status-dot");
  const label = document.getElementById("status-label");
  const dotClass = error && !running ? "stopped" : paused ? "paused" : running ? "running" : "stopped";
  const labelText = paused ? "paused" : running ? "running" : "stopped";
  dot.className = `dot ${dotClass}`;
  label.textContent = labelText;
  document.getElementById("interval-text").textContent = running ? formatIntervalText(data) : "";

  document.getElementById("start-btn").disabled = running && !paused;
  document.getElementById("stop-btn").disabled = !running;
  document.getElementById("pause-btn").style.display = paused ? "none" : "inline-block";
  document.getElementById("resume-btn").style.display = paused ? "inline-block" : "none";
  document.getElementById("pause-btn").disabled = !running;

  const nextCheckEl = document.getElementById("next-check");
  if (running && !paused && data.nextCheckEstimate) {
    nextCheckEl.textContent = `Next check: ~${new Date(data.nextCheckEstimate).toLocaleTimeString()}`;
    nextCheckEl.style.display = "block";
  } else {
    nextCheckEl.style.display = "none";
  }

  document.getElementById("autostop-input").disabled = running && !paused;
  const autoStopEl = document.getElementById("autostop-text");
  if (running && !paused && data.autoStopAt) {
    autoStopEl.textContent = `Auto-stop: ~${new Date(data.autoStopAt).toLocaleTimeString()}`;
    autoStopEl.style.display = "block";
  } else {
    autoStopEl.style.display = "none";
  }

  const autoStoppedEl = document.getElementById("autostopped-banner");
  if (!running && data.autoStopped) {
    autoStoppedEl.textContent = `⏱ Auto-stopped after ${data.autoStopMinutes ?? "?"} minute(s)`;
    autoStoppedEl.style.display = "block";
  } else {
    autoStoppedEl.style.display = "none";
  }

  const errorEl = document.getElementById("last-error");
  if (error) {
    errorEl.textContent = `Last error: ${error}`;
    errorEl.style.display = "block";
  } else {
    errorEl.style.display = "none";
  }

  const warningEl = document.getElementById("long-running-warning");
  if (data.longRunningWarning) {
    warningEl.textContent = `⚠ ${data.longRunningWarning}`;
    warningEl.style.display = "block";
  } else {
    warningEl.style.display = "none";
  }
}

function renderNotifications(notifications) {
  const el = document.getElementById("notifications");
  if (!notifications || notifications.length === 0) {
    el.innerHTML = "<em>(none yet)</em>";
    return;
  }
  el.innerHTML = notifications
    .map((n) => {
      const badge = `<span class="badge ${n.direction}">${n.direction === "credit" ? "Money in" : "Money out"}</span>`;
      const sign = n.direction === "credit" ? "+" : "-";
      return `<div class="notification">${badge}
        <strong>${sign}$${Number(n.amount).toFixed(2)}</strong>
        ${n.direction === "credit" ? "from" : "to"} ${escapeHtml(n.counterparty)} —
        balance after: $${Number(n.balanceAfter).toFixed(2)} —
        <span class="hint">${escapeHtml(n.timestamp)} · ref ${escapeHtml(n.id)} · noticed ${escapeHtml(n.notifiedAt)}</span>
      </div>`;
    })
    .join("");
}

function renderTransactions(transactions) {
  const body = document.getElementById("transactions");
  if (!transactions || transactions.length === 0) {
    body.innerHTML = `<tr><td colspan="6">(no data yet)</td></tr>`;
    return;
  }
  body.innerHTML = transactions
    .map((t) => {
      const sign = t.direction === "credit" ? "+" : "-";
      return `<tr>
        <td>${escapeHtml(t.timestamp)}</td>
        <td><span class="badge ${t.direction}">${t.direction}</span></td>
        <td>${escapeHtml(t.counterparty)}</td>
        <td>${sign}$${Number(t.amount).toFixed(2)}</td>
        <td>$${Number(t.balanceAfter).toFixed(2)}</td>
        <td>${escapeHtml(t.id)}</td>
      </tr>`;
    })
    .join("");
}

// Tracks what's currently rendered so polling only ever touches the DOM
// when something actually changed -- avoids the iframe reloading or the
// fallback image re-fetching on every 3s tick, which would look like
// constant flicker for no reason.
let chromeShown = null; // true | false | null (unknown yet)
let fallbackFilename = null;

function showLiveIframe() {
  if (chromeShown === true) return;
  chromeShown = true;
  document.getElementById("chrome-offline").style.display = "none";
  const iframe = document.getElementById("live-iframe");
  iframe.src = NOVNC_CHROME_URL;
  iframe.style.display = "block";
}

function showChromeOffline() {
  if (chromeShown === false) return;
  chromeShown = false;
  const iframe = document.getElementById("live-iframe");
  iframe.style.display = "none";
  iframe.src = "about:blank";
  document.getElementById("chrome-offline").style.display = "block";
}

function updateFallbackScreenshot(screenshots) {
  const el = document.getElementById("fallback-shot");
  const latest = screenshots && screenshots.length > 0 ? screenshots[0] : null;
  if (!latest) {
    if (fallbackFilename !== null) {
      fallbackFilename = null;
    }
    el.innerHTML = "<em>No screenshots yet — click \"Check once\" or \"Start monitor\" to begin.</em>";
    return;
  }
  if (latest.filename === fallbackFilename) return; // unchanged, don't re-render/re-fetch
  fallbackFilename = latest.filename;
  const url = `/screenshots/${encodeURIComponent(latest.filename)}`;
  el.innerHTML = `<img src="${url}" alt="latest screenshot" />
    <p class="hint">Latest screenshot: ${escapeHtml(latest.capturedAt)}</p>`;
}

async function pollChromeStatus(latestScreenshots) {
  try {
    const res = await fetch("/api/status");
    const status = await res.json();
    if (status.chrome === "running") {
      showLiveIframe();
    } else {
      showChromeOffline();
      updateFallbackScreenshot(latestScreenshots);
    }
  } catch (err) {
    showChromeOffline();
    updateFallbackScreenshot(latestScreenshots);
    console.error("chrome status poll failed", err);
  }
}

let lastScreenshots = [];

async function fetchStatus() {
  try {
    const res = await fetch("/api/monitors/xc-bank");
    const data = await res.json();
    if (!data.ok) {
      setStatusUi({ running: false, error: data.error || "Unknown error" });
      return;
    }
    setStatusUi(data);
    document.getElementById("last-checked").textContent = `Last checked: ${data.lastCheckedAt || "never"}`;
    document.getElementById("balance").textContent =
      data.latestBalance !== null && data.latestBalance !== undefined ? `$${Number(data.latestBalance).toFixed(2)}` : "—";
    renderNotifications(data.notifications);
    renderTransactions(data.latestTransactions);
    lastScreenshots = data.screenshots || [];
  } catch (err) {
    setStatusUi({ running: false, error: `Could not reach the Control Panel API: ${err}` });
  }
  await pollChromeStatus(lastScreenshots);
}

async function callAndRefresh(url) {
  try {
    const res = await fetch(url, { method: "POST" });
    const data = await res.json();
    if (!data.ok) {
      setStatusUi({ running: false, error: data.error || "Request failed" });
    }
  } catch (err) {
    setStatusUi({ running: false, error: `Request failed: ${err}` });
  }
  await fetchStatus();
}

document.getElementById("start-btn").addEventListener("click", async () => {
  const raw = document.getElementById("autostop-input").value.trim();
  const autoStopMinutes = raw ? Number(raw) : undefined;
  try {
    const res = await fetch("/api/monitors/xc-bank/start", {
      method: "POST",
      headers: autoStopMinutes !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: autoStopMinutes !== undefined ? JSON.stringify({ autoStopMinutes }) : undefined,
    });
    const data = await res.json();
    if (!data.ok) {
      setStatusUi({ running: false, error: data.error || "Request failed" });
    }
  } catch (err) {
    setStatusUi({ running: false, error: `Request failed: ${err}` });
  }
  await fetchStatus();
});
document.getElementById("stop-btn").addEventListener("click", () => callAndRefresh("/api/monitors/xc-bank/stop"));
document.getElementById("pause-btn").addEventListener("click", () => callAndRefresh("/api/monitors/xc-bank/pause"));
document.getElementById("resume-btn").addEventListener("click", () => callAndRefresh("/api/monitors/xc-bank/resume"));
document.getElementById("check-once-btn").addEventListener("click", () => callAndRefresh("/api/monitors/xc-bank/check-once"));
document.getElementById("start-chrome-btn").addEventListener("click", async () => {
  document.getElementById("start-chrome-btn").disabled = true;
  try {
    await fetch("/api/action/startChrome", { method: "POST" });
  } catch (err) {
    console.error("start chrome failed", err);
  }
  document.getElementById("start-chrome-btn").disabled = false;
  await fetchStatus();
});

fetchStatus();
setInterval(fetchStatus, 3000);
