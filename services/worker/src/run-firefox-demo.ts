import { mkdir } from "node:fs/promises";
import { connectToFirefox } from "./firefoxConnect.js";
import { step } from "./steps.js";

const FIREFOX_WS_ENDPOINT = process.env.FIREFOX_WS_ENDPOINT ?? "ws://localhost:9223/firefox";
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/app/output";
const TARGET_URL = process.env.TARGET_URL ?? "https://example.com";

async function main(): Promise<void> {
  const browser = await step("connect", () => connectToFirefox(FIREFOX_WS_ENDPOINT));

  // Unlike connectOverCDP against an already-running Chromium, nothing has
  // created a context/page in this Firefox yet (launchServer() doesn't take
  // a startup URL) -- this is the first page, not a reused default one.
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  await step("navigate", () => page.goto(TARGET_URL, { waitUntil: "domcontentloaded" }));
  const title = await page.title();
  console.log(`Navigated to ${TARGET_URL} — page title: "${title}"`);

  await mkdir(OUTPUT_DIR, { recursive: true });
  const screenshotPath = `${OUTPUT_DIR}/firefox-example.png`;
  await step("screenshot", () => page.screenshot({ path: screenshotPath }), { screenshot: "firefox-example.png" });
  console.log(`Saved screenshot to ${screenshotPath}`);

  // Not calling browser.close(): this worker didn't launch the Firefox
  // process -- launch-firefox.js in the browser-worker-firefox container
  // did, and it must keep running for noVNC and future jobs.
  process.exit(0);
}

main().catch((err) => {
  console.error("run-firefox-demo failed:", err);
  process.exit(1);
});
