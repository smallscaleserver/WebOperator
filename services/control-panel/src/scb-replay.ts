import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  REPO_ROOT,
  readScbRecording,
  runScbRecording,
  writeScbTempSegment,
  deleteScbTempSegment,
  type CompiledRecordingStep,
} from "./exec.js";
import { sendTelegramMessage } from "./telegram.js";

const STATE_PATH = path.join(REPO_ROOT, "data", "lanes", "scb-business-anywhere-1", "replay-state.json");

// Checked case-insensitively against each step's selector/text params.
// Best-effort, not a guarantee -- a real button whose text doesn't
// happen to match one of these (different wording, a different
// language) isn't caught. Documented plainly in docs/PROJECT_PLAN.md;
// this is the one thing standing between a replayed script and a real
// transaction, so it errs toward over-matching rather than under.
const DANGEROUS_KEYWORDS = [
  "transfer",
  "pay",
  "payment",
  "confirm",
  "submit",
  "send",
  "bill payment",
  "payroll",
  "delete",
  "remove",
  "โอนเงิน",
  "ชำระ",
  "จ่าย",
  "ยืนยัน",
  "ส่ง",
  "ลบ",
];

function isDangerousStep(step: CompiledRecordingStep): boolean {
  const target = `${step.params.selector ?? ""} ${step.params.text ?? ""}`.toLowerCase();
  return DANGEROUS_KEYWORDS.some((kw) => target.includes(kw));
}

function describeStep(step: CompiledRecordingStep, index: number): string {
  const selector = typeof step.params.selector === "string" ? step.params.selector.replace(/^text=/, "") : "?";
  return `Step ${index + 1}: ${step.type} → "${selector}"`;
}

interface PendingConfirmation {
  runId: string;
  recordingName: string;
  stepIndex: number;
  stepDescription: string;
  sentAt: string;
}

interface ReplayState {
  pendingConfirmation: PendingConfirmation | null;
  // Set by telegram-commands.ts when /confirm or /cancel arrives while
  // pendingConfirmation is set; cleared by the runner's own poll loop
  // once observed. Two separate processes never touch this (both
  // telegram-commands.ts's poll loop and the queue job that's blocked
  // waiting run inside the same worker.ts process) but a file is used
  // anyway so server.ts (a *separate* process) can read
  // pendingConfirmation for the UI banner.
  lastDecision: { runId: string; confirmed: boolean } | null;
  lastRunSummary: string | null;
  lastRunAt: string | null;
}

function emptyState(): ReplayState {
  return { pendingConfirmation: null, lastDecision: null, lastRunSummary: null, lastRunAt: null };
}

async function loadState(): Promise<ReplayState> {
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    return { ...emptyState(), ...(JSON.parse(raw) as Partial<ReplayState>) };
  } catch {
    return emptyState();
  }
}

