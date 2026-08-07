import type { Page } from "playwright-core";

// All company/account entries known to exist in this account's
// switcher dropdown, in the exact text they render as. The dropdown's
// closed-state header shows whichever one is currently active as its
// own clickable label (e.g. "เซซุส" alone, or "บริษัท 2 ยู เอสเตท
// จำกัด") -- there's no single stable selector for "the header"
// itself, so opening it reliably means checking each known name in
// turn to find whichever one is currently showing.
export const KNOWN_COMPANIES = ["เซซุส", "บริษัท 2 ยู เอสเตท จำกัด", "กฤษฎิ์ ดำประสงค์"];

// Clicks the given company in the switcher, opening the dropdown
// first if needed. Never touches a credential, never navigates away.
export async function selectCompany(page: Page, companyName: string): Promise<void> {
  const target = page.getByText(companyName, { exact: true }).first();
  if (await target.isVisible({ timeout: 1500 }).catch(() => false)) {
    // Already visible -- either it's already the active header (a
    // harmless re-click) or the dropdown happens to already be open
    // with it in the list.
    await target.click();
    await page.waitForTimeout(800);
    return;
  }
  // Not visible -- the dropdown must be closed and showing some other
  // company as its header. Find which one and click it to open the
  // dropdown, then the target becomes clickable in the opened list.
  for (const name of KNOWN_COMPANIES) {
    if (name === companyName) continue;
    const header = page.getByText(name, { exact: true }).first();
    if (await header.isVisible({ timeout: 1000 }).catch(() => false)) {
      await header.click();
      await page.waitForTimeout(600);
      break;
    }
  }
  await target.click();
  await page.waitForTimeout(800);
}
