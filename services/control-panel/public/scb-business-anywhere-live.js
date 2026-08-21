// autoconnect=true skips noVNC's own "Connect" button click -- the
// user still types this lane's noVNC access password once (not their
// bank password, see the hint text on the page) via noVNC's own
// built-in password prompt.
const NOVNC_URL = "http://localhost:6090/vnc.html?autoconnect=true";

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

let laneShown = null; // true | false | null (unknown yet)

function showLiveIframe() {
  if (laneShown === true) return;
  laneShown = true;
  document.getElementById("lane-offline").style.display = "none";
  const iframe = document.getElementById("live-iframe");
  iframe.src = NOVNC_URL;
  iframe.style.display = "block";
}

function showLaneOffline() {
  if (laneShown === false) return;
  laneShown = false;
  const iframe = document.getElementById("live-iframe");
  iframe.style.display = "none";
  iframe.src = "about:blank";
  document.getElementById("lane-offline").style.display = "block";
}

function setStatusUi(state) {
  const running = state === "running";
  const dot = document.getElementById("status-dot");
  const label = document.getElementById("status-label");
  dot.className = `dot ${running ? "running" : "stopped"}`;
  label.textContent = running ? "running" : "stopped";
  document.getElementById("start-btn").disabled = running;
  document.getElementById("stop-btn").disabled = !running;
  document.getElementById("open-login-btn").disabled = !running;
  document.getElementById("auth-bridge-state-btn").disabled = !running;
  document.getElementById("auth-bridge-login-mock-btn").disabled = !running;
  document.getElementById("auth-bridge-reset-mock-btn").disabled = !running;

  if (running) {
    showLiveIframe();
  } else {
    showLaneOffline();
  }
}

function setAuthBridgeUi(health) {
  const dot = document.getElementById("auth-bridge-dot");
  const label = document.getElementById("auth-bridge-label");
  const ok = health && health.ok === true;
  dot.className = `dot ${ok ? "running" : "stopped"}`;
  label.textContent = ok
    ? `ready${health.readyForLogin === false ? " (login config incomplete)" : ""}`
    : `unavailable${health?.error ? ` — ${health.error}` : ""}`;


  authBridgeHealthLabel = label.textContent;
  if (!ok && health?.error) authBridgeLastError = health.error;
  renderAuthBridgeSummary();
}

let authBridgeEventsAfter = 0;
let authBridgeEvents = [];
let authBridgeHealthLabel = "checking...";
let authBridgeLatestState = "not run yet";
let authBridgeLatestLogin = "not run yet";
let authBridgeLatestReset = "not run yet";
let authBridgeLatestEvent = "none";
let authBridgeLastError = "none";


function setSummaryText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderAuthBridgeSummary() {
  setSummaryText("auth-bridge-summary-health", authBridgeHealthLabel);
  setSummaryText("auth-bridge-summary-state", authBridgeLatestState);
  setSummaryText("auth-bridge-summary-login", authBridgeLatestLogin);
  setSummaryText("auth-bridge-summary-reset", authBridgeLatestReset);
  setSummaryText("auth-bridge-summary-event", authBridgeLatestEvent);
  setSummaryText("auth-bridge-summary-error", authBridgeLastError);
}

function applyAuthBridgeEventSummary(event) {
  const state = event.details?.state;
  if (event.type === "auth_state_finished") {
    authBridgeLatestState = state || event.message || "unknown";
  }
  if (event.type === "auth_login_finished") {
    authBridgeLatestLogin = state || event.message || "authenticated";
  }
  if (event.type === "auth_login_failed" || event.type === "auth_login_rejected") {
    authBridgeLatestLogin = state || "failed";
    authBridgeLastError = event.message || event.type;
  }
  if (event.createdAt) {
    authBridgeLatestEvent = `${event.type} at ${new Date(event.createdAt).toLocaleTimeString()}`;
  }
}

function parseJobStdout(job) {
  try {
    return job.result?.stdout ? JSON.parse(job.result.stdout) : null;
  } catch {
    return null;
  }
}

