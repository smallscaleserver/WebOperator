import type { Page } from "playwright-core";
import { connectToChromium } from "./cdp.js";
import { step } from "./steps.js";
import { selectCompany } from "./company-switcher.js";

const CDP_URL = process.env.CDP_URL ?? "http://localhost:9222";
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/app/output";
// Optional -- if set, re-asserts this company is active before every
// check (base64-encoded, same Windows-execFile-argv-encoding reasoning
// as select-company.ts). Found empirically that re-login resets the
// active company back to the account default, silently making the
// monitor report the wrong company's data -- this closes that gap by
// re-selecting the intended company on every single check,
// unconditionally (selectCompany() is a harmless no-op/re-click if
// it's already active).
const TARGET_COMPANY = process.env.TARGET_COMPANY_B64
  ? Buffer.from(process.env.TARGET_COMPANY_B64, "base64").toString("utf-8")
  : "";

// EN/TH label aliases -- the real site (and now services/scb-mock, see
// its own TRANSLATIONS object) can render either language depending on
// the account's own language setting, so every landmark/label this
// parser looks for is matched against both variants, never English
// only. Keep the Thai strings here byte-identical to
// services/scb-mock/src/server.ts's TRANSLATIONS.th -- they're
// duplicated (not imported) since this ships as a standalone worker
// script, same reasoning as CREDENTIAL_HINT_KEYWORDS's own duplication
// in record-actions.ts.
const LABELS = {
  username: ["Username", "ชื่อผู้ใช้งาน"],
  accountSummary: ["Account Summary", "สรุปบัญชี"],
  viewDetails: ["View Details", "ดูรายละเอียด"],
  latestTransactions: ["Latest Transactions", "รายการล่าสุด"],
  refresh: ["Refresh", "รีเฟรช"],
  availableBalance: ["Available Balance", "ยอดเงินที่ใช้ได้"],
  ledgerBalance: ["Ledger Balance", "ยอดเงินตามบัญชี"],
  lastUpdated: ["Last Updated", "อัปเดตล่าสุด"],
  addNote: ["Add a Note", "เพิ่มบันทึกช่วยจำ"],
  transactionDescription: ["Transaction Description", "รายละเอียดรายการ"],
  channel: ["Channel", "ช่องทาง"],
  chequeNo: ["Cheque No.", "เลขที่เช็ค"],
  terminalNo: ["Terminal No.", "หมายเลขเครื่อง"],
  tellerNo: ["Teller No.", "รหัสพนักงาน"],
  branchCode: ["Branch Code", "รหัสสาขา"],
} as const satisfies Record<string, readonly [string, string]>;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A Playwright getByText() locator that matches either language variant,
// exact-text (anchored), same as passing { exact: true } for a plain
// string -- getByText() accepts a RegExp for exactly this case.
function bilingualText(key: keyof typeof LABELS): RegExp {
  const [en, th] = LABELS[key];
  return new RegExp(`^(?:${escapeRegExp(en)}|${escapeRegExp(th)})$`);
}

// Same alternation, for building body-text regexes below (not anchored --
// used mid-pattern).
function bilingualAlt(key: keyof typeof LABELS): string {
  const [en, th] = LABELS[key];
  return `(?:${escapeRegExp(en)}|${escapeRegExp(th)})`;
}

interface Transaction {
  date: string;
  time: string;
  trCode: string;
  description: string;
  amount: number;
  detail: string;
}

interface CheckResult {
  availableBalance: number | null;
  ledgerBalance: number | null;
  transactions: Transaction[];
  checkedAt: string;
  url: string;
  screenshot: string;
  pageLastUpdatedText: string | null;
}

