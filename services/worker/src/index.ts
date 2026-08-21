import { mkdir } from "node:fs/promises";
import { connectToChromium, disconnectFromChromium } from "./cdp.js";
import { step, stepBestEffort } from "./steps.js";
import { uploadArtifact } from "./artifacts.js";

const CDP_URL = process.env.CDP_URL ?? "http://localhost:9222";
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/app/output";
const TARGET_URL = process.env.TARGET_URL ?? "https://example.com";

async function main(): Promise<void> {
  const browser = await step("connect", () => connectToChromium(CDP_URL));
  try {
    // entrypoint.sh already opened one about:blank page — reuse it instead of
    // spawning a redundant tab.
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());

    await step("navigate", () => page.goto(TARGET_URL, { waitUntil: "domcontentloaded" }));
    const title = await page.title();
    console.log(`Navigated to ${TARGET_URL} — page title: "${title}"`);

    await mkdir(OUTPUT_DIR, { recursive: true });
    const screenshotPath = `${OUTPUT_DIR}/example.png`;
    await step("screenshot", () => page.screenshot({ path: screenshotPath }), { screenshot: "example.png" });
    console.log(`Saved screenshot to ${screenshotPath}`);
    await stepBestEffort("archive-screenshot", () => uploadArtifact(screenshotPath, "screenshots/example.png"));
  } finally {
    // This worker didn't launch the Chromium process (entrypoint.sh did, and
    // it must keep running for noVNC and future tasks) -- disconnectFromChromium
    // only disconnects this client, confirmed live it does not affect the
    // running Chromium process. See cdp.ts: skipping this and letting the
    // process just exit instead is what was silently degrading Chromium
    // across repeated runs until it crashed with no trace.
    await disconnectFromChromium(browser);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Worker failed:", err);
  process.exit(1);
});
