import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectToChromium } from "./cdp.js";
import { step, stepWithRetry, stepBestEffort, type RetryOptions } from "./steps.js";
import { uploadArtifact } from "./artifacts.js";
import { ACTION_HANDLERS, type ActionParams } from "./actions/registry.js";
import { getPolicy, randomDelay } from "./policy.js";
import { detectChallenge } from "./challenge.js";

const CDP_URL = process.env.CDP_URL ?? "http://localhost:9222";
const WORKFLOW_NAME = process.env.WORKFLOW_NAME;
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/app/output";
// Generously below the real Xvfb resolution (1366x768, see
// services/browser-worker/entrypoint.sh's RESOLUTION) -- only meant to
// catch genuinely abnormal sizes, not the ~20-40px window-decoration
// variance already observed as normal (726-748px height range).
const MIN_EXPECTED_WINDOW_WIDTH = 1200;
const MIN_EXPECTED_WINDOW_HEIGHT = 600;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Overridable so the SCB lane can point this at its own mounted
// recordings directory (/app/recordings) to run a recorded/compiled
// script -- defaults to the committed-to-git workflows/ dir, unchanged
// for every existing caller that doesn't set this.
const WORKFLOWS_DIR = process.env.WORKFLOWS_DIR ? path.resolve(process.env.WORKFLOWS_DIR) : path.resolve(__dirname, "../workflows");

interface WorkflowRetryDef {
  attempts?: number;
  delayMs?: number;
}

interface WorkflowStepDef {
  type: string;
  params?: ActionParams;
  retry?: WorkflowRetryDef;
}

interface WorkflowDef {
  name: string;
  // Selects a per-site "polite automation" policy (locale/timezone/pacing)
  // from policy.ts -- optional, falls back to a generic default. See
  // policy.ts and docs/PROJECT_PLAN.md decision log.
  siteId?: string;
  steps: WorkflowStepDef[];
}

// Step types that click/navigate/fill -- get a small randomized pacing
// delay before running, and a post-run challenge-page check after. Purely
// read-only steps (extract, screenshot, saveSession, xcBankExtractDashboard)
// don't cause a page transition, so neither applies to them.
const INTERACTIVE_STEP_TYPES = new Set(["navigate", "dismissPopup", "login", "xcBankLogin", "xcBankLogoutClean"]);
// Only these can land on a genuinely new page worth challenge-checking
// (dismissPopup/xcBankLogoutClean stay on the same page).
const CHALLENGE_CHECK_STEP_TYPES = new Set(["navigate", "login", "xcBankLogin"]);

// Only read-only/idempotent actions are retried by default -- login and
// saveSession are state-changing, so they only retry if a workflow
// explicitly opts in via a "retry" field on that step. xcBankLogin is
// state-changing the same way; xcBankExtractDashboard is read-only like
// extract; xcBankLogoutClean is idempotent by design (a no-op if already
// clean), safe to retry.
const DEFAULT_RETRYABLE_TYPES = new Set([
  "navigate",
  "dismissPopup",
  "extract",
  "screenshot",
  "xcBankExtractDashboard",
  "xcBankLogoutClean",
]);
const DEFAULT_RETRY: RetryOptions = { attempts: 2, delayMs: 1000 };

// Lets a workflow step reference an env var instead of a hardcoded
// literal, e.g. { "filename": "${SOME_VAR}" } -- useful whenever a
// caller needs to control a per-run value (a unique screenshot filename,
// for instance) without a dedicated workflow JSON file per invocation.
// An unresolved (unset) var becomes "", which trips existing param
// validation (e.g. screenshot's requireString) with a clear error rather
// than silently using a garbled literal filename.
function resolveParams(params: ActionParams): ActionParams {
  const resolved: ActionParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      const match = value.match(/^\$\{(\w+)\}$/);
      resolved[key] = match ? (process.env[match[1]] ?? "") : value;
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

function resolveRetry(workflowStep: WorkflowStepDef): RetryOptions {
  if (workflowStep.retry) {
    return {
      attempts: Math.max(1, workflowStep.retry.attempts ?? DEFAULT_RETRY.attempts),
      delayMs: workflowStep.retry.delayMs ?? DEFAULT_RETRY.delayMs,
    };
  }
  return DEFAULT_RETRYABLE_TYPES.has(workflowStep.type) ? DEFAULT_RETRY : { attempts: 1, delayMs: 0 };
}

async function loadWorkflow(name: string): Promise<WorkflowDef> {
  const filePath = path.join(WORKFLOWS_DIR, `${name}.json`);
  const raw = await readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw) as WorkflowDef;
  if (!Array.isArray(parsed.steps)) {
    throw new Error(`Workflow "${name}" has no "steps" array`);
  }
  return parsed;
}

