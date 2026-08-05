import { loadState as loadXcBankState } from "./monitor.js";
import { isMonitorScheduled as isXcBankMonitorScheduled } from "./queue.js";

// Data-driven listing layer for the "/" Control Center's Monitors
// section -- a thin registry, not a full generic check-engine
// abstraction. Only XC Bank exists today; adding a second monitor later
// means writing its own state module + getSummary() function and one
// more entry here. "/", app.js, and GET /api/monitors never need to
// change again -- they already render whatever's in this list. Start/
// Stop/Check-once for a listed monitor follow the convention
// /api/monitors/<id>/start|stop|check-once, the same shape the XC Bank
// detail page's own routes (services/control-panel/src/server.ts)
// already use -- not re-declared here since every monitor's own routes
// naturally follow it.
export interface MonitorSummary {
  id: string;
  name: string;
  detailPath: string;
  livePath: string;
  running: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  summary: string | null;
}

interface MonitorDefinition {
  id: string;
  name: string;
  detailPath: string;
  livePath: string;
  getSummary: () => Promise<MonitorSummary>;
}

async function getXcBankSummary(): Promise<MonitorSummary> {
  const [state, running] = await Promise.all([loadXcBankState(), isXcBankMonitorScheduled()]);
  return {
    id: "xc-bank",
    name: "XC Bank",
    detailPath: "/monitors/xc-bank",
    livePath: "/monitors/xc-bank/live",
    running,
    lastCheckedAt: state.lastCheckedAt,
    lastError: state.lastError,
    summary: state.latestBalance !== null ? `Balance: $${state.latestBalance.toFixed(2)}` : null,
  };
}

const MONITORS: MonitorDefinition[] = [
  {
    id: "xc-bank",
    name: "XC Bank",
    detailPath: "/monitors/xc-bank",
    livePath: "/monitors/xc-bank/live",
    getSummary: getXcBankSummary,
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
          lastCheckedAt: null,
          lastError: (err as Error).message,
          summary: null,
        }),
      ),
    ),
  );
}
