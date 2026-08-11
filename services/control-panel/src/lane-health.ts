import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getLane, laneIds, type LaneConfig } from "./lanes.js";
import { composePs, parseComposePs, EXEC_OPTS } from "./exec.js";

const execFileAsync = promisify(execFile);

// Closes a real, previously-proven blind spot (see
// docs/BOT_LANE_ISOLATION.md): `docker compose ps`/container-"Up" status
// stayed green through three real Chromium crashes found during the
// monitor-stability work that motivated that doc. This module adds the
// one signal that actually catches it -- a live CDP reachability check --
// without publishing CDP anywhere (it stays loopback-only inside each
// lane's own container, reached via `docker compose exec` the same way
// Playwright's own connectOverCDP/waitForCdp reach it from inside the
// worker container).
export interface LaneHealth {
  laneId: string;
  containerRunning: boolean;
  // null when containerRunning is false -- not checked, not "checked and failed".
  cdpReachable: boolean | null;
  browserTargetCount: number | null;
  novncReachable: boolean | null;
  status: "healthy" | "degraded" | "unhealthy" | "stopped";
  crashCount: number;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
}

interface LaneHealthState {
  lastCdpReachable: boolean | null;
  crashCount: number;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
}

// In-memory only, dev-only -- resets on control-panel restart, same
// posture as this project's other dev-only state (e.g. monitor.ts's
// in-process fields). No persisted history file; see decision log for
// why (not asked for, would need a real hook into job outcomes to be
// worth the extra file).
const laneHealthState = new Map<string, LaneHealthState>();

function getState(laneId: string): LaneHealthState {
  let state = laneHealthState.get(laneId);
  if (!state) {
    state = { lastCdpReachable: null, crashCount: 0, lastFailureAt: null, lastFailureReason: null };
    laneHealthState.set(laneId, state);
  }
  return state;
}

const FETCH_TIMEOUT_MS = 2000;

// Duplicated from health.ts's own urlReachable() rather than imported --
// health.ts imports from this module for the /health page's lane rows,
// so importing the other direction would create a cycle.
async function urlReachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

// curl is installed in the browser-worker image (services/browser-worker/
// Dockerfile). Targets browserWorkerService (the long-running container
// Chromium's own --remote-debugging-port actually opens inside), not
// workerService (which has no `command:` and only exists transiently via
// `docker compose run --rm`) -- see lanes.ts's LaneConfig comment.
async function execInLane(browserWorkerService: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["compose", "exec", "-T", browserWorkerService, "curl", "-sf", "--max-time", "2", ...args],
      EXEC_OPTS,
    );
    return stdout;
  } catch {
    return null;
  }
}

async function checkLaneCdp(browserWorkerService: string): Promise<{ reachable: boolean; targetCount: number | null }> {
  const version = await execInLane(browserWorkerService, ["http://localhost:9222/json/version"]);
  if (version === null) return { reachable: false, targetCount: null };
  const list = await execInLane(browserWorkerService, ["http://localhost:9222/json/list"]);
  if (list === null) return { reachable: true, targetCount: null };
  try {
    const parsed = JSON.parse(list);
    return { reachable: true, targetCount: Array.isArray(parsed) ? parsed.length : null };
  } catch {
    return { reachable: true, targetCount: null };
  }
}

async function isContainerRunning(browserWorkerService: string): Promise<boolean> {
  const stdout = await composePs();
  const entries = parseComposePs(stdout);
  return entries.some((e) => e.Service === browserWorkerService && e.State === "running");
}

function deriveStatus(
  containerRunning: boolean,
  cdpReachable: boolean | null,
  browserTargetCount: number | null,
  novncReachable: boolean | null,
): LaneHealth["status"] {
  if (!containerRunning) return "stopped";
  if (!cdpReachable) return "unhealthy";
  if (browserTargetCount !== 1 || novncReachable === false) return "degraded";
  return "healthy";
}

export async function getLaneHealth(laneId: string): Promise<LaneHealth> {
  const lane: LaneConfig | undefined = getLane(laneId);
  if (!lane) {
    return {
      laneId,
      containerRunning: false,
      cdpReachable: null,
      browserTargetCount: null,
      novncReachable: null,
      status: "stopped",
      crashCount: 0,
      lastFailureAt: null,
      lastFailureReason: null,
    };
  }

  const state = getState(laneId);
  const containerRunning = await isContainerRunning(lane.browserWorkerService);

  if (!containerRunning) {
    // A deliberate stop isn't a crash -- don't touch the counter, but do
    // reset lastCdpReachable so a later true->false transition (e.g. it
    // comes back up healthy, then dies) is still detected correctly.
    state.lastCdpReachable = null;
    return {
      laneId,
      containerRunning: false,
      cdpReachable: null,
      browserTargetCount: null,
      novncReachable: null,
      status: "stopped",
      crashCount: state.crashCount,
      lastFailureAt: state.lastFailureAt,
      lastFailureReason: state.lastFailureReason,
    };
  }

  const [{ reachable: cdpReachable, targetCount: browserTargetCount }, novncReachable] = await Promise.all([
    checkLaneCdp(lane.browserWorkerService),
    urlReachable(lane.novncUrl),
  ]);

  if (state.lastCdpReachable === true && cdpReachable === false) {
    state.crashCount += 1;
    state.lastFailureAt = new Date().toISOString();
    state.lastFailureReason = "CDP unreachable while container still running (browser process likely dead)";
  }
  state.lastCdpReachable = cdpReachable;

  const status = deriveStatus(containerRunning, cdpReachable, browserTargetCount, novncReachable);

  return {
    laneId,
    containerRunning,
    cdpReachable,
    browserTargetCount,
    novncReachable,
    status,
    crashCount: state.crashCount,
    lastFailureAt: state.lastFailureAt,
    lastFailureReason: state.lastFailureReason,
  };
}

export async function getAllLaneHealth(): Promise<LaneHealth[]> {
  return Promise.all(laneIds().map((id) => getLaneHealth(id)));
}
