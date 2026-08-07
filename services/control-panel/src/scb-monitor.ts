import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT, runScbCheckBalance, parseScbBalanceSummary, type ScbTransaction } from "./exec.js";
import { sendTelegramMessage } from "./telegram.js";

export const SCB_MONITOR_JOB_NAME = "scb-business-anywhere-1-monitor-check";

// Reserved lane-scoped path per docs/BOT_LANE_ISOLATION.md's lane
// model -- never shared with data/monitor-state/xc-bank.json or any
// other lane's state.
const STATE_PATH = path.join(REPO_ROOT, "data", "lanes", "scb-business-anywhere-1", "monitor-state.json");

// Dev-only bound, same reasoning as XC Bank Monitor's MAX_SEEN_REFS --
// a JSON file, not a database.
const MAX_SEEN_TRANSACTIONS = 500;

export interface ScbMonitorState {
  lastCheckedAt: string | null;
  lastError: string | null;
  availableBalance: number | null;
  ledgerBalance: number | null;
  latestTransactions: ScbTransaction[];
  // Composite key per transaction (date+time+trCode+description+amount)
  // -- this real production page has no single visible unique id per
  // row the way XC Bank's mock does, so dedup keys off the combination
  // of visible fields instead.
  seenTransactionKeys: string[];
  paused: boolean;
  autoStopAt: string | null;
  autoStopped: boolean;
  autoStopMinutes: number | null;
}

function emptyState(): ScbMonitorState {
  return {
    lastCheckedAt: null,
    lastError: null,
    availableBalance: null,
    ledgerBalance: null,
    latestTransactions: [],
    seenTransactionKeys: [],
    paused: false,
    autoStopAt: null,
    autoStopped: false,
    autoStopMinutes: null,
  };
}

export async function loadState(): Promise<ScbMonitorState> {
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    return { ...emptyState(), ...(JSON.parse(raw) as Partial<ScbMonitorState>) };
  } catch {
    return emptyState();
  }
}

async function saveState(state: ScbMonitorState): Promise<void> {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

function transactionKey(t: ScbTransaction): string {
  return `${t.date}|${t.time}|${t.trCode}|${t.description}|${t.amount}`;
}

function formatThb(n: number | null): string {
  return n === null ? "?" : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Read-only: runs check-transactions.ts against the SCB lane's own
// isolated worker (never the shared one), on whatever company is
// currently active in the switcher -- this module has no concept of
// switching companies itself, it only reads. Never throws -- every
// failure mode is captured into state.lastError, matching monitor.ts's
// own established pattern for the XC Bank monitor.
export async function checkOnce(): Promise<ScbMonitorState> {
  const state = await loadState();
  const now = new Date().toISOString();
  const isFirstEverCheck = state.lastCheckedAt === null;

  const result = await runScbCheckBalance().catch((err: Error) => ({
    ok: false,
    stdout: "",
    stderr: "",
    error: err.message,
    steps: [],
  }));

  if (!result.ok) {
    state.lastError = result.error ?? result.stderr ?? "SCB balance check failed";
    state.lastCheckedAt = now;
    await saveState(state);
    return state;
  }

  const summary = parseScbBalanceSummary(result.stdout);
  if (!summary) {
    state.lastError = "Could not parse SCB balance summary from the worker's output";
    state.lastCheckedAt = now;
    await saveState(state);
    return state;
  }

  const seen = new Set(state.seenTransactionKeys);
  const newTransactions = summary.transactions.filter((t) => !seen.has(transactionKey(t)));

  for (const t of newTransactions) {
    state.seenTransactionKeys.push(transactionKey(t));
  }
  if (state.seenTransactionKeys.length > MAX_SEEN_TRANSACTIONS) {
    state.seenTransactionKeys.splice(0, state.seenTransactionKeys.length - MAX_SEEN_TRANSACTIONS);
  }

  state.availableBalance = summary.availableBalance;
  state.ledgerBalance = summary.ledgerBalance;
  state.latestTransactions = summary.transactions;
  state.lastCheckedAt = now;
  state.lastError = null;
  await saveState(state);

  // Best-effort Telegram notification. First-ever check sends a
  // baseline snapshot regardless of whether any transactions were
  // found (per explicit request: "แจ้งบอทด้วยตอนเข้ามาครั้งแรก"). Every
  // check after that only notifies for genuinely new transactions
  // (in/out, description, amount, updated balance) -- per explicit
  // request: "แจ้ง ว่าเข้าหรือออกจากไหนไปไหนเท่าไหร่ และยอด update".
  if (isFirstEverCheck) {
    await sendTelegramMessage(
      `🏦 SCB Business Anywhere — monitoring started\nAvailable Balance: ${formatThb(summary.availableBalance)} THB\nLedger Balance: ${formatThb(summary.ledgerBalance)} THB`,
    );
  } else if (newTransactions.length > 0) {
    const lines = newTransactions.map((t) => {
      const direction = t.amount < 0 ? "ออก (debit)" : "เข้า (credit)";
      const detailSuffix = t.detail ? `\n  ${t.detail}` : "";
      return `${direction}: ${Math.abs(t.amount).toFixed(2)} THB — ${t.description} (${t.date} ${t.time})${detailSuffix}`;
    });
    await sendTelegramMessage(
      `🏦 SCB Business Anywhere — ${newTransactions.length} รายการใหม่:\n${lines.join("\n")}\n\nBalance: ${formatThb(summary.availableBalance)} THB`,
    );
  }

  return state;
}

export async function setPaused(paused: boolean): Promise<ScbMonitorState> {
  const state = await loadState();
  state.paused = paused;
  await saveState(state);
  return state;
}

export interface ScbAutoStopConfig {
  autoStopAt: string | null;
  autoStopped: boolean;
  autoStopMinutes: number | null;
}

export async function setAutoStopConfig(patch: ScbAutoStopConfig): Promise<ScbMonitorState> {
  const state = await loadState();
  state.autoStopAt = patch.autoStopAt;
  state.autoStopped = patch.autoStopped;
  state.autoStopMinutes = patch.autoStopMinutes;
  await saveState(state);
  return state;
}
