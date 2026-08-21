import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readdir, readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { ACTIONS, type ActionName } from "./actions.js";
import { getLane, type LaneConfig } from "./lanes.js";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// services/control-panel/src -> repo root
export const REPO_ROOT = path.resolve(__dirname, "../../..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, "services", "worker", "workflows");

// The separate D:\WebOperatorAuthBridge overlay compose file adds a
// `ports:` mapping to browser-worker-scb-business-anywhere-1 (so
// auth-bridge, which joins that container's network namespace via
// `network_mode: "service:..."`, can be reached). Found live: any
// `docker compose run` against this lane that resolves its config
// WITHOUT that overlay sees a different (portless) config for that
// service and silently recreates it to match -- which orphans
// auth-bridge's shared network namespace even though nothing
// meaningful actually changed. Loading the same overlay file here,
// when present, keeps the resolved config identical to whatever's
// actually running, so `docker compose run` never has a reason to
// recreate it. Read once per call (not cached) since compose itself
// re-resolves config on every invocation anyway, and this is a cheap
// existsSync -- not a hot path.
const AUTH_BRIDGE_OVERLAY_PATH = path.resolve(
  REPO_ROOT,
  "..",
  "WebOperatorAuthBridge",
  "weboperator-compose.overlay.example.yml",
);

function scbLaneComposePrefix(): string[] {
  return existsSync(AUTH_BRIDGE_OVERLAY_PATH)
    ? ["-f", "docker-compose.yml", "-f", AUTH_BRIDGE_OVERLAY_PATH]
    : [];
}

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
//
// Generalized so a recorded SCB-lane script can run through the exact
// same generic run-workflow.ts engine, just pointed at that lane's own
// service/recordings directory instead of the shared browser/committed
// workflows/ dir (see run-workflow.ts's now-overridable WORKFLOWS_DIR).
export async function runWorkflowOnLane(
  name: string,
  laneService: string,
  workflowsDir?: string,
  extraEnv?: Record<string, string>,
): Promise<ActionResult> {
  const args = ["compose", "run", "--rm", "-e", `WORKFLOW_NAME=${name}`];
  if (workflowsDir) {
    args.push("-e", `WORKFLOWS_DIR=${workflowsDir}`);
  }
  for (const [key, value] of Object.entries(extraEnv ?? {})) {
    args.push("-e", `${key}=${value}`);
  }
  args.push(laneService, "npm", "run", "workflow");
  return execAndParse(args);
}

export async function runWorkflow(name: string): Promise<ActionResult> {
  return runWorkflowOnLane(name, "worker");
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
    ...scbLaneComposePrefix(),
    "run",
    "--rm",
    "--no-deps",
    "-e",
    "WORKFLOW_NAME=scb-business-anywhere-open-login",
    SCB_LANE_SERVICE,
    "npm",
    "run",
    "workflow",
  ]);
}

export async function runScbAnalyzePage(): Promise<ActionResult> {
  return execAndParse(["compose", ...scbLaneComposePrefix(), "run", "--rm", "--no-deps", SCB_LANE_SERVICE, "npm", "run", "analyze-page"]);
}

// Mock-monitor-only pre-step (see scb-mock-monitor.ts): AuthBridge's
// own mock-login job closes/resets the page it was driving once it
// finishes, so by the time a balance check runs there's nothing open
// for check-transactions.ts to read -- found live while verifying.
// This just navigates back to scb-mock's own account-summary URL,
// relying on the session cookie AuthBridge's login already
// established (cookies live on the browser context/profile, not the
// page, so closing/reopening a tab doesn't lose them). If the session
// genuinely isn't authenticated, scb-mock's own server redirects this
// straight to /login, which check-transactions.ts already detects and
// reports as SESSION_EXPIRED -- same safe fallback either way. Never
// used for the real SCB site (a completely different URL) and never
// touches check-transactions.ts's own real-lane behavior.
//
// KEEP_EXISTING_PAGE=1: without it, run-workflow.ts's default
// "close every existing page, then open one fresh one" prepare-page
// step is itself a crash trigger, independent of the disconnect fix
// in cdp.ts -- found live, reproducibly (crashed within 2 back-to-back
// runs with the close+reopen pattern, 10/10 clean with reuse instead).
// This workflow runs repeatedly against an already-open, already-
// authenticated lane, so reusing the existing page (same pattern
// check-transactions.ts/analyze-page.ts already use) is also the
// semantically correct choice, not just the safe one. See
// docs/PROJECT_PLAN.md's SCB lane mid-session crash writeup.
export async function runScbMockGotoAccountSummary(): Promise<ActionResult> {
  return execAndParse([
    "compose",
    ...scbLaneComposePrefix(),
    "run",
    "--rm",
    "--no-deps",
    "-e",
    "WORKFLOW_NAME=scb-business-anywhere-mock-goto-account-summary",
    "-e",
    "KEEP_EXISTING_PAGE=1",
    SCB_LANE_SERVICE,
    "npm",
    "run",
    "workflow",
  ]);
}

