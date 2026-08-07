import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT, parseXcBankDashboard, runXcBankMonitorCheck, type XcBankTransaction } from "./exec.js";
import { removeArtifact } from "./artifacts.js";

export const MONITOR_JOB_NAME = "xc-bank-monitor-check";

const STATE_PATH = path.join(REPO_ROOT, "data", "monitor-state", "xc-bank.json");
const WORKER_OUTPUT_DIR = path.join(REPO_ROOT, "data", "worker-output");

// Dev-only limits -- a JSON file, not a database, so these bound how
// large it can grow over a long-running dev session. Screenshots: exactly
// what the user asked for (200 most recent). seenRefs/notifications: not
// explicitly requested, but XC Bank's own transaction ref space keeps
// growing over time, so an unbounded list would eventually bloat the
// state file for no benefit -- capped generously above what a dev
// session would realistically need to look back through.
const MAX_SCREENSHOTS = 200;
const MAX_SEEN_REFS = 500;
const MAX_NOTIFICATIONS = 500;

export interface NotificationEntry {
  id: string;
  direction: string;
  amount: number;
  counterparty: string;
  balanceAfter: number;
  timestamp: string;
  notifiedAt: string;
}

export interface ScreenshotEntry {
  filename: string;
  capturedAt: string;
}

export interface MonitorState {
  lastCheckedAt: string | null;
  lastError: string | null;
  latestBalance: number | null;
  latestTransactions: XcBankTransaction[];
  seenRefs: string[];
  notifications: NotificationEntry[];
  screenshots: ScreenshotEntry[];
  // Skips the actual check on a *scheduled* tick (manual "Check once"
  // ignores this) while leaving the BullMQ scheduler itself running --
  // lighter than stop, which removes the scheduler entirely. See
  // queue.ts and docs/PROJECT_PLAN.md decision log.
  paused: boolean;
  // Auto-stop: a safety limit for unattended runs, requested after a
  // real ~38h unattended run crashed Chromium -- a real ban risk if
  // this were ever pointed at an actual site. Checked by the scheduled
  // tick the same way `paused` is; a manual "Check once" always ignores
  // it. autoStopAt is cleared (null) once it fires or a fresh Start is
  // issued; autoStopMinutes is remembered afterward purely so the UI
  // can say "Auto-stopped after N minutes".
  autoStopAt: string | null;
  autoStopped: boolean;
  autoStopMinutes: number | null;
}

function emptyState(): MonitorState {
  return {
    lastCheckedAt: null,
    lastError: null,
    latestBalance: null,
    latestTransactions: [],
    seenRefs: [],
    notifications: [],
    screenshots: [],
    paused: false,
    autoStopAt: null,
    autoStopped: false,
    autoStopMinutes: null,
  };
}

export async function loadState(): Promise<MonitorState> {
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    return { ...emptyState(), ...(JSON.parse(raw) as Partial<MonitorState>) };
  } catch {
    return emptyState();
  }
}

