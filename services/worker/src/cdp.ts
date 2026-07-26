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
