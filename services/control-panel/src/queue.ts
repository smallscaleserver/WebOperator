import path from "node:path";
import { Queue, Worker } from "bullmq";
import {
  runAction,
  runWorkflow,
  runScbAnalyzePage,
  parseLanePageAnalysis,
  runStartRecording,
  parseRecordingResult,
  REPO_ROOT,
  type ActionResult,
} from "./exec.js";
import type { ActionName } from "./actions.js";
import { checkOnce, loadState, resetState, setPaused, setAutoStopConfig, MONITOR_JOB_NAME } from "./monitor.js";
import {
  checkOnce as scbCheckOnce,
  loadState as scbLoadState,
  setPaused as scbSetPaused,
  setAutoStopConfig as scbSetAutoStopConfig,
  SCB_MONITOR_JOB_NAME,
} from "./scb-monitor.js";
import { runRecordingReplay } from "./replay-engine.js";
import { sendTelegramMessage, sendTelegramPhoto } from "./telegram.js";

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
// Same queue-serialization reasoning as pause/resume, kept as its own
// job type (not folded into MONITOR_SET_PAUSED_JOB_NAME) to avoid
// touching that already-tested mechanism. Requested after a real ~38h
// unattended run crashed Chromium -- a genuine ban risk if this loop
// were ever pointed at an actual site with no bound on how long it runs.
const MONITOR_SET_AUTOSTOP_JOB_NAME = "xc-bank-monitor-set-autostop";
const MIN_AUTO_STOP_MINUTES = 1;
const MAX_AUTO_STOP_MINUTES = 240;
const MONITOR_INTERVAL_MS = Number(process.env.XC_BANK_MONITOR_INTERVAL_MS ?? 20_000);

