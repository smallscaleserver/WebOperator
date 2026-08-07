import type { Page } from "playwright-core";

// All company/account entries known to exist in this account's
// switcher dropdown, in the exact text they render as. The dropdown's
// closed-state header shows whichever one is currently active as its
// own clickable label (e.g. "เซซุส" alone, or "บริษัท 2 ยู เอสเตท
// จำกัด") -- there's no single stable selector for "the header"
// itself, so opening it reliably means checking each known name in
// turn to find whichever one is currently showing.
export const KNOWN_COMPANIES = ["เซซุส", "บริษัท 2 ยู เอสเตท จำกัด", "กฤษฎิ์ ดำประสงค์"];

async function visibleCompanies(page: Page): Promise<string[]> {
  const results = await Promise.all(
    KNOWN_COMPANIES.map(async (name) => {
      const visible = await page.getByText(name, { exact: true }).first().isVisible({ timeout: 500 }).catch(() => false);
      return visible ? name : null;
    }),
  );
  return results.filter((n): n is string => n !== null);
}

// Clicks the given company in the switcher, opening the dropdown
// first if needed. Never touches a credential, never navigates away.
//
// Two real failure modes found empirically (not assumed), both fixed
// here:
// 1. Clicking the header when it's *already* showing the target
//    company doesn't no-op -- it's the same toggle button that opens
//    the dropdown, so clicking it again actually opens the menu,
//    whose own popover overlay then blocks that very click's own
//    actionability retries, hanging for the full 30s timeout.
// 2. If a *previous* run left the dropdown open (e.g. it hung/was
//    killed mid-selection), every subsequent run inherits that open
//    state and clicking the already-highlighted target item doesn't
//    reliably close the menu either (same overlay-blocks-itself
//    symptom).
// Fixed by always pressing Escape first (harmless no-op if nothing
// was open, and confirmed directly to close a real stuck-open
// dropdown) to guarantee a known closed state, then only opening/
// clicking if the target isn't already the (now-confirmed-closed)
// active header.
export async function selectCompany(page: Page, companyName: string): Promise<void> {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);

  const visible = await visibleCompanies(page);
  if (visible.length === 1 && visible[0] === companyName) {
    // Confirmed closed, target is already the active header -- done.
    return;
  }

  const header = page.getByText(visible[0] ?? KNOWN_COMPANIES[0], { exact: true }).first();
  await header.click();
  await page.waitForTimeout(600);
  await page.getByText(companyName, { exact: true }).first().click();
  await page.waitForTimeout(800);
  // The dropdown's own overlay (MUI's Popover backdrop) can linger
  // and intercept clicks elsewhere on the page for a moment after
  // selecting -- wait for it to actually detach before returning, not
  // just a fixed extra delay.
  await page
    .locator(".MuiPopover-root")
    .first()
    .waitFor({ state: "hidden", timeout: 5000 })
    .catch(() => {});
}
