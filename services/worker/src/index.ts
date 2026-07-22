import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const CDP_URL = process.env.CDP_URL ?? "http://localhost:9222";
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/app/output";
const TARGET_URL = process.env.TARGET_URL ?? "https://example.com";

const MAX_ATTEMPTS = 30;
const RETRY_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCdp(url: string): Promise<void> {
  const versionUrl = new URL("/json/version", url).toString();
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(versionUrl);
      if (res.ok) {
        console.log(`CDP endpoint ready after ${attempt} attempt(s): ${versionUrl}`);
        return;
      }
    } catch {
      // Not up yet — browser-worker-chrome may still be starting Chromium.
    }
    console.log(`Waiting for CDP at ${versionUrl} (attempt ${attempt}/${MAX_ATTEMPTS})...`);
    await sleep(RETRY_DELAY_MS);
  }
  throw new Error(`CDP endpoint never became ready at ${versionUrl}`);
}

async function main(): Promise<void> {
  await waitForCdp(CDP_URL);

  const browser = await chromium.connectOverCDP(CDP_URL);
  console.log("Connected to Chromium over CDP.");

  // entrypoint.sh already opened one about:blank page — reuse it instead of
  // spawning a redundant tab.
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
  const title = await page.title();
  console.log(`Navigated to ${TARGET_URL} — page title: "${title}"`);

  await mkdir(OUTPUT_DIR, { recursive: true });
  const screenshotPath = `${OUTPUT_DIR}/example.png`;
  await page.screenshot({ path: screenshotPath });
  console.log(`Saved screenshot to ${screenshotPath}`);

  // Deliberately not calling browser.close(): this worker did not launch the
  // Chromium process (entrypoint.sh did, and it must keep running for noVNC
  // and future tasks) — just disconnect by exiting.
  process.exit(0);
}

main().catch((err) => {
  console.error("Worker failed:", err);
  process.exit(1);
});