function applyAuthBridgeJobSummary(job) {
  if (job.name === "auth-bridge-state") {
    const payload = parseJobStdout(job);
    authBridgeLatestState = payload?.state || (job.result?.ok ? "ok" : "unknown");
    if (!job.result?.ok) authBridgeLastError = job.result?.stderr || job.failedReason || "state failed";
  }
  if (job.name === "auth-bridge-login-mock") {
    const payload = parseJobStdout(job);
    authBridgeLatestLogin = payload?.state || (job.result?.ok ? "authenticated" : "failed");
    if (!job.result?.ok) authBridgeLastError = payload?.message || job.result?.stderr || job.failedReason || "login failed";
  }
  if (job.name === "auth-bridge-reset-mock-session") {
    authBridgeLatestReset = job.result?.ok ? "returned to login" : "failed";
    if (!job.result?.ok) authBridgeLastError = job.result?.stderr || job.failedReason || "reset failed";
  }
}

async function fetchAuthBridgeJobSummary() {
  try {
    const res = await fetch("/api/jobs");
    const data = await res.json();
    (data.jobs || [])
      .filter((job) => job.name && job.name.startsWith("auth-bridge-"))
      .slice(0, 20)
      .reverse()
      .forEach(applyAuthBridgeJobSummary);
    renderAuthBridgeSummary();
  } catch (err) {
    authBridgeLastError = `Jobs unavailable: ${err}`;
    renderAuthBridgeSummary();
  }
}
function renderAuthBridgeEvents() {
  const list = document.getElementById("auth-bridge-events-list");
  if (authBridgeEvents.length === 0) {
    list.innerHTML = "<li>(no events yet)</li>";
    return;
  }
  list.innerHTML = authBridgeEvents
    .slice(-20)
    .reverse()
    .map((event) => {
      const time = event.createdAt ? new Date(event.createdAt).toLocaleTimeString() : "?";
      const state = event.details?.state ? ` (${event.details.state})` : "";
      return `<li><strong>${escapeHtml(event.type)}</strong>${escapeHtml(state)} <span class="hint">${escapeHtml(time)} � ${escapeHtml(event.message || "")}</span></li>`;
    })
    .join("");
}

async function fetchAuthBridgeEvents() {
  const status = document.getElementById("auth-bridge-events-status");
  try {
    const res = await fetch(`/api/lanes/scb-business-anywhere-1/auth-bridge/events?after=${authBridgeEventsAfter}&limit=20`);
    const data = await res.json();
    if (!data.ok) {
      status.textContent = `AuthBridge events unavailable: ${data.error || "unknown error"}`;
      return;
    }
    authBridgeEventsAfter = data.nextAfter ?? authBridgeEventsAfter;
    (data.items || []).forEach(applyAuthBridgeEventSummary);
    authBridgeEvents = authBridgeEvents.concat(data.items || []).slice(-20);
    status.textContent = authBridgeEvents.length ? `Showing ${authBridgeEvents.length} latest safe event(s)` : "Waiting for events…";
    renderAuthBridgeEvents();
    renderAuthBridgeSummary();
  } catch (err) {
    status.textContent = `AuthBridge events unavailable: ${err}`;
  }
}
async function queueAuthBridgeAction(path, buttonId) {
  showError(null);
  const btn = document.getElementById(buttonId);
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Queueing…";
  try {
    const res = await fetch(path, { method: "POST" });
    const data = await res.json();
    if (!data.ok) {
      showError(data.error || "Failed to queue AuthBridge action");
    } else {
      document.getElementById("auth-bridge-last-job").textContent =
        `Last AuthBridge job: ${data.jobId}${data.credentialRef ? ` (${data.credentialRef})` : ""}`;
    }
  } catch (err) {
    showError(`Request failed: ${err}`);
  }
  btn.disabled = false;
  btn.textContent = originalText;
  await fetchStatus();
  await fetchAuthBridgeEvents();
}

async function fetchStatus() {
  try {
    const res = await fetch("/api/status");
    const status = await res.json();
    setStatusUi(status.scbLane1);
    setAuthBridgeUi(status.authBridgeHealth);
  } catch (err) {
    console.error("lane status poll failed", err);
  }
}

