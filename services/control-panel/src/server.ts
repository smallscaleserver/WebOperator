import "./env.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import { ACTIONS, isActionName } from "./actions.js";
import {
  runAction,
  composePs,
  parseComposePs,
  listWorkflowNames,
  validateWorkflowFile,
  runScbOpenLoginPage,
  runScbAnalyzePage,
  parseLanePageAnalysis,
  REPO_ROOT,
} from "./exec.js";
import {
  enqueueAction,
  enqueueWorkflow,
  isQueueableAction,
  listRecentJobs,
  closeQueue,
  enqueueMonitorCheckOnce,
  enqueueMonitorCleanup,
  getMonitorScheduleInfo,
  pauseMonitor,
  resumeMonitor,
  startMonitorSchedule,
  stopMonitorSchedule,
  validateAutoStopMinutes,
} from "./queue.js";
import { getArtifactStream } from "./artifacts.js";
import { loadState as loadMonitorState } from "./monitor.js";
import { listMonitorSummaries, pauseAllMonitors, stopAllMonitors } from "./monitors-registry.js";
import { runHealthChecks } from "./health.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const WORKER_OUTPUT_DIR = path.join(REPO_ROOT, "data", "worker-output");

const PORT = Number(process.env.CONTROL_PANEL_PORT ?? 4000);

const app = express();
app.use(express.static(PUBLIC_DIR));
// Read-only: the same directory worker containers already write screenshots
// to via the existing bind mount (data/worker-output:/app/output).
app.use("/screenshots", express.static(WORKER_OUTPUT_DIR));
// Same idea, scoped to the isolated scb-business-anywhere-1 lane's own
// output dir -- deliberately separate from WORKER_OUTPUT_DIR above, so
// serving one can never accidentally expose the other lane's files.
app.use(
  "/lane-screenshots/scb-business-anywhere-1",
  express.static(path.join(REPO_ROOT, "data", "lanes", "scb-business-anywhere-1", "output")),
);

app.get("/api/status", async (_req, res) => {
  const status = { chrome: "unknown", firefox: "unknown", scbLane1: "unknown" };
  try {
    const stdout = await composePs();
    const entries = parseComposePs(stdout);
    status.chrome = "stopped";
    status.firefox = "stopped";
    status.scbLane1 = "stopped";
    for (const entry of entries) {
      const running = entry.State === "running";
      if (entry.Service === "browser-worker-chrome") status.chrome = running ? "running" : "stopped";
      if (entry.Service === "browser-worker-firefox") status.firefox = running ? "running" : "stopped";
      if (entry.Service === "browser-worker-scb-business-anywhere-1") status.scbLane1 = running ? "running" : "stopped";
    }
  } catch (err) {
    console.error("status check failed:", err);
  }
  res.json(status);
});

// Read-only diagnostics -- never starts/stops anything itself, only
// reports and (for a failing check) suggests the command to run. See
// health.ts and docs/PROJECT_PLAN.md decision log.
app.get("/api/health", async (_req, res) => {
  try {
    const checks = await runHealthChecks();
    const ready = checks.every((c) => c.status === "ok");
    res.json({ ok: true, ready, checks });
  } catch (err) {
    res.status(500).json({ ok: false, ready: false, error: (err as Error).message });
  }
});

app.post("/api/action/:name", express.json(), async (req, res) => {
  const { name } = req.params;
  if (!isActionName(name)) {
    res.status(400).json({ ok: false, error: `Unknown action "${name}"` });
    return;
  }
  res.json(await runAction(name));
});

