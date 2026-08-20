import { readFileSync } from "node:fs";
import express from "express";
import cookieParser from "cookie-parser";
import { createSession, deleteSession, getSession, MOCK_COMPANIES, type Session } from "./sessions.js";
import { generateBaselineTransactions, computeBalances, makeManualTransaction, type Transaction } from "./transactions.js";

const PORT = Number(process.env.PORT ?? 3000);
const COOKIE_NAME = "scbmock_session";
const USERPASSMOCK_PATH = process.env.USERPASSMOCK_PATH ?? "/app/.userpassmock";

// Host-editable convenience file (see .gitignore/.userpassmock) --
// pre-fills the login form so there's nothing to remember/retype.
// Safe to read automatically here specifically because this mock
// never validates against these values (any non-empty value already
// works) -- unlike .userpass, which the bot never reads for any real
// site. Read fresh on every render (cheap, low-traffic page) so edits
// apply immediately with no restart. Missing/malformed file just
// falls back to empty fields, never an error.
function readUserPassMock(): { username: string; password: string } {
  try {
    const raw = readFileSync(USERPASSMOCK_PATH, "utf-8");
    const username = raw.match(/^username:\s*(.*)$/m)?.[1]?.trim() ?? "";
    const password = raw.match(/^password:\s*(.*)$/m)?.[1]?.trim() ?? "";
    return { username, password };
  } catch {
    return { username: "", password: "" };
  }
}

const app = express();
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));

// Visual/language fidelity pass only -- services/scb-mock scope, dev/test
// fixture, never touches the real site or any credential handling. "th"
// stays the default everywhere (no ?language= param) so the exact-text
// "ชื่อผู้ใช้งาน" landmark check-transactions.ts's SESSION_EXPIRED
// detector depends on, plus any existing recordings/AuthBridge flows,
// keep working completely unchanged. See docs/PROJECT_PLAN.md decision
// log for why this file only translates the specific strings asked for,
// not the whole app.
type Lang = "en" | "th";

const TRANSLATIONS: Record<Lang, Record<string, string>> = {
  en: {
    username: "Username",
    next: "Next",
    password: "Password",
    signIn: "Sign In",
    userGuides: "User Guides",
    howToCreateTransactions: "How to Create Transactions",
    howToGeneratePaymentAdvices: "How to Generate Payment Advices",
    allUserGuides: "All User Guides",
    termsAndConditions: "Terms and Conditions",
    securityTips: "Security Tips",
    privacyNotice: "Privacy Notice",
    // Dashboard/transactions -- kept in sync with the LABELS map in
    // services/worker/src/check-transactions.ts (both variants of each
    // label are matched there regardless of which one the page shows).
    accountSummary: "Account Summary",
    viewDetails: "View Details",
    latestTransactions: "Latest Transactions",
    availableBalance: "Available Balance",
    ledgerBalance: "Ledger Balance",
    lastUpdated: "Last Updated",
    refresh: "Refresh",
    addNote: "Add a Note",
    transactionDate: "Transaction Date",
    transactionDescription: "Transaction Description",
    channel: "Channel",
    chequeNo: "Cheque No.",
    terminalNo: "Terminal No.",
    tellerNo: "Teller No.",
    branchCode: "Branch Code",
    // Nav/misc -- not parsed by check-transactions.ts, translated for
    // visual completeness only.
    mainPage: "Main Page",
    paymentsAndTransfers: "Payments and Transfers",
    transfers: "Transfers",
    billPayments: "Bill Payments",
    payroll: "Payroll",
    recipientProfiles: "Recipient Profiles",
    reports: "Reports",
    accountDetails: "Account Details",
    welcome: "Welcome",
    lastLoggedIn: "Last Logged in",
    logout: "Logout",
    logoutClean: "Logout clean",
  },
  th: {
    username: "ชื่อผู้ใช้งาน",
    next: "ถัดไป",
    password: "รหัสผ่าน",
    signIn: "เข้าสู่ระบบ",
    userGuides: "คู่มือการใช้งาน",
    howToCreateTransactions: "วิธีสร้างรายการ",
    howToGeneratePaymentAdvices: "วิธีสร้างใบแจ้งการชำระเงิน",
    allUserGuides: "คู่มือทั้งหมด",
    termsAndConditions: "ข้อกำหนดและเงื่อนไข",
    securityTips: "เคล็ดลับความปลอดภัย",
    privacyNotice: "นโยบายความเป็นส่วนตัว",
    accountSummary: "สรุปบัญชี",
    viewDetails: "ดูรายละเอียด",
    latestTransactions: "รายการล่าสุด",
    availableBalance: "ยอดเงินที่ใช้ได้",
    ledgerBalance: "ยอดเงินตามบัญชี",
    lastUpdated: "อัปเดตล่าสุด",
    refresh: "รีเฟรช",
    addNote: "เพิ่มบันทึกช่วยจำ",
    transactionDate: "วันที่ทำรายการ",
    transactionDescription: "รายละเอียดรายการ",
    channel: "ช่องทาง",
    chequeNo: "เลขที่เช็ค",
    terminalNo: "หมายเลขเครื่อง",
    tellerNo: "รหัสพนักงาน",
    branchCode: "รหัสสาขา",
    mainPage: "หน้าหลัก",
    paymentsAndTransfers: "การชำระเงินและโอนเงิน",
    transfers: "โอนเงิน",
    billPayments: "ชำระค่าสินค้า/บริการ",
    payroll: "เงินเดือน",
    recipientProfiles: "โปรไฟล์ผู้รับเงิน",
    reports: "รายงาน",
    accountDetails: "รายละเอียดบัญชี",
    welcome: "ยินดีต้อนรับ",
    lastLoggedIn: "เข้าสู่ระบบล่าสุด",
    logout: "ออกจากระบบ",
    logoutClean: "ออกจากระบบ (ล้างข้อมูล)",
  },
};