async function callAction(name) {
  try {
    await fetch(`/api/action/${name}`, { method: "POST" });
  } catch (err) {
    console.error(`${name} failed`, err);
  }
  await fetchStatus();
}

function showError(message) {
  const el = document.getElementById("lane-error");
  if (!message) {
    el.style.display = "none";
    return;
  }
  el.textContent = message;
  el.style.display = "block";
}

function markStepDone(stepId) {
  document.getElementById(stepId).classList.add("done");
}

document.getElementById("start-btn").addEventListener("click", () => callAction("startScbLane1"));
document.getElementById("start-btn-2").addEventListener("click", () => callAction("startScbLane1"));
document.getElementById("stop-btn").addEventListener("click", () => callAction("stopScbLane1"));
document.getElementById("auth-bridge-state-btn").addEventListener("click", () =>
  queueAuthBridgeAction("/api/lanes/scb-business-anywhere-1/auth-bridge/state", "auth-bridge-state-btn"),
);
document.getElementById("auth-bridge-login-mock-btn").addEventListener("click", () =>
  queueAuthBridgeAction("/api/lanes/scb-business-anywhere-1/auth-bridge/login-mock", "auth-bridge-login-mock-btn"),
);
document.getElementById("auth-bridge-reset-mock-btn").addEventListener("click", () =>
  queueAuthBridgeAction(
    "/api/lanes/scb-business-anywhere-1/auth-bridge/reset-mock-session",
    "auth-bridge-reset-mock-btn",
  ),
);

document.getElementById("open-login-btn").addEventListener("click", async () => {
  showError(null);
  const btn = document.getElementById("open-login-btn");
  btn.disabled = true;
  btn.textContent = "Opening…";
  try {
    const res = await fetch("/api/lanes/scb-business-anywhere-1/open-login", { method: "POST" });
    const data = await res.json();
    if (!data.ok) {
      showError(data.error || "Failed to open the login page");
    } else {
      markStepDone("step-1");
    }
  } catch (err) {
    showError(`Request failed: ${err}`);
  }
  btn.disabled = false;
  btn.textContent = "Open Login Page";
});

document.getElementById("confirm-login-btn").addEventListener("click", () => {
  // Purely a client-side checklist marker -- the bot never verifies
  // login state itself (that would mean inspecting page content before
  // the user is ready), it just unlocks the read-only Analyze step.
  markStepDone("step-2");
  markStepDone("step-3");
  markStepDone("step-4");
  markStepDone("step-5");
  document.getElementById("confirm-login-btn").disabled = true;
  document.getElementById("analyze-btn").disabled = false;
});

document.getElementById("analyze-btn").addEventListener("click", async () => {
  showError(null);
  const btn = document.getElementById("analyze-btn");
  btn.disabled = true;
  btn.textContent = "Analyzing…";
  try {
    const res = await fetch("/api/lanes/scb-business-anywhere-1/analyze", { method: "POST" });
    const data = await res.json();
    if (!data.ok || !data.analysis) {
      showError(data.error || "Failed to analyze the current page");
    } else {
      markStepDone("step-6");
      document.getElementById("analysis-section").style.display = "block";
      document.getElementById("analysis-url").textContent = data.analysis.url;
      document.getElementById("analysis-title").textContent = data.analysis.title;
      document.getElementById("analysis-text").textContent = data.analysis.textSnippet;
      document.getElementById("analysis-screenshot").src =
        `/lane-screenshots/scb-business-anywhere-1/${encodeURIComponent(data.analysis.screenshot)}`;
    }
  } catch (err) {
    showError(`Request failed: ${err}`);
  }
  btn.disabled = false;
  btn.textContent = "Analyze current page";
});

function formatIntervalText(data) {
  if (!data.intervalMs) return "";
  const seconds = Math.round(data.intervalMs / 1000);
  const jitterSeconds = Math.round((data.jitterMs || 0) / 1000);
  return jitterSeconds > 0 ? `~${seconds}s (±${jitterSeconds}s jitter)` : `~${seconds}s`;
}

