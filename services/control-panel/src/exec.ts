import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ACTIONS, type ActionName } from "./actions.js";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// services/control-panel/src -> repo root
export const REPO_ROOT = path.resolve(__dirname, "../../..");

export const EXEC_OPTS = { cwd: REPO_ROOT, timeout: 120_000, maxBuffer: 5 * 1024 * 1024 };

export interface StepEvent {
  name: string;
  status: "ok" | "error";
  detail?: string;
  screenshot?: string;
  at: string;
}

export interface ActionResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
  steps: StepEvent[];
}

// Worker scripts (services/worker/src/steps.ts) print `WEBOP_STEP {...}`
// lines amid otherwise unstructured stdout — pull those out into a proper
// step list for the Control Panel's job detail view.
function parseSteps(stdout: string): StepEvent[] {
  const steps: StepEvent[] = [];
  for (const line of stdout.split("\n")) {
    const match = line.match(/^WEBOP_STEP (.+)$/);
    if (!match) continue;
    try {
      steps.push(JSON.parse(match[1]) as StepEvent);
    } catch {
      // ignore malformed lines rather than fail the whole action
    }
  }
  return steps;
}

export async function runAction(name: ActionName): Promise<ActionResult> {
  try {
    const { stdout, stderr } = await execFileAsync("docker", ACTIONS[name], EXEC_OPTS);
    return { ok: true, stdout, stderr, steps: parseSteps(stdout) };
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; message: string };
    const stdout = execErr.stdout ?? "";
    return {
      ok: false,
      stdout,
      stderr: execErr.stderr ?? "",
      error: execErr.message,
      steps: parseSteps(stdout),
    };
  }
}

export async function composePs(): Promise<string> {
  const { stdout } = await execFileAsync("docker", ["compose", "ps", "--format", "json"], EXEC_OPTS);
  return stdout;
}
