import type { Page } from "playwright-core";

// Mock third-party site run by services/xc-bank -- reached only over
// HTTP like any other external site (network-only channel, no shared
// code/DB/queue with WebOperator). See docs/PROJECT_PLAN.md decision log.
const BASE_URL = process.env.XC_BANK_BASE_URL ?? "http://xc-bank:3000";

export interface LoginResult {
  // "fresh": no session at all -- filled both username and password.
  // "remembered-username": a pending session already had the username
  // (from a prior partial login, or after a plain /logout) -- the site
  // redirected /login straight to /password, so only password was filled.
  // "already-authenticated": a fully authenticated session was still
  // active -- /login redirected straight to /dashboard, nothing filled.
  path: "fresh" | "remembered-username" | "already-authenticated";
}

export async function login(
  page: Page,
  credentials: { username: string; password: string },
): Promise<LoginResult> {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });

  if (/\/dashboard$/.test(page.url())) {
    return { path: "already-authenticated" };
  }

  if (/\/password$/.test(page.url())) {
    // Username already remembered by the site -- don't re-fill it.
    await page.fill("#password", credentials.password);
    await page.click("button[type=submit]");
    await page.waitForURL(/\/dashboard$/);
    return { path: "remembered-username" };
  }

  // Still on /login: a genuinely fresh session, fill both steps.
  await page.fill("#username", credentials.username);
  await page.click("button[type=submit]");

  await page.waitForURL(/\/password$/);
  await page.fill("#password", credentials.password);
  await page.click("button[type=submit]");

  await page.waitForURL(/\/dashboard$/);
  return { path: "fresh" };
}

export interface LogoutCleanResult {
  wasAlreadyClean: boolean;
}

// Dev/test-only reset utility -- clicks the real "Logout clean" button
// via the DOM (never a raw request to the route), same isolation posture
// as every other adapter function here. Idempotent: if there's no
// session at all, there's nothing to click and this is a no-op.
export async function logoutClean(page: Page): Promise<LogoutCleanResult> {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });

  if (/\/login$/.test(page.url())) {
    return { wasAlreadyClean: true };
  }

  await page.click("#logout-clean-btn");
  await page.waitForURL(/\/login$/);
  return { wasAlreadyClean: false };
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
