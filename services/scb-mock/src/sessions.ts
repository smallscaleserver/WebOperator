import { randomBytes } from "node:crypto";
import type { Transaction } from "./transactions.js";

// Same 3 display names company-switcher.ts's KNOWN_COMPANIES already
// hardcodes for the real site -- reused here (not secret, just a
// company display name) so select-company.ts/company-switcher.ts are
// directly testable against this mock without any code changes there.
export const MOCK_COMPANIES = ["เซซุส", "บริษัท 2 ยู เอสเตท จำกัด", "กฤษฎิ์ ดำประสงค์"];

export interface Session {
  id: string;
  username: string | null;
  authenticated: boolean;
  company: string;
  // Server-side "as of" timestamp for the balance/transactions widget --
  // deliberately only advances when /refresh is hit (mirrors the real
  // site's own "Last Updated: ...  Refresh" behavior this whole feature
  // exists to test: the widget does NOT poll itself). A plain reload of
  // /account-summary must show the SAME stale value, not a fresh one.
  lastRefreshedAt: string;
  // Dev-injected via /dev/add-transaction, prepended ahead of the
  // generated baseline -- lets a test deliberately create a "new
  // transaction" for dedup/notification testing without waiting on the
  // generator's own time-based rotation.
  extraTransactions: Transaction[];
  // Set by /dev/force-logout -- the mock equivalent of the real site's
  // idle-timeout ("you have been logged out"). Checked instead of
  // `authenticated` on the account pages, distinctly from a real
  // logout, purely so a test can distinguish "never logged in" from
  // "was logged in, then idle-timed-out" if that ever matters later.
  forcedLoggedOut: boolean;
  // Set by /dev/session-timeout-overlay -- renders the real site's
  // "you have been logged out" dialog ON TOP of whatever authenticated
  // page is showing, while `authenticated` stays true underneath (same
  // ambiguous state observed on the real site: the page is still
  // there, but a real click is blocked by the overlay). Only ever
  // cleared by a real "OK" click (POST /dev/acknowledge-timeout) --
  // never auto-dismissed, never auto-bypassed, on purpose.
  showTimeoutOverlay: boolean;
  // Set by POST /transfer, read by the confirmation step and cleared
  // by /transfer/confirm or /transfer (cancel) -- a real multi-step
  // form flow, not a single-request shortcut, so record->analyze->run
  // has an actual "form -> confirm -> submit" sequence to capture.
  pendingTransfer: { toAccount: string; amount: number; memo: string } | null;
  // Visual/language fidelity only -- never affects auth/session logic.
  // Defaults to "th" so the unmodified default path (no ?language=
  // param) keeps showing the exact same Thai labels this mock always
  // has, which check-transactions.ts's SESSION_EXPIRED detector
  // (exact-text match on "ชื่อผู้ใช้งาน") and any existing recordings
  // depend on. Set from ?language= on /login, /password, or
  // /account-summary and carried forward from then on.
  language: "en" | "th";
}

// Pure in-memory -- no database, no file on disk, nothing anywhere near
// WebOperator's own data/ directory. Resets on container restart,
// expected and fine for a mock test fixture (same posture as xc-bank).
const sessions = new Map<string, Session>();

export function createSession(): Session {
  const id = randomBytes(16).toString("hex");
  const session: Session = {
    id,
    username: null,
    authenticated: false,
    company: MOCK_COMPANIES[0],
    lastRefreshedAt: new Date().toISOString(),
    extraTransactions: [],
    forcedLoggedOut: false,
    showTimeoutOverlay: false,
    pendingTransfer: null,
    language: "th",
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id: string | undefined): Session | undefined {
  if (!id) return undefined;
  return sessions.get(id);
}

export function deleteSession(id: string | undefined): void {
  if (!id) return;
  sessions.delete(id);
}
