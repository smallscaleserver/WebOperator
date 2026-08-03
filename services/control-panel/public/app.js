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
  btn.addEventListener("click", () => enqueueAction(btn.dataset.action));
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

function renderSteps(job) {
  const steps = job.result && job.result.steps ? job.result.steps : [];
  if (steps.length === 0) return "<em>(no step detail)</em>";
  return steps
    .map((s) => {
      const icon = s.status === "ok" ? "✅" : "❌";
      const detail = s.detail ? `: ${escapeHtml(s.detail)}` : "";
      const data =
        s.data !== undefined && s.data !== null ? ` — <em>${escapeHtml(String(s.data))}</em>` : "";
      const shot = s.screenshot
        ? ` — <a href="/screenshots/${encodeURIComponent(s.screenshot)}" target="_blank">screenshot</a>`
        : "";
      return `<div>${icon} <strong>${escapeHtml(s.name)}</strong>${detail}${data}${shot}</div>`;
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
            return `<tr class="job-row" data-job-id="${job.id}">
              <td>${job.id}</td>
              <td>${escapeHtml(displayName)}</td>
              <td><span class="badge ${job.state}">${job.state}</span></td>
              <td class="job-result" title="${result}">${result}</td>
            </tr>
            <tr class="steps-row" style="display:${isOpen ? "table-row" : "none"}">
              <td colspan="4">${renderSteps(job)}</td>
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

pollStatus();
pollJobs();
loadWorkflows();
setInterval(pollStatus, 3000);
setInterval(pollJobs, 3000);