function setMonitorStatusUi(data) {
  const running = !!data.running;
  const paused = !!data.paused;
  const error = data.lastError || data.error || null;

  const dot = document.getElementById("monitor-status-dot");
  const label = document.getElementById("monitor-status-label");
  dot.className = `dot ${error && !running ? "stopped" : running ? "running" : "stopped"}`;
  label.textContent = paused ? "paused" : running ? "running" : "stopped";
  document.getElementById("monitor-interval-text").textContent = running ? formatIntervalText(data) : "";

  document.getElementById("monitor-start-btn").disabled = running && !paused;
  document.getElementById("monitor-stop-btn").disabled = !running;
  document.getElementById("monitor-autostop-input").disabled = running && !paused;

  const autoStopEl = document.getElementById("monitor-autostop-text");
  if (running && !paused && data.autoStopAt) {
    autoStopEl.textContent = `Auto-stop: ~${new Date(data.autoStopAt).toLocaleTimeString()}`;
    autoStopEl.style.display = "block";
  } else {
    autoStopEl.style.display = "none";
  }

  const autoStoppedEl = document.getElementById("monitor-autostopped-banner");
  if (!running && data.autoStopped) {
    autoStoppedEl.textContent = `⏱ Auto-stopped after ${data.autoStopMinutes ?? "?"} minute(s)`;
    autoStoppedEl.style.display = "block";
  } else {
    autoStoppedEl.style.display = "none";
  }

  const errorEl = document.getElementById("monitor-last-error");
  if (error) {
    errorEl.textContent = `Last error: ${error}`;
    errorEl.style.display = "block";
  } else {
    errorEl.style.display = "none";
  }

  document.getElementById("monitor-last-checked").textContent = `Last checked: ${data.lastCheckedAt || "never"}`;
  document.getElementById("monitor-page-last-updated").textContent =
    `Page's own "Last Updated": ${data.pageLastUpdatedText || "—"}${data.staleRefreshStreak > 0 ? ` (unchanged for ${data.staleRefreshStreak} check(s))` : ""}`;

  const staleEl = document.getElementById("monitor-stale-refresh-warning");
  if (data.staleRefreshStreak >= 2) {
    staleEl.textContent = `⚠️ Refresh may not be working — "Last Updated" hasn't moved for ${data.staleRefreshStreak} consecutive checks.`;
    staleEl.style.display = "block";
  } else {
    staleEl.style.display = "none";
  }
  document.getElementById("monitor-available-balance").textContent =
    data.availableBalance !== null && data.availableBalance !== undefined ? `${Number(data.availableBalance).toFixed(2)} THB` : "—";
  document.getElementById("monitor-ledger-balance").textContent =
    data.ledgerBalance !== null && data.ledgerBalance !== undefined ? `${Number(data.ledgerBalance).toFixed(2)} THB` : "—";

  const mismatchEl = document.getElementById("monitor-balance-mismatch");
  const hasMismatch =
    data.availableBalance !== null &&
    data.availableBalance !== undefined &&
    data.ledgerBalance !== null &&
    data.ledgerBalance !== undefined &&
    Number(data.availableBalance) !== Number(data.ledgerBalance);
  mismatchEl.style.display = hasMismatch ? "block" : "none";

  const targetEl = document.getElementById("target-company-text");
  targetEl.textContent = data.targetCompany
    ? `Sticky target: ${data.targetCompany} (re-asserted on every check)`
    : "Sticky target: (none set — monitor reports whatever's currently active)";

  const screenshotEl = document.getElementById("monitor-screenshot");
  if (data.latestScreenshot) {
    const src = `/lane-screenshots/scb-business-anywhere-1/${encodeURIComponent(data.latestScreenshot)}`;
    if (screenshotEl.src !== new URL(src, window.location.href).href) {
      screenshotEl.src = src;
    }
    screenshotEl.style.display = "block";
  } else {
    screenshotEl.style.display = "none";
  }

  const txEl = document.getElementById("monitor-transactions");
  if (!data.latestTransactions || data.latestTransactions.length === 0) {
    txEl.innerHTML = "<em>(no data yet)</em>";
  } else {
    txEl.innerHTML = data.latestTransactions
      .map((t) => {
        const sign = t.amount < 0 ? "-" : "+";
        const detail = t.detail ? `<br><span class="hint">${escapeHtml(t.detail)}</span>` : "";
        return `<div class="hint">${escapeHtml(t.date)} ${escapeHtml(t.time)} — ${escapeHtml(t.description)} — ${sign}${Math.abs(t.amount).toFixed(2)} THB${detail}</div>`;
      })
      .join("");
  }
}

