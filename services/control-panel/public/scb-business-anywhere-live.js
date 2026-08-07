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

  if (running) {
    showLiveIframe();
  } else {
    showLaneOffline();
  }
}

async function fetchStatus() {
  try {
    const res = await fetch("/api/status");
    const status = await res.json();
    setStatusUi(status.scbLane1);
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

fetchStatus();
setInterval(fetchStatus, 3000);
