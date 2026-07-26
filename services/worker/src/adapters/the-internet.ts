import type { Page } from "playwright-core";

const BASE_URL = "https://the-internet.herokuapp.com";

export interface LoginResult {
  success: boolean;
  message: string;
}

// the-internet.herokuapp.com is a small, free practice app built specifically
// for people to automate against; these are its own publicly documented test
// credentials, not a secret.
export const DEMO_CREDENTIALS = {
  username: "tomsmith",
  password: "SuperSecretPassword!",
};

// The #flash element's textContent includes its nested "×" close-icon link
// and the whitespace around it — strip both so callers get just the message.
function cleanFlashText(raw: string): string {
  return raw.replace(/×/g, "").replace(/\s+/g, " ").trim();
}

export async function dismissAdIfPresent(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/entry_ad`, { waitUntil: "domcontentloaded" });
  const modal = page.locator("#modal");
  // The page shows the modal via `setTimeout(showAd, 500)`, not on initial
  // render — wait for it rather than checking visibility immediately.
  const appeared = await modal
    .waitFor({ state: "visible", timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) {
    await page.locator(".modal-footer p").click();
    console.log("Ad modal was present — dismissed it.");
  } else {
    console.log("No ad modal present.");
  }
}

export async function login(
  page: Page,
  credentials: { username: string; password: string },
): Promise<LoginResult> {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#username", credentials.username);
  await page.fill("#password", credentials.password);
  await page.click("button[type='submit']");

  const flash = page.locator("#flash");
  await flash.waitFor({ state: "visible" });
  const message = cleanFlashText((await flash.textContent()) ?? "");
  const success = await flash.evaluate((el) => el.classList.contains("success"));

  return { success, message };
}

export async function extractSecureAreaMessage(page: Page): Promise<string> {
  const flash = page.locator("#flash");
  return cleanFlashText((await flash.textContent()) ?? "");
}
