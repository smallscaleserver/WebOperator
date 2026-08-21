import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT, runScbCheckBalance, runScbMockGotoAccountSummary, parseScbBalanceSummary, type ScbTransaction } from "./exec.js";

// Mock-first balance-check/notify monitor for scb-business-anywhere,
// deliberately separate from scb-monitor.ts (the real-account monitor)
// even though both run through the exact same isolated lane/worker and
// the exact same check-transactions.ts extractor -- AuthBridge's own
// mock-login flow is what puts that lane's browser on scb-mock in the
// first place (see docs/AGENT_HANDOFF.md). check-once only this round,
// no scheduler/pause/autostop/company-switch -- deliberately smaller
// scope than scb-monitor.ts, per explicit instruction.
//
// Never sends Telegram: scb-monitor.ts already owns that channel for
// the *real* account, and mixing mock notifications into the same
// channel risks a human mistaking a mock alert for a real one. All
// notifications here are UI-only, read via GET /api/monitors/scb-business-anywhere.
export const SCB_MOCK_MONITOR_JOB_NAME = "scb-business-anywhere-check-once";

// Separate file from scb-monitor.ts's own monitor-state.json in the
// same lane directory -- same lane, deliberately different state, so
// a mock check-once can never clobber or be clobbered by the real
// monitor's own state.
const STATE_PATH = path.join(REPO_ROOT, "data", "lanes", "scb-business-anywhere-1", "mock-monitor-state.json");

const MAX_SEEN_TRANSACTIONS = 500;
const MAX_NOTIFICATIONS = 100;

export interface ScbMockMonitorNotification {
  id: string;
  type: "transaction" | "balance_changed";
  message: string;
  at: string;
}

export interface ScbMockMonitorState {
  lastCheckedAt: string | null;
  lastError: string | null;
  availableBalance: number | null;
  ledgerBalance: number | null;
  latestTransactions: ScbTransaction[];
  notifications: ScbMockMonitorNotification[];
  pageLastUpdatedText: string | null;
  // Composite key per transaction, order matches the explicit
  // requirement: date + time + trCode + amount + description.
  seenTransactionKeys: string[];
}

function emptyState(): ScbMockMonitorState {
  return {
    lastCheckedAt: null,
    lastError: null,
    availableBalance: null,
    ledgerBalance: null,
    latestTransactions: [],
    notifications: [],
    pageLastUpdatedText: null,
    seenTransactionKeys: [],
  };
}

export async function loadState(): Promise<ScbMockMonitorState> {
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    return { ...emptyState(), ...(JSON.parse(raw) as Partial<ScbMockMonitorState>) };
  } catch {
    return emptyState();
  }
}

async function saveState(state: ScbMockMonitorState): Promise<void> {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

function transactionKey(t: ScbTransaction): string {
  return `${t.date}|${t.time}|${t.trCode}|${t.amount}|${t.description}`;
}

function formatThb(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pushNotification(state: ScbMockMonitorState, type: ScbMockMonitorNotification["type"], message: string): void {
  state.notifications.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type, message, at: new Date().toISOString() });
  if (state.notifications.length > MAX_NOTIFICATIONS) {
    state.notifications.splice(0, state.notifications.length - MAX_NOTIFICATIONS);
  }
}

// Read-only: runs check-transactions.ts (the same bilingual EN/TH
// extractor real-account checks use) against the scb-business-anywhere-1
// lane's own isolated worker -- whatever page is currently loaded
// there (scb-mock, once AuthBridge's mock-login has run; nothing else
// if not). Never throws -- every failure mode lands in state.lastError,
// same established pattern as scb-monitor.ts/monitor.ts.
export async function checkOnce(): Promise<ScbMockMonitorState> {
  const state = await loadState();
  const now = new Date().toISOString();
  const isFirstEverCheck = state.lastCheckedAt === null;

  // See runScbMockGotoAccountSummary()'s own comment: AuthBridge closes
  // its page after a mock-login finishes, so navigate back to
  // scb-mock's account-summary first (cookie-based, safe either way)
  // before asking check-transactions.ts to read it. Best-effort -- if
  // this itself fails for some reason, fall through to the check
  // anyway and let its own error reporting explain what's wrong.
  await runScbMockGotoAccountSummary().catch(() => undefined);

  const result = await runScbCheckBalance().catch((err: Error) => ({
    ok: false,
    stdout: "",
    stderr: "",
    error: err.message,
    steps: [],
  }));

  if (!result.ok) {
    const rawError = result.error ?? result.stderr ?? "SCB mock balance check failed";
    // check-transactions.ts throws this exact prefix (see
    // check-transactions.ts) whenever it lands back on a login page or
    // can't find the authenticated nav -- map it to the friendlier,
    // action-oriented message this feature was asked to show, rather
    // than the raw technical detail.
    state.lastError = rawError.includes("SESSION_EXPIRED:")
      ? "SCB mock session is not authenticated. Use Queue Mock Login first."
      : rawError;
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

  const previousAvailable = state.availableBalance;
  const previousLedger = state.ledgerBalance;

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
  state.pageLastUpdatedText = summary.pageLastUpdatedText ?? null;
  state.lastCheckedAt = now;
  state.lastError = null;

  // First-ever check just establishes the baseline (every transaction
  // on the page is technically "new" the first time) -- no
  // notifications, same reasoning scb-monitor.ts already uses for its
  // own first-check Telegram message, just without sending anything.
  if (!isFirstEverCheck) {
    for (const t of newTransactions) {
      const direction = t.amount < 0 ? "debit" : "credit";
      pushNotification(
        state,
        "transaction",
        `${direction}: ${formatThb(Math.abs(t.amount))} THB — ${t.description} (${t.date} ${t.time})`,
      );
    }
    const balanceChanged =
      previousAvailable !== null &&
      previousLedger !== null &&
      (previousAvailable !== summary.availableBalance || previousLedger !== summary.ledgerBalance);
    if (balanceChanged) {
      pushNotification(
        state,
        "balance_changed",
        `Balance changed — Available: ${summary.availableBalance === null ? "?" : formatThb(summary.availableBalance)} THB, Ledger: ${summary.ledgerBalance === null ? "?" : formatThb(summary.ledgerBalance)} THB`,
      );
    }
  }

  await saveState(state);
  return state;
}
