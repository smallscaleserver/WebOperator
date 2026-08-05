const NOVNC_URL = { chrome: "http://localhost:6080/vnc.html", firefox: "http://localhost:6081/vnc.html" };

const output = document.getElementById("output");

async function callAction(name) {
  output.textContent = `Running ${name}...`;
  try {
    const res = await fetch(`/api/action/${name}`, { method: "POST" });
    const data = await res.json();
    output.textContent =
      `${name}: ${data.ok ? "OK" : "FAILED"}\n\n` +
      (data.stdout ? `--- stdout ---\n${data.stdout}\n` : "") +
      (data.stderr ? `--- stderr ---\n${data.stderr}\n` : "") +
      (data.error ? `--- error ---\n${data.error}\n` : "");
  } catch (err) {
    output.textContent = `${name}: request failed — ${err}`;
  }
  await pollStatus();
}

function setBrowserUi(browser, state) {
  const dot = document.getElementById(`dot-${browser}`);
  const label = document.getElementById(`label-${browser}`);
  dot.className = `dot ${state}`;
  label.textContent = state;

  document.getElementById(`start-${browser}`).disabled = state === "running";
  document.getElementById(`stop-${browser}`).disabled = state !== "running";
  document.getElementById(`take-${browser}`).disabled = state !== "running";

  if (state !== "running") {
    const iframe = document.getElementById(`iframe-${browser}`);
    iframe.style.display = "none";
    iframe.src = "about:blank";
  }
}

async function pollStatus() {
  try {
    const res = await fetch("/api/status");
    const status = await res.json();
    setBrowserUi("chrome", status.chrome);
    setBrowserUi("firefox", status.firefox);

    document.querySelectorAll(".worker-action").forEach((btn) => {
      const requires = btn.dataset.requires || "chrome";
      btn.disabled = status[requires] !== "running";
    });
  } catch (err) {
    console.error("status poll failed", err);
  }
}

document.getElementById("start-chrome").addEventListener("click", () => callAction("startChrome"));
document.getElementById("stop-chrome").addEventListener("click", () => callAction("stopChrome"));
document.getElementById("start-firefox").addEventListener("click", () => callAction("startFirefox"));
document.getElementById("stop-firefox").addEventListener("click", () => callAction("stopFirefox"));

document.getElementById("take-chrome").addEventListener("click", () => {
  const iframe = document.getElementById("iframe-chrome");
  const showing = iframe.style.display === "block";
  iframe.style.display = showing ? "none" : "block";
  iframe.src = showing ? "about:blank" : NOVNC_URL.chrome;
});
document.getElementById("take-firefox").addEventListener("click", () => {
  const iframe = document.getElementById("iframe-firefox");
  const showing = iframe.style.display === "block";
  iframe.style.display = showing ? "none" : "block";
  iframe.src = showing ? "about:blank" : NOVNC_URL.firefox;
});

async function enqueueAction(name) {
  output.textContent = `Queuing ${name}...`;
  try {
    const res = await fetch(`/api/enqueue/${name}`, { method: "POST" });
    const data = await res.json();
    output.textContent = data.ok
      ? `Queued ${name} as job ${data.jobId} — see Jobs table below for progress.`
      : `Failed to queue ${name}: ${data.error}`;
  } catch (err) {
    output.textContent = `Failed to queue ${name}: ${err}`;
  }
  await pollJobs();
}

document.querySelectorAll(".worker-action").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.workflow) {
      enqueueWorkflow(btn.dataset.workflow);
    } else {
      enqueueAction(btn.dataset.action);
    }
  });
});

async function enqueueWorkflow(name) {
  output.textContent = `Queuing workflow ${name}...`;
  try {
    const res = await fetch(`/api/enqueue-workflow/${name}`, { method: "POST" });
    const data = await res.json();
    output.textContent = data.ok
      ? `Queued workflow "${name}" as job ${data.jobId} — see Jobs table below for progress.`
      : `Failed to queue workflow ${name}: ${data.error}`;
  } catch (err) {
    output.textContent = `Failed to queue workflow ${name}: ${err}`;
  }
  await pollJobs();
}

