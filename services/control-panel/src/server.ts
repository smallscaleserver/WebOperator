import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import { ACTIONS, isActionName } from "./actions.js";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// services/control-panel/src -> repo root
const REPO_ROOT = path.resolve(__dirname, "../../..");
const PUBLIC_DIR = path.resolve(__dirname, "../public");

const PORT = Number(process.env.CONTROL_PANEL_PORT ?? 4000);
const EXEC_OPTS = { cwd: REPO_ROOT, timeout: 120_000, maxBuffer: 5 * 1024 * 1024 };

const app = express();
app.use(express.static(PUBLIC_DIR));

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
    const { stdout } = await execFileAsync(
      "docker",
      ["compose", "ps", "--format", "json"],
      EXEC_OPTS,
    );
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
  try {
    const { stdout, stderr } = await execFileAsync("docker", ACTIONS[name], EXEC_OPTS);
    res.json({ ok: true, stdout, stderr });
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; message: string };
    res.json({
      ok: false,
      stdout: execErr.stdout ?? "",
      stderr: execErr.stderr ?? "",
      error: execErr.message,
    });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`WebOperator Control Panel: http://localhost:${PORT}`);
  console.log("Bound to 127.0.0.1 only — no auth, do not expose this to a network.");
});
