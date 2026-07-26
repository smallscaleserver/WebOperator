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

document.querySelectorAll(".worker-action").forEach((btn) => {
  btn.addEventListener("click", () => callAction(btn.dataset.action));
});

pollStatus();
setInterval(pollStatus, 3000);
