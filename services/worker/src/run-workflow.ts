import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectToChromium } from "./cdp.js";
import { step, stepWithRetry, stepBestEffort, type RetryOptions } from "./steps.js";
import { uploadArtifact } from "./artifacts.js";
import { ACTION_HANDLERS, type ActionParams } from "./actions/registry.js";

const CDP_URL = process.env.CDP_URL ?? "http://localhost:9222";
const WORKFLOW_NAME = process.env.WORKFLOW_NAME;
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/app/output";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = path.resolve(__dirname, "../workflows");

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
  steps: WorkflowStepDef[];
}

// Only read-only/idempotent actions are retried by default -- login and
// saveSession are state-changing, so they only retry if a workflow
// explicitly opts in via a "retry" field on that step.
const DEFAULT_RETRYABLE_TYPES = new Set(["navigate", "dismissPopup", "extract", "screenshot"]);
const DEFAULT_RETRY: RetryOptions = { attempts: 2, delayMs: 1000 };

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
  const page = context.pages()[0] ?? (await context.newPage());

  for (const [index, workflowStep] of workflow.steps.entries()) {
    const handler = ACTION_HANDLERS[workflowStep.type];
    if (!handler) {
      throw new Error(`Unknown workflow action type "${workflowStep.type}"`);
    }
    const params = workflowStep.params ?? {};
    const stepName = `${index + 1}-${workflowStep.type}`;
    const opts =
      workflowStep.type === "screenshot"
        ? { screenshot: String(params.filename ?? "") }
        : workflowStep.type === "extract"
          ? { captureResult: true }
          : undefined;

    await stepWithRetry(stepName, () => handler({ page, context }, params), resolveRetry(workflowStep), opts);

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
