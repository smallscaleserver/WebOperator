import type { Page } from "playwright-core";

// Mock third-party site run by services/xc-bank -- reached only over
// HTTP like any other external site (network-only channel, no shared
// code/DB/queue with WebOperator). See docs/PROJECT_PLAN.md decision log.
const BASE_URL = process.env.XC_BANK_BASE_URL ?? "http://xc-bank:3000";

export interface LoginResult {
  alreadyAuthenticated: boolean;
}

export async function login(
  page: Page,
  credentials: { username: string; password: string },
): Promise<LoginResult> {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });

  // An existing session cookie makes /login redirect straight to
  // /dashboard server-side -- detect that instead of blindly filling a
  // form that may not be there.
  if (/\/dashboard$/.test(page.url())) {
    return { alreadyAuthenticated: true };
  }

  await page.fill("#username", credentials.username);
  await page.click("button[type=submit]");

  await page.waitForURL(/\/password$/);
  await page.fill("#password", credentials.password);
  await page.click("button[type=submit]");

  await page.waitForURL(/\/dashboard$/);
  return { alreadyAuthenticated: false };
}

export interface ExtractedTransaction {
  id: string;
  direction: string;
  amount: number;
  counterparty: string;
}

export interface DashboardSummary {
  balance: number;
  transactionCount: number;
  transactions: ExtractedTransaction[];
}

function parseCurrency(text: string): number {
  // "$1,234.56" / "+$45.00" / "-$45.00" -> 1234.56 / 45 / 45 (sign
  // dropped -- direction is read separately from data-direction).
  const cleaned = text.replace(/[^0-9.]/g, "");
  return Number.parseFloat(cleaned);
}

// Reads exclusively from the rendered DOM via Playwright locators --
// never an internal xc-bank API -- so this genuinely proves live
// extraction, not a hard-coded expectation.
export async function extractDashboard(page: Page): Promise<DashboardSummary> {
  const balanceText = await page.locator("#balance-amount").textContent();
  const balance = parseCurrency(balanceText ?? "");

  const rows = page.locator("table#transactions tr[data-tx-id]");
  const count = await rows.count();
  const transactions: ExtractedTransaction[] = [];

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const id = (await row.getAttribute("data-tx-id")) ?? "";
    const direction = (await row.getAttribute("data-direction")) ?? "";
    const amountText = (await row.locator(".tx-amount").textContent()) ?? "";
    const counterparty = ((await row.locator(".tx-counterparty").textContent()) ?? "").trim();
    transactions.push({ id, direction, amount: parseCurrency(amountText), counterparty });
  }

  return { balance, transactionCount: transactions.length, transactions };
}