async function loadWorkflows() {
  const container = document.getElementById("workflow-buttons");
  try {
    const res = await fetch("/api/workflows");
    const data = await res.json();
    const names = data.workflows || [];
    container.innerHTML = names.length
      ? names
          .map(
            (name) =>
              `<button class="workflow-run" data-workflow="${escapeHtml(name)}">Run "${escapeHtml(name)}"</button>`,
          )
          .join("")
      : "<em>(no workflows found)</em>";
    container.querySelectorAll(".workflow-run").forEach((btn) => {
      btn.addEventListener("click", () => enqueueWorkflow(btn.dataset.workflow));
    });
  } catch (err) {
    container.textContent = "Failed to load workflows.";
    console.error("workflow list failed", err);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function shortResult(job) {
  if (job.state === "failed") return job.failedReason || "(failed)";
  if (job.result) {
    const text = job.result.ok ? job.result.stdout : job.result.error || job.result.stderr;
    const lastLine = (text || "")
      .trim()
      .split("\n")
      .filter((line) => line && !line.startsWith("WEBOP_STEP "))
      .pop();
    return lastLine || (job.result.ok ? "(ok, no output)" : "(failed)");
  }
  return "";
}

function renderJobTiming(job) {
  if (job.processedOn === null) return "";
  const started = new Date(job.processedOn).toLocaleTimeString();
  const duration = job.durationMs !== null ? `${(job.durationMs / 1000).toFixed(1)}s` : "(in progress)";
  return `<div class="job-timing">Started ${escapeHtml(started)} — duration ${escapeHtml(duration)}</div>`;
}

function renderSteps(job) {
  const steps = job.result && job.result.steps ? job.result.steps : [];
  if (steps.length === 0) return "<em>(no step detail)</em>";
  return steps
    .map((s) => {
      const icon = s.status === "ok" ? "✅" : "❌";
      const attemptInfo = s.attempts && s.attempts > 1 ? ` (attempt ${s.attempt}/${s.attempts})` : "";
      const detail = s.detail ? `: ${escapeHtml(s.detail)}` : "";
      const data =
        s.data !== undefined && s.data !== null ? ` — <em>${escapeHtml(String(s.data))}</em>` : "";
      const shot = s.screenshot
        ? ` — <a href="/screenshots/${encodeURIComponent(s.screenshot)}" target="_blank">screenshot</a>`
        : "";
      // Only link to the MinIO copy when its archive step actually
      // succeeded -- avoids a dead link when archival failed or MinIO
      // was down for that particular job.
      const archiveStepName = s.name.replace(/screenshot$/, "archive-screenshot");
      const archived = steps.some((other) => other.name === archiveStepName && other.status === "ok");
      const minioLink =
        s.screenshot && archived
          ? ` — <a href="/api/artifacts/screenshots/${encodeURIComponent(s.screenshot)}" target="_blank">MinIO</a>`
          : "";
      return `<div>${icon} <strong>${escapeHtml(s.name)}</strong>${escapeHtml(attemptInfo)}${detail}${data}${shot}${minioLink}</div>`;
    })
    .join("");
}

const jobsBody = document.getElementById("jobs-body");
const expandedJobs = new Set();

async function pollJobs() {
  try {
    const res = await fetch("/api/jobs");
    const data = await res.json();
    const jobs = data.jobs || [];
    jobsBody.innerHTML = jobs.length
      ? jobs
          .map((job) => {
            const result = escapeHtml(shortResult(job));
            const isOpen = expandedJobs.has(String(job.id));
            const displayName = job.name.startsWith("workflow:")
              ? `workflow: ${job.name.slice("workflow:".length)}`
              : job.name;
            const scheduleBadge =
              job.name === "xc-bank-monitor-check"
                ? ` <span class="badge ${job.scheduled ? "scheduled" : "manual"}">${job.scheduled ? "scheduled" : "manual"}</span>`
                : "";
            return `<tr class="job-row" data-job-id="${job.id}">
              <td>${job.id}</td>
              <td>${escapeHtml(displayName)}${scheduleBadge}</td>
              <td><span class="badge ${job.state}">${job.state}</span></td>
              <td class="job-result" title="${result}">${result}</td>
            </tr>
            <tr class="steps-row" style="display:${isOpen ? "table-row" : "none"}">
              <td colspan="4">${renderJobTiming(job)}${renderSteps(job)}</td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="4">(no jobs yet)</td></tr>`;

    jobsBody.querySelectorAll(".job-row").forEach((row) => {
      row.addEventListener("click", () => {
        const id = row.dataset.jobId;
        if (expandedJobs.has(id)) {
          expandedJobs.delete(id);
        } else {
          expandedJobs.add(id);
        }
        const stepsRow = row.nextElementSibling;
        stepsRow.style.display = expandedJobs.has(id) ? "table-row" : "none";
      });
    });
  } catch (err) {
    console.error("jobs poll failed", err);
  }
}

async function callMonitorAction(id, action) {
  try {
    await fetch(`/api/monitors/${id}/${action}`, { method: "POST" });
  } catch (err) {
    console.error(`monitor ${id} ${action} failed`, err);
  }
  await loadMonitors();
}

function formatIntervalText(m) {
  if (!m.intervalMs) return "";
  const seconds = Math.round(m.intervalMs / 1000);
  const jitterSeconds = Math.round((m.jitterMs || 0) / 1000);
  return jitterSeconds > 0 ? `~${seconds}s (±${jitterSeconds}s jitter)` : `~${seconds}s`;
}

function formatNextCheck(m) {
  if (!m.running || m.paused || !m.nextCheckEstimate) return "";
  return `Next check: ~${new Date(m.nextCheckEstimate).toLocaleTimeString()}`;
}

function renderMonitors(monitors) {
  const el = document.getElementById("monitors-list");
  if (!monitors || monitors.length === 0) {
    el.innerHTML = "<em>(no monitors registered)</em>";
    return;
  }
  el.innerHTML = monitors
    .map((m) => {
      const dotClass = m.lastError ? "error" : m.paused ? "paused" : m.running ? "running" : "stopped";
      const statusLabel = m.lastError ? "error" : m.paused ? "paused" : m.running ? "running" : "stopped";
      const summary = m.summary ? escapeHtml(m.summary) : "(no data yet)";
      const lastChecked = m.lastCheckedAt ? escapeHtml(m.lastCheckedAt) : "never";
      const errorLine = m.lastError ? `<div class="error">${escapeHtml(m.lastError)}</div>` : "";
      const warningLine = m.longRunningWarning
        ? `<div class="monitor-warning">⚠ ${escapeHtml(m.longRunningWarning)}</div>`
        : "";
      const intervalText = formatIntervalText(m);
      const nextCheckText = formatNextCheck(m);
      const pauseResumeBtn = m.paused
        ? `<button data-monitor="${escapeHtml(m.id)}" data-monitor-action="resume">Resume</button>`
        : `<button data-monitor="${escapeHtml(m.id)}" data-monitor-action="pause" ${m.running ? "" : "disabled"}>Pause</button>`;
      return `<div class="monitor-card">
        <div class="row">
          <span class="dot ${dotClass}"></span>
          <strong>${escapeHtml(m.name)}</strong>
          <span class="hint">${statusLabel}${intervalText ? ` — ${escapeHtml(intervalText)}` : ""}</span>
          <button data-monitor="${escapeHtml(m.id)}" data-monitor-action="start" ${m.running && !m.paused ? "disabled" : ""}>Start</button>
          <button data-monitor="${escapeHtml(m.id)}" data-monitor-action="stop" ${m.running ? "" : "disabled"}>Stop</button>
          ${pauseResumeBtn}
          <button data-monitor="${escapeHtml(m.id)}" data-monitor-action="check-once">Check once</button>
          <a href="${m.detailPath}">Detail</a>
          <a href="${m.livePath}">Live</a>
        </div>
        <div class="hint">${summary} — last checked: ${lastChecked}${nextCheckText ? ` — ${escapeHtml(nextCheckText)}` : ""}</div>
        ${errorLine}
        ${warningLine}
      </div>`;
    })
    .join("");

  el.querySelectorAll("[data-monitor-action]").forEach((btn) => {
    btn.addEventListener("click", () => callMonitorAction(btn.dataset.monitor, btn.dataset.monitorAction));
  });
}

document.getElementById("pause-all-monitors").addEventListener("click", async () => {
  try {
    await fetch("/api/monitors/pause-all", { method: "POST" });
  } catch (err) {
    console.error("pause-all failed", err);
  }
  await loadMonitors();
});
document.getElementById("stop-all-monitors").addEventListener("click", async () => {
  try {
    await fetch("/api/monitors/stop-all", { method: "POST" });
  } catch (err) {
    console.error("stop-all failed", err);
  }
  await loadMonitors();
});

async function loadMonitors() {
  const el = document.getElementById("monitors-list");
  try {
    const res = await fetch("/api/monitors");
    const data = await res.json();
    if (!data.ok) {
      el.innerHTML = `<p class="error">Failed to load monitors: ${escapeHtml(data.error || "unknown error")}</p>`;
      return;
    }
    renderMonitors(data.monitors);
  } catch (err) {
    el.innerHTML = `<p class="error">Failed to load monitors: ${escapeHtml(String(err))}</p>`;
  }
}

function renderHealthBanner(data) {
  const banner = document.getElementById("health-banner");
  if (!data || !data.ok) {
    banner.className = "health-banner not-ready";
    banner.textContent = `⚠ Could not run health checks: ${(data && data.error) || "unknown error"}`;
    return;
  }
  if (data.ready) {
    banner.className = "health-banner ready";
    banner.textContent = "✅ All systems ready";
  } else {
    const failing = data.checks.filter((c) => c.status !== "ok").length;
    banner.className = "health-banner not-ready";
    banner.textContent = `⚠ ${failing} issue(s) — see Diagnostics`;
  }
}

function renderJobsWorkerWarning(data) {
  const el = document.getElementById("jobs-worker-warning");
  const workerCheck = data && data.ok && data.checks.find((c) => c.id === "queue-worker");
  if (workerCheck && workerCheck.status !== "ok") {
    el.textContent = `⚠ No queue worker connected — enqueued jobs will stay "waiting" until you run: ${workerCheck.hint}`;
    el.style.display = "block";
  } else {
    el.style.display = "none";
  }
}

async function loadHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    renderHealthBanner(data);
    renderJobsWorkerWarning(data);
  } catch (err) {
    renderHealthBanner({ ok: false, error: String(err) });
    renderJobsWorkerWarning(null);
  }
}

document.getElementById("run-readiness-check").addEventListener("click", loadHealth);

pollStatus();
pollJobs();
loadWorkflows();
loadMonitors();
loadHealth();
setInterval(pollStatus, 3000);
setInterval(pollJobs, 3000);
setInterval(loadMonitors, 3000);
setInterval(loadHealth, 10000);
