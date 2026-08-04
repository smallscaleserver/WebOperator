function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function setStatusUi(running, error) {
  const dot = document.getElementById("status-dot");
  const label = document.getElementById("status-label");
  dot.className = `dot ${running ? "running" : "stopped"}`;
  label.textContent = running ? "running" : "stopped";
  document.getElementById("start-btn").disabled = running;
  document.getElementById("stop-btn").disabled = !running;

  const errorEl = document.getElementById("last-error");
  if (error) {
    errorEl.textContent = `Last error: ${error}`;
    errorEl.style.display = "block";
  } else {
    errorEl.style.display = "none";
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
    el.innerHTML = "<em>(none yet)</em>";
    return;
  }
  el.innerHTML = screenshots
    .map((s) => {
      const local = `/screenshots/${encodeURIComponent(s.filename)}`;
      const minio = `/api/artifacts/screenshots/${encodeURIComponent(s.filename)}`;
      return `<div class="screenshot-entry">
        <a href="${local}" target="_blank">local</a>
        <a href="${minio}" target="_blank">MinIO</a>
        ${escapeHtml(s.capturedAt)}
      </div>`;
    })
    .join("");
}

async function fetchStatus() {
  try {
    const res = await fetch("/api/monitors/xc-bank");
    const data = await res.json();
    if (!data.ok) {
      setStatusUi(false, data.error || "Unknown error");
      return;
    }
    setStatusUi(data.running, data.lastError);
    document.getElementById("last-checked").textContent = `Last checked: ${data.lastCheckedAt || "never"}`;
    document.getElementById("balance").textContent =
      data.latestBalance !== null && data.latestBalance !== undefined ? `$${Number(data.latestBalance).toFixed(2)}` : "—";
    renderNotifications(data.notifications);
    renderTransactions(data.latestTransactions);
    renderScreenshots(data.screenshots);
  } catch (err) {
    setStatusUi(false, `Could not reach the Control Panel API: ${err}`);
  }
}

async function callAndRefresh(url) {
  try {
    const res = await fetch(url, { method: "POST" });
    const data = await res.json();
    if (!data.ok) {
      setStatusUi(false, data.error || "Request failed");
    }
  } catch (err) {
    setStatusUi(false, `Request failed: ${err}`);
  }
  await fetchStatus();
}

document.getElementById("start-btn").addEventListener("click", () => callAndRefresh("/api/monitors/xc-bank/start"));
document.getElementById("stop-btn").addEventListener("click", () => callAndRefresh("/api/monitors/xc-bank/stop"));
document.getElementById("check-once-btn").addEventListener("click", () => callAndRefresh("/api/monitors/xc-bank/check-once"));

fetchStatus();
setInterval(fetchStatus, 3000);
