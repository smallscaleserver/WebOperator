import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Page, BrowserContext } from "playwright-core";
import * as xcBank from "../adapters/xc-bank.js";
import { getPolicy, humanFill, type SitePolicy } from "../policy.js";

const DEFAULT_POLICY = getPolicy();

export interface ActionContext {
  page: Page;
  context: BrowserContext;
  // Optional -- run-workflow.ts always provides the resolved per-site
  // policy; falls back to the generic default for any handler invoked
  // outside that path (nothing currently does).
  policy?: SitePolicy;
}

export type ActionParams = Record<string, unknown>;
export type ActionHandler = (ctx: ActionContext, params: ActionParams) => Promise<unknown>;

const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/app/output";

function requireString(params: ActionParams, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required string param "${key}"`);
  }
  return value;
}

function cleanText(raw: string): string {
  return raw.replace(/×/g, "").replace(/\s+/g, " ").trim();
}

// Shared with record-actions.ts, which writes this exact string into a
// typeText step instead of a real keystroke whenever the recording
// target was a password-type (or autocomplete=*-password) field --
// never the real value, no matter what. If a step carrying this
// sentinel is ever replayed, typeText below refuses to type anything
// and throws instead, so a script that somehow still contains one
// fails loudly rather than silently typing a placeholder into a real
// field. See docs/PROJECT_PLAN.md's credential-handling decision log.
export const REDACTED_FIELD_SENTINEL = " WEBOP_REDACTED_CREDENTIAL_FIELD ";

export const ACTION_HANDLERS: Record<string, ActionHandler> = {
  navigate: async ({ page }, params) => {
    const url = requireString(params, "url");
    await page.goto(url, { waitUntil: "domcontentloaded" });
  },

  // Generalizes adapters/the-internet.ts's dismissAdIfPresent. The site
  // shows its modal via setTimeout(showAd, 500), not on initial render, so
  // this waits for visibility rather than checking isVisible() immediately
  // — the lesson from that adapter, now baked into the generic handler.
  dismissPopup: async ({ page }, params) => {
    const selector = requireString(params, "selector");
    const closeSelector = requireString(params, "closeSelector");
    const timeoutMs = Number(params.timeoutMs ?? 2000);
    const appeared = await page
      .locator(selector)
      .waitFor({ state: "visible", timeout: timeoutMs })
      .then(() => true)
      .catch(() => false);
    if (appeared) {
      await page.locator(closeSelector).click();
    }
    return { dismissed: appeared };
  },

  login: async ({ page, policy }, params) => {
    const usernameSelector = requireString(params, "usernameSelector");
    const passwordSelector = requireString(params, "passwordSelector");
    const submitSelector = requireString(params, "submitSelector");
    const username = requireString(params, "username");
    const password = requireString(params, "password");
    const flashSelector = typeof params.flashSelector === "string" ? params.flashSelector : undefined;
    const successClass = typeof params.successClass === "string" ? params.successClass : undefined;
    const activePolicy = policy ?? DEFAULT_POLICY;

    await humanFill(page.locator(usernameSelector), username, activePolicy);
    await humanFill(page.locator(passwordSelector), password, activePolicy);
    await page.click(submitSelector);

    if (!flashSelector) return undefined;

    const flash = page.locator(flashSelector);
    await flash.waitFor({ state: "visible" });
    const message = cleanText((await flash.textContent()) ?? "");
    const success = successClass
      ? await flash.evaluate((el, cls) => el.classList.contains(cls), successClass)
      : true;
    if (!success) {
      throw new Error(`Login failed: ${message}`);
    }
    return message;
  },

  extract: async ({ page }, params) => {
    const selector = requireString(params, "selector");
    const text = (await page.locator(selector).textContent()) ?? "";
    return cleanText(text);
  },

  saveSession: async ({ context }, params) => {
    const path = requireString(params, "path");
    await mkdir(dirname(path), { recursive: true });
    await context.storageState({ path });
  },

  screenshot: async ({ page }, params) => {
    const filename = requireString(params, "filename");
    await mkdir(OUTPUT_DIR, { recursive: true });
    await page.screenshot({ path: join(OUTPUT_DIR, filename) });
  },

  // XC Bank (services/xc-bank) is an isolated mock third-party site --
  // these three actions only ever touch it through the DOM via `page`,
  // exactly like any other adapter in this registry; see
  // adapters/xc-bank.ts and docs/PROJECT_PLAN.md's decision log.
  xcBankLogin: async ({ page, policy }, params) => {
    const username = requireString(params, "username");
    const password = requireString(params, "password");
    const result = await xcBank.login(page, { username, password }, policy ?? DEFAULT_POLICY);
    switch (result.path) {
      case "already-authenticated":
        return `Already authenticated as ${username} (session reused, password step skipped)`;
      case "remembered-username":
        return `Username remembered as ${username} (site skipped straight to password)`;
      case "fresh":
        return `Logged in as ${username} (fresh two-step login)`;
    }
  },

  xcBankExtractDashboard: async ({ page }) => {
    const summary = await xcBank.extractDashboard(page);
    // Single-line, prefixed marker -- same convention as WEBOP_STEP in
    // steps.ts -- so a caller (e.g. the Control Panel's XC Bank monitor)
    // can reliably grep the full structured detail out of stdout. The
    // returned string below is what the regular Jobs UI shows, reusing
    // the existing data-rendering path instead of new UI code there.
    console.log(`XC_BANK_DASHBOARD ${JSON.stringify(summary)}`);
    return `Balance: $${summary.balance.toFixed(2)} | ${summary.transactionCount} transaction(s)`;
  },

  // Dev/test-only reset helper -- clicks XC Bank's real "Logout clean"
  // button, not a raw request to its route. Not simulating real bank
  // behavior; exists purely so a workflow can reset test state on demand.
  xcBankLogoutClean: async ({ page }) => {
    const result = await xcBank.logoutClean(page);
    return result.wasAlreadyClean
      ? "Already clean (no session to log out of)"
      : "Logged out and cleared session (next login will be fresh)";
  },

  // Recorder-generated action: element-first, pixel-fallback. A short
  // locator timeout (not the default ~30s) so a genuinely missing
  // element fails fast into the pixel path instead of hanging --
  // matches the same "don't blindly wait the default timeout" lesson
  // already applied elsewhere in this codebase (check-transactions.ts).
  clickSmart: async ({ page }, params) => {
    const selector = requireString(params, "selector");
    const x = Number(params.x);
    const y = Number(params.y);
    const locator = page.locator(selector).first();
    const foundElement = await locator.isVisible({ timeout: 2000 }).catch(() => false);
    if (foundElement) {
      await locator.click();
      return { via: "element", selector };
    }
    if (Number.isFinite(x) && Number.isFinite(y)) {
      await page.mouse.click(x, y);
      return { via: "pixel", x, y };
    }
    throw new Error(`clickSmart: element "${selector}" not found and no pixel fallback (x/y) provided`);
  },

  pressKey: async ({ page }, params) => {
    const key = requireString(params, "key");
    await page.keyboard.press(key);
  },

  // Recorder-generated action for ordinary (non-credential) text
  // fields. Refuses outright if the recorded text is the redaction
  // sentinel above -- see its comment for why this must be a loud
  // failure, never a silent skip or a placeholder keystroke.
  typeText: async ({ page }, params) => {
    const selector = requireString(params, "selector");
    const text = requireString(params, "text");
    if (text === REDACTED_FIELD_SENTINEL) {
      throw new Error(
        "REDACTED_FIELD: this step targets a credential field that was intentionally never recorded -- fill it manually via noVNC, this script cannot and will not do it",
      );
    }
    await page.locator(selector).fill(text);
  },
};
