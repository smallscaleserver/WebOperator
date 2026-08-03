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
  startWorker,
  closeQueue,
} from "./queue.js";

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

app.get("/api/jobs", async (_req, res) => {
  try {
    const jobs = await listRecentJobs();
    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ jobs: [], error: (err as Error).message });
  }
});

startWorker();

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`WebOperator Control Panel: http://localhost:${PORT}`);
  console.log("Bound to 127.0.0.1 only — no auth, do not expose this to a network.");
});

async function shutdown(): Promise<void> {
  console.log("Shutting down control panel...");
  await closeQueue();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
