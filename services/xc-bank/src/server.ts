import express from "express";
import cookieParser from "cookie-parser";
import { createSession, getSession, type Session } from "./sessions.js";
import { generateDashboard } from "./transactions.js";

const PORT = Number(process.env.PORT ?? 3000);
const COOKIE_NAME = "xcbank_session";
const DEMO_USERNAME = "demo_user";
const DEMO_PASSWORD = "demo_pass";

const app = express();
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title} — XC Bank</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 480px; margin: 3rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.3rem; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 1.5rem; }
  label { display: block; margin: 0.75rem 0 0.25rem; font-size: 0.9rem; }
  input { width: 100%; padding: 0.5rem; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px; }
  button { margin-top: 1.25rem; padding: 0.5rem 1.2rem; cursor: pointer; }
  .error { color: #b00020; font-size: 0.9rem; }
  .hint { color: #666; font-size: 0.8rem; }
</style>
</head>
<body>
<h1>XC Bank <span style="font-weight:normal;font-size:0.7em;color:#888">(mock)</span></h1>
${body}
</body>
</html>`;
}

function dashboardPage(session: Session): string {
  const { balance, transactions } = generateDashboard(session.id, session.regenerateEpoch);
  const showBanner = Math.floor(Date.now() / 10_000) % 3 === 0;

  const rows = transactions
    .map(
      (t) => `<tr data-tx-id="${t.id}" data-direction="${t.direction}">
        <td class="tx-timestamp">${t.timestamp}</td>
        <td class="tx-direction">${t.direction === "credit" ? "Credit" : "Debit"}</td>
        <td class="tx-counterparty">${t.counterpartyName} (${t.counterpartyAccount})</td>
        <td class="tx-amount">${t.direction === "credit" ? "+" : "-"}$${t.amount.toFixed(2)}</td>
        <td class="tx-balance-after">$${t.balanceAfter.toFixed(2)}</td>
        <td class="tx-reference">${t.id}</td>
      </tr>`,
    )
    .join("\n");

  const banner = showBanner
    ? `<div id="promo-banner" style="background:#fff8dc;border:1px solid #e6d38a;padding:0.6rem;border-radius:6px;margin-bottom:1rem;">
        New: XC Bank Premium is here. <button id="dismiss-banner" onclick="this.parentElement.remove()">Dismiss</button>
      </div>`
    : "";

  return page(
    "Dashboard",
    `<div class="card">
      ${banner}
      <p class="hint">Signed in as ${session.username}</p>
      <h2>Current balance: <span id="balance-amount">$${balance.toFixed(2)}</span></h2>
      <table id="transactions" style="width:100%;border-collapse:collapse;font-size:0.9rem;">
        <thead><tr>
          <th style="text-align:left">Time</th><th style="text-align:left">Type</th>
          <th style="text-align:left">Counterparty</th><th style="text-align:left">Amount</th>
          <th style="text-align:left">Balance</th><th style="text-align:left">Ref</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <form method="post" action="/dev/regenerate" style="margin-top:1rem;">
        <button type="submit">Regenerate data (dev-only)</button>
      </form>
    </div>`,
  );
}

app.get("/", (_req, res) => {
  res.status(200).send(page("XC Bank", `<p>XC Bank mock site is running. <a href="/login">Log in</a></p>`));
});

app.get("/login", (req, res) => {
  const session = getSession(req.cookies[COOKIE_NAME]);
  if (session?.authenticated) {
    res.redirect("/dashboard");
    return;
  }
  const error = req.query.error ? `<p class="error">Unknown username. Try "${DEMO_USERNAME}".</p>` : "";
  res.send(
    page(
      "Log in",
      `<div class="card">
        <p class="hint">Test account: username "${DEMO_USERNAME}", password "${DEMO_PASSWORD}" -- mock only, not a real credential.</p>
        ${error}
        <form method="post" action="/login">
          <label for="username">Username</label>
          <input id="username" name="username" autofocus />
          <button type="submit">Continue</button>
        </form>
      </div>`,
    ),
  );
});

app.post("/login", (req, res) => {
  const username = String(req.body.username ?? "");
  if (username !== DEMO_USERNAME) {
    res.redirect("/login?error=1");
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
  const error = req.query.error ? `<p class="error">Incorrect password.</p>` : "";
  res.send(
    page(
      "Password",
      `<div class="card">
        <p class="hint">Signing in as ${session.username}</p>
        ${error}
        <form method="post" action="/password">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autofocus />
          <button type="submit">Sign in</button>
        </form>
      </div>`,
    ),
  );
});

app.post("/password", (req, res) => {
  const session = getSession(req.cookies[COOKIE_NAME]);
  if (!session) {
    res.redirect("/login");
    return;
  }
  const password = String(req.body.password ?? "");
  if (password !== DEMO_PASSWORD) {
    res.redirect("/password?error=1");
    return;
  }
  session.authenticated = true;
  res.redirect("/dashboard");
});

app.get("/dashboard", (req, res) => {
  const session = getSession(req.cookies[COOKIE_NAME]);
  if (!session?.authenticated) {
    res.redirect("/login");
    return;
  }
  res.send(dashboardPage(session));
});

// Dev-only: forces a fresh seed immediately, without waiting for the
// 10s time window to roll over -- not a hidden feature, documented in
// AGENTS.md/README.md.
app.post("/dev/regenerate", (req, res) => {
  const session = getSession(req.cookies[COOKIE_NAME]);
  if (!session?.authenticated) {
    res.redirect("/login");
    return;
  }
  session.regenerateEpoch += 1;
  res.redirect("/dashboard");
});

app.listen(PORT, () => {
  console.log(`XC Bank mock site listening on :${PORT}`);
});
