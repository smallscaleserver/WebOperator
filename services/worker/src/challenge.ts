import type { Page } from "playwright-core";

// Basic challenge-page detector -- checks rendered page text for common
// CAPTCHA/verification/2FA wording. On a match, the caller stops and
// reports a clear error; this module never attempts to solve or bypass
// anything, by design. See docs/PROJECT_PLAN.md decision log ("polite
// automation, not bypass").
const CHALLENGE_KEYWORDS: RegExp[] = [
  /captcha/i,
  /verification/i,
  /verify your identity/i,
  /\b2fa\b/i,
  /two-factor/i,
  /two factor/i,
];

export async function detectChallenge(page: Page): Promise<string | null> {
  const text = (await page.locator("body").textContent().catch(() => "")) ?? "";
  const hit = CHALLENGE_KEYWORDS.find((re) => re.test(text));
  return hit ? hit.source : null;
}