function isLang(value: unknown): value is Lang {
  return value === "en" || value === "th";
}

// Query param wins (explicit navigation like /login?language=en), then
// the session's own last-known language (continuity across login ->
// password -> account-summary without needing the param on every hop),
// then "th" (the original, unmodified default).
function resolveLanguage(query: unknown, session?: Session): Lang {
  if (isLang(query)) return query;
  if (session && isLang(session.language)) return session.language;
  return "th";
}

function langToggleHtml(lang: Lang, path: string): string {
  const other = lang === "en" ? "th" : "en";
  return `<div class="auth-lang">
    <a href="${path}?language=en" class="${lang === "en" ? "lang-active" : ""}">EN</a>
    &nbsp;|&nbsp;
    <a href="${path}?language=th" class="${lang === "th" ? "lang-active" : ""}">ไทย</a>
  </div>`;
}

// Cosmetic footer matching the real public site's own "legal links +
// version/copyright" strip at the bottom of the login/password pages --
// every link is a dead onclick (same pattern already used for User
// Guides), never a real page, since this is a login page and nothing
// here should look clickable-into-real-content.
function authFooterHtml(lang: Lang): string {
  const t = TRANSLATIONS[lang];
  return `<div class="auth-footer">
    <a href="#" onclick="return false;">${t.termsAndConditions}</a>
    <a href="#" onclick="return false;">${t.securityTips}</a>
    <a href="#" onclick="return false;">${t.privacyNotice}</a>
    <div class="auth-footer-copy">&copy; ${new Date().getUTCFullYear()} SCB Business Anywhere (mock) &middot; v1.0.0-mock &middot; dev/test fixture only</div>
  </div>`;
}

