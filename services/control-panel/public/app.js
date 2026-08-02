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

    const workerButtons = document.querySelectorAll(".worker-action");
    workerButtons.forEach((btn) => {
      btn.disabled = status.chrome !== "running";
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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function shortResult(job) {
  if (job.state === "failed") return job.failedReason || "(failed)";
  if (job.result) {
    const text = job.result.ok ? job.result.stdout : job.result.error || job.result.stderr;
    const lastLine = (text || "").trim().split("\n").filter(Boolean).pop();
    return lastLine || (job.result.ok ? "(ok, no output)" : "(failed)");
  }
  return "";
}

const jobsBody = document.getElementById("jobs-body");

async function pollJobs() {
  try {
    const res = await fetch("/api/jobs");
    const data = await res.json();
    const jobs = data.jobs || [];
    jobsBody.innerHTML = jobs.length
      ? jobs
          .map((job) => {
            const result = escapeHtml(shortResult(job));
            return `<tr>
              <td>${job.id}</td>
              <td>${escapeHtml(job.name)}</td>
              <td><span class="badge ${job.state}">${job.state}</span></td>
              <td class="job-result" title="${result}">${result}</td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="4">(no jobs yet)</td></tr>`;
  } catch (err) {
    console.error("jobs poll failed", err);
  }
}

pollStatus();
pollJobs();
setInterval(pollStatus, 3000);
setInterval(pollJobs, 3000);