// Read-only: clicks the "Account Summary" left-nav link (in-app SPA
// navigation via a real click, not page.goto() -- a full page.goto()
// reload risks losing the currently-active company selection set via
// select-company.ts, since that's session/client state, not part of
// the URL). Never touches a credential, never submits a
// transfer/payment form. Extracts both the account's own balance
// figures and its Latest Transactions table rows from the page's
// visible text.
async function runCheck(page: Page): Promise<CheckResult> {
  // Detect a dropped/expired session fast (short timeout) instead of
  // blindly waiting the default ~30s for "Account Summary" to appear
  // (which it never will if logged out) -- found this happening for
  // real: the session expired mid-monitoring and the check just hung
  // until timeout with an unclear error. A thrown "SESSION_EXPIRED:"
  // prefix lets scb-monitor.ts recognize this specific case and send
  // a clear "please log in again" alert instead of a generic failure.
  const loginUsernameField = page.getByText(bilingualText("username")).first();
  if (await loginUsernameField.isVisible({ timeout: 3000 }).catch(() => false)) {
    throw new Error("SESSION_EXPIRED: back on the login page -- a human needs to log in again via noVNC");
  }
  const accountSummaryLink = page.getByText(bilingualText("accountSummary")).first();
  if (!(await accountSummaryLink.isVisible({ timeout: 5000 }).catch(() => false))) {
    throw new Error(
      "SESSION_EXPIRED: expected nav (Account Summary) not found -- likely logged out (or blocked by an unexpected popup -- check the screenshot), a human needs to log in again via noVNC",
    );
  }

  if (TARGET_COMPANY) {
    await selectCompany(page, TARGET_COMPANY);
  }

  await accountSummaryLink.click();
  await page.waitForTimeout(1500);
  // "Account Summary" can land on either the single-account detail
  // (has the Latest Transactions table directly) or the "All
  // Accounts" overview list (each account is a card with its own
  // "View Details" link, further down the page below account-group
  // summaries that load async) -- which one depends on prior
  // navigation state, found empirically rather than assumed. If a
  // "View Details" link is present, drill into it; there's currently
  // only one account under any company here, so `.first()` is
  // unambiguous -- would need to target a specific account if a
  // company ever has more than one.
  //
  // A bare isVisible() (no timeout) is an instant one-shot check, not
  // a wait -- found empirically that it can fire before the "All
  // Accounts" card list (an async-loaded section further down the
  // page) has rendered yet, silently skipping the click and leaving
  // the check stuck on the overview with zero transactions extracted.
  // isVisible({timeout}) polls/retries instead.
  const viewDetails = page.getByText(bilingualText("viewDetails")).first();
  if (await viewDetails.isVisible({ timeout: 6000 }).catch(() => false)) {
    await viewDetails.click();
    await page.waitForTimeout(1500);
  }
  // The transaction table itself loads asynchronously, after the
  // balance figures already render (observed directly -- a fixed
  // short wait sometimes captured the page before this table
  // finished its own fetch) -- wait for its own heading specifically
  // rather than a longer blind timeout.
  await page.getByText(bilingualText("latestTransactions")).first().waitFor({ timeout: 10_000 }).catch(() => {});

  // The balance/transactions widget shows a cached snapshot as of
  // whatever "Last Updated: <date>, <time>" it displays -- it does NOT
  // poll or auto-refresh on its own (confirmed directly: the user
  // found "Last Updated" stuck at an old timestamp not matching a real
  // new transaction they could see had posted). Click the widget's own
  // "Refresh" link every check so the data actually reflects "now",
  // not whenever a human last happened to click it (or never).
  const refreshLink = page.getByText(bilingualText("refresh")).first();
  const refreshLinkVisible = await refreshLink.isVisible({ timeout: 3000 }).catch(() => false);
  if (refreshLinkVisible) {
    await refreshLink.click();
    await page.waitForTimeout(2500);
  } else {
    // Fallback if SCB ever renames/relocates that link and the text
    // match stops finding it -- a full page.reload() forces the SPA to
    // refetch everything from scratch (unlike page.goto(), still the
    // same page/session, just re-mounted), so this can never silently
    // fall back to stale data just because one specific selector broke.
    // Re-navigate afterwards since a reload drops back to whatever the
    // SPA's default landing view is; selectCompany() re-asserting the
    // target company on every check (above) already covers the
    // "reload reset my company selection" risk this would otherwise
    // reintroduce.
    await page.reload().catch(() => {});
    await page.waitForTimeout(1500);
    if (TARGET_COMPANY) {
      await selectCompany(page, TARGET_COMPANY);
    }
    await page.getByText(bilingualText("accountSummary")).first().click().catch(() => {});
    await page.waitForTimeout(1500);
    const viewDetailsAgain = page.getByText(bilingualText("viewDetails")).first();
    if (await viewDetailsAgain.isVisible({ timeout: 6000 }).catch(() => false)) {
      await viewDetailsAgain.click();
      await page.waitForTimeout(1500);
    }
    await page.getByText(bilingualText("latestTransactions")).first().waitFor({ timeout: 10_000 }).catch(() => {});
  }

  const text = await page.evaluate(() => (document.body ? document.body.innerText : ""));

  // -? -- found live during EN/TH verification: a negative balance (a
  // real, reachable state, same as any transaction amount) wasn't
  // matched at all before this, silently returning null instead of the
  // real figure. Pre-existing gap, not introduced by the bilingual
  // change; the transaction-row regex below already handled negative
  // amounts correctly (`-?[\d,]+\.\d{2}`), the balance regexes just
  // never had the same `-?` prefix.
  const availableMatch = text.match(new RegExp(`${bilingualAlt("availableBalance")}\\s*\\n+\\s*(-?[\\d,]+\\.\\d{2})\\s*THB`));
  const ledgerMatch = text.match(new RegExp(`${bilingualAlt("ledgerBalance")}\\s*\\n+\\s*(-?[\\d,]+\\.\\d{2})\\s*THB`));
  // The widget's own "Last Updated: <date>, <time>  Refresh" text --
  // captured as a success signal, not just for display: if this stays
  // identical across consecutive checks (each ~70-105s apart), the
  // Refresh click above silently didn't actually pull fresh data (link
  // moved, click missed, bank-side throttling, etc.) even though no
  // error was thrown. scb-monitor.ts compares this against the prior
  // check's value to catch exactly that silent-stale case.
  const lastUpdatedMatch = text.match(
    new RegExp(`${bilingualAlt("lastUpdated")}:\\s*(\\d{1,2}\\s+\\w+\\s+\\d{4},\\s*\\d{2}:\\d{2})`),
  );

  // Row shape observed: "DD/MM/YYYY\n\nHH:MM\n\n<TrCode>\n\n<Description>\n\nAdd a Note\n\n[-]amount THB"
  const rowPattern = new RegExp(
    `(\\d{2}/\\d{2}/\\d{4})\\s*\\n+\\s*(\\d{2}:\\d{2})\\s*\\n+\\s*(\\S+)\\s*\\n+\\s*([^\\n]+?)\\s*\\n+\\s*${bilingualAlt("addNote")}\\s*\\n+\\s*(-?[\\d,]+\\.\\d{2})\\s*THB`,
    "g",
  );
  const rows: { date: string; time: string; trCode: string; description: string; amount: number; amountRaw: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = rowPattern.exec(text)) !== null) {
    rows.push({
      date: match[1],
      time: match[2],
      trCode: match[3],
      description: match[4].trim(),
      amount: Number(match[5].replace(/,/g, "")),
      amountRaw: match[5],
    });
  }

  // Expand each row's "▾" detail chevron (the amount chip itself is
  // the clickable element, confirmed empirically) to reveal reference
  // detail beyond the summary row: "Transaction Date", "Transaction
  // Description", "Channel", "Cheque No.", "Terminal No.", "Teller
  // No.", "Branch Code" (labels confirmed directly against a real
  // expanded row, not assumed). Parsed as labeled fields (same
  // per-label regex technique already used for the balance figures
  // above) rather than a raw diff, so the result is clean structured
  // data instead of a text dump.
  // Keys into LABELS -- matched against either language variant, but
  // always emitted below using the canonical English label text (the
  // first element of each LABELS pair) so scb-monitor.ts/Telegram
  // formatting downstream never needs to care which language the page
  // was actually showing.
  const DETAIL_LABEL_KEYS = ["transactionDescription", "channel", "chequeNo", "terminalNo", "tellerNo", "branchCode"] as const;
  const transactions: Transaction[] = [];
  for (const row of rows) {
    let detail = "";
    try {
      // The chevron toggles open/closed -- only click if the detail
      // isn't already showing (a same-session repeat check could
      // otherwise re-collapse a row a prior check had expanded).
      const alreadyExpanded = await page
        .getByText(bilingualText("transactionDescription"))
        .first()
        .isVisible()
        .catch(() => false);
      if (!alreadyExpanded) {
        const chip = page.getByText(`${row.amountRaw} THB`, { exact: false }).first();
        if (await chip.isVisible().catch(() => false)) {
          await chip.click();
          await page.waitForTimeout(800);
        }
      }
      const after = await page.evaluate(() => (document.body ? document.body.innerText : ""));
      const parts: string[] = [];
      for (const key of DETAIL_LABEL_KEYS) {
        const [canonicalLabel] = LABELS[key];
        const m = after.match(new RegExp(`${bilingualAlt(key)}\\s*\\n+\\s*([^\\n]+)`));
        if (m && m[1].trim()) parts.push(`${canonicalLabel}: ${m[1].trim()}`);
      }
      detail = parts.join(", ");
    } catch {
      // Best-effort only -- a failed expand click still leaves the
      // base row (date/time/description/amount) intact.
    }
    transactions.push({ ...row, detail });
  }

  // Screenshot every successful check too (not just error cases) --
  // per explicit request to have a visual record of each ~5-min
  // scheduled tick, so an idle-timeout popup (or anything else
  // unexpected) shows up in the trail even on a check that otherwise
  // succeeded normally.
  const screenshotFilename = `check-${Date.now()}.png`;
  await page.screenshot({ path: `${OUTPUT_DIR}/${screenshotFilename}`, fullPage: true }).catch(() => {});

  return {
    availableBalance: availableMatch ? Number(availableMatch[1].replace(/,/g, "")) : null,
    ledgerBalance: ledgerMatch ? Number(ledgerMatch[1].replace(/,/g, "")) : null,
    transactions,
    checkedAt: new Date().toISOString(),
    url: page.url(),
    screenshot: screenshotFilename,
    pageLastUpdatedText: lastUpdatedMatch ? lastUpdatedMatch[1] : null,
  };
}

async function main(): Promise<void> {
  const browser = await step("connect", () => connectToChromium(CDP_URL));
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  const result = await step("check-transactions", async () => {
    try {
      return await runCheck(page);
    } catch (err) {
      // Screenshot on *any* failure this step hits, not just the
      // SESSION_EXPIRED cases -- found empirically that other failure
      // modes exist too (e.g. a lingering dropdown overlay blocking a
      // click), and a screenshot is valuable for diagnosing any of
      // them, not only a suspected-logout scenario. Best-effort: a
      // failed screenshot still lets the real error through.
      const filename = `check-failed-${Date.now()}.png`;
      await page.screenshot({ path: `${OUTPUT_DIR}/${filename}`, fullPage: true }).catch(() => {});
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`${message} (screenshot: ${filename})`);
    }
  });

  console.log(`SCB_BALANCE_SUMMARY ${JSON.stringify(result)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("check-transactions failed:", err);
  process.exit(1);
});
