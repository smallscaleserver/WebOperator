import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import { ACTIONS, isActionName } from "./actions.js";
import { runAction, composePs, listWorkflowNames, validateWorkflowFile, REPO_ROOT } from "./exec.js";
import {
  enqueueAction,
  enqueueWorkflow,
  isQueueableAction,
  listRecentJobs,
  closeQueue,
  enqueueMonitorCheckOnce,
  isMonitorScheduled,
  startMonitorSchedule,
  stopMonitorSchedule,
} from "./queue.js";
import { getArtifactStream } from "./artifacts.js";
import { loadState as loadMonitorState } from "./monitor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const WORKER_OUTPUT_DIR = path.join(REPO_ROOT, "data", "worker-output");

const PORT = Number(process.env.CONTROL_PANEL_PORT ?? 4000);

const app = express();
app.use(express.static(PUBLIC_DIR));
// Read-only: the same directory worker containers already write screenshots
// to via the existing bind mount (data/worker-output:/app/output).
app.use("/screenshots", express.static(WORKER_OUTPUT_DIR));

interface ComposePsEntry {
  Service?: string;
  State?: string;
}

function parseComposePs(stdout: string): ComposePsEntry[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Some compose versions emit newline-delimited JSON instead of an array.
    return trimmed
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line) as ComposePsEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is ComposePsEntry => entry !== null);
  }
}

app.get("/api/status", async (_req, res) => {
  const status = { chrome: "unknown", firefox: "unknown" };
  try {
    const stdout = await composePs();
    const entries = parseComposePs(stdout);
    status.chrome = "stopped";
    status.firefox = "stopped";
    for (const entry of entries) {
      const running = entry.State === "running";
      if (entry.Service === "browser-worker-chrome") status.chrome = running ? "running" : "stopped";
      if (entry.Service === "browser-worker-firefox") status.firefox = running ? "running" : "stopped";
    }
  } catch (err) {
    console.error("status check failed:", err);
  }
  res.json(status);
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

// XC Bank monitor: a continuous check loop, isolated to its own JSON
// state file and BullMQ Job Scheduler -- read-only status combines the
// persisted state (fs-based, no Redis needed) with the scheduler's own
// authoritative running/stopped signal (needs Redis). If Redis/Docker
// aren't reachable, every route below returns a clear JSON error instead
// of hanging or crashing the process (matches the same posture already
// documented for /api/enqueue*/api/jobs elsewhere in this file).
app.get("/api/monitors/xc-bank", async (_req, res) => {
  try {
    const [state, running] = await Promise.all([loadMonitorState(), isMonitorScheduled()]);
    res.json({ ok: true, running, ...state });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.post("/api/monitors/xc-bank/start", async (_req, res) => {
  try {
    await startMonitorSchedule();
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

// A separate page from the noVNC take-control UI -- deliberately not a
// browser-control surface, just a read-only view of the monitor's state.
app.get("/monitors/xc-bank", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "xc-bank-monitor.html"));
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
