import express from "express";
import cookieParser from "cookie-parser";
import { createSession, deleteSession, getSession, MOCK_COMPANIES, type Session } from "./sessions.js";
import { generateBaselineTransactions, computeBalances, makeManualTransaction, type Transaction } from "./transactions.js";

const PORT = Number(process.env.PORT ?? 3000);
const COOKIE_NAME = "scbmock_session";

const app = express();
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));

// Purple theme roughly matching the real site's look -- not pixel-
// perfect, close enough that a screenshot is recognizable at a glance.
function page(title: string, body: string, wide = false): string {
  return `<!doctype html>
<html lang="en">
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
  ${wide ? "" : ""}
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

// Login-page marker check-transactions.ts's SESSION_EXPIRED detection
// looks for on the real site -- included here so that same detection
// logic is directly testable against this mock unchanged.
function loginPage(session: Session | undefined, error?: string): string {
  return page(
    "Log in",
    `${announcementBanner()}
    <div class="auth-shell">
      <div class="card">
        <h1>SCB Business Anywhere <span class="hint">(mock)</span></h1>
        ${error ? `<p class="error">${error}</p>` : ""}
        <p class="hint">Any non-empty username/password works -- this is a mock, values aren't checked against anything real.</p>
        <form method="post" action="/login">
          <label for="username">ชื่อผู้ใช้งาน</label>
          <span class="hint">(Username)</span>
          <input id="username" name="username" autofocus />
          <button type="submit">Next</button>
        </form>
      </div>
    </div>`,
  );
}

function passwordPage(session: Session, error?: string): string {
  return page(
    "Password",
    `${announcementBanner()}
    <div class="auth-shell">
      <div class="card">
        <h1>SCB Business Anywhere <span class="hint">(mock)</span></h1>
        <p class="hint">Signing in as ${session.username}</p>
        ${error ? `<p class="error">${error}</p>` : ""}
        <form method="post" action="/password">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autofocus />
          <button type="submit">Sign In</button>
        </form>
      </div>
    </div>`,
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

function txRow(t: Transaction, index: number): string {
  const isCredit = t.amount >= 0;
  const amountText = `${formatThb(t.amount)} THB`;
  return `<div class="tx-row">
    <div class="tx-datetime">${t.date}<br>${t.time}</div>
    <div class="tx-code">${t.trCode}</div>
    <div class="tx-desc">${t.description}<br><a href="#" class="add-note" onclick="return false;">Add a Note</a></div>
    <div class="tx-amount ${isCredit ? "credit" : "debit"}" onclick="toggleDetail(${index})">${amountText}</div>
    <div>&#9662;</div>
  </div>
  <div class="tx-detail" id="tx-detail-${index}">
    <div><strong>Transaction Date</strong><br>${t.date} ${t.time}</div>
    <div><strong>Transaction Description</strong><br>Transfer Deposit, Withdrawal Nobook</div>
    <div><strong>Channel</strong><br>${t.channel}</div>
    <div><strong>Cheque No.</strong><br>${t.chequeNo}</div>
    <div><strong>Terminal No.</strong><br>${t.terminalNo}</div>
    <div><strong>Teller No.</strong><br>${t.tellerNo}</div>
    <div><strong>Branch Code</strong><br>${t.branchCode}</div>
  </div>`;
}

function accountSummaryPage(session: Session): string {
  const transactions = allTransactions(session);
  const { available, ledger } = computeBalances(transactions);
  const companyMenu = MOCK_COMPANIES.map(
    (c) => `<button onclick="selectCompany('${c.replace(/'/g, "\\'")}')">${c}</button>`,
  ).join("");

  return page(
    "Account Summary",
    `${announcementBanner()}
    <div class="topbar">
      <span>Last Logged in: ${formatLastUpdated(new Date().toISOString())} | EN</span>
      <span>Welcome ${session.username}</span>
    </div>
    <div class="company-switcher">
      <span class="current" onclick="toggleCompanyMenu()"><span class="company-name">${session.company}</span> <span aria-hidden="true">&#9662;</span></span>
      <div class="company-menu" id="company-menu">${companyMenu}</div>
    </div>
    <div class="app-shell">
      <nav class="side">
        <a href="/account-summary">Main Page</a>
        <a href="/account-summary" class="active">Account Summary</a>
        <a href="#" onclick="return false;">Payments and Transfers</a>
        <a href="/transfer" style="padding-left:1.75rem;">Transfers</a>
        <a href="#" onclick="return false;" style="padding-left:1.75rem;">Bill Payments</a>
        <a href="#" onclick="return false;" style="padding-left:1.75rem;">Payroll</a>
        <a href="#" onclick="return false;">Recipient Profiles</a>
        <a href="#" onclick="return false;">Reports</a>
      </nav>
      <main>
        <h1>Account Details</h1>
        <div class="account-card">
          <div class="balance-row">
            <div>
              <div>${session.company} <span class="hint">Active</span></div>
              <div class="hint">434-215406-4 &middot; Savings Account</div>
            </div>
            <div style="text-align:right;">
              <div class="hint">Available Balance</div>
              <div class="balance-figure">${formatThb(available)} THB</div>
            </div>
          </div>
          <div class="balance-row" style="margin-top:0.5rem;">
            <div class="hint">Last Updated: ${formatLastUpdated(session.lastRefreshedAt)} <a href="/account-summary?refresh=1">Refresh</a></div>
            <div style="text-align:right;">
              <div class="hint">Ledger Balance</div>
              <div class="balance-figure">${formatThb(ledger)} THB</div>
            </div>
          </div>
        </div>

        <h2 style="margin-top:1.5rem;">Latest Transactions</h2>
        <div class="account-card" style="margin-top:0.5rem;">
          ${transactions.map((t, i) => txRow(t, i)).join("\n")}
        </div>

        <div style="margin-top:1.5rem;">
          <form method="post" action="/logout" style="display:inline-block;"><button type="submit">Logout</button></form>
          <form method="post" action="/logout-clean" style="display:inline-block;"><button type="submit">Logout clean</button></form>
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
  );
}

function transferFormPage(session: Session, error?: string): string {
  return page(
    "Transfer",
    `${announcementBanner()}
    <div class="topbar">
      <span>Last Logged in: ${formatLastUpdated(new Date().toISOString())} | EN</span>
      <span>Welcome ${session.username}</span>
    </div>
    <div class="app-shell">
      <nav class="side">
        <a href="/account-summary">Main Page</a>
        <a href="/account-summary">Account Summary</a>
        <a href="#" onclick="return false;">Payments and Transfers</a>
        <a href="/transfer" class="active" style="padding-left:1.75rem;">Transfers</a>
        <a href="#" onclick="return false;" style="padding-left:1.75rem;">Bill Payments</a>
        <a href="#" onclick="return false;" style="padding-left:1.75rem;">Payroll</a>
      </nav>
      <main>
        <h1>Transfer</h1>
        <p class="hint">Mock only -- submitting this form never moves real money, no matter what.</p>
        ${error ? `<p class="error">${error}</p>` : ""}
        <div class="account-card" style="max-width:480px;">
          <form method="post" action="/transfer">
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
  );
}

