import type { Locator } from "playwright-core";

// Per-site "polite automation" policy -- pacing/locale so a workflow run
// doesn't look like a script hammering the site at a robotic, identical
// cadence every time. This is a false-positive-reduction measure, not a
// fingerprint-evasion one: it does not touch navigator.webdriver, CDP
// artifacts, or anything that would misrepresent what the client is. See
// docs/PROJECT_PLAN.md decision log ("polite automation, not bypass").
export interface SitePolicy {
  locale: string;
  timezoneId: string;
  actionDelayMs: { min: number; max: number };
  typingDelayMs: number;
}

const DEFAULT_POLICY: SitePolicy = {
  locale: "en-US",
  timezoneId: "UTC",
  actionDelayMs: { min: 150, max: 500 },
  typingDelayMs: 40,
};

// Add a new entry here for each future site's own workflows -- no other
// code needs to change (same extensibility shape as
// services/control-panel/src/monitors-registry.ts).
const SITE_POLICIES: Record<string, SitePolicy> = {
  "xc-bank": {
    locale: "th-TH",
    timezoneId: "Asia/Bangkok",
    actionDelayMs: { min: 200, max: 800 },
    typingDelayMs: 60,
  },
};

export function getPolicy(siteId?: string): SitePolicy {
  return (siteId && SITE_POLICIES[siteId]) || DEFAULT_POLICY;
}

export function randomDelay(range: { min: number; max: number }): number {
  return Math.round(range.min + Math.random() * (range.max - range.min));
}

// Types a value character-by-character at the policy's pace instead of
// Playwright's instant fill() -- the same final input value, just typed
// at a plausible speed rather than appearing all at once.
export async function humanFill(locator: Locator, text: string, policy: SitePolicy): Promise<void> {
  await locator.pressSequentially(text, { delay: policy.typingDelayMs });
}