async function saveState(state: ReplayState): Promise<void> {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

export async function getReplayState(): Promise<ReplayState> {
  return loadState();
}

// Called by telegram-commands.ts on an incoming /confirm or /cancel --
// only meaningful when pendingConfirmation is currently set; a stray
// reply with nothing pending is a documented no-op, not an error.
export async function resolvePendingConfirmation(confirmed: boolean): Promise<boolean> {
  const state = await loadState();
  if (!state.pendingConfirmation) return false;
  state.lastDecision = { runId: state.pendingConfirmation.runId, confirmed };
  await saveState(state);
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CONFIRM_POLL_INTERVAL_MS = 3000;
const CONFIRM_TIMEOUT_MS = 10 * 60 * 1000;

// Waits for a /confirm or /cancel matching this exact runId. Polls the
// state file rather than Telegram directly -- telegram-commands.ts is
// the single consumer of getTelegramUpdates(); having this loop poll
// Telegram too would race it for the same offset. Times out (aborts,
// same as an explicit /cancel) if nothing arrives in time -- a script
// must never sit forever waiting on a reply that isn't coming.
async function waitForConfirmation(runId: string): Promise<boolean> {
  const startedAt = Date.now();
  for (;;) {
    const state = await loadState();
    if (state.lastDecision?.runId === runId) {
      const confirmed = state.lastDecision.confirmed;
      await saveState({ ...state, pendingConfirmation: null, lastDecision: null });
      return confirmed;
    }
    if (Date.now() - startedAt > CONFIRM_TIMEOUT_MS) {
      await saveState({ ...state, pendingConfirmation: null });
      return false;
    }
    await sleep(CONFIRM_POLL_INTERVAL_MS);
  }
}

export interface ReplayResult {
  ok: boolean;
  summary: string;
}

// Runs one saved recording segment by segment: everything up to the
// next risky-keyword step runs as a normal workflow through the SCB
// lane's own worker; a risky step pauses first and requires a live
// /confirm in Telegram (see DANGEROUS_KEYWORDS above) before it's
// allowed to run. Never runs inside a single run-workflow.ts process --
// orchestrated here so the pause-and-wait can happen between two
// separate `docker compose run` invocations, without needing any new
// cross-container communication.
export async function runScbRecordingReplay(recordingName: string): Promise<ReplayResult> {
  const recording = await readScbRecording(recordingName);
  if (!recording) {
    return { ok: false, summary: `No saved recording named "${recordingName}"` };
  }
  const runId = `${recordingName}-${Date.now()}`;
  const steps = recording.steps;

  let segment: CompiledRecordingStep[] = [];
  let segmentIndex = 0;

  async function runSegment(): Promise<{ ok: true } | { ok: false; error: string }> {
    if (segment.length === 0) return { ok: true };
    const tempName = `.__segment-${runId}-${segmentIndex}`;
    segmentIndex += 1;
    await writeScbTempSegment(tempName, segment);
    segment = [];
    try {
      const result = await runScbRecording(tempName);
      if (!result.ok) {
        return { ok: false, error: result.error ?? result.stderr ?? "Segment failed" };
      }
      return { ok: true };
    } finally {
      await deleteScbTempSegment(tempName);
    }
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!isDangerousStep(step)) {
      segment.push(step);
      continue;
    }
    // Flush everything queued up so far before pausing on the risky step.
    const flushResult = await runSegment();
    if (!flushResult.ok) {
      const summary = `Stopped before step ${i + 1}: ${flushResult.error}`;
      await saveState({ ...(await loadState()), lastRunSummary: summary, lastRunAt: new Date().toISOString() });
      return { ok: false, summary };
    }

    const stepDescription = describeStep(step, i);
    const pending: PendingConfirmation = {
      runId,
      recordingName,
      stepIndex: i,
      stepDescription,
      sentAt: new Date().toISOString(),
    };
    await saveState({ ...(await loadState()), pendingConfirmation: pending });
    await sendTelegramMessage(
      `⚠️ Script "${recordingName}" กำลังจะทำ:\n${stepDescription}\n\nพิมพ์ /confirm เพื่อทำต่อ หรือ /cancel เพื่อยกเลิก (หมดเวลาอัตโนมัติใน 10 นาทีถ้าไม่ตอบ)`,
    );

    const confirmed = await waitForConfirmation(runId);
    if (!confirmed) {
      const summary = `Cancelled (or timed out waiting for /confirm) at step ${i + 1}: ${stepDescription}`;
      await sendTelegramMessage(`🛑 Script "${recordingName}" ${summary}`);
      await saveState({ ...(await loadState()), lastRunSummary: summary, lastRunAt: new Date().toISOString() });
      return { ok: false, summary };
    }

    segment = [step];
    const stepResult = await runSegment();
    if (!stepResult.ok) {
      const summary = `Failed on confirmed risky step ${i + 1}: ${stepResult.error}`;
      await saveState({ ...(await loadState()), lastRunSummary: summary, lastRunAt: new Date().toISOString() });
      return { ok: false, summary };
    }
  }

  const finalFlush = await runSegment();
  const summary = finalFlush.ok
    ? `Completed all ${steps.length} step(s) of "${recordingName}"`
    : `Stopped near the end: ${finalFlush.error}`;
  await saveState({ ...(await loadState()), lastRunSummary: summary, lastRunAt: new Date().toISOString() });
  return { ok: finalFlush.ok, summary };
}
