import { chromium, type Browser } from "playwright-core";

const MAX_ATTEMPTS = 30;
const RETRY_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForCdp(url: string): Promise<void> {
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

export async function connectToChromium(url: string): Promise<Browser> {
  await waitForCdp(url);
  const browser = await chromium.connectOverCDP(url);
  console.log("Connected to Chromium over CDP.");
  return browser;
}

// Every script here runs as a one-shot `docker compose run` process:
// connect, do the job, exit. Found live, reproducibly (18/18 clean runs
// vs. a crash within 2-3 runs otherwise), that letting the process just
// exit -- severing the CDP WebSocket abruptly instead of disconnecting
// through Playwright -- degrades Chromium's own target/session
// bookkeeping a little further each time; enough repeated abrupt
// disconnects across separate invocations eventually crashes the whole
// Chromium process with no trace anywhere (not even a crashpad dump).
// browser.close() on a connectOverCDP()-obtained Browser only
// disconnects this client -- confirmed live it does not close the
// actual Chromium process or affect any existing page/session/cookie
// state, so calling it here is always safe. Every caller of
// connectToChromium must call this in a `finally` block before the
// process exits. See docs/PROJECT_PLAN.md's SCB lane mid-session crash
// writeup for the full investigation.
export async function disconnectFromChromium(browser: Browser): Promise<void> {
  await browser.close().catch(() => {});
}
