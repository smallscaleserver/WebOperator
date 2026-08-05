import { composePs, parseComposePs } from "./exec.js";
import { checkQueueWorkerHealth, checkRedisHealth } from "./queue.js";
import { checkMinioHealth } from "./artifacts.js";

export interface HealthCheck {
  id: string;
  label: string;
  status: "ok" | "warn" | "error";
  message: string;
  // A shell command the user can run themselves -- shown as plain text
  // only. This module never executes anything; see docs/PROJECT_PLAN.md
  // decision log for why (explicit instruction: no silent auto-start).
  hint?: string;
}

const XC_BANK_URL = "http://127.0.0.1:4100/login";
const NOVNC_URL = "http://127.0.0.1:6080/";
const FETCH_TIMEOUT_MS = 2000;

async function urlReachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

// Each check is independently try/caught so one failing dependency
// (e.g. Docker not running at all) can't blank the rest of the page --
// same posture as monitors-registry.ts's listMonitorSummaries.
async function safeCheck(id: string, label: string, hint: string, fn: () => Promise<boolean>): Promise<HealthCheck> {
  try {
    const ok = await fn();
    return ok
      ? { id, label, status: "ok", message: "OK" }
      : { id, label, status: "error", message: "Not reachable", hint };
  } catch (err) {
    // A connection-refused failure through the minio client (and some
    // Node fetch paths) surfaces as an AggregateError with an **empty**
    // .message -- the real detail is in .code (e.g. "ECONNREFUSED").
    // Same fix already applied to the artifact route in server.ts;
    // confirmed here directly against a real stopped MinIO container
    // rather than assumed to still apply.
    const error = err as Error & { code?: string };
    const message = error.message || error.code || String(error);
    return { id, label, status: "error", message, hint };
  }
}

async function dockerServiceChecks(): Promise<HealthCheck[]> {
  const services = [
    { id: "docker-redis", label: "Docker: redis", service: "redis" },
    { id: "docker-minio", label: "Docker: minio", service: "minio" },
    { id: "docker-xc-bank", label: "Docker: xc-bank", service: "xc-bank" },
    { id: "docker-chrome", label: "Docker: browser-worker-chrome", service: "browser-worker-chrome" },
  ];
  try {
    const stdout = await composePs();
    const entries = parseComposePs(stdout);
    return services.map(({ id, label, service }) => {
      const entry = entries.find((e) => e.Service === service);
      const running = entry?.State === "running";
      return running
        ? { id, label, status: "ok" as const, message: "running" }
        : {
            id,
            label,
            status: "error" as const,
            message: entry ? `state: ${entry.State}` : "not found",
            hint: `docker compose up -d ${service}`,
          };
    });
  } catch (err) {
    // docker compose ps itself failed (e.g. Docker Desktop not running) --
    // every service check reports the same underlying cause.
    const message = (err as Error).message || String(err);
    return services.map(({ id, label }) => ({
      id,
      label,
      status: "error" as const,
      message,
      hint: "Open Docker Desktop, then docker compose up -d",
    }));
  }
}

export async function runHealthChecks(): Promise<HealthCheck[]> {
  const [dockerChecks, queueWorker, redis, minio, xcBank, novnc] = await Promise.all([
    dockerServiceChecks(),
    safeCheck("queue-worker", "Queue worker", "cd services/control-panel && npm run worker", checkQueueWorkerHealth),
    safeCheck("redis", "Redis (app-level)", "docker compose up -d redis", () => checkRedisHealth()),
    safeCheck(
      "minio",
      "MinIO connectivity",
      "docker compose up -d minio",
      () => checkMinioHealth().then(() => true),
    ),
    safeCheck("xc-bank", "XC Bank URL (127.0.0.1:4100)", "docker compose up -d xc-bank", () =>
      urlReachable(XC_BANK_URL),
    ),
    safeCheck("novnc", "noVNC/Chrome (127.0.0.1:6080)", "docker compose up -d browser-worker-chrome", () =>
      urlReachable(NOVNC_URL),
    ),
  ]);

  const minioAnnotated: HealthCheck =
    minio.status === "error"
      ? { ...minio, message: `${minio.message} — artifact archival will error, but the main job can still run` }
      : minio;

  return [
    // Trivially ok: if this code is executing, the API process that owns
    // it is alive. Included for completeness per the explicit ask, not
    // because it can meaningfully report anything else from inside itself.
    { id: "api", label: "Control Panel API", status: "ok", message: "OK (this process is running)" },
    ...dockerChecks,
    queueWorker,
    redis,
    minioAnnotated,
    xcBank,
    novnc,
  ];
}
