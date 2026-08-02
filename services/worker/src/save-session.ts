import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { connectToChromium } from "./cdp.js";
import { step } from "./steps.js";

const CDP_URL = process.env.CDP_URL ?? "http://localhost:9222";
const TARGET_URL = process.env.TARGET_URL ?? "https://example.com";
const SESSION_FILE = process.env.SESSION_FILE ?? "/app/sessions/example.json";
const MARKER_KEY = "weboperator-marker";

async function main(): Promise<void> {
  const browser = await step("connect", () => connectToChromium(CDP_URL));

  // Same default context/page as index.ts — the one a human could have
  // manually logged into via noVNC.
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  await step("navigate", () => page.goto(TARGET_URL, { waitUntil: "domcontentloaded" }));

  const markerValue = new Date().toISOString();

  await step("set-marker", async () => {
    await context.addCookies([
      {
        name: MARKER_KEY,
        value: markerValue,
        domain: "example.com",
        path: "/",
      },
    ]);
    await page.evaluate(
      ({ key, value }) => localStorage.setItem(key, value),
      { key: MARKER_KEY, value: markerValue },
    );
  });

  await step("save-storage-state", async () => {
    await mkdir(dirname(SESSION_FILE), { recursive: true });
    await context.storageState({ path: SESSION_FILE });
  });

  console.log(`Set marker "${MARKER_KEY}" = "${markerValue}" (cookie + localStorage)`);
  console.log(`Saved storage state to ${SESSION_FILE}`);

  // Deliberately not calling browser.close() — see index.ts.
  process.exit(0);
}

main().catch((err) => {
  console.error("save-session failed:", err);
  process.exit(1);
});