// --- Balance monitor (mock) -- deliberately separate from the
// real-account monitor above: own state file, own routes, own UI
// section, never sends Telegram (see scb-mock-monitor.ts for why).
// Browser JS here only ever calls WebOperator's own two routes below,
// never AuthBridge/the worker/scb-mock directly.

function formatMockTransaction(t) {
  const sign = t.amount < 0 ? "-" : "+";
  const detail = t.detail ? `<br><span class="hint">${escapeHtml(t.detail)}</span>` : "";
  return `<div class="hint">${escapeHtml(t.date)} ${escapeHtml(t.time)} — ${escapeHtml(t.description)} — ${sign}${Math.abs(t.amount).toFixed(2)} THB${detail}</div>`;
}

function setMockMonitorUi(data) {
  const error = data.lastError || data.error || null;

  const errorEl = document.getElementById("mock-monitor-last-error");
  if (error) {
    errorEl.textContent = `Last error: ${error}`;
    errorEl.style.display = "block";
  } else {
    errorEl.style.display = "none";
  }

  document.getElementById("mock-monitor-last-checked").textContent = `Last checked: ${data.lastCheckedAt || "never"}`;
  document.getElementById("mock-monitor-page-last-updated").textContent =
    `Page's own "Last Updated": ${data.pageLastUpdatedText || "—"}`;
  document.getElementById("mock-monitor-available-balance").textContent =
    data.availableBalance !== null && data.availableBalance !== undefined ? `${Number(data.availableBalance).toFixed(2)} THB` : "—";
  document.getElementById("mock-monitor-ledger-balance").textContent =
    data.ledgerBalance !== null && data.ledgerBalance !== undefined ? `${Number(data.ledgerBalance).toFixed(2)} THB` : "—";

  const txEl = document.getElementById("mock-monitor-transactions");
  if (!data.latestTransactions || data.latestTransactions.length === 0) {
    txEl.innerHTML = "<em>(no data yet)</em>";
  } else {
    txEl.innerHTML = data.latestTransactions.map(formatMockTransaction).join("");
  }

  const notifEl = document.getElementById("mock-monitor-notifications");
  if (!data.notifications || data.notifications.length === 0) {
    notifEl.innerHTML = "<em>(none yet)</em>";
  } else {
    notifEl.innerHTML = data.notifications
      .slice()
      .reverse()
      .map((n) => {
        const time = n.at ? new Date(n.at).toLocaleTimeString() : "?";
        const icon = n.type === "balance_changed" ? "💰" : "🔔";
        return `<div class="hint">${icon} ${escapeHtml(time)} — ${escapeHtml(n.message)}</div>`;
      })
      .join("");
  }
}

async function fetchMockMonitorStatus() {
  try {
    const res = await fetch("/api/monitors/scb-business-anywhere");
    const data = await res.json();
    setMockMonitorUi(data.ok ? data : { error: data.error });
  } catch (err) {
    console.error("SCB mock monitor status poll failed", err);
  }
}

document.getElementById("mock-monitor-check-once-btn").addEventListener("click", async () => {
  const btn = document.getElementById("mock-monitor-check-once-btn");
  btn.disabled = true;
  btn.textContent = "Checking…";
  try {
    const res = await fetch("/api/monitors/scb-business-anywhere/check-once", { method: "POST" });
    const data = await res.json();
    if (!data.ok) {
      setMockMonitorUi({ error: data.error || "Request failed" });
    }
  } catch (err) {
    setMockMonitorUi({ error: `Request failed: ${err}` });
  }
  btn.disabled = false;
  btn.textContent = "Check Balance Once";
  await fetchMockMonitorStatus();
});