// Purple theme roughly matching the real site's look -- not pixel-
// perfect, close enough that a screenshot is recognizable at a glance.
function page(title: string, body: string, lang: Lang = "th"): string {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<title>${title} — SCB Business Anywhere (mock)</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; margin: 0; color: #1a1a2e; background: #f5f5f8; }
  .banner { background: linear-gradient(90deg,#7b5fd6,#5b3fc0); color: #fff; padding: 0.5rem 1rem; font-size: 0.85rem; }
  .topbar { background: #2d1b5e; color: #fff; display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 1rem; font-size: 0.85rem; }
  .auth-shell { max-width: 480px; margin: 4rem auto; }
  .card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1.5rem; }
  label { display: block; margin: 0.75rem 0 0.25rem; font-size: 0.9rem; }
  input { width: 100%; padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px; }
  button, a.btn { cursor: pointer; padding: 0.5rem 1.1rem; border-radius: 4px; border: none; background: #5b3fc0; color: #fff; font-size: 0.9rem; text-decoration: none; display: inline-block; }
  .error { color: #b00020; font-size: 0.9rem; }
  .hint { color: #666; font-size: 0.8rem; }
  .app-shell { display: flex; min-height: 100vh; }
  nav.side { width: 220px; background: #fff; border-right: 1px solid #ddd; padding: 1rem 0; }
  nav.side a { display: block; padding: 0.5rem 1rem; color: #333; text-decoration: none; font-size: 0.9rem; }
  nav.side a.active { color: #5b3fc0; font-weight: bold; background: #f0ecfb; }
  main { flex: 1; padding: 1.5rem 2rem; }
  .company-switcher { position: relative; background: #2d1b5e; color: #fff; padding: 0.6rem 1rem; }
  .company-switcher .current { cursor: pointer; }
  .company-menu { display: none; position: absolute; top: 100%; left: 0; background: #fff; color: #1a1a2e; border: 1px solid #ccc; border-radius: 4px; min-width: 240px; z-index: 20; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
  .company-menu.open { display: block; }
  .company-menu button { display: block; width: 100%; text-align: left; background: none; color: #1a1a2e; padding: 0.6rem 1rem; border: none; border-bottom: 1px solid #eee; }
  .company-menu button:hover { background: #f5f5f8; }
  .account-card { background: #fff; border-radius: 8px; padding: 1.5rem; margin-top: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .balance-row { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 1rem; }
  .balance-figure { font-size: 1.3rem; font-weight: bold; }
  .tx-row { display: grid; grid-template-columns: 110px 60px 1fr 140px 30px; gap: 0.5rem; padding: 0.75rem 0; border-top: 1px solid #eee; align-items: start; }
  .tx-amount { text-align: right; cursor: pointer; }
  .tx-amount.credit { color: #1a7f37; }
  .tx-amount.debit { color: #cf222e; }
  .tx-detail { display: none; grid-column: 1 / -1; background: #f8f8fb; padding: 0.75rem 1rem; font-size: 0.85rem; }
  .tx-detail.open { display: block; }
  .tx-detail div { margin-bottom: 0.4rem; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 50; }
  .modal-box { background: #fff; border-radius: 8px; padding: 1.5rem 2rem; max-width: 420px; }
  .auth-split { display: flex; min-height: 100vh; }
  .auth-left { flex: 1 1 45%; background: linear-gradient(160deg,#5b3fc0,#4a2fa8); color: #fff; padding: 2.5rem; display: flex; flex-direction: column; }
  .auth-left .logo { display: flex; align-items: center; gap: 0.5rem; font-weight: bold; letter-spacing: 0.15em; font-size: 1.1rem; }
  .auth-left .logo .mark { width: 1.4rem; height: 1.4rem; border-radius: 6px; background: #f4b942; display: inline-block; }
  .auth-announce { background: #fff; color: #1a1a2e; border-radius: 8px; padding: 1rem 1.2rem; margin-top: 2rem; max-width: 360px; }
  .auth-announce .icon { color: #5b3fc0; font-weight: bold; margin-right: 0.4rem; }
  .auth-illustration { margin-top: auto; opacity: 0.5; font-size: 3.5rem; }
  .auth-right { flex: 1 1 55%; background: #fff; display: flex; align-items: center; justify-content: center; }
  .auth-right-inner { width: 100%; max-width: 380px; padding: 2rem; }
  .auth-lang { text-align: right; color: #666; font-size: 0.85rem; margin-bottom: 2rem; }
  .auth-lang a { color: #666; text-decoration: none; }
  .auth-lang a.lang-active { color: #5b3fc0; font-weight: bold; text-decoration: underline; }
  .user-guides { background: #eef0ff; border: 1px solid #d9dcff; border-radius: 8px; padding: 1rem 1.2rem; margin-top: 1.5rem; font-size: 0.85rem; }
  .user-guides a { color: #5b3fc0; display: block; margin-top: 0.4rem; text-decoration: underline; }
  .auth-footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #eee; font-size: 0.75rem; color: #888; }
  .auth-footer a { color: #888; text-decoration: underline; margin-right: 1rem; }
  .auth-footer-copy { margin-top: 0.5rem; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function announcementBanner(): string {
  return `<div class="banner">Direct credit and payroll transactions (mock notice) will be processed from 08:00 am onward.</div>`;
}

// Matches the real site's own idle-timeout dialog text closely (see
// docs/PROJECT_PLAN.md's decision log for the original real-site
// screenshot this is based on). Rendered ON TOP of an otherwise
// normal authenticated page -- the underlying page/nav is still
// present in the DOM (same as the real site), only this overlay
// (a real position:fixed div covering the viewport) blocks pointer
// events from reaching it, so a script that tries to click through
// gets the same "blocked by another element" failure the real site
// produces. The only way out is the OK button -- no auto-dismiss.
function timeoutOverlayHtml(): string {
  return `<div class="modal-overlay">
    <div class="modal-box">
      <h2 style="margin-top:0;">For your online security, you have been logged out of SCB Business Anywhere</h2>
      <p>Please log in again.</p>
      <form method="post" action="/dev/acknowledge-timeout">
        <button type="submit">OK</button>
      </form>
    </div>
  </div>`;
}

// Two-column layout roughly matching the real site's own login page
// (purple announcement panel on the left, form on the right, "User
// Guides" box below the form) -- based directly on a real screenshot
// captured earlier this session, not guessed. Cosmetic only: the
// functional bits check-transactions.ts's SESSION_EXPIRED detection
// and the recorder both depend on ("ชื่อผู้ใช้งาน" as its own exact-text
// label, the form/input/button structure) are unchanged.
function authLeftPanel(): string {
  return `<div class="auth-left">
    <div class="logo"><span class="mark"></span> ANYWHERE</div>
    <div class="auth-announce">
      <div><span class="icon">&#9432;</span><strong>Announcement</strong></div>
      <p class="hint" style="margin-bottom:0;">Direct credit and payroll transactions (mock notice) will be processed from 08:00 am onward.</p>
    </div>
    <div class="auth-illustration">&#128188;&#9993;&#65039;</div>
  </div>`;
}

// Login-page marker check-transactions.ts's SESSION_EXPIRED detection
// looks for on the real site -- included here so that same detection
// logic is directly testable against this mock unchanged.
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function loginPage(session: Session | undefined, error: string | undefined, lang: Lang): string {
  const { username, password } = readUserPassMock();
  const t = TRANSLATIONS[lang];
  return page(
    "Log in",
    `<div class="auth-split">
      ${authLeftPanel()}
      <div class="auth-right">
        <div class="auth-right-inner">
          ${langToggleHtml(lang, "/login")}
          <h1>SCB Business Anywhere</h1>
          ${error ? `<p class="error">${error}</p>` : ""}
          <form method="post" action="/login">
            <input type="hidden" name="language" value="${lang}" />
            <label for="username">${t.username}</label>
            <input id="username" name="username" autofocus />
            <button type="submit" style="margin-top:1.25rem;">${t.next}</button>
          </form>
          <div class="user-guides">
            <strong>${t.userGuides}</strong>
            <a href="#" onclick="return false;">${t.howToCreateTransactions}</a>
            <a href="#" onclick="return false;">${t.howToGeneratePaymentAdvices}</a>
            <a href="#" onclick="return false;">${t.allUserGuides}</a>
          </div>
          <p class="hint" style="margin-top:1.5rem;">Mock only, nothing checked against anything real. From <code>.userpassmock</code>: username <strong>${escapeAttr(username)}</strong>, password <strong>${escapeAttr(password)}</strong></p>
          ${authFooterHtml(lang)}
        </div>
      </div>
    </div>`,
    lang,
  );
}

function passwordPage(session: Session, error: string | undefined, lang: Lang): string {
  const { username, password } = readUserPassMock();
  const t = TRANSLATIONS[lang];
  return page(
    "Password",
    `<div class="auth-split">
      ${authLeftPanel()}
      <div class="auth-right">
        <div class="auth-right-inner">
          ${langToggleHtml(lang, "/password")}
          <h1>SCB Business Anywhere</h1>
          <p class="hint">Signing in as ${session.username}</p>
          ${error ? `<p class="error">${error}</p>` : ""}
          <form method="post" action="/password">
            <input type="hidden" name="language" value="${lang}" />
            <label for="password">${t.password}</label>
            <input id="password" name="password" type="password" autofocus />
            <button type="submit" style="margin-top:1.25rem;">${t.signIn}</button>
          </form>
          <p class="hint" style="margin-top:1.5rem;">Mock only, nothing checked against anything real. From <code>.userpassmock</code>: username <strong>${escapeAttr(username)}</strong>, password <strong>${escapeAttr(password)}</strong></p>
          ${authFooterHtml(lang)}
        </div>
      </div>
    </div>`,
    lang,
  );
}

function formatThb(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatLastUpdated(iso: string): string {
  const d = new Date(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm}`;
}

function allTransactions(session: Session): Transaction[] {
  return [...session.extraTransactions, ...generateBaselineTransactions(session.id, session.company)];
}

function txRow(t: Transaction, index: number, lang: Lang): string {
  const tt = TRANSLATIONS[lang];
  const isCredit = t.amount >= 0;
  const amountText = `${formatThb(t.amount)} THB`;
  return `<div class="tx-row">
    <div class="tx-datetime">${t.date}<br>${t.time}</div>
    <div class="tx-code">${t.trCode}</div>
    <div class="tx-desc">${t.description}<br><a href="#" class="add-note" onclick="return false;">${tt.addNote}</a></div>
    <div class="tx-amount ${isCredit ? "credit" : "debit"}" onclick="toggleDetail(${index})">${amountText}</div>
    <div>&#9662;</div>
  </div>
  <div class="tx-detail" id="tx-detail-${index}">
    <div><strong>${tt.transactionDate}</strong><br>${t.date} ${t.time}</div>
    <div><strong>${tt.transactionDescription}</strong><br>Transfer Deposit, Withdrawal Nobook</div>
    <div><strong>${tt.channel}</strong><br>${t.channel}</div>
    <div><strong>${tt.chequeNo}</strong><br>${t.chequeNo}</div>
    <div><strong>${tt.terminalNo}</strong><br>${t.terminalNo}</div>
    <div><strong>${tt.tellerNo}</strong><br>${t.tellerNo}</div>
    <div><strong>${tt.branchCode}</strong><br>${t.branchCode}</div>
  </div>`;
}

function accountSummaryPage(session: Session): string {
  const transactions = allTransactions(session);
  const { available, ledger } = computeBalances(transactions);
  const companyMenu = MOCK_COMPANIES.map(
    (c) => `<button onclick="selectCompany('${c.replace(/'/g, "\\'")}')">${c}</button>`,
  ).join("");
  const lang = session.language;
  const t = TRANSLATIONS[lang];

  return page(
    "Account Summary",
    `${announcementBanner()}
    <div class="topbar">
      <span>${t.lastLoggedIn}: ${formatLastUpdated(new Date().toISOString())} | <a href="/account-summary?language=en" style="color:${lang === "en" ? "#fff" : "#bbb"};text-decoration:none;">EN</a> / <a href="/account-summary?language=th" style="color:${lang === "th" ? "#fff" : "#bbb"};text-decoration:none;">ไทย</a></span>
      <span>${t.welcome} ${session.username}</span>
    </div>
    <div class="company-switcher">
      <span class="current" onclick="toggleCompanyMenu()"><span class="company-name">${session.company}</span> <span aria-hidden="true">&#9662;</span></span>
      <div class="company-menu" id="company-menu">${companyMenu}</div>
    </div>
    <div class="app-shell">
      <nav class="side">
        <a href="/account-summary">${t.mainPage}</a>
        <a href="/account-summary" class="active">${t.accountSummary}</a>
        <a href="#" onclick="return false;">${t.paymentsAndTransfers}</a>
        <a href="/transfer" style="padding-left:1.75rem;">${t.transfers}</a>
        <a href="#" onclick="return false;" style="padding-left:1.75rem;">${t.billPayments}</a>
        <a href="#" onclick="return false;" style="padding-left:1.75rem;">${t.payroll}</a>
        <a href="#" onclick="return false;">${t.recipientProfiles}</a>
        <a href="#" onclick="return false;">${t.reports}</a>
      </nav>
      <main>
        <h1>${t.accountDetails}</h1>
        <div class="account-card">
          <div class="balance-row">
            <div>
              <div>${session.company} <span class="hint">Active</span></div>
              <div class="hint">434-215406-4 &middot; Savings Account</div>
            </div>
            <div style="text-align:right;">
              <div class="hint">${t.availableBalance}</div>
              <div class="balance-figure">${formatThb(available)} THB</div>
            </div>
          </div>
          <div class="balance-row" style="margin-top:0.5rem;">
            <div class="hint">${t.lastUpdated}: ${formatLastUpdated(session.lastRefreshedAt)} <a href="/account-summary?refresh=1">${t.refresh}</a></div>
            <div style="text-align:right;">
              <div class="hint">${t.ledgerBalance}</div>
              <div class="balance-figure">${formatThb(ledger)} THB</div>
            </div>
          </div>
        </div>

        <h2 style="margin-top:1.5rem;">${t.latestTransactions}</h2>
        <div class="account-card" style="margin-top:0.5rem;">
          ${transactions.map((tx, i) => txRow(tx, i, lang)).join("\n")}
        </div>

        <div style="margin-top:1.5rem;">
          <form method="post" action="/logout" style="display:inline-block;"><button type="submit">${t.logout}</button></form>
          <form method="post" action="/logout-clean" style="display:inline-block;"><button type="submit">${t.logoutClean}</button></form>
          <form method="post" action="/dev/session-timeout-overlay" style="display:inline-block;"><button type="submit" style="background:#9a6700;">Simulate session timeout (dev)</button></form>
        </div>
      </main>
    </div>
    <script>
      function toggleDetail(i) {
        document.getElementById('tx-detail-' + i).classList.toggle('open');
      }
      function toggleCompanyMenu() {
        document.getElementById('company-menu').classList.add('open');
      }
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') document.getElementById('company-menu').classList.remove('open');
      });
      function selectCompany(name) {
        document.getElementById('company-menu').classList.remove('open');
        const form = document.createElement('form');
        form.method = 'post';
        form.action = '/select-company';
        const input = document.createElement('input');
        input.name = 'company';
        input.value = name;
        form.appendChild(input);
        document.body.appendChild(form);
        form.submit();
      }
    </script>
    ${session.showTimeoutOverlay ? timeoutOverlayHtml() : ""}`,
    session.language,
  );
}

function transferFormPage(session: Session, error?: string): string {
  const lang = session.language;
  const t = TRANSLATIONS[lang];
  return page(
    "Transfer",
    `${announcementBanner()}
    <div class="topbar">
      <span>${t.lastLoggedIn}: ${formatLastUpdated(new Date().toISOString())} | <a href="/transfer?language=en" style="color:${lang === "en" ? "#fff" : "#bbb"};text-decoration:none;">EN</a> / <a href="/transfer?language=th" style="color:${lang === "th" ? "#fff" : "#bbb"};text-decoration:none;">ไทย</a></span>
      <span>${t.welcome} ${session.username}</span>
    </div>
    <div class="app-shell">
      <nav class="side">
        <a href="/account-summary">${t.mainPage}</a>
        <a href="/account-summary">${t.accountSummary}</a>
        <a href="#" onclick="return false;">${t.paymentsAndTransfers}</a>
        <a href="/transfer" class="active" style="padding-left:1.75rem;">${t.transfers}</a>
        <a href="#" onclick="return false;" style="padding-left:1.75rem;">${t.billPayments}</a>
        <a href="#" onclick="return false;" style="padding-left:1.75rem;">${t.payroll}</a>
      </nav>
      <main>
        <h1>${t.transfers}</h1>
        <p class="hint">Mock only -- submitting this form never moves real money, no matter what.</p>
        ${error ? `<p class="error">${error}</p>` : ""}
        <div class="account-card" style="max-width:480px;">
          <form method="post" action="/transfer">
            <input type="hidden" name="language" value="${lang}" />
            <label for="fromAccount">From Account</label>
            <input id="fromAccount" name="fromAccount" value="434-215406-4 (${session.company})" readonly />
            <label for="toAccount">To Account</label>
            <input id="toAccount" name="toAccount" placeholder="e.g. 111-222333-4" required />
            <label for="amount">Amount (THB)</label>
            <input id="amount" name="amount" type="number" min="0.01" step="0.01" required />
            <label for="memo">Memo</label>
            <input id="memo" name="memo" placeholder="optional" />
            <button type="submit" data-testid="transfer-submit-btn" style="margin-top:1.25rem;">Transfer</button>
          </form>
          <form method="post" action="/dev/session-timeout-overlay" style="margin-top:0.5rem;"><button type="submit" style="background:#9a6700;">Simulate session timeout (dev)</button></form>
        </div>
      </main>
    </div>
    ${session.showTimeoutOverlay ? timeoutOverlayHtml() : ""}`,
    lang,
  );
}

function transferConfirmPage(session: Session): string {
  const pending = session.pendingTransfer;
  const lang = session.language;
  const t = TRANSLATIONS[lang];
  return page(
    "Confirm Transfer",
    `${announcementBanner()}
    <div class="topbar">
      <span>${t.lastLoggedIn}: ${formatLastUpdated(new Date().toISOString())}</span>
      <span>${t.welcome} ${session.username}</span>
    </div>
    <div class="app-shell">
      <main>
        <h1>Confirm Transfer</h1>
        <p class="hint">Mock only -- confirming this never moves real money, no matter what.</p>
        <div class="account-card" style="max-width:480px;">
          <div><strong>From:</strong> 434-215406-4 (${session.company})</div>
          <div><strong>To:</strong> ${pending?.toAccount ?? ""}</div>
          <div><strong>Amount:</strong> ${pending ? formatThb(pending.amount) : "0.00"} THB</div>
          <div><strong>Memo:</strong> ${pending?.memo || "(none)"}</div>
          <div style="margin-top:1.25rem;">
            <form method="post" action="/transfer/confirm" style="display:inline-block;">
              <button type="submit" data-testid="confirm-transfer-btn">Confirm Transfer</button>
            </form>
            <form method="post" action="/transfer/cancel" style="display:inline-block;margin-left:0.5rem;">
              <button type="submit" style="background:#888;">Cancel</button>
            </form>
          </div>
        </div>
      </main>
    </div>
    ${session.showTimeoutOverlay ? timeoutOverlayHtml() : ""}`,
    lang,
  );
}

function transferSuccessPage(lang: Lang): string {
  return page(
    "Transfer Submitted",
    `${announcementBanner()}
    <div class="auth-shell">
      <div class="card">
        <h1>Mock Transfer Submitted</h1>
        <p>This is a mock result only -- no real funds were moved.</p>
        <a class="btn" href="/account-summary">Back to Account Summary</a>
      </div>
    </div>`,
    lang,
  );
}

app.get("/", (_req, res) => {
  res.send(page("SCB Business Anywhere (mock)", `<p style="padding:2rem;">SCB Business Anywhere mock is running. <a href="/login">Log in</a></p>`));
});

app.get("/login", (req, res) => {
  const session = getSession(req.cookies[COOKIE_NAME]);
  if (session?.authenticated && !session.forcedLoggedOut) {
    res.redirect("/account-summary");
    return;
  }
  if (session?.username && !session.forcedLoggedOut) {
    res.redirect("/password");
    return;
  }
  const lang = resolveLanguage(req.query.language, session);
  res.send(loginPage(session, undefined, lang));
});

app.post("/login", (req, res) => {
  const lang = isLang(req.body.language) ? req.body.language : "th";
  const username = String(req.body.username ?? "").trim();
  if (!username) {
    res.send(loginPage(undefined, "Username is required.", lang));
    return;
  }
  const session = createSession();
  session.username = username;
  session.language = lang;
  res.cookie(COOKIE_NAME, session.id, { httpOnly: true });
  // Bare URL, no ?language= -- session.language (just set above) already
  // carries it forward; GET /password falls back to the session when
  // the query param is absent (see resolveLanguage()). Found live that
  // adding ?language= here changed this redirect's URL shape in a way
  // that broke an external caller's own strict URL check (AuthBridge's
  // mock-login flow) -- the query param was never actually required for
  // correctness, so removing it restores the original bare URL with no
  // loss of continuity.
  res.redirect("/password");
});

app.get("/password", (req, res) => {
  const session = getSession(req.cookies[COOKIE_NAME]);
  if (!session || session.authenticated) {
    res.redirect("/login");
    return;
  }
  const lang = resolveLanguage(req.query.language, session);
  session.language = lang;
  res.send(passwordPage(session, undefined, lang));
});

app.post("/password", (req, res) => {
  const session = getSession(req.cookies[COOKIE_NAME]);
  if (!session) {
    res.redirect("/login");
    return;
  }
  const lang = isLang(req.body.language) ? req.body.language : session.language;
  session.language = lang;
  const password = String(req.body.password ?? "");
  if (!password) {
    res.send(passwordPage(session, "Password is required.", lang));
    return;
  }
  session.authenticated = true;
  session.forcedLoggedOut = false;
  // Same reasoning as the /login -> /password redirect above -- bare
  // URL, session.language already carries it forward.
  res.redirect("/account-summary");
});

app.get("/account-summary", (req, res) => {
  const session = getSession(req.cookies[COOKIE_NAME]);
  if (!session?.authenticated || session.forcedLoggedOut) {
    res.redirect("/login");
    return;
  }
  if (req.query.refresh) {
    session.lastRefreshedAt = new Date().toISOString();
    res.redirect("/account-summary");
    return;
  }
  session.language = resolveLanguage(req.query.language, session);
  res.send(accountSummaryPage(session));
});

app.get("/transfer", (req, res) => {
  const session = getSession(req.cookies[COOKIE_NAME]);
  if (!session?.authenticated || session.forcedLoggedOut) {
    res.redirect("/login");
    return;
  }
  session.language = resolveLanguage(req.query.language, session);
  res.send(transferFormPage(session));
});

app.post("/transfer", (req, res) => {
  const session = getSession(req.cookies[COOKIE_NAME]);
  if (!session?.authenticated || session.forcedLoggedOut) {
    res.redirect("/login");
    return;
  }
  if (isLang(req.body.language)) session.language = req.body.language;
  const toAccount = String(req.body.toAccount ?? "").trim();
  const amount = Number(req.body.amount);
  const memo = String(req.body.memo ?? "").trim();
  if (!toAccount || !Number.isFinite(amount) || amount <= 0) {
    res.send(transferFormPage(session, "Enter a valid destination account and a positive amount."));
    return;
  }
  session.pendingTransfer = { toAccount, amount, memo };
  res.send(transferConfirmPage(session));
});

app.post("/transfer/confirm", (req, res) => {
  const session = getSession(req.cookies[COOKIE_NAME]);
  if (!session?.authenticated || session.forcedLoggedOut) {
    res.redirect("/login");
    return;
  }
  const pending = session.pendingTransfer;
  if (pending) {
    session.extraTransactions.unshift(
      makeManualTransaction(
        "debit",
        pending.amount,
        `MOCK Transfer to ${pending.toAccount}${pending.memo ? `: ${pending.memo}` : ""} (not a real transaction)`,
      ),
    );
    session.pendingTransfer = null;
  }
  res.send(transferSuccessPage(session.language));
});

app.post("/transfer/cancel", (req, res) => {
  const session = getSession(req.cookies[COOKIE_NAME]);
  if (session) session.pendingTransfer = null;
  res.redirect("/transfer");
});

app.post("/select-company", (req, res) => {
  const session = getSession(req.cookies[COOKIE_NAME]);
  if (!session?.authenticated) {
    res.redirect("/login");
    return;
  }
  const company = String(req.body.company ?? "");
  if (MOCK_COMPANIES.includes(company)) {
    session.company = company;
  }
  res.redirect("/account-summary");
});

app.post("/logout", (req, res) => {
  const session = getSession(req.cookies[COOKIE_NAME]);
  if (session) session.authenticated = false;
  res.redirect("/login");
});

app.post("/logout-clean", (req, res) => {
  deleteSession(req.cookies[COOKIE_NAME]);
  res.clearCookie(COOKIE_NAME);
  res.redirect("/login");
});

// --- Dev-only test controls (documented, not hidden) ---

app.post("/dev/add-transaction", (req, res) => {
  const session = getSession(req.cookies[COOKIE_NAME]);
  if (!session?.authenticated) {
    res.redirect("/login");
    return;
  }
  const direction = req.body.direction === "debit" ? "debit" : "credit";
  const amount = Number(req.body.amount) || 100;
  const description = typeof req.body.description === "string" ? req.body.description : undefined;
  session.extraTransactions.unshift(makeManualTransaction(direction, amount, description));
  res.redirect("/account-summary");
});

// Mock equivalent of the real site's idle-timeout, redirect-to-login
// variant -- matches the "SESSION_EXPIRED: expected nav not found"
// path check-transactions.ts already handles.
app.post("/dev/force-logout", (req, res) => {
  const session = getSession(req.cookies[COOKIE_NAME]);
  if (session) {
    session.authenticated = false;
    session.forcedLoggedOut = true;
  }
  res.redirect("/account-summary");
});

// Overlay variant -- the page stays up (still authenticated
// underneath), only the dialog appears on top. Redirects back to
// wherever the request came from (Referer) so triggering this while
// on /transfer shows the overlay over the transfer page, not just
// account-summary -- falls back to /account-summary if there's no
// Referer (e.g. triggered directly via curl/API).
app.post("/dev/session-timeout-overlay", (req, res) => {
  const session = getSession(req.cookies[COOKIE_NAME]);
  if (session) session.showTimeoutOverlay = true;
  const referer = req.get("referer");
  res.redirect(referer && referer.includes("/transfer") ? "/transfer" : "/account-summary");
});

// The overlay's own "OK" button posts here -- the ONLY way the
// overlay ever clears. No auto-dismiss, no timeout-based bypass,
// deliberately, so a test always has to actually interact with it.
app.post("/dev/acknowledge-timeout", (req, res) => {
  const session = getSession(req.cookies[COOKIE_NAME]);
  if (session) {
    session.showTimeoutOverlay = false;
    session.authenticated = false;
    session.forcedLoggedOut = true;
  }
  res.redirect("/login");
});

app.listen(PORT, () => {
  console.log(`SCB Business Anywhere mock listening on :${PORT}`);
});