// Validates the *entire* workflow before anything runs, so a bad step
// anywhere fails the job instantly with zero browser interaction and zero
// side effects, instead of executing earlier steps (navigation, form
// fills, session saves) before dying partway through.
function validateWorkflow(workflow: WorkflowDef): void {
  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    throw new Error("Workflow must have a non-empty steps array");
  }
  if (workflow.siteId !== undefined && typeof workflow.siteId !== "string") {
    throw new Error('"siteId" must be a string if present');
  }
  workflow.steps.forEach((workflowStep, index) => {
    const label = `Step ${index + 1}`;
    if (typeof workflowStep.type !== "string" || !(workflowStep.type in ACTION_HANDLERS)) {
      throw new Error(`${label}: unknown action type "${String(workflowStep.type)}"`);
    }
    const params = workflowStep.params;
    if (params !== undefined && (typeof params !== "object" || params === null || Array.isArray(params))) {
      throw new Error(`${label} ("${workflowStep.type}"): "params" must be an object`);
    }
    const retry = workflowStep.retry;
    if (retry !== undefined) {
      if (typeof retry !== "object" || retry === null || Array.isArray(retry)) {
        throw new Error(`${label} ("${workflowStep.type}"): "retry" must be an object`);
      }
      if (retry.attempts !== undefined && !(typeof retry.attempts === "number" && retry.attempts > 0)) {
        throw new Error(`${label} ("${workflowStep.type}"): "retry.attempts" must be a positive number`);
      }
      if (retry.delayMs !== undefined && !(typeof retry.delayMs === "number" && retry.delayMs >= 0)) {
        throw new Error(`${label} ("${workflowStep.type}"): "retry.delayMs" must be a non-negative number`);
      }
    }
  });
}