async function fetchMonitorStatus() {
  try {
    const res = await fetch("/api/lanes/scb-business-anywhere-1/monitor");
    const data = await res.json();
    setMonitorStatusUi(data.ok ? data : { error: data.error });
  } catch (err) {
    console.error("SCB monitor status poll failed", err);
  }
}

async function callMonitorAction(url, body) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!data.ok) {
      setMonitorStatusUi({ error: data.error || "Request failed" });
    }
  } catch (err) {
    setMonitorStatusUi({ error: `Request failed: ${err}` });
  }
  await fetchMonitorStatus();
}

document.getElementById("monitor-start-btn").addEventListener("click", () => {
  const raw = document.getElementById("monitor-autostop-input").value.trim();
  const autoStopMinutes = raw ? Number(raw) : undefined;
  callMonitorAction(
    "/api/lanes/scb-business-anywhere-1/monitor/start",
    autoStopMinutes !== undefined ? { autoStopMinutes } : {},
  );
});
document.getElementById("monitor-stop-btn").addEventListener("click", () =>
  callMonitorAction("/api/lanes/scb-business-anywhere-1/monitor/stop"),
);
document.getElementById("monitor-check-once-btn").addEventListener("click", () =>
  callMonitorAction("/api/lanes/scb-business-anywhere-1/monitor/check-once"),
);

document.getElementById("switch-company-btn").addEventListener("click", async () => {
  showError(null);
  const input = document.getElementById("company-name-input");
  const companyName = input.value.trim();
  if (!companyName) return;
  const btn = document.getElementById("switch-company-btn");
  btn.disabled = true;
  btn.textContent = "Switching…";
  try {
    const res = await fetch("/api/lanes/scb-business-anywhere-1/select-company", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyName }),
    });
    const data = await res.json();
    if (!data.ok) {
      showError(data.error || `Failed to switch to "${companyName}"`);
    }
  } catch (err) {
    showError(`Request failed: ${err}`);
  }
  btn.disabled = false;
  btn.textContent = "Switch";
});

// --- Script & loop reference (editable notes, localStorage-persisted) ---

const SCRIPT_REFERENCE_STORAGE_KEY = "scb-lane-script-reference-v1";