function transferConfirmPage(session: Session): string {
  const pending = session.pendingTransfer;
  return page(
    "Confirm Transfer",
    `${announcementBanner()}
    <div class="topbar">
      <span>Last Logged in: ${formatLastUpdated(new Date().toISOString())} | EN</span>
      <span>Welcome ${session.username}</span>
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
  );
}

function transferSuccessPage(): string {
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
  res.send(loginPage(session));
});

app.post("/login", (req, res) => {
  const username = String(req.body.username ?? "").trim();
  if (!username) {
    res.send(loginPage(undefined, "Username is required."));
    return;
  }
  const session = createSession();
  session.username = username;
  res.cookie(COOKIE_NAME, session.id, { httpOnly: true });
  res.redirect("/password");
});

app.get("/password", (req, res) => {
  const session = getSession(req.cookies[COOKIE_NAME]);
  if (!session || session.authenticated) {
    res.redirect("/login");
    return;
  }
  res.send(passwordPage(session));
});

app.post("/password", (req, res) => {
  const session = getSession(req.cookies[COOKIE_NAME]);
  if (!session) {
    res.redirect("/login");
    return;
  }
  const password = String(req.body.password ?? "");
  if (!password) {
    res.send(passwordPage(session, "Password is required."));
    return;
  }
  session.authenticated = true;
  session.forcedLoggedOut = false;
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
  res.send(accountSummaryPage(session));
});

app.get("/transfer", (req, res) => {
  const session = getSession(req.cookies[COOKIE_NAME]);
  if (!session?.authenticated || session.forcedLoggedOut) {
    res.redirect("/login");
    return;
  }
  res.send(transferFormPage(session));
});

app.post("/transfer", (req, res) => {
  const session = getSession(req.cookies[COOKIE_NAME]);
  if (!session?.authenticated || session.forcedLoggedOut) {
    res.redirect("/login");
    return;
  }
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
  res.send(transferSuccessPage());
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
