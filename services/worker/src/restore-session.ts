import { connectToChromium } from "./cdp.js";
import { step } from "./steps.js";

const CDP_URL = process.env.CDP_URL ?? "http://localhost:9222";
const TARGET_URL = process.env.TARGET_URL ?? "https://example.com";
const SESSION_FILE = process.env.SESSION_FILE ?? "/app/sessions/example.json";
const MARKER_KEY = "weboperator-marker";

async function main(): Promise<void> {
  const browser = await step("connect", () => connectToChromium(CDP_URL));

  // A fresh, isolated context — deliberately NOT the default/visible one —
  // to prove the session data is portable rather than "still there because
  // it's the same context."
  const context = await step("restore-context", () => browser.newContext({ storageState: SESSION_FILE }));
  const page = await context.newPage();

  await step("navigate", () => page.goto(TARGET_URL, { waitUntil: "domcontentloaded" }));

  const { cookieValue, localStorageValue } = await step("read-marker", async () => {
    const cookies = await context.cookies(TARGET_URL);
    const cookieValue = cookies.find((c) => c.name === MARKER_KEY)?.value ?? "(missing)";
    const localStorageValue = await page.evaluate((key) => localStorage.getItem(key), MARKER_KEY);
    return { cookieValue, localStorageValue };
  });

  console.log(`Restored cookie "${MARKER_KEY}" = "${cookieValue}"`);
  console.log(`Restored localStorage "${MARKER_KEY}" = "${localStorageValue ?? "(missing)"}"`);

  // This context was created by this script, unlike the shared default
  // context — safe to close without touching the underlying browser
  // entrypoint.sh owns.
  await context.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("restore-session failed:", err);
  process.exit(1);
});