async function main(): Promise<void> {
  if (!WORKFLOW_NAME) {
    throw new Error("WORKFLOW_NAME env var is required");
  }
  const workflow = await loadWorkflow(WORKFLOW_NAME);
  await step("validate", async () => validateWorkflow(workflow));

  const browser = await step("connect", () => connectToChromium(CDP_URL));
  const context = browser.contexts()[0] ?? (await browser.newContext());

  // Close every existing page in the shared context (best-effort -- a
  // close failing here doesn't matter, the goal is just not to leave it
  // behind) and open exactly one fresh page, instead of reusing the same
  // page indefinitely -- prevents tab buildup over a long-running
  // monitor loop. This job only fails if newPage() itself fails (no
  // page, nothing downstream can run) -- a failed close never does.
  // Deliberately opens a new PAGE in the existing context, not a new
  // CONTEXT: a new context would be a genuinely separate top-level
  // window that does not inherit the existing maximized window state
  // (confirmed empirically), where a same-context newPage() does.
  const page = await step("prepare-page", async () => {
    for (const existing of context.pages()) {
      await existing.close().catch(() => {});
    }
    return context.newPage();
  });

  // Best-effort only: window sizing is observed, not corrected. An
  // earlier design tried an explicit-bounds resize fallback here and
  // confirmed empirically it can *shrink* an already-maximized window
  // (Fluxbox/X11 quirk) -- ruled out. A same-context newPage() already
  // inherits the parent window's maximized state on its own; this just
  // measures the real rendered size and flags it (step goes red, job
  // does not fail) if abnormally small, for visibility only.
  await stepBestEffort(
    "check-window-size",
    async () => {
      try {
        const cdp = await context.newCDPSession(page);
        const { windowId } = await cdp.send("Browser.getWindowForTarget");
        await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "maximized" } });
      } catch {
        // Chromium-only CDP calls; harmless if unavailable (e.g. a
        // future non-Chromium path) or if the browser doesn't cooperate.
      }
      const size = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      if (size.width < MIN_EXPECTED_WINDOW_WIDTH || size.height < MIN_EXPECTED_WINDOW_HEIGHT) {
        throw new Error(`Window smaller than expected: ${size.width}x${size.height}`);
      }
      return size;
    },
    { captureResult: true },
  );

  const policy = getPolicy(workflow.siteId);
  // Raw CDP, not Playwright's newContext({locale, timezoneId}) -- this
  // context/page already exists (reused from the shared browser above),
  // and Playwright's high-level locale/timezone options only take effect
  // at context-creation time. Emulation.set*Override applies to an
  // existing target instead. See docs/PROJECT_PLAN.md decision log.
  await step("apply-policy", async () => {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setTimezoneOverride", { timezoneId: policy.timezoneId });
    await cdp.send("Emulation.setLocaleOverride", { locale: policy.locale });
    // setLocaleOverride only affects Intl/date-formatting -- confirmed
    // empirically it does NOT change navigator.language/navigator.languages.
    // Those reflect Accept-Language, set via setUserAgentOverride's
    // acceptLanguage field -- the real userAgent string is read back and
    // passed through unchanged, so this never misrepresents the browser
    // itself, only its language preference.
    const realUserAgent = await page.evaluate(() => navigator.userAgent);
    await cdp.send("Emulation.setUserAgentOverride", { userAgent: realUserAgent, acceptLanguage: policy.locale });
  });

  for (const [index, workflowStep] of workflow.steps.entries()) {
    const handler = ACTION_HANDLERS[workflowStep.type];
    if (!handler) {
      throw new Error(`Unknown workflow action type "${workflowStep.type}"`);
    }
    const params = resolveParams(workflowStep.params ?? {});
    const stepName = `${index + 1}-${workflowStep.type}`;
    const opts =
      workflowStep.type === "screenshot"
        ? { screenshot: String(params.filename ?? "") }
        : workflowStep.type === "extract" ||
            workflowStep.type === "xcBankLogin" ||
            workflowStep.type === "xcBankExtractDashboard" ||
            workflowStep.type === "xcBankLogoutClean"
          ? { captureResult: true }
          : undefined;

    if (INTERACTIVE_STEP_TYPES.has(workflowStep.type)) {
      await page.waitForTimeout(randomDelay(policy.actionDelayMs));
    }

    await stepWithRetry(
      stepName,
      () => handler({ page, context, policy }, params),
      resolveRetry(workflowStep),
      opts,
    );

    if (CHALLENGE_CHECK_STEP_TYPES.has(workflowStep.type)) {
      await step(`${index + 1}-challenge-check`, async () => {
        const matched = await detectChallenge(page);
        if (matched) {
          throw new Error(`Challenge detected on page (matched /${matched}/i) — stopping, not attempting to bypass`);
        }
      });
    }

    if (workflowStep.type === "screenshot") {
      const filename = String(params.filename ?? "");
      const localPath = path.join(OUTPUT_DIR, filename);
      await stepBestEffort(`${index + 1}-archive-screenshot`, () => uploadArtifact(localPath, `screenshots/${filename}`));
    }

    if (workflowStep.type === "saveSession") {
      const sessionPath = String(params.path ?? "");
      await stepBestEffort(`${index + 1}-archive-session`, () =>
        uploadArtifact(sessionPath, `sessions/${path.basename(sessionPath)}`),
      );
    }
  }

  console.log(`Workflow "${workflow.name}" completed (${workflow.steps.length} steps).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("run-workflow failed:", err);
  process.exit(1);
});
