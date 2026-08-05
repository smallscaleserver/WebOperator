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

function renderScreenshots(screenshots) {
  const el = document.getElementById("screenshots");
  if (!screenshots || screenshots.length === 0) {
    el.innerHTML = "<em>No screenshots yet — click \"Check once\" or \"Start monitor\" to begin.</em>";
    return;
  }
  el.innerHTML = screenshots
    .map((s) => {
      const local = `/screenshots/${encodeURIComponent(s.filename)}`;
      const minio = `/api/artifacts/screenshots/${encodeURIComponent(s.filename)}`;
      // Thumbnail links to the full-size local image in a new tab (the
      // simplest form of "open full-size" -- no modal component needed).
      // MinIO stays as a small secondary text link, still only ever via
      // the existing server-side-proxied /api/artifacts/screenshots/:filename
      // route, never a direct unproxied MinIO URL.
      return `<div class="screenshot-entry">
        <a href="${local}" target="_blank"><img src="${local}" alt="${escapeHtml(s.capturedAt)}" loading="lazy" /></a>
        <div>${escapeHtml(s.capturedAt)}</div>
        <a href="${minio}" target="_blank">MinIO</a>
      </div>`;
    })
    .join("");
}

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
    renderScreenshots(data.screenshots);
  } catch (err) {
    setStatusUi({ running: false, error: `Could not reach the Control Panel API: ${err}` });
  }
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

document.getElementById("start-btn").addEventListener("click", () => callAndRefresh("/api/monitors/xc-bank/start"));
document.getElementById("stop-btn").addEventListener("click", () => callAndRefresh("/api/monitors/xc-bank/stop"));
document.getElementById("pause-btn").addEventListener("click", () => callAndRefresh("/api/monitors/xc-bank/pause"));
document.getElementById("resume-btn").addEventListener("click", () => callAndRefresh("/api/monitors/xc-bank/resume"));
document.getElementById("check-once-btn").addEventListener("click", () => callAndRefresh("/api/monitors/xc-bank/check-once"));
document.getElementById("cleanup-btn").addEventListener("click", () => {
  if (!confirm("Delete all tracked screenshots and reset this monitor's state (notifications/dedup history)? This does not affect XC Bank itself.")) {
    return;
  }
  callAndRefresh("/api/monitors/xc-bank/cleanup");
});

fetchStatus();
setInterval(fetchStatus, 3000);
