import path from "node:path";
import { fileURLToPath } from "node:url";

// Computed independently (not imported from exec.ts) to avoid a
// circular import -- exec.ts imports getLane() from this file.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

// The single place record->analyze->run (and anything else lane-scoped
// in the future) looks up which docker compose worker service to run
// scripts through and where that lane's saved scripts/stop-flags live
// on the host. Adding a new lane later is one entry here -- nothing
// else in the recording pipeline needs to change, by design (see
// docs/PROJECT_PLAN.md's decision log on why this exists: the
// recorder was originally hard-wired to the SCB lane specifically,
// which the user explicitly rejected as not "universal").
export interface LaneConfig {
  // docker compose service name a recording session/replay segment
  // runs through, e.g. `docker compose run --rm <workerService> ...`
  workerService: string;
  // Host-side directory holding this lane's saved recordings, temp
  // segment files, stop-flag files, and replay-state.json.
  recordingsHostDir: string;
  // Where recordingsHostDir is bind-mounted inside that lane's own
  // worker container -- passed as WORKFLOWS_DIR/RECORDINGS_DIR.
  recordingsContainerDir: string;
  // The long-running browser container itself (distinct from
  // workerService above, which has no `command:` and only exists
  // transiently via `docker compose run --rm`). Chromium's CDP port
  // is opened *inside* this container, not workerService -- see
  // lane-health.ts for why health checks target this name.
  browserWorkerService: string;
  // Host-reachable noVNC URL for this lane's browser container.
  novncUrl: string;
}

export const LANES: Record<string, LaneConfig> = {
  // The shared testing browser (browser-worker-chrome + worker) --
  // already what XC Bank, the-internet, demo, and scb-mock all run
  // through. Recording against "shared" means recording against
  // whatever site is currently open in that browser -- no per-site
  // code needed.
  shared: {
    workerService: "worker",
    recordingsHostDir: path.join(REPO_ROOT, "data", "recordings", "shared"),
    recordingsContainerDir: "/app/recordings",
    browserWorkerService: "browser-worker-chrome",
    novncUrl: "http://127.0.0.1:6080/",
  },
  "scb-business-anywhere-1": {
    workerService: "worker-scb-business-anywhere-1",
    recordingsHostDir: path.join(REPO_ROOT, "data", "lanes", "scb-business-anywhere-1", "recordings"),
    recordingsContainerDir: "/app/recordings",
    browserWorkerService: "browser-worker-scb-business-anywhere-1",
    novncUrl: "http://127.0.0.1:6090/",
  },
};

export function getLane(laneId: string): LaneConfig | undefined {
  return LANES[laneId];
}

export function laneIds(): string[] {
  return Object.keys(LANES);
}