export async function runScbSelectCompany(companyName: string): Promise<ActionResult> {
  // Base64-encoded -- found empirically that a non-ASCII (Thai)
  // argument passed through Node's child_process.execFile on Windows
  // gets mangled into literal "?" characters before docker even sees
  // it. See select-company.ts for the full explanation.
  const companyNameB64 = Buffer.from(companyName, "utf-8").toString("base64");
  return execAndParse([
    "compose",
    ...scbLaneComposePrefix(),
    "run",
    "--rm",
    "--no-deps",
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
  const args = ["compose", ...scbLaneComposePrefix(), "run", "--rm", "--no-deps"];
  if (targetCompany) {
    args.push("-e", `TARGET_COMPANY_B64=${Buffer.from(targetCompany, "utf-8").toString("base64")}`);
  }
  args.push(SCB_LANE_SERVICE, "npm", "run", "check-transactions");
  return execAndParse(args);
}

export async function runScbMockReset(): Promise<ActionResult> {
  return execAndParse([
    "compose",
    ...scbLaneComposePrefix(),
    "run",
    "--rm",
    "--no-deps",
    SCB_LANE_SERVICE,
    "npx",
    "tsx",
    "src/scb-mock-reset.ts",
  ]);
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

// Record → analyze → run -- lane-parameterized (see lanes.ts). Started
// out hard-wired to the SCB lane specifically; generalized after an
// explicit request that this work against any lane/website, not just
// SCB, with no per-lane code (see docs/PROJECT_PLAN.md's decision
// log). Every function below resolves its host/container paths via
// getLane(laneId) rather than a hardcoded SCB path.

// Long-running by design: this resolves only once the human clicks
// Stop (or the recorder's own 15-minute max duration elapses) — not a
// quick one-shot action, so it needs a much longer timeout than
// EXEC_OPTS's default 120s. Whatever calls this (a queued job) is
// expected to just await it; the shared queue's concurrency=1 already
// means nothing else can touch that lane's browser while a recording
// is in progress, which is exactly the desired behavior (a scheduled
// job firing mid-recording would be visually confusing at best).
const RECORDING_EXEC_OPTS = { cwd: REPO_ROOT, timeout: 16 * 60 * 1000, maxBuffer: 5 * 1024 * 1024 };

function requireLane(laneId: string): LaneConfig {
  const lane = getLane(laneId);
  if (!lane) {
    throw new Error(`Unknown lane "${laneId}"`);
  }
  return lane;
}

// Explicit, human-triggered only -- never called automatically (see
// docs/BOT_LANE_ISOLATION.md §3: "Explicit Restart Lane, never silent
// auto-heal", the same "never starts/stops anything itself" rule
// health.ts already follows). `stop` then `up -d` rather than a plain
// `restart`, matching the pattern already proven more reliable this
// session for recovering a wedged browser-worker container.
export async function restartLane(laneId: string): Promise<ActionResult> {
  const lane = requireLane(laneId);
  const stopResult = await execAndParse(["compose", "stop", lane.browserWorkerService]);
  if (!stopResult.ok) return stopResult;
  return execAndParse(["compose", "up", "-d", lane.browserWorkerService]);
}

export async function runStartRecording(laneId: string, runId: string): Promise<ActionResult> {
  const lane = requireLane(laneId);
  await mkdir(lane.recordingsHostDir, { recursive: true });
  try {
    const { stdout, stderr } = await execFileAsync(
      "docker",
      ["compose", "run", "--rm", "-e", `RECORDING_RUN_ID=${runId}`, lane.workerService, "npm", "run", "record-actions"],
      RECORDING_EXEC_OPTS,
    );
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

// Writing this file directly (no docker call) is what actually stops a
// recording session -- record-actions.ts polls for it every ~1s. This
// is the reason recording uses a stop-flag file at all instead of a
// second queued "stop" job: the lane's queue slot is occupied by the
// recording job itself for the whole session, so a queued stop job
// would never get a turn to run.
export async function writeRecordingStopFlag(laneId: string, runId: string): Promise<void> {
  const lane = requireLane(laneId);
  await mkdir(lane.recordingsHostDir, { recursive: true });
  await writeFile(path.join(lane.recordingsHostDir, `.stop-${runId}`), "");
}

export interface CompiledRecordingStep {
  type: "clickSmart" | "typeText" | "pressKey";
  params: Record<string, unknown>;
}

export interface RecordingResult {
  steps: CompiledRecordingStep[];
  redactedCount: number;
  eventCount: number;
}

export function parseRecordingResult(stdout: string): RecordingResult | undefined {
  for (const line of stdout.split("\n")) {
    const match = line.match(/^SCB_RECORDING_RESULT (.+)$/);
    if (!match) continue;
    try {
      return JSON.parse(match[1]) as RecordingResult;
    } catch {
      // fall through -- treat as unparseable
    }
  }
  return undefined;
}

const SAFE_RECORDING_NAME = /^[a-zA-Z0-9_-]{1,80}$/;

export function isValidRecordingName(name: string): boolean {
  return SAFE_RECORDING_NAME.test(name);
}

export async function listRecordings(laneId: string): Promise<string[]> {
  const lane = requireLane(laneId);
  try {
    const entries = await readdir(lane.recordingsHostDir);
    return entries
      .filter((f) => f.endsWith(".json") && !f.startsWith("."))
      .map((f) => f.slice(0, -".json".length));
  } catch {
    return [];
  }
}

export async function saveRecording(laneId: string, name: string, steps: CompiledRecordingStep[]): Promise<void> {
  if (!isValidRecordingName(name)) {
    throw new Error(`Invalid recording name "${name}" — use only letters, numbers, "-", "_"`);
  }
  const lane = requireLane(laneId);
  await mkdir(lane.recordingsHostDir, { recursive: true });
  const filePath = path.join(lane.recordingsHostDir, `${name}.json`);
  await writeFile(filePath, JSON.stringify({ name, steps }, null, 2), "utf-8");
}

export async function deleteRecording(laneId: string, name: string): Promise<void> {
  if (!isValidRecordingName(name)) return;
  const lane = requireLane(laneId);
  await unlink(path.join(lane.recordingsHostDir, `${name}.json`)).catch(() => {});
}

export interface RecordingFile {
  name: string;
  steps: CompiledRecordingStep[];
}

export async function readRecording(laneId: string, name: string): Promise<RecordingFile | undefined> {
  if (!isValidRecordingName(name)) return undefined;
  const lane = getLane(laneId);
  if (!lane) return undefined;
  try {
    const raw = await readFile(path.join(lane.recordingsHostDir, `${name}.json`), "utf-8");
    return JSON.parse(raw) as RecordingFile;
  } catch {
    return undefined;
  }
}

// Runs one saved recording (or, from replay-engine.ts, one *segment*
// of one -- a small temp file with the same {name, steps} shape)
// against a specific lane, through the same generic run-workflow.ts
// engine every other workflow uses, just pointed at that lane's own
// service and recordings directory instead of the shared browser.
//
// KEEP_EXISTING_PAGE=1 -- found live that replay-engine.ts's
// segment-by-segment execution was losing all page state (login,
// filled form fields, current URL) between segments, because
// run-workflow.ts's own page-reset step closed the page and opened a
// blank one before every single segment. This lane's every other
// interaction (check-transactions.ts, select-company.ts, the
// recorder itself) already reuses the existing page instead of
// resetting it -- a replayed recording needs that same continuity,
// not run-workflow.ts's monitor-loop-oriented "always start fresh"
// behavior. See run-workflow.ts's own comment on this flag.
export async function runRecording(laneId: string, name: string): Promise<ActionResult> {
  const lane = requireLane(laneId);
  return runWorkflowOnLane(name, lane.workerService, lane.recordingsContainerDir, { KEEP_EXISTING_PAGE: "1" });
}

export async function writeTempSegment(laneId: string, fileName: string, steps: CompiledRecordingStep[]): Promise<void> {
  const lane = requireLane(laneId);
  await mkdir(lane.recordingsHostDir, { recursive: true });
  await writeFile(
    path.join(lane.recordingsHostDir, `${fileName}.json`),
    JSON.stringify({ name: fileName, steps }, null, 2),
    "utf-8",
  );
}

export async function deleteTempSegment(laneId: string, fileName: string): Promise<void> {
  const lane = getLane(laneId);
  if (!lane) return;
  await unlink(path.join(lane.recordingsHostDir, `${fileName}.json`)).catch(() => {});
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
