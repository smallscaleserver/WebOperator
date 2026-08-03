import { firefox, type Browser } from "playwright-core";

const MAX_ATTEMPTS = 30;
const RETRY_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Unlike Chromium's CDP (a plain HTTP /json/version health check), a
// Playwright launchServer() endpoint has no separate health-check route --
// readiness is determined by retrying the actual connect() call itself.
export async function connectToFirefox(wsEndpoint: string): Promise<Browser> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const browser = await firefox.connect(wsEndpoint, { timeout: 5000 });
      console.log(`Connected to Firefox after ${attempt} attempt(s): ${wsEndpoint}`);
      return browser;
    } catch (err) {
      lastErr = err;
      console.log(`Waiting for Firefox server at ${wsEndpoint} (attempt ${attempt}/${MAX_ATTEMPTS})...`);
      await sleep(RETRY_DELAY_MS);
    }
  }
  throw new Error(`Could not connect to Firefox server at ${wsEndpoint}: ${lastErr}`);
}