// SCB Business Anywhere lane monitor -- same queue-serialization and
// auto-stop reasoning as the XC Bank monitor above, kept as entirely
// separate job types/scheduler id (not shared) since it drives a
// genuinely different browser (worker-scb-business-anywhere-1, see
// exec.ts's runScbCheckBalance). Real-money, real-bank site -- the
// same "no unattended loop without a bound" caution applies at least
// as strongly as it did for XC Bank.
//
// Interval shortened from an original 5min/±15s to this, per explicit
// request, for faster (~1-2 min) transaction detection -- deliberately
// randomized per-tick, not a fixed cadence, specifically so the gap
// between real requests to the bank varies every time (70-105s) rather
// than reading as a perfectly regular bot pattern. Still an inherent
// tradeoff being made knowingly, not a solved problem: jitter defeats
// a naive "requests every exactly N seconds" check, it does not make
// this look like a human (a human doesn't refresh a balance page
// continuously 24/7 either). If this account is ever flagged/rate
// limited, this interval is the first thing to widen back out.
const SCB_MONITOR_SCHEDULER_ID = "monitor:scb-business-anywhere-1";
const SCB_MONITOR_SET_PAUSED_JOB_NAME = "scb-business-anywhere-1-monitor-set-paused";
const SCB_MONITOR_SET_AUTOSTOP_JOB_NAME = "scb-business-anywhere-1-monitor-set-autostop";
// every: 87_500ms with jitter: 17_500ms => sleep(0..17_500) before each
// tick's actual check, so consecutive real requests land 70_000-105_000ms
// apart (87_500 - 17_500 to 87_500 + 17_500) -- i.e. roughly 1:10-1:45.
const SCB_MONITOR_INTERVAL_MS = Number(process.env.SCB_MONITOR_INTERVAL_MS ?? 87_500);
const AUTH_BRIDGE_BASE_URL = process.env.AUTH_BRIDGE_BASE_URL ?? "http://127.0.0.1:4300";
const AUTH_BRIDGE_LANE_ID = "scb-business-anywhere-1";
const AUTH_BRIDGE_SITE_ID = "scb-business-anywhere";
const AUTH_BRIDGE_CDP_URL = process.env.AUTH_BRIDGE_CDP_URL ?? "http://localhost:9222";
const AUTH_BRIDGE_MOCK_CREDENTIAL_REF = "scb.mock.demo";
const AUTH_BRIDGE_STATE_JOB_NAME = "auth-bridge-state";
const AUTH_BRIDGE_LOGIN_MOCK_JOB_NAME = "auth-bridge-login-mock";
const SCB_MONITOR_JITTER_MS = Number(process.env.SCB_MONITOR_JITTER_MS ?? 17_500);
// Telegram-triggered commands (see telegram-commands.ts) -- routed
// through this same queue (not run directly from the polling loop) so
// they can never run concurrently with a scheduled check on the
// shared SCB lane browser. Both strictly read-only: screenshot reuses
// analyze-page.ts (no navigation, no company switching, no clicking),
// status only reads already-saved state. Never expand this pair to
// anything that types/clicks/navigates from arbitrary Telegram text.
const SCB_TELEGRAM_SCREENSHOT_JOB_NAME = "scb-business-anywhere-1-telegram-screenshot";
const SCB_TELEGRAM_STATUS_JOB_NAME = "scb-business-anywhere-1-telegram-status";
// Record → analyze → run -- lane-parameterized (see lanes.ts/exec.ts/
// replay-engine.ts). Originally SCB-only, generalized to work against
// any lane (see docs/PROJECT_PLAN.md decision log). Long-running by
// design (resolves only once a human clicks Stop or the recorder's
// own 15-min max elapses) -- occupying this queue's one concurrency
// slot for the whole session is intentional, not a bug: nothing else
// should touch that lane's browser while a human is actively
// recording against it.
const RECORDING_JOB_NAME = "recording";
// Replaying a saved script -- runs segment by segment with a live
// Telegram confirm gate on any risky-keyword step (replay-engine.ts).
// Also the job type a per-recording BullMQ schedule fires, tagged via
// data.scheduled the same way SCB_MONITOR_JOB_NAME distinguishes a
// scheduled tick from a manual run-now.
const RUN_RECORDING_JOB_NAME = "run-recording";
// One BullMQ Job Scheduler id per (lane, saved recording name) pair,
// so each script can have its own independent on/off schedule and two
// different lanes can reuse the same script name without colliding.
function recordingSchedulerId(laneId: string, name: string): string {
  return `recording-schedule:${laneId}:${name}`;
}
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
      if (job.name === MONITOR_SET_AUTOSTOP_JOB_NAME) {
        const data = (job.data ?? {}) as { autoStopAt?: string | null; autoStopMinutes?: number | null };
        await setAutoStopConfig({
          autoStopAt: data.autoStopAt ?? null,
          autoStopped: false,
          autoStopMinutes: data.autoStopMinutes ?? null,
        });
        return {
          ok: true,
          stdout: data.autoStopAt ? `Auto-stop set for ${data.autoStopAt}` : "Auto-stop cleared (unlimited run)",
          stderr: "",
          steps: [],
        };
      }
      if (job.name === MONITOR_JOB_NAME) {
        const isScheduledTick = job.data?.scheduled === true;
        if (isScheduledTick) {
          await sleep(Math.random() * MONITOR_JITTER_MS);
          // Manual "Check once" always runs regardless of paused/auto-stop
          // -- both only gate the automatic scheduled loop, matching the
          // "manual is always instant/authoritative" precedent from the
          // jitter work above. One loadState() covers both gates.
          const { autoStopAt, autoStopMinutes, paused } = await loadState();
          if (autoStopAt && Date.now() >= Date.parse(autoStopAt)) {
            // Remove the scheduler itself (safe to call from within one
            // of its own jobs -- this job still completes normally, just
            // no future ticks get scheduled) and record why, directly
            // (not re-queued -- already inside the serialized job, same
            // reasoning checkOnce() itself uses for its own
            // read-modify-write).
            await stopMonitorSchedule();
            await setAutoStopConfig({ autoStopAt: null, autoStopped: true, autoStopMinutes });
            await sendTelegramMessage(`⏱ XC Bank Monitor auto-stopped after ${autoStopMinutes ?? "?"} minute(s)`);
            return {
              ok: true,
              stdout: `Monitor auto-stopped after ${autoStopMinutes ?? "?"} minute(s)`,
              stderr: "",
              steps: [],
            };
          }
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
      if (job.name === SCB_MONITOR_SET_PAUSED_JOB_NAME) {
        const paused = job.data?.paused === true;
        await scbSetPaused(paused);
        return { ok: true, stdout: paused ? "SCB monitor paused" : "SCB monitor resumed", stderr: "", steps: [] };
      }
      if (job.name === SCB_MONITOR_SET_AUTOSTOP_JOB_NAME) {
        const data = (job.data ?? {}) as { autoStopAt?: string | null; autoStopMinutes?: number | null };
        await scbSetAutoStopConfig({
          autoStopAt: data.autoStopAt ?? null,
          autoStopped: false,
          autoStopMinutes: data.autoStopMinutes ?? null,
        });
        return {
          ok: true,
          stdout: data.autoStopAt ? `SCB monitor auto-stop set for ${data.autoStopAt}` : "SCB monitor auto-stop cleared (unlimited run)",
          stderr: "",
          steps: [],
        };
      }
      if (job.name === SCB_MONITOR_JOB_NAME) {
        const isScheduledTick = job.data?.scheduled === true;
        if (isScheduledTick) {
          await sleep(Math.random() * SCB_MONITOR_JITTER_MS);
          const { autoStopAt, autoStopMinutes, paused } = await scbLoadState();
          if (autoStopAt && Date.now() >= Date.parse(autoStopAt)) {
            await stopScbMonitorSchedule();
            await scbSetAutoStopConfig({ autoStopAt: null, autoStopped: true, autoStopMinutes });
            await sendTelegramMessage(`⏱ SCB Business Anywhere monitor auto-stopped after ${autoStopMinutes ?? "?"} minute(s)`);
            return {
              ok: true,
              stdout: `SCB monitor auto-stopped after ${autoStopMinutes ?? "?"} minute(s)`,
              stderr: "",
              steps: [],
            };
          }
          if (paused) {
            return { ok: true, stdout: "SCB monitor paused — scheduled check skipped", stderr: "", steps: [] };
          }
        }
        const state = await scbCheckOnce();
        return {
          ok: state.lastError === null,
          stdout: state.lastError ? "" : `SCB balance check ok — last checked ${state.lastCheckedAt}`,
          stderr: state.lastError ?? "",
          steps: [],
        };
      }
      if (job.name === AUTH_BRIDGE_STATE_JOB_NAME) {
        return callAuthBridge("/auth/state", {
          laneId: AUTH_BRIDGE_LANE_ID,
          cdpUrl: AUTH_BRIDGE_CDP_URL,
          siteId: AUTH_BRIDGE_SITE_ID,
        });
      }
      if (job.name === AUTH_BRIDGE_LOGIN_MOCK_JOB_NAME) {
        return callAuthBridgeLoginMock();
      }
      if (job.name === SCB_TELEGRAM_SCREENSHOT_JOB_NAME) {
        const result = await runScbAnalyzePage();
        const analysis = parseLanePageAnalysis(result.stdout);
        if (analysis) {
          const screenshotPath = path.join(
            REPO_ROOT,
            "data",
            "lanes",
            "scb-business-anywhere-1",
            "output",
            analysis.screenshot,
          );
          await sendTelegramPhoto(screenshotPath, `📸 ${analysis.title}\n${analysis.url}`);
        }
        return {
          ok: result.ok && !!analysis,
          stdout: analysis ? "Screenshot sent to Telegram" : "Could not capture/send screenshot",
          stderr: result.ok ? "" : (result.error ?? result.stderr),
          steps: [],
        };
      }
      if (job.name === SCB_TELEGRAM_STATUS_JOB_NAME) {
        const state = await scbLoadState();
        const lines = [
          `🏦 SCB Business Anywhere status`,
          `Last checked: ${state.lastCheckedAt ?? "never"}`,
          state.lastError ? `Last error: ${state.lastError.slice(0, 300)}` : null,
          `Available: ${state.availableBalance ?? "?"} THB | Ledger: ${state.ledgerBalance ?? "?"} THB`,
          state.latestTransactions.length > 0
            ? `Latest transactions:\n${state.latestTransactions
                .map((t) => `  ${t.date} ${t.time} — ${t.description} — ${t.amount} THB`)
                .join("\n")}`
            : "No transactions on the current page.",
        ].filter((l): l is string => l !== null);
        await sendTelegramMessage(lines.join("\n"));
        return { ok: true, stdout: "Status sent to Telegram", stderr: "", steps: [] };
      }
      if (job.name === RECORDING_JOB_NAME) {
        const laneId = job.data?.laneId as string;
        const runId = job.data?.runId as string;
        const result = await runStartRecording(laneId, runId);
        const parsed = parseRecordingResult(result.stdout);
        return {
          ok: result.ok && !!parsed,
          stdout: result.stdout,
          stderr: result.ok ? "" : (result.error ?? result.stderr),
          steps: [],
        };
      }
      if (job.name === RUN_RECORDING_JOB_NAME) {
        const laneId = job.data?.laneId as string;
        const recordingName = job.data?.recordingName as string;
        const { ok, summary } = await runRecordingReplay(laneId, recordingName);
        return { ok, stdout: ok ? summary : "", stderr: ok ? "" : summary, steps: [] };
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

async function enqueueSetAutoStop(autoStopAt: string | null, autoStopMinutes: number | null): Promise<string> {
  const job = await queue.add(MONITOR_SET_AUTOSTOP_JOB_NAME, { autoStopAt, autoStopMinutes }, JOB_OPTS);
  return job.id ?? "";
}

export function validateAutoStopMinutes(value: unknown): { ok: true; minutes: number | undefined } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, minutes: undefined };
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return { ok: false, error: "autoStopMinutes must be an integer" };
  }
  if (value < MIN_AUTO_STOP_MINUTES || value > MAX_AUTO_STOP_MINUTES) {
    return { ok: false, error: `autoStopMinutes must be between ${MIN_AUTO_STOP_MINUTES} and ${MAX_AUTO_STOP_MINUTES}` };
  }
  return { ok: true, minutes: value };
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

// autoStopMinutes: undefined/omitted means unlimited -- every Start
// explicitly (re)configures autoStopAt one way or the other, so a
// previous run's limit (or auto-stopped flag) never silently carries
// over into a fresh unlimited run, and vice versa.
export async function startMonitorSchedule(autoStopMinutes?: number): Promise<void> {
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
  const autoStopAt =
    autoStopMinutes !== undefined ? new Date(Date.now() + autoStopMinutes * 60_000).toISOString() : null;
  await enqueueSetAutoStop(autoStopAt, autoStopMinutes ?? null);
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

export async function enqueueAuthBridgeState(): Promise<string> {
  const job = await queue.add(AUTH_BRIDGE_STATE_JOB_NAME, {}, { ...JOB_OPTS, attempts: 1 });
  return job.id ?? "";
}

export async function enqueueAuthBridgeLoginMock(): Promise<string> {
  const job = await queue.add(
    AUTH_BRIDGE_LOGIN_MOCK_JOB_NAME,
    { credentialRef: AUTH_BRIDGE_MOCK_CREDENTIAL_REF },
    { ...JOB_OPTS, attempts: 1 },
  );
  return job.id ?? "";
}

export async function checkAuthBridgeHealth(
  timeoutMs = 1500,
): Promise<{ ok: boolean; readyForLogin?: boolean; error?: string }> {
  try {
    const response = await fetch(`${AUTH_BRIDGE_BASE_URL}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    const data = (await response.json()) as { ok?: boolean; readyForLogin?: boolean };
    return { ok: response.ok && data.ok === true, readyForLogin: data.readyForLogin };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}


async function callAuthBridgeLoginMock(): Promise<ActionResult> {
  if (AUTH_BRIDGE_MOCK_CREDENTIAL_REF !== "scb.mock.demo") {
    return {
      ok: false,
      stdout: "",
      stderr: "Mock login refused: credentialRef is not scb.mock.demo",
      steps: [],
    };
  }

  const state = await callAuthBridge("/auth/state", {
    laneId: AUTH_BRIDGE_LANE_ID,
    cdpUrl: AUTH_BRIDGE_CDP_URL,
    siteId: AUTH_BRIDGE_SITE_ID,
  });
  const statePayload = parseAuthBridgeJson(state.stdout);
  if (!statePayload || !isScbMockUrl(statePayload.url)) {
    return {
      ok: false,
      stdout: JSON.stringify({
        ok: false,
        state: statePayload?.state ?? "refused",
        url: statePayload?.url,
        title: statePayload?.title,
        error: "mock_login_refused_not_scb_mock",
        message: "Mock login refused: current lane page is not scb-mock",
      }),
      stderr: state.stderr || "Mock login refused: current lane page is not scb-mock",
      steps: [],
    };
  }

  return callAuthBridge("/auth/login", {
    laneId: AUTH_BRIDGE_LANE_ID,
    cdpUrl: AUTH_BRIDGE_CDP_URL,
    siteId: AUTH_BRIDGE_SITE_ID,
    credentialRef: AUTH_BRIDGE_MOCK_CREDENTIAL_REF,
  });
}

function parseAuthBridgeJson(stdout: string): { state?: string; url?: string; title?: string } | null {
  try {
    const value = JSON.parse(stdout) as { state?: unknown; url?: unknown; title?: unknown };
    return {
      state: typeof value.state === "string" ? value.state : undefined,
      url: typeof value.url === "string" ? value.url : undefined,
      title: typeof value.title === "string" ? value.title : undefined,
    };
  } catch (_err) {
    return null;
  }
}

function isScbMockUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" && parsed.hostname === "scb-mock" && parsed.port === "3000";
  } catch (_err) {
    return false;
  }
}
async function callAuthBridge(pathname: "/auth/state" | "/auth/login", body: Record<string, string>): Promise<ActionResult> {
  try {
    const response = await fetch(`${AUTH_BRIDGE_BASE_URL}${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json();
    return {
      ok: response.ok && data?.error === undefined && data?.state !== "failed",
      stdout: JSON.stringify(data),
      stderr: response.ok ? "" : `AuthBridge ${pathname} failed with HTTP ${response.status}`,
      steps: [],
    };
  } catch (err) {
    return { ok: false, stdout: "", stderr: err instanceof Error ? err.message : String(err), steps: [] };
  }
}

// --- SCB Business Anywhere lane monitor -- mirrors everything above ---

async function enqueueScbSetPaused(paused: boolean): Promise<string> {
  const job = await queue.add(SCB_MONITOR_SET_PAUSED_JOB_NAME, { paused }, JOB_OPTS);
  return job.id ?? "";
}

export async function pauseScbMonitor(): Promise<string> {
  return enqueueScbSetPaused(true);
}
export async function resumeScbMonitor(): Promise<string> {
  return enqueueScbSetPaused(false);
}

async function enqueueScbSetAutoStop(autoStopAt: string | null, autoStopMinutes: number | null): Promise<string> {
  const job = await queue.add(SCB_MONITOR_SET_AUTOSTOP_JOB_NAME, { autoStopAt, autoStopMinutes }, JOB_OPTS);
  return job.id ?? "";
}

export async function enqueueScbMonitorCheckOnce(): Promise<string> {
  const job = await queue.add(SCB_MONITOR_JOB_NAME, {}, JOB_OPTS);
  return job.id ?? "";
}

// Called from telegram-commands.ts's incoming-message polling loop --
// routed through this same queue (not run directly) so a Telegram
// command can never execute concurrently with a scheduled check on
// the shared SCB lane browser.
export async function enqueueScbTelegramScreenshot(): Promise<string> {
  const job = await queue.add(SCB_TELEGRAM_SCREENSHOT_JOB_NAME, {}, JOB_OPTS);
  return job.id ?? "";
}

export async function enqueueScbTelegramStatus(): Promise<string> {
  const job = await queue.add(SCB_TELEGRAM_STATUS_JOB_NAME, {}, JOB_OPTS);
  return job.id ?? "";
}

export async function getScbMonitorScheduleInfo(): Promise<MonitorScheduleInfo> {
  const schedulers = await queue.getJobSchedulers();
  const scheduler = schedulers.find((s) => s.key === SCB_MONITOR_SCHEDULER_ID);
  return {
    running: scheduler !== undefined,
    next: scheduler?.next ?? null,
    every: scheduler?.every ?? SCB_MONITOR_INTERVAL_MS,
    jitterMs: SCB_MONITOR_JITTER_MS,
  };
}

export async function startScbMonitorSchedule(autoStopMinutes?: number): Promise<void> {
  await queue.upsertJobScheduler(
    SCB_MONITOR_SCHEDULER_ID,
    { every: SCB_MONITOR_INTERVAL_MS },
    { name: SCB_MONITOR_JOB_NAME, data: { scheduled: true } },
  );
  await enqueueScbSetPaused(false);
  const autoStopAt =
    autoStopMinutes !== undefined ? new Date(Date.now() + autoStopMinutes * 60_000).toISOString() : null;
  await enqueueScbSetAutoStop(autoStopAt, autoStopMinutes ?? null);
  await enqueueScbMonitorCheckOnce();
}

export async function stopScbMonitorSchedule(): Promise<void> {
  await queue.removeJobScheduler(SCB_MONITOR_SCHEDULER_ID);
}

// --- Record -> analyze -> run, any lane (see lanes.ts) ---

// Long-running (see the processor branch above); the caller (server.ts)
// does not await job completion synchronously -- it enqueues and
// returns the runId/jobId immediately so the UI can poll for status
// while the human interacts via noVNC. Stopping is NOT a queued job
// (see writeRecordingStopFlag's own comment in exec.ts for why) --
// server.ts's stop route writes the flag file directly.
export async function enqueueStartRecording(laneId: string, runId: string): Promise<string> {
  const job = await queue.add(RECORDING_JOB_NAME, { laneId, runId }, { ...JOB_OPTS, attempts: 1 });
  return job.id ?? "";
}

export async function enqueueRunRecording(laneId: string, recordingName: string, scheduled = false): Promise<string> {
  const job = await queue.add(RUN_RECORDING_JOB_NAME, { laneId, recordingName, scheduled }, { ...JOB_OPTS, attempts: 1 });
  return job.id ?? "";
}

export async function startRecordingSchedule(laneId: string, recordingName: string, everyMs: number): Promise<void> {
  await queue.upsertJobScheduler(
    recordingSchedulerId(laneId, recordingName),
    { every: everyMs },
    { name: RUN_RECORDING_JOB_NAME, data: { laneId, recordingName, scheduled: true } },
  );
}

export async function stopRecordingSchedule(laneId: string, recordingName: string): Promise<void> {
  await queue.removeJobScheduler(recordingSchedulerId(laneId, recordingName));
}

export async function getRecordingScheduleInfo(laneId: string, recordingName: string): Promise<{ running: boolean; next: number | null; every: number | null }> {
  const schedulers = await queue.getJobSchedulers();
  const scheduler = schedulers.find((s) => s.key === recordingSchedulerId(laneId, recordingName));
  return { running: scheduler !== undefined, next: scheduler?.next ?? null, every: scheduler?.every ?? null };
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
