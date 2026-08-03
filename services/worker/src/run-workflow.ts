import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectToChromium } from "./cdp.js";
import { step } from "./steps.js";
import { ACTION_HANDLERS, type ActionParams } from "./actions/registry.js";

const CDP_URL = process.env.CDP_URL ?? "http://localhost:9222";
const WORKFLOW_NAME = process.env.WORKFLOW_NAME;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = path.resolve(__dirname, "../workflows");

interface WorkflowStepDef {
  type: string;
  params?: ActionParams;
}

interface WorkflowDef {
  name: string;
  steps: WorkflowStepDef[];
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

    await step(stepName, () => handler({ page, context }, params), opts);
  }

  console.log(`Workflow "${workflow.name}" completed (${workflow.steps.length} steps).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("run-workflow failed:", err);
  process.exit(1);
});
