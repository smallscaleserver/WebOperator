import { Queue, Worker } from "bullmq";
import { runAction, runWorkflow, type ActionResult } from "./exec.js";
import type { ActionName } from "./actions.js";
import { checkOnce, loadState, resetState, setPaused, MONITOR_JOB_NAME } from "./monitor.js";

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
// Dev-only "wipe this monitor's tracked history/screenshots" job --
// routed through the same concurrency-1 queue as checkOnce so it can
// never race an in-flight check's file writes.
const MONITOR_CLEANUP_JOB_NAME = "xc-bank-monitor-cleanup";
// Pause/resume also route through this queue, not a direct setPaused()
// call -- found empirically, not assumed: checkOnce() holds its own
// in-memory state object across a multi-second real-browser check, and
// a direct out-of-band file write landing inside that window gets
// silently overwritten by checkOnce()'s own eventual save (it writes
// back whatever paused value it read at *its* load time). Queueing
// serializes this the same way it already does for cleanup.
const MONITOR_SET_PAUSED_JOB_NAME = "xc-bank-monitor-set-paused";
const MONITOR_INTERVAL_MS = Number(process.env.XC_BANK_MONITOR_INTERVAL_MS ?? 20_000);
// Max random extra delay before a *scheduled* tick actually runs -- avoids
// a perfectly robotic exact-every-N-seconds cadence. Manual "Check once"
// jobs (and the immediate first tick after Start) are untagged and skip
// this entirely, since a user explicitly asking for a check expects it
// right away. See docs/PROJECT_PLAN.md decision log ("polite automation").
const MONITOR_JITTER_MS = Number(process.env.XC_BANK_MONITOR_JITTER_MS ?? 5_000);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
      if (job.name === MONITOR_CLEANUP_JOB_NAME) {
        await resetState();
        return { ok: true, stdout: "XC Bank monitor state and screenshots cleared", stderr: "", steps: [] };
      }
      if (job.name === MONITOR_SET_PAUSED_JOB_NAME) {
        const paused = job.data?.paused === true;
        await setPaused(paused);
        return { ok: true, stdout: paused ? "Monitor paused" : "Monitor resumed", stderr: "", steps: [] };
      }
      if (job.name === MONITOR_JOB_NAME) {
        const isScheduledTick = job.data?.scheduled === true;
        if (isScheduledTick) {
          await sleep(Math.random() * MONITOR_JITTER_MS);
          // Manual "Check once" always runs regardless of paused --
          // pause only skips the automatic scheduled loop, matching the
          // "manual is always instant/authoritative" precedent from the
          // jitter work above.
          const { paused } = await loadState();
          if (paused) {
            return { ok: true, stdout: "Monitor paused — scheduled check skipped", stderr: "", steps: [] };
          }
        }
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

export async function enqueueMonitorCleanup(): Promise<string> {
  const job = await queue.add(MONITOR_CLEANUP_JOB_NAME, {}, JOB_OPTS);
  return job.id ?? "";
}

async function enqueueSetPaused(paused: boolean): Promise<string> {
  const job = await queue.add(MONITOR_SET_PAUSED_JOB_NAME, { paused }, JOB_OPTS);
  return job.id ?? "";
}

export async function pauseMonitor(): Promise<string> {
  return enqueueSetPaused(true);
}
export async function resumeMonitor(): Promise<string> {
  return enqueueSetPaused(false);
}

export interface MonitorScheduleInfo {
  running: boolean;
  next: number | null;
  every: number;
  jitterMs: number;
}

// Authoritative "is the monitor running" signal (plus next/every) --
// checked against BullMQ's own scheduler list rather than a flag this
// module maintains itself, so it can't drift out of sync if the
// Control Panel process restarted after a crash.
export async function getMonitorScheduleInfo(): Promise<MonitorScheduleInfo> {
  const schedulers = await queue.getJobSchedulers();
  // The scheduler's own identifier comes back as .key (confirmed by
  // inspecting a live queue directly, not assumed from the type alone --
  // .id is a separate, unrelated field that's null unless a distinct
  // per-iteration jobId template is configured). .next/.every likewise
  // confirmed directly against a live queue before relying on them here.
  const scheduler = schedulers.find((s) => s.key === MONITOR_SCHEDULER_ID);
  return {
    running: scheduler !== undefined,
    next: scheduler?.next ?? null,
    every: scheduler?.every ?? MONITOR_INTERVAL_MS,
    jitterMs: MONITOR_JITTER_MS,
  };
}

export async function startMonitorSchedule(): Promise<void> {
  // data.scheduled tags jobs produced by the scheduler itself (not the
  // immediate first-tick enqueue below, and not a manual "Check once")
  // so the processor above knows which jobs to jitter.
  await queue.upsertJobScheduler(
    MONITOR_SCHEDULER_ID,
    { every: MONITOR_INTERVAL_MS },
    { name: MONITOR_JOB_NAME, data: { scheduled: true } },
  );
  // "Start" always means "actively running" -- clears a leftover paused
  // flag too (queued, same race-avoidance reasoning as pause/resume
  // above), so resuming a paused-but-still-scheduled monitor via the
  // existing Start button works intuitively without a separate step.
  await enqueueSetPaused(false);
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
  // True only for a monitor-check job the scheduler itself produced;
  // false for a manual "Check once" and for every non-monitor job (the
  // "scheduled vs. manual" distinction has no meaning outside the
  // monitor's own job type).
  scheduled: boolean;
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
        scheduled: job.name === MONITOR_JOB_NAME && job.data?.scheduled === true,
      };
    }),
  );
  return summaries.sort((a, b) => b.timestamp - a.timestamp);
}

export async function closeQueue(): Promise<void> {
  await worker?.close();
  await queue.close();
}

// Health/diagnostics checks -- both used only by health.ts, kept here
// since they need the private `queue` instance directly.

// There's no IPC channel between this API process and the separate
// `npm run worker` process -- getWorkers() (confirmed live against a
// real running/stopped worker before relying on it) is BullMQ's own
// mechanism for listing connected worker clients via Redis CLIENT LIST,
// the only real signal available.
export async function checkQueueWorkerHealth(): Promise<boolean> {
  const workers = await queue.getWorkers();
  return workers.length > 0;
}

// ioredis queues commands during a connection outage rather than
// failing fast (documented gotcha elsewhere in this repo) -- a
// diagnostics check must not hang waiting for that, so this races the
// real ping against a short timeout instead of awaiting it directly.
export async function checkRedisHealth(timeoutMs = 1500): Promise<boolean> {
  const client = await queue.client;
  // BullMQ's IRedisClient abstraction doesn't declare ping() (not a
  // command BullMQ itself needs internally) -- info() is declared and
  // is an equally real round-trip for this purpose.
  const result = await Promise.race([
    client.info().then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
  return result;
}
