// Reusable "record -> review -> save -> run" UI component. Drop-in:
// any page just needs
//   <div id="recorder-root" data-lane-base="/api/lanes/<laneId>"></div>
//   <script src="/recorder-ui.js"></script>
// and gets the full Recorder section, wired to that lane's generic
// /api/lanes/:laneId/recordings/* routes -- no per-page/per-lane JS.
// Originally built SCB-lane-specific, extracted into this shared
// module after an explicit request that record->analyze->run work
// against any lane, with no page-specific code (see
// docs/PROJECT_PLAN.md's decision log).

(function () {
  const root = document.getElementById("recorder-root");
  if (!root) return;
  const LANE_BASE = root.dataset.laneBase;
  if (!LANE_BASE) {
    console.error("recorder-ui.js: #recorder-root is missing data-lane-base");
    return;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  root.innerHTML = `
    <h2>🎬 Recorder — record → review → run</h2>
    <p class="danger">
      Never records a real credential: any password-type field is
      detected in-page and replaced with a redacted marker before
      anything leaves the browser — replaying a redacted step fails
      loudly instead of typing anything. Recording is refused outright
      while a password field is visible on the current page.
    </p>
    <p class="warning">
      Saved scripts CAN run on a schedule or via Telegram <code>/run</code>.
      Any step whose target text matches a risky keyword
      (Transfer/Pay/Confirm/Submit/โอนเงิน/ชำระ/ยืนยัน/etc.) always
      pauses and waits for a live <code>/confirm</code> reply in
      Telegram before it runs — this is a best-effort keyword match,
      not a guarantee.
    </p>
    <p class="warning" id="recorder-pending-confirmation-banner" style="display:none;"></p>

    <div class="row">
      <span class="dot" id="recorder-status-dot"></span>
      <span id="recorder-status-label">idle</span>
      <button id="recorder-start-btn">🔴 Start Recording</button>
      <button id="recorder-stop-btn" disabled>⏹ Stop Recording</button>
    </div>
    <p class="hint">Log in and navigate manually first (via noVNC), then start recording once you're past any login page — max 15 minutes per session.</p>
    <p class="error" id="recorder-error" style="display:none;"></p>

    <div id="recorder-review" style="display:none;">
      <h3 style="font-size:0.9rem; margin-bottom:0.3rem;">Review captured steps</h3>
      <p class="hint" id="recorder-redacted-hint"></p>
      <div id="recorder-steps-list" class="analysis-text" style="max-height:260px;"></div>
      <div class="row" style="margin-top:0.5rem;">
        <input type="text" id="recorder-save-name" placeholder="script-name (letters/numbers/-/_)" style="flex:1; min-width:200px; padding:0.4rem;">
        <button id="recorder-save-btn">💾 Save as script</button>
      </div>
    </div>

    <h3 style="font-size:0.9rem; margin:1rem 0 0.3rem;">Saved scripts</h3>
    <div id="recorder-recordings-list"><em>(none saved yet)</em></div>
  `;

  function showError(message) {
    const el = document.getElementById("recorder-error");
    if (!message) {
      el.style.display = "none";
      return;
    }
    el.textContent = message;
    el.style.display = "block";
  }

  let activeRunId = null;
  let activeJobId = null;
  let pollTimer = null;
  let pendingCompiledSteps = null;

  function setRecordingUi(recording) {
    const dot = document.getElementById("recorder-status-dot");
    const label = document.getElementById("recorder-status-label");
    dot.className = `dot ${recording ? "running" : "stopped"}`;
    label.textContent = recording ? "recording…" : "idle";
    document.getElementById("recorder-start-btn").disabled = recording;
    document.getElementById("recorder-stop-btn").disabled = !recording;
  }

  function parseRecordingResultFromStdout(stdout) {
    for (const line of (stdout || "").split("\n")) {
      const match = line.match(/^SCB_RECORDING_RESULT (.+)$/);
      if (!match) continue;
      try {
        return JSON.parse(match[1]);
      } catch {
        // fall through
      }
    }
    return undefined;
  }

  function describeCompiledStep(step) {
    if (step.type === "clickSmart") {
      const sel = String(step.params.selector || "").replace(/^text=/, "");
      return `click → "${sel}"`;
    }
    if (step.type === "typeText") {
      const isRedacted = /WEBOP_REDACTED_CREDENTIAL_FIELD/.test(step.params.text || "");
      return isRedacted ? `type → [REDACTED credential field]` : `type "${step.params.text}" → "${step.params.selector}"`;
    }
    if (step.type === "pressKey") return `press key: ${step.params.key}`;
    return step.type;
  }

  function showRecordingResult(result) {
    pendingCompiledSteps = result.steps;
    const listEl = document.getElementById("recorder-steps-list");
    listEl.textContent = result.steps.map((s, i) => `${i + 1}. ${describeCompiledStep(s)}`).join("\n") || "(no actions captured)";
    const hintEl = document.getElementById("recorder-redacted-hint");
    hintEl.textContent =
      result.redactedCount > 0
        ? `⚠️ ${result.redactedCount} credential field(s) were detected and NOT recorded.`
        : "No credential fields detected.";
    document.getElementById("recorder-review").style.display = "block";
  }

  async function pollRecordingJob() {
    if (!activeJobId) return;
    try {
      const res = await fetch("/api/jobs");
      const data = await res.json();
      const job = (data.jobs || []).find((j) => j.id === activeJobId);
      if (!job) return;
      if (job.state === "completed" || job.state === "failed") {
        clearInterval(pollTimer);
        pollTimer = null;
        setRecordingUi(false);
        const stdout = job.result?.stdout || "";
        const result = parseRecordingResultFromStdout(stdout);
        if (result) {
          showRecordingResult(result);
        } else {
          showError(job.result?.stderr || job.failedReason || "Recording did not produce a result");
        }
        activeRunId = null;
        activeJobId = null;
      }
    } catch (err) {
      console.error("recording job poll failed", err);
    }
  }

  document.getElementById("recorder-start-btn").addEventListener("click", async () => {
    showError(null);
    document.getElementById("recorder-review").style.display = "none";
    try {
      const res = await fetch(`${LANE_BASE}/recordings/start`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) {
        showError(data.error || "Failed to start recording");
        return;
      }
      activeRunId = data.runId;
      activeJobId = data.jobId;
      setRecordingUi(true);
      pollTimer = setInterval(pollRecordingJob, 3000);
    } catch (err) {
      showError(`Request failed: ${err}`);
    }
  });

  document.getElementById("recorder-stop-btn").addEventListener("click", async () => {
    if (!activeRunId) return;
    try {
      await fetch(`${LANE_BASE}/recordings/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: activeRunId }),
      });
      document.getElementById("recorder-stop-btn").disabled = true;
      document.getElementById("recorder-status-label").textContent = "stopping…";
    } catch (err) {
      showError(`Request failed: ${err}`);
    }
  });

  document.getElementById("recorder-save-btn").addEventListener("click", async () => {
    showError(null);
    const name = document.getElementById("recorder-save-name").value.trim();
    if (!name || !pendingCompiledSteps) return;
    try {
      const res = await fetch(`${LANE_BASE}/recordings/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, steps: pendingCompiledSteps }),
      });
      const data = await res.json();
      if (!data.ok) {
        showError(data.error || "Failed to save script");
        return;
      }
      document.getElementById("recorder-review").style.display = "none";
      document.getElementById("recorder-save-name").value = "";
      pendingCompiledSteps = null;
      await loadRecordingsList();
    } catch (err) {
      showError(`Request failed: ${err}`);
    }
  });

  async function loadRecordingsList() {
    const container = document.getElementById("recorder-recordings-list");
    try {
      const res = await fetch(`${LANE_BASE}/recordings`);
      const data = await res.json();
      const names = data.ok ? data.recordings : [];
      if (names.length === 0) {
        container.innerHTML = "<em>(none saved yet)</em>";
        return;
      }
      container.innerHTML = "";
      for (const name of names) {
        const row = document.createElement("div");
        row.className = "row";
        row.innerHTML = `
          <strong>${escapeHtml(name)}</strong>
          <button data-run="${escapeHtml(name)}">▶ Run now</button>
          <input type="number" min="1" max="1440" placeholder="every N min" style="width:8rem;" data-schedule-input="${escapeHtml(name)}">
          <button data-schedule-start="${escapeHtml(name)}">Start schedule</button>
          <button data-schedule-stop="${escapeHtml(name)}">Stop schedule</button>
          <span class="hint" data-schedule-status="${escapeHtml(name)}"></span>
          <button data-delete="${escapeHtml(name)}">🗑 Delete</button>
        `;
        container.appendChild(row);
      }
      container.querySelectorAll("[data-run]").forEach((btn) =>
        btn.addEventListener("click", async () => {
          await fetch(`${LANE_BASE}/recordings/${encodeURIComponent(btn.dataset.run)}/run`, { method: "POST" });
        }),
      );
      container.querySelectorAll("[data-delete]").forEach((btn) =>
        btn.addEventListener("click", async () => {
          if (!confirm(`Delete saved script "${btn.dataset.delete}"? This also stops its schedule, if any.`)) return;
          await fetch(`${LANE_BASE}/recordings/${encodeURIComponent(btn.dataset.delete)}`, { method: "DELETE" });
          await loadRecordingsList();
        }),
      );
      container.querySelectorAll("[data-schedule-start]").forEach((btn) =>
        btn.addEventListener("click", async () => {
          const name = btn.dataset.scheduleStart;
          const input = container.querySelector(`[data-schedule-input="${CSS.escape(name)}"]`);
          const everyMinutes = Number(input.value);
          if (!everyMinutes || everyMinutes < 1) {
            showError('Enter a valid "every N min" value first');
            return;
          }
          await fetch(`${LANE_BASE}/recordings/${encodeURIComponent(name)}/schedule/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ everyMinutes }),
          });
          await refreshScheduleStatus(name, container);
        }),
      );
      container.querySelectorAll("[data-schedule-stop]").forEach((btn) =>
        btn.addEventListener("click", async () => {
          const name = btn.dataset.scheduleStop;
          await fetch(`${LANE_BASE}/recordings/${encodeURIComponent(name)}/schedule/stop`, { method: "POST" });
          await refreshScheduleStatus(name, container);
        }),
      );
      for (const name of names) {
        await refreshScheduleStatus(name, container);
      }
    } catch (err) {
      console.error("loading recordings list failed", err);
    }
  }

  async function refreshScheduleStatus(name, container) {
    try {
      const res = await fetch(`${LANE_BASE}/recordings/${encodeURIComponent(name)}/schedule`);
      const data = await res.json();
      const el = container.querySelector(`[data-schedule-status="${CSS.escape(name)}"]`);
      if (!el) return;
      el.textContent = data.ok && data.running ? `scheduled every ${Math.round((data.every || 0) / 60000)} min` : "not scheduled";
    } catch {
      // best-effort
    }
  }

  async function fetchReplayState() {
    try {
      const res = await fetch(`${LANE_BASE}/replay-state`);
      const data = await res.json();
      const banner = document.getElementById("recorder-pending-confirmation-banner");
      if (data.ok && data.pendingConfirmation) {
        banner.textContent = `⏳ Waiting for /confirm in Telegram: ${data.pendingConfirmation.stepDescription} (script "${data.pendingConfirmation.recordingName}")`;
        banner.style.display = "block";
      } else {
        banner.style.display = "none";
      }
    } catch (err) {
      console.error("replay state poll failed", err);
    }
  }

  loadRecordingsList();
  fetchReplayState();
  setInterval(fetchReplayState, 3000);
})();
