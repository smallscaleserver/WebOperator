const NOVNC_URL = "http://localhost:6090/vnc.html";

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
  document.getElementById("start-btn").disabled = true;
  document.getElementById("start-btn-2").disabled = true;
  try {
    await fetch(`/api/action/${name}`, { method: "POST" });
  } catch (err) {
    console.error(`${name} failed`, err);
  }
  await fetchStatus();
}

document.getElementById("start-btn").addEventListener("click", () => callAction("startScbLane1"));
document.getElementById("start-btn-2").addEventListener("click", () => callAction("startScbLane1"));
document.getElementById("stop-btn").addEventListener("click", () => callAction("stopScbLane1"));

fetchStatus();
setInterval(fetchStatus, 3000);