app.post("/api/enqueue/:name", async (req, res) => {
  const { name } = req.params;
  if (!isQueueableAction(name)) {
    res.status(400).json({ ok: false, error: `"${name}" is not a queueable action` });
    return;
  }
  try {
    const jobId = await enqueueAction(name);
    res.json({ ok: true, jobId });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/api/workflows", async (_req, res) => {
  res.json({ workflows: await listWorkflowNames() });
});

app.post("/api/enqueue-workflow/:name", async (req, res) => {
  const { name } = req.params;
  const known = await listWorkflowNames();
  if (!known.includes(name)) {
    res.status(400).json({ ok: false, error: `Unknown workflow "${name}"` });
    return;
  }
  const validation = await validateWorkflowFile(name);
  if (!validation.ok) {
    res.status(400).json({ ok: false, error: validation.error });
    return;
  }
  try {
    const jobId = await enqueueWorkflow(name);
    res.json({ ok: true, jobId });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// Kinds readable through the artifact API. "sessions" is deliberately
// never in this set -- session content must never be exposed through
// this route, full stop, not just "nothing links to it" like before.
// "downloads"/"videos"/"traces" have no producer yet (see decision log in
// docs/PROJECT_PLAN.md for why downloads specifically is blocked) --
// reads for those kinds correctly 404 ("not found") until a producer
// exists; the kind itself is accepted now so the route won't need
// another shape change once one does.
const READABLE_ARTIFACT_KINDS = new Set(["screenshots", "downloads", "videos", "traces"]);

// Reads an artifact back from MinIO instead of local disk -- an
// additional, best-effort-populated source alongside the existing
// /screenshots/* static route (unchanged, still the source of truth for
// screenshots). Same URL shape as before for the screenshots case
// (/api/artifacts/screenshots/foo.png still matches), just generalized to
// accept other kinds too. Filename validated against a strict allowlist
// before it ever reaches MinIO, and every failure mode (bad kind, bad
// name, MinIO down, object missing) returns a clear JSON error instead of
// crashing the process.
app.get("/api/artifacts/:kind/:filename", async (req, res) => {
  const { kind, filename } = req.params;
  if (!READABLE_ARTIFACT_KINDS.has(kind)) {
    res.status(400).json({ ok: false, error: `Unknown or unreadable artifact kind "${kind}"` });
    return;
  }
  if (!/^[\w.-]+$/.test(filename)) {
    res.status(400).json({ ok: false, error: "Invalid filename" });
    return;
  }
  try {
    const stream = await getArtifactStream(`${kind}/${filename}`);
    if (kind === "screenshots") {
      res.setHeader("Content-Type", "image/png");
    } else {
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
    }
    stream.on("error", (err) => {
      if (!res.headersSent) {
        res.status(502).json({ ok: false, error: (err as Error).message });
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  } catch (err) {
    // A connection failure (MinIO down) surfaces as a Node AggregateError
    // with an empty .message and the real detail in .code (e.g.
    // "ECONNREFUSED") -- fall back to that so the JSON error is never
    // just "MinIO unavailable: ". A missing object is a distinct S3Error
    // with .code "NoSuchKey" (not reflected in .message), verified
    // directly against a real 404 rather than assumed.
    const error = err as Error & { code?: string };
    const notFound = error.code === "NoSuchKey";
    const message = error.message || error.code || String(error);
    res.status(notFound ? 404 : 502).json({
      ok: false,
      error: notFound ? `Artifact not found in MinIO: ${kind}/${filename}` : `MinIO unavailable: ${message}`,
    });
  }
});

app.get("/api/jobs", async (_req, res) => {
  try {
    const jobs = await listRecentJobs();
    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ jobs: [], error: (err as Error).message });
  }
});

// Data-driven listing for the "/" Control Center's Monitors section --
// see monitors-registry.ts. Currently just XC Bank; a future second
// monitor appears here automatically without this route changing.
app.get("/api/monitors", async (_req, res) => {
  try {
    res.json({ ok: true, monitors: await listMonitorSummaries() });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// Bulk actions across every registered monitor -- see
// monitors-registry.ts's pauseAllMonitors/stopAllMonitors. Only XC Bank
// exists today; a future second monitor is included automatically.
app.post("/api/monitors/pause-all", async (_req, res) => {
  try {
    await pauseAllMonitors();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.post("/api/monitors/stop-all", async (_req, res) => {
  try {
    await stopAllMonitors();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// XC Bank monitor: a continuous check loop, isolated to its own JSON
// state file and BullMQ Job Scheduler -- read-only status combines the
// persisted state (fs-based, no Redis needed) with the scheduler's own
// authoritative running/stopped signal (needs Redis). If Redis/Docker
// aren't reachable, every route below returns a clear JSON error instead
// of hanging or crashing the process (matches the same posture already
// documented for /api/enqueue*/api/jobs elsewhere in this file).
app.get("/api/monitors/xc-bank", async (_req, res) => {
  try {
    const [state, schedule] = await Promise.all([loadMonitorState(), getMonitorScheduleInfo()]);
    res.json({
      ok: true,
      running: schedule.running,
      intervalMs: schedule.every,
      jitterMs: schedule.jitterMs,
      nextCheckEstimate: schedule.next !== null ? new Date(schedule.next).toISOString() : null,
      ...state,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// Optional JSON body { autoStopMinutes?: number } -- a safety limit for
// unattended runs (1-240 min), validated here as the real authority (the
// UI also clamps client-side, but this is what actually enforces it).
// Omitted entirely means unlimited, same as before this existed.
app.post("/api/monitors/xc-bank/start", express.json(), async (req, res) => {
  const validation = validateAutoStopMinutes(req.body?.autoStopMinutes);
  if (!validation.ok) {
    res.status(400).json({ ok: false, error: validation.error });
    return;
  }
  try {
    await startMonitorSchedule(validation.minutes);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.post("/api/monitors/xc-bank/stop", async (_req, res) => {
  try {
    await stopMonitorSchedule();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.post("/api/monitors/xc-bank/check-once", async (_req, res) => {
  try {
    const jobId = await enqueueMonitorCheckOnce();
    res.json({ ok: true, jobId });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// Lighter than stop: leaves the scheduler running (so next/iterationCount
// stay meaningful) but skips the actual check on each scheduled tick.
// Manual "Check once" ignores this and always runs.
app.post("/api/monitors/xc-bank/pause", async (_req, res) => {
  try {
    const jobId = await pauseMonitor();
    res.json({ ok: true, jobId });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.post("/api/monitors/xc-bank/resume", async (_req, res) => {
  try {
    const jobId = await resumeMonitor();
    res.json({ ok: true, jobId });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// Dev-only: wipes this monitor's tracked screenshots/history/notifications
// (not XC Bank's own site data). Routed through the queue (like
// check-once) so it can't race an in-flight check's file writes.
app.post("/api/monitors/xc-bank/cleanup", async (_req, res) => {
  try {
    const jobId = await enqueueMonitorCleanup();
    res.json({ ok: true, jobId });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// A separate page from the noVNC take-control UI -- deliberately not a
// browser-control surface, just a read-only view of the monitor's state.
app.get("/monitors/xc-bank", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "xc-bank-monitor.html"));
});

// Live/current-operation view -- distinct from the history/detail page
// above. Left column embeds the same noVNC endpoint "/"'s take-control
// buttons already use (the shared, concurrency-1 browser this monitor's
// own checks drive), right column polls the same /api/monitors/xc-bank
// data. No new API routes needed for this page.
app.get("/monitors/xc-bank/live", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "xc-bank-monitor-live.html"));
});

// Full diagnostics view -- see health.ts / GET /api/health above.
app.get("/health", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "health.html"));
});

// Isolated-lane live view for scb-business-anywhere (laneId
// scb-business-anywhere-1) -- noVNC of that lane's own browser only,
// never browser-worker-chrome's. No automation/monitor state exists
// for this site yet, so unlike /monitors/xc-bank/live this page has no
// data panel -- see docs/BOT_LANE_ISOLATION.md and the decision log
// entry for why this lane was split off before any login automation.
app.get("/monitors/scb-business-anywhere/live", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "scb-business-anywhere-live.html"));
});

// Assisted Manual Login flow for the scb-business-anywhere-1 lane --
// two deliberately narrow actions, nothing else touches this lane's
// browser. Both are synchronous (not queued): each is a single
// `docker compose run --rm` invocation against that lane's own
// isolated worker service, already serialized by construction (one
// `docker compose run` at a time per lane in practice), same
// synchronous-exec pattern /api/action/:name already uses for
// container lifecycle calls.
//
// open-login: safe to navigate -- meant to run *before* a human logs
// in (or to deliberately reset/reload the login page). Never fills
// any field.
app.post("/api/lanes/scb-business-anywhere-1/open-login", async (_req, res) => {
  try {
    res.json(await runScbOpenLoginPage());
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// analyze: read-only, never navigates -- meant to run *after* a human
// has manually logged in (and/or completed OTP) via this lane's own
// noVNC. Reports back current URL/title/visible-text-snippet/screenshot
// of whatever page is already open, without the bot ever touching a
// credential or driving the login itself.
app.post("/api/lanes/scb-business-anywhere-1/analyze", async (_req, res) => {
  try {
    const result = await runScbAnalyzePage();
    const analysis = parseLanePageAnalysis(result.stdout);
    res.json({ ok: result.ok && !!analysis, analysis, error: result.ok ? undefined : (result.error ?? result.stderr) });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`WebOperator Control Panel: http://localhost:${PORT}`);
  console.log("Bound to 127.0.0.1 only — no auth, do not expose this to a network.");
  console.log('Job queue consumer runs separately -- start it with "npm run worker".');
});

async function shutdown(): Promise<void> {
  console.log("Shutting down control panel...");
  await closeQueue();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