const DEFAULT_SCRIPT_REFERENCE = `SCB BUSINESS ANYWHERE LANE — SCRIPT & LOOP REFERENCE
(edit this freely — it's saved in this browser only, via localStorage)

All scripts below live in services/worker/src/*.ts — plain TypeScript,
editable like any other code in the repo. Each one runs via:
  docker compose run --rm worker-scb-business-anywhere-1 npm run <script>
— a fresh throwaway container every run, but always connecting (over
CDP) to the SAME persistent Chromium/page, so login session and the
open tab carry over between script runs.

1. OPEN LOGIN PAGE
   File: workflows/scb-business-anywhere-open-login.json (via run-workflow.ts)
   Trigger: "Open Login Page" button
   Does: closes old tabs, opens a fresh one, navigates to the real
         login page. Touches no field.
   Use: only BEFORE logging in — using it after login discards that
        session's tab.

2. SWITCH COMPANY
   File: select-company.ts
   Trigger: "Switch" button (Switch company box)
   Does: opens the company-switcher dropdown (reopens it if needed),
         clicks the named entry (e.g. เซซุส, กฤษฎิ์ ดำประสงค์). Thai
         text passed base64-encoded (Windows execFile argv encoding
         workaround).
   Note: re-login resets the active company back to the account
         default — re-select after every fresh login.

3. ANALYZE CURRENT PAGE
   File: analyze-page.ts
   Trigger: "Analyze current page" button
   Does: read-only, never navigates. Captures URL, title, first 2000
         chars of visible text, and a screenshot of whatever's already
         on screen.

4. CHECK TRANSACTIONS (the balance monitor's core)
   File: check-transactions.ts
   Trigger: "Check once" button, or every scheduled loop tick
   Does:
     a. Fast session-expired check (~3-5s, not the default ~30s
        timeout) — fails clearly with "SESSION_EXPIRED:" if logged out
     b. Clicks "Account Summary" (handles both landing directly on
        account detail, or on an "All Accounts" overview needing an
        extra "View Details" click)
     c. Extracts Available/Ledger balance + Latest Transactions rows
        via labeled regex on the page's visible text
     d. Expands each transaction's "▾" detail chevron (idempotent —
        checks if already expanded first) for Channel/Cheque No./
        Teller No./Branch Code

THE SCHEDULED LOOP — where it starts and ends
------------------------------------------------
Outer loop (the schedule itself):
  "Start monitor" clicked
    -> creates a BullMQ scheduler (monitor:scb-business-anywhere-1)
    -> fires one check immediately (no waiting for the first interval)
    -> repeats every ~5 min (+0-15s random jitter) from then on
    ... ticks keep firing every ~5 min ...
  Loop ends when:
    - "Stop monitor" is clicked (scheduler removed outright), OR
    - the auto-stop timer (Run for ___ min) elapses on its own
      (scheduler removed + a Telegram alert sent automatically)

Inner loop (what happens on each individual tick):
  1. Sleep the random jitter (0-15s)
  2. Check auto-stop elapsed? -> if yes: stop scheduler, alert
     Telegram, done (no balance check this tick)
  3. Check paused? -> if yes: skip the balance check this tick
     (scheduler keeps running, next tick checks again)
  4. Run check-transactions.ts for real (step 4 above)
  5. Compare against previously-seen transactions (dedup)
  6. Save to data/lanes/scb-business-anywhere-1/monitor-state.json
  7. If anything new (or this is the very first-ever check): send a
     Telegram message (private chat + the group, both if configured)
  Tick done -> waits for the next scheduled tick (back to outer loop)

NOTES / OPTIONS
------------------------------------------------
- "Analyze current page" and "Check once" never modify anything — safe
  to click anytime, any number of times.
- "Open Login Page" is the one button that resets the tab — don't use
  it once you're logged in and being monitored.
- If the monitor is reporting the wrong company's data after a
  re-login, use "Switch company" to fix it before trusting the numbers.
`;

function loadScriptReference() {
  try {
    const saved = localStorage.getItem(SCRIPT_REFERENCE_STORAGE_KEY);
    return saved !== null ? saved : DEFAULT_SCRIPT_REFERENCE;
  } catch {
    return DEFAULT_SCRIPT_REFERENCE;
  }
}

function showSavedHint() {
  const hint = document.getElementById("reference-saved-hint");
  hint.textContent = "Saved";
  clearTimeout(showSavedHint._t);
  showSavedHint._t = setTimeout(() => {
    hint.textContent = "";
  }, 1500);
}

const referenceTextarea = document.getElementById("script-reference");
referenceTextarea.value = loadScriptReference();
referenceTextarea.addEventListener("input", () => {
  try {
    localStorage.setItem(SCRIPT_REFERENCE_STORAGE_KEY, referenceTextarea.value);
    showSavedHint();
  } catch {
    // localStorage unavailable (private browsing, quota, etc.) --
    // editing still works for the current page load, just won't persist.
  }
});
document.getElementById("reference-reset-btn").addEventListener("click", () => {
  if (!confirm("Reset these notes back to the default reference text? Your edits will be lost.")) return;
  referenceTextarea.value = DEFAULT_SCRIPT_REFERENCE;
  try {
    localStorage.removeItem(SCRIPT_REFERENCE_STORAGE_KEY);
  } catch {
    // ignore
  }
  showSavedHint();
});

// Recorder section (record -> review -> save -> run) now lives in the
// shared recorder-ui.js component, mounted via the #recorder-root
// container in scb-business-anywhere-live.html -- see that file's own
// comment for why (this used to be duplicated inline here).

fetchStatus();
fetchAuthBridgeEvents();
fetchAuthBridgeJobSummary();
fetchMonitorStatus();
fetchMockMonitorStatus();
setInterval(fetchStatus, 3000);
setInterval(fetchAuthBridgeEvents, 3000);
setInterval(fetchAuthBridgeJobSummary, 3000);
setInterval(fetchMonitorStatus, 3000);
setInterval(fetchMockMonitorStatus, 3000);
