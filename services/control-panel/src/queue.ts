import { Queue, Worker } from "bullmq";
import { runAction, type ActionResult } from "./exec.js";
import type { ActionName } from "./actions.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const QUEUE_NAME = "worker-actions";
const connection = { url: REDIS_URL };

// Only the automation actions are queueable — browser start/stop are
// container-lifecycle calls, not automation jobs, and stay on the existing
// synchronous /api/action/:name path.
export const QUEUEABLE_ACTIONS = ["runStart", "runSave", "runRestore", "runAdapter"] as const;
export type QueueableAction = (typeof QUEUEABLE_ACTIONS)[number];

export function isQueueableAction(value: string): value is QueueableAction {
  return (QUEUEABLE_ACTIONS as readonly string[]).includes(value);
}

const queue = new Queue(QUEUE_NAME, { connection });

let worker: Worker | undefined;

// All queueable actions connect to the same shared browser-worker-chrome
// instance over CDP — concurrency 1 serializes access to that one browser
// instead of racing two jobs against it.
export function startWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(
    QUEUE_NAME,
    async (job): Promise<ActionResult> => runAction(job.name as ActionName),
    { connection, concurrency: 1 },
  );
  worker.on("failed", (job, err) => {
    console.error(`Job ${job?.id} (${job?.name}) failed:`, err.message);
  });
  return worker;
}

export async function enqueueAction(name: QueueableAction): Promise<string> {
  const job = await queue.add(name, {}, {
    attempts: 2,
    backoff: { type: "fixed", delay: 5000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 50 },
  });
  return job.id ?? "";
}

export interface JobSummary {
  id: string | undefined;
  name: string;
  state: string;
  timestamp: number;
  finishedOn: number | null;
  result: ActionResult | null;
  failedReason: string | null;
}

export async function listRecentJobs(): Promise<JobSummary[]> {
  const jobs = await queue.getJobs(["waiting", "active", "completed", "failed", "delayed"], 0, 20);
  const summaries = await Promise.all(
    jobs.map(async (job): Promise<JobSummary> => ({
      id: job.id,
      name: job.name,
      state: await job.getState(),
      timestamp: job.timestamp,
      finishedOn: job.finishedOn ?? null,
      result: (job.returnvalue as ActionResult | undefined) ?? null,
      failedReason: job.failedReason ?? null,
    })),
  );
  return summaries.sort((a, b) => b.timestamp - a.timestamp);
}

export async function closeQueue(): Promise<void> {
  await worker?.close();
  await queue.close();
}
