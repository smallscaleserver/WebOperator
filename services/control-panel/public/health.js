function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderChecks(data) {
  const banner = document.getElementById("ready-banner");
  if (data.ready) {
    banner.className = "banner ready";
    banner.textContent = "✅ All systems ready";
  } else {
    const failing = data.checks.filter((c) => c.status !== "ok").length;
    banner.className = "banner not-ready";
    banner.textContent = `⚠ ${failing} issue(s) found — see below`;
  }

  const body = document.getElementById("checks-body");
  body.innerHTML = data.checks
    .map((c) => {
      const hint = c.hint ? `<code>${escapeHtml(c.hint)}</code>` : "";
      return `<tr>
        <td><span class="dot ${c.status}"></span></td>
        <td>${escapeHtml(c.label)}</td>
        <td>${escapeHtml(c.message)}</td>
        <td>${hint}</td>
      </tr>`;
    })
    .join("");

  document.getElementById("last-checked").textContent = `Last checked: ${new Date().toLocaleTimeString()}`;
}

async function fetchHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    if (!data.ok) {
      const banner = document.getElementById("ready-banner");
      banner.className = "banner not-ready";
      banner.textContent = `⚠ Could not run health checks: ${data.error || "unknown error"}`;
      return;
    }
    renderChecks(data);
  } catch (err) {
    const banner = document.getElementById("ready-banner");
    banner.className = "banner not-ready";
    banner.textContent = `⚠ Could not reach the Control Panel API: ${err}`;
  }
}

document.getElementById("refresh-btn").addEventListener("click", fetchHealth);

fetchHealth();
setInterval(fetchHealth, 5000);