async function saveState(state: MonitorState): Promise<void> {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

// Best-effort: retention must never fail the check itself just because a
// local file or a MinIO object was already gone/unreachable.
async function deleteScreenshot(filename: string): Promise<void> {
  await unlink(path.join(WORKER_OUTPUT_DIR, filename)).catch((err) => {
    console.error(`XC Bank monitor: failed to delete local screenshot ${filename}:`, (err as Error).message);
  });
  await removeArtifact(`screenshots/${filename}`).catch((err) => {
    console.error(`XC Bank monitor: failed to delete MinIO screenshot ${filename}:`, (err as Error).message);
  });
}

function uniqueScreenshotFilename(): string {
  return `xc-bank-monitor-${Date.now()}.png`;
}

// The one real check: run the real workflow (real browser, real DOM
// extraction, session-aware login -- all reused unchanged from the
// existing XC Bank adapter/actions), dedupe against what's already been
// seen, and persist. Never throws -- every failure mode is captured into
// state.lastError so a scheduled tick that fails doesn't crash the
// worker process or lose prior state.
export async function checkOnce(): Promise<MonitorState> {
  const state = await loadState();
  const now = new Date().toISOString();
  const screenshotFilename = uniqueScreenshotFilename();

  const result = await runXcBankMonitorCheck(screenshotFilename).catch((err: Error) => {
    return { ok: false, stdout: "", stderr: "", error: err.message, steps: [] };
  });

  if (!result.ok) {
    state.lastError = result.error ?? result.stderr ?? "XC Bank monitor check failed";
    state.lastCheckedAt = now;
    await saveState(state);
    return state;
  }

  const dashboard = parseXcBankDashboard(result.stdout);
  if (!dashboard) {
    state.lastError = "Could not parse XC Bank dashboard data from the worker's output";
    state.lastCheckedAt = now;
    await saveState(state);
    return state;
  }

  // Dedup by XC Bank's own transaction reference/id -- new ones only,
  // oldest-first so notifications are emitted in chronological order,
  // never skipped even if several arrived in one check.
  const seen = new Set(state.seenRefs);
  const newTransactions = dashboard.transactions
    .filter((t) => !seen.has(t.id))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  for (const t of newTransactions) {
    state.seenRefs.push(t.id);
    state.notifications.unshift({
      id: t.id,
      direction: t.direction,
      amount: t.amount,
      counterparty: t.counterparty,
      balanceAfter: t.balanceAfter,
      timestamp: t.timestamp,
      notifiedAt: now,
    });
  }
  if (state.seenRefs.length > MAX_SEEN_REFS) {
    state.seenRefs.splice(0, state.seenRefs.length - MAX_SEEN_REFS);
  }
  if (state.notifications.length > MAX_NOTIFICATIONS) {
    state.notifications.length = MAX_NOTIFICATIONS;
  }

  // Latest-state fields always refresh, independent of whether anything
  // new was found -- the transaction table reflects current state, not
  // a deduped view.
  state.latestBalance = dashboard.balance;
  state.latestTransactions = dashboard.transactions;
  state.lastCheckedAt = now;
  state.lastError = null;

  state.screenshots.unshift({ filename: screenshotFilename, capturedAt: now });
  if (state.screenshots.length > MAX_SCREENSHOTS) {
    const overflow = state.screenshots.splice(MAX_SCREENSHOTS);
    await Promise.all(overflow.map((s) => deleteScreenshot(s.filename)));
  }

  await saveState(state);
  return state;
}

export async function setPaused(paused: boolean): Promise<MonitorState> {
  const state = await loadState();
  state.paused = paused;
  await saveState(state);
  return state;
}

export interface AutoStopConfig {
  autoStopAt: string | null;
  autoStopped: boolean;
  autoStopMinutes: number | null;
}

export async function setAutoStopConfig(patch: AutoStopConfig): Promise<MonitorState> {
  const state = await loadState();
  state.autoStopAt = patch.autoStopAt;
  state.autoStopped = patch.autoStopped;
  state.autoStopMinutes = patch.autoStopMinutes;
  await saveState(state);
  return state;
}

// Dev-only "cleanup" action -- wipes every tracked screenshot (local +
// MinIO, best-effort, same deleteScreenshot() used by normal 200-item
// retention pruning) and resets state back to empty. Does not touch XC
// Bank's own site data (a different, isolated system) -- only this
// monitor's own tracking. Routed through the queue by the caller (not
// called directly here) so it can't race an in-flight checkOnce()'s
// file writes.
export async function resetState(): Promise<void> {
  const state = await loadState();
  await Promise.all(state.screenshots.map((s) => deleteScreenshot(s.filename)));
  await saveState(emptyState());
}

// Exposed for the retention verification test -- lets a test seed state
// directly without needing 200+ real browser-driven checks.
export { saveState as _saveStateForTest };
