export interface StepEvent {
  name: string;
  status: "ok" | "error";
  detail?: string;
  screenshot?: string; // filename only, relative to OUTPUT_DIR
  data?: unknown; // the step function's return value, when opts.captureResult is set
  attempt?: number; // only present when attempts > 1 was configured
  attempts?: number;
  at: string;
}

export interface RetryOptions {
  attempts: number;
  delayMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Prefixed so a step line is trivially greppable out of otherwise mixed
// stdout (tsx/npm print other lines too) without needing the whole stream
// to be structured. Exactly one WEBOP_STEP line is emitted per logical
// step, not per attempt -- intermediate failed attempts are retried
// silently; only the final outcome (which attempt it resolved on, or that
// all attempts were exhausted) is reported.
async function stepInternal<T>(
  name: string,
  fn: () => Promise<T>,
  retry: RetryOptions,
  opts?: { screenshot?: string; captureResult?: boolean },
): Promise<T> {
  // Attempt info is only genuinely informative when a retry actually
  // happened (succeeded after attempt 1) or all attempts were exhausted on
  // failure -- a clean first-try success stays exactly as quiet as before,
  // even for a step configured with attempts > 1.
  const configuredForRetry = retry.attempts > 1;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retry.attempts; attempt++) {
    try {
      const result = await fn();
      const event: StepEvent = {
        name,
        status: "ok",
        screenshot: opts?.screenshot,
        data: opts?.captureResult ? result : undefined,
        ...(configuredForRetry && attempt > 1 ? { attempt, attempts: retry.attempts } : {}),
        at: new Date().toISOString(),
      };
      console.log(`WEBOP_STEP ${JSON.stringify(event)}`);
      return result;
    } catch (err) {
      lastErr = err;
      if (attempt < retry.attempts) {
        await sleep(retry.delayMs);
      }
    }
  }
  const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
  const event: StepEvent = {
    name,
    status: "error",
    detail: configuredForRetry ? `${message} (after ${retry.attempts} attempts)` : message,
    ...(configuredForRetry ? { attempt: retry.attempts, attempts: retry.attempts } : {}),
    at: new Date().toISOString(),
  };
  console.log(`WEBOP_STEP ${JSON.stringify(event)}`);
  throw lastErr;
}

export async function step<T>(
  name: string,
  fn: () => Promise<T>,
  opts?: { screenshot?: string; captureResult?: boolean },
): Promise<T> {
  return stepInternal(name, fn, { attempts: 1, delayMs: 0 }, opts);
}

export async function stepWithRetry<T>(
  name: string,
  fn: () => Promise<T>,
  retry: RetryOptions,
  opts?: { screenshot?: string; captureResult?: boolean },
): Promise<T> {
  return stepInternal(name, fn, retry, opts);
}
