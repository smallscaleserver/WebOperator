import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { ACTIONS, type ActionName } from "./actions.js";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// services/control-panel/src -> repo root
export const REPO_ROOT = path.resolve(__dirname, "../../..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, "services", "worker", "workflows");

export const EXEC_OPTS = { cwd: REPO_ROOT, timeout: 120_000, maxBuffer: 5 * 1024 * 1024 };

export interface StepEvent {
  name: string;
  status: "ok" | "error";
  detail?: string;
  screenshot?: string;
  data?: unknown;
  attempt?: number;
  attempts?: number;
  at: string;
}

export interface ActionResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
  exitCode?: number;
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

async function execAndParse(args: readonly string[]): Promise<ActionResult> {
  try {
    const { stdout, stderr } = await execFileAsync("docker", args as string[], EXEC_OPTS);
    return { ok: true, stdout, stderr, exitCode: 0, steps: parseSteps(stdout) };
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; message: string; code?: unknown };
    const stdout = execErr.stdout ?? "";
    return {
      ok: false,
      stdout,
      stderr: execErr.stderr ?? "",
      error: execErr.message,
      exitCode: typeof execErr.code === "number" ? execErr.code : undefined,
      steps: parseSteps(stdout),
    };
  }
}

export async function runAction(name: ActionName): Promise<ActionResult> {
  return execAndParse(ACTIONS[name]);
}

// `name` is always validated against listWorkflowNames() (the real files on
// disk) before this is called — still array-form execFile argv either way,
// so there's no shell-injection surface regardless.
export async function runWorkflow(name: string): Promise<ActionResult> {
  return execAndParse(["compose", "run", "--rm", "-e", `WORKFLOW_NAME=${name}`, "worker", "npm", "run", "workflow"]);
}

export async function listWorkflowNames(): Promise<string[]> {
  try {
    const entries = await readdir(WORKFLOWS_DIR);
    return entries.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length));
  } catch {
    return [];
  }
}

// Cheap structural check at enqueue time: catches broken JSON / a missing
// steps array before a job is even created. Deliberately does not check
// individual step "type" values against the actions registry -- that
// registry lives in the separate services/worker project, and duplicating
// it here would just be a second list to keep in sync for no real safety
// gain. run-workflow.ts's own upfront validation (before it connects to
// any browser) is what actually guarantees an unknown action type never
// causes partial execution.
export async function validateWorkflowFile(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const filePath = path.join(WORKFLOWS_DIR, `${name}.json`);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return { ok: false, error: `Could not read workflow file for "${name}"` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `Workflow "${name}" is not valid JSON: ${(err as Error).message}` };
  }
  const steps = (parsed as { steps?: unknown }).steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, error: `Workflow "${name}" must have a non-empty "steps" array` };
  }
  const badIndex = steps.findIndex((s) => typeof (s as { type?: unknown }).type !== "string");
  if (badIndex !== -1) {
    return { ok: false, error: `Workflow "${name}": step ${badIndex + 1} is missing a string "type"` };
  }
  return { ok: true };
}

export async function composePs(): Promise<string> {
  const { stdout } = await execFileAsync("docker", ["compose", "ps", "--format", "json"], EXEC_OPTS);
  return stdout;
}
