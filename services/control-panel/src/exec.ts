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

// Same as runWorkflow, but for the one workflow (xc-bank-monitor-check)
// whose screenshot filename is supplied per-run via
// run-workflow.ts's ${ENV_VAR} substitution -- needed so the XC Bank
// monitor's screenshot timeline gets a distinct file per check instead
// of the fixed name xc-bank-login-extract.json always overwrites.
export async function runXcBankMonitorCheck(screenshotFilename: string): Promise<ActionResult> {
  return execAndParse([
    "compose",
    "run",
    "--rm",
    "-e",
    "WORKFLOW_NAME=xc-bank-monitor-check",
    "-e",
    `XC_BANK_MONITOR_SCREENSHOT_FILENAME=${screenshotFilename}`,
    "worker",
    "npm",
    "run",
    "workflow",
  ]);
}

export interface XcBankTransaction {
  id: string;
  direction: string;
  amount: number;
  counterparty: string;
  timestamp: string;
  balanceAfter: number;
}

export interface XcBankDashboard {
  balance: number;
  transactionCount: number;
  transactions: XcBankTransaction[];
}

// Mirrors parseSteps()'s approach: services/worker/src/actions/registry.ts's
// xcBankExtractDashboard prints a single-line `XC_BANK_DASHBOARD {...}`
// marker specifically so this can pull the full structured detail back
// out of the job's own stdout -- reading our own child process's output,
// not talking to XC Bank directly, so the isolation rule (WebOperator
// never uses an internal XC Bank API/DB) is unaffected.
export function parseXcBankDashboard(stdout: string): XcBankDashboard | undefined {
  for (const line of stdout.split("\n")) {
    const match = line.match(/^XC_BANK_DASHBOARD (.+)$/);
    if (!match) continue;
    try {
      return JSON.parse(match[1]) as XcBankDashboard;
    } catch {
      // fall through -- treat as unparseable, same as a malformed WEBOP_STEP line
    }
  }
  return undefined;
}

// Workflow files that must only ever run against their own isolated
// lane's worker service (see runScbOpenLoginPage/runScbAnalyzePage
// below), never the shared "worker"/browser-worker-chrome the generic
// Workflows section on "/" enqueues against. Excluded here rather than
// just "not linked to" -- listWorkflowNames() feeds
// /api/enqueue-workflow/:name's own validation, so this is a real
// guard against accidentally running real-bank navigation on the
// wrong (shared) browser, not just a UI omission.
const LANE_ONLY_WORKFLOW_PREFIXES = ["scb-business-anywhere"];

export async function listWorkflowNames(): Promise<string[]> {
  try {
    const entries = await readdir(WORKFLOWS_DIR);
    return entries
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length))
      .filter((name) => !LANE_ONLY_WORKFLOW_PREFIXES.some((prefix) => name.startsWith(prefix)));
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

// scb-business-anywhere-1 lane -- fixed, hardcoded service/workflow
// names (not parameterized by request input), same "no path from a
// request to shell argv" posture as ACTIONS. These two are the only
// ways anything ever touches this lane's browser: open-login (safe to
// navigate -- meant to run before a human logs in) and analyze
// (read-only, never navigates -- meant to run after).
const SCB_LANE_SERVICE = "worker-scb-business-anywhere-1";

export async function runScbOpenLoginPage(): Promise<ActionResult> {
  return execAndParse([
    "compose",
    "run",
    "--rm",
    "-e",
    "WORKFLOW_NAME=scb-business-anywhere-open-login",
    SCB_LANE_SERVICE,
    "npm",
    "run",
    "workflow",
  ]);
}

export async function runScbAnalyzePage(): Promise<ActionResult> {
  return execAndParse(["compose", "run", "--rm", SCB_LANE_SERVICE, "npm", "run", "analyze-page"]);
}

export async function runScbSelectCompany(companyName: string): Promise<ActionResult> {
  // Base64-encoded -- found empirically that a non-ASCII (Thai)
  // argument passed through Node's child_process.execFile on Windows
  // gets mangled into literal "?" characters before docker even sees
  // it. See select-company.ts for the full explanation.
  const companyNameB64 = Buffer.from(companyName, "utf-8").toString("base64");
  return execAndParse([
    "compose",
    "run",
    "--rm",
    "-e",
    `COMPANY_NAME_B64=${companyNameB64}`,
    SCB_LANE_SERVICE,
    "npm",
    "run",
    "select-company",
  ]);
}

// targetCompany, if given, is re-asserted (base64-encoded, same
// Windows execFile argv reasoning as runScbSelectCompany) before every
// check -- closes the "re-login resets the active company" gap found
// empirically, without needing a separate step from the caller.
export async function runScbCheckBalance(targetCompany?: string | null): Promise<ActionResult> {
  const args = ["compose", "run", "--rm"];
  if (targetCompany) {
    args.push("-e", `TARGET_COMPANY_B64=${Buffer.from(targetCompany, "utf-8").toString("base64")}`);
  }
  args.push(SCB_LANE_SERVICE, "npm", "run", "check-transactions");
  return execAndParse(args);
}

export interface ScbTransaction {
  date: string;
  time: string;
  trCode: string;
  description: string;
  amount: number;
  detail: string;
}

export interface ScbBalanceSummary {
  availableBalance: number | null;
  ledgerBalance: number | null;
  transactions: ScbTransaction[];
  checkedAt: string;
  url: string;
  screenshot?: string;
  pageLastUpdatedText?: string | null;
}

export function parseScbBalanceSummary(stdout: string): ScbBalanceSummary | undefined {
  for (const line of stdout.split("\n")) {
    const match = line.match(/^SCB_BALANCE_SUMMARY (.+)$/);
    if (!match) continue;
    try {
      return JSON.parse(match[1]) as ScbBalanceSummary;
    } catch {
      // fall through -- treat as unparseable
    }
  }
  return undefined;
}

export interface LanePageAnalysis {
  url: string;
  title: string;
  textSnippet: string;
  screenshot: string;
}

// Mirrors parseXcBankDashboard()'s approach -- pulls the one
// LANE_PAGE_ANALYSIS marker line back out of the job's own stdout.
export function parseLanePageAnalysis(stdout: string): LanePageAnalysis | undefined {
  for (const line of stdout.split("\n")) {
    const match = line.match(/^LANE_PAGE_ANALYSIS (.+)$/);
    if (!match) continue;
    try {
      return JSON.parse(match[1]) as LanePageAnalysis;
    } catch {
      // fall through -- treat as unparseable
    }
  }
  return undefined;
}

export async function composePs(): Promise<string> {
  const { stdout } = await execFileAsync("docker", ["compose", "ps", "--format", "json"], EXEC_OPTS);
  return stdout;
}

export interface ComposePsEntry {
  Service?: string;
  State?: string;
}

// Shared by /api/status (chrome/firefox) and the health module (every
// other Docker service) so there's one parser for docker compose ps's
// output shape, not two copies drifting apart.
export function parseComposePs(stdout: string): ComposePsEntry[] {
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
