import { Queue, Worker } from "bullmq";
import { runAction, runWorkflow, type ActionResult } from "./exec.js";
import type { ActionName } from "./actions.js";
import { checkOnce, MONITOR_JOB_NAME } from "./monitor.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const QUEUE_NAME = "worker-actions";
const WORKFLOW_JOB_PREFIX = "workflow:";
const connection = { url: REDIS_URL };

// BullMQ Job Scheduler id for the XC Bank monitor's repeatable check --
// same queue, same concurrency-1 Worker as every other action/workflow
// job below, so a scheduled tick can never run concurrently with (or
// interrupt) a manual job on the same shared browser. Dev default 20s,
// within the requested 10-30s range.
const MONITOR_SCHEDULER_ID = "monitor:xc-bank";
const MONITOR_INTERVAL_MS = Number(process.env.XC_BANK_MONITOR_INTERVAL_MS ?? 20_000);

// Only the automation actions are queueable — browser start/stop are
// container-lifecycle calls, not automation jobs, and stay on the existing
// synchronous /api/action/:name path.
export const QUEUEABLE_ACTIONS = ["runSave", "runRestore", "runFirefoxDemo"] as const;
export type QueueableAction = (typeof QUEUEABLE_ACTIONS)[number];

export function isQueueableAction(value: string): value is QueueableAction {
  return (QUEUEABLE_ACTIONS as readonly string[]).includes(value);
}

const queue = new Queue(QUEUE_NAME, { connection });

let worker: Worker | undefined;

// All queueable actions/workflows connect to the same shared
// browser-worker-chrome instance over CDP — concurrency 1 serializes
// access to that one browser instead of racing jobs against it.
export function startWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(
    QUEUE_NAME,
    async (job): Promise<ActionResult> => {
      if (job.name === MONITOR_JOB_NAME) {
        const state = await checkOnce();
        return {
          ok: state.lastError === null,
          stdout: state.lastError
            ? ""
            : `XC Bank monitor check ok — balance $${state.latestBalance?.toFixed(2)}, ` +
              `${state.notifications.length} notification(s) tracked total`,
          stderr: state.lastError ?? "",
          steps: [],
        };
      }
      if (job.name.startsWith(WORKFLOW_JOB_PREFIX)) {
        const workflowName = job.data?.workflowName as string;
        return runWorkflow(workflowName);
      }
      return runAction(job.name as ActionName);
    },
    { connection, concurrency: 1 },
  );
  worker.on("failed", (job, err) => {
    console.error(`Job ${job?.id} (${job?.name}) failed:`, err.message);
  });
  return worker;
}

const JOB_OPTS = {
  attempts: 2,
  backoff: { type: "fixed" as const, delay: 5000 },
  removeOnComplete: { count: 50 },
  removeOnFail: { count: 50 },
};

export async function enqueueAction(name: QueueableAction): Promise<string> {
  const job = await queue.add(name, {}, JOB_OPTS);
  return job.id ?? "";
}

export async function enqueueWorkflow(name: string): Promise<string> {
  const job = await queue.add(`${WORKFLOW_JOB_PREFIX}${name}`, { workflowName: name }, JOB_OPTS);
  return job.id ?? "";
}

export async function enqueueMonitorCheckOnce(): Promise<string> {
  const job = await queue.add(MONITOR_JOB_NAME, {}, JOB_OPTS);
  return job.id ?? "";
}

// Authoritative "is the monitor running" signal -- checked against
// BullMQ's own scheduler list rather than a flag this module maintains
// itself, so it can't drift out of sync if the Control Panel process
// restarted after a crash.
export async function isMonitorScheduled(): Promise<boolean> {
  const schedulers = await queue.getJobSchedulers();
  // The scheduler's own identifier comes back as .key (confirmed by
  // inspecting a live queue directly, not assumed from the type alone --
  // .id is a separate, unrelated field that's null unless a distinct
  // per-iteration jobId template is configured).
  return schedulers.some((s) => s.key === MONITOR_SCHEDULER_ID);
}

export async function startMonitorSchedule(): Promise<void> {
  await queue.upsertJobScheduler(MONITOR_SCHEDULER_ID, { every: MONITOR_INTERVAL_MS }, { name: MONITOR_JOB_NAME });
  // Also fire one check immediately rather than assuming/relying on the
  // scheduler's own first-tick timing, so the UI shows real data right
  // away instead of waiting up to a full interval.
  await enqueueMonitorCheckOnce();
}

// Stops future scheduled ticks. Does NOT forcibly kill a check that's
// already running -- that job (if any) finishes naturally. Documented
// behavior, not an oversight: safely cancelling a job mid-flight through
// a real browser session is a bigger feature than this dev tool needs.
export async function stopMonitorSchedule(): Promise<void> {
  await queue.removeJobScheduler(MONITOR_SCHEDULER_ID);
}

export interface JobSummary {
  id: string | undefined;
  name: string;
  state: string;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
  durationMs: number | null;
  result: ActionResult | null;
  failedReason: string | null;
}

export async function listRecentJobs(): Promise<JobSummary[]> {
  const jobs = await queue.getJobs(["waiting", "active", "completed", "failed", "delayed"], 0, 20);
  const summaries = await Promise.all(
    jobs.map(async (job): Promise<JobSummary> => {
      const processedOn = job.processedOn ?? null;
      const finishedOn = job.finishedOn ?? null;
      return {
        id: job.id,
        name: job.name,
        state: await job.getState(),
        timestamp: job.timestamp,
        processedOn,
        finishedOn,
        durationMs: processedOn !== null && finishedOn !== null ? finishedOn - processedOn : null,
        result: (job.returnvalue as ActionResult | undefined) ?? null,
        failedReason: job.failedReason ?? null,
      };
    }),
  );
  return summaries.sort((a, b) => b.timestamp - a.timestamp);
}

export async function closeQueue(): Promise<void> {
  await worker?.close();
  await queue.close();
}
