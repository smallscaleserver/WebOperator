import { loadState as loadXcBankState } from "./monitor.js";
import {
  getMonitorScheduleInfo,
  pauseMonitor as pauseXcBankMonitor,
  stopMonitorSchedule as stopXcBankMonitor,
} from "./queue.js";

// Data-driven listing layer for the "/" Control Center's Monitors
// section -- a thin registry, not a full generic check-engine
// abstraction. Only XC Bank exists today; adding a second monitor later
// means writing its own state module + getSummary()/pause()/stop()
// functions and one more entry here. "/", app.js, and GET /api/monitors
// never need to change again -- they already render whatever's in this
// list. Start/Stop/Check-once for a listed monitor follow the
// convention /api/monitors/<id>/start|stop|check-once, the same shape
// the XC Bank detail page's own routes (services/control-panel/src/
// server.ts) already use -- not re-declared here since every monitor's
// own routes naturally follow it.
export interface MonitorSummary {
  id: string;
  name: string;
  detailPath: string;
  livePath: string;
  running: boolean;
  paused: boolean;
  intervalMs: number;
  jitterMs: number;
  nextCheckEstimate: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  summary: string | null;
  longRunningWarning: string | null;
  autoStopAt: string | null;
  autoStopped: boolean;
  autoStopMinutes: number | null;
}

interface MonitorDefinition {
  id: string;
  name: string;
  detailPath: string;
  livePath: string;
  getSummary: () => Promise<MonitorSummary>;
  // Return values (e.g. a jobId) are intentionally discarded by the bulk
  // actions below -- they don't need to report per-monitor job ids back.
  pause: () => Promise<unknown>;
  stop: () => Promise<unknown>;
}

// Screenshot count nearing the 200-item retention cap, or the oldest
// tracked screenshot being old enough, both suggest "this has been
// running a while, worth a look" -- purely derived from existing state,
// no new tracking needed.
const NEAR_CAP_THRESHOLD = 180;
const LONG_RUNNING_HOURS = 3;

function computeLongRunningWarning(screenshots: { capturedAt: string }[]): string | null {
  if (screenshots.length === 0) return null;
  const oldest = screenshots[screenshots.length - 1];
  const ageHours = (Date.now() - Date.parse(oldest.capturedAt)) / 3_600_000;
  const nearCap = screenshots.length >= NEAR_CAP_THRESHOLD;
  const longRunning = ageHours >= LONG_RUNNING_HOURS;
  if (!nearCap && !longRunning) return null;
  return `Running a while: ${screenshots.length}/200 screenshots tracked, oldest from ${ageHours.toFixed(1)}h ago`;
}

async function getXcBankSummary(): Promise<MonitorSummary> {
  const [state, schedule] = await Promise.all([loadXcBankState(), getMonitorScheduleInfo()]);
  return {
    id: "xc-bank",
    name: "XC Bank",
    detailPath: "/monitors/xc-bank",
    livePath: "/monitors/xc-bank/live",
    running: schedule.running,
    paused: state.paused,
    intervalMs: schedule.every,
    jitterMs: schedule.jitterMs,
    nextCheckEstimate: schedule.next !== null ? new Date(schedule.next).toISOString() : null,
    lastCheckedAt: state.lastCheckedAt,
    lastError: state.lastError,
    summary: state.latestBalance !== null ? `Balance: $${state.latestBalance.toFixed(2)}` : null,
    longRunningWarning: computeLongRunningWarning(state.screenshots),
    autoStopAt: state.autoStopAt,
    autoStopped: state.autoStopped,
    autoStopMinutes: state.autoStopMinutes,
  };
}

const MONITORS: MonitorDefinition[] = [
  {
    id: "xc-bank",
    name: "XC Bank",
    detailPath: "/monitors/xc-bank",
    livePath: "/monitors/xc-bank/live",
    getSummary: getXcBankSummary,
    pause: pauseXcBankMonitor,
    stop: stopXcBankMonitor,
  },
];

// Each monitor's summary is fetched independently -- one monitor's
// failure (e.g. its own dependency unavailable) surfaces as a readable
// per-entry error, not a 500 for the whole list.
export async function listMonitorSummaries(): Promise<MonitorSummary[]> {
  return Promise.all(
    MONITORS.map((m) =>
      m.getSummary().catch(
        (err): MonitorSummary => ({
          id: m.id,
          name: m.name,
          detailPath: m.detailPath,
          livePath: m.livePath,
          running: false,
          paused: false,
          intervalMs: 0,
          jitterMs: 0,
          nextCheckEstimate: null,
          lastCheckedAt: null,
          lastError: (err as Error).message,
          summary: null,
          longRunningWarning: null,
          autoStopAt: null,
          autoStopped: false,
          autoStopMinutes: null,
        }),
      ),
    ),
  );
}

// Bulk actions for the Control Center's "Pause all"/"Stop all" buttons.
// Promise.allSettled so one monitor's failure doesn't block the others
// -- same per-entry-independent posture as listMonitorSummaries above.
export async function pauseAllMonitors(): Promise<void> {
  await Promise.allSettled(MONITORS.map((m) => m.pause()));
}

export async function stopAllMonitors(): Promise<void> {
  await Promise.allSettled(MONITORS.map((m) => m.stop()));
}
