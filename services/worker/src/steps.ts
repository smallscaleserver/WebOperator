export interface StepEvent {
  name: string;
  status: "ok" | "error";
  detail?: string;
  screenshot?: string; // filename only, relative to OUTPUT_DIR
  data?: unknown; // the step function's return value, when opts.captureResult is set
  at: string;
}

// Prefixed so a step line is trivially greppable out of otherwise mixed
// stdout (tsx/npm print other lines too) without needing the whole stream
// to be structured.
export async function step<T>(
  name: string,
  fn: () => Promise<T>,
  opts?: { screenshot?: string; captureResult?: boolean },
): Promise<T> {
  try {
    const result = await fn();
    const event: StepEvent = {
      name,
      status: "ok",
      screenshot: opts?.screenshot,
      data: opts?.captureResult ? result : undefined,
      at: new Date().toISOString(),
    };
    console.log(`WEBOP_STEP ${JSON.stringify(event)}`);
    return result;
  } catch (err) {
    const event: StepEvent = {
      name,
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
      at: new Date().toISOString(),
    };
    console.log(`WEBOP_STEP ${JSON.stringify(event)}`);
    throw err;
  }
}
