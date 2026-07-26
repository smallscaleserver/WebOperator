import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { connectToChromium } from "./cdp.js";
import {
  dismissAdIfPresent,
  extractSecureAreaMessage,
  login,
  DEMO_CREDENTIALS,
} from "./adapters/the-internet.js";

const CDP_URL = process.env.CDP_URL ?? "http://localhost:9222";
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/app/output";
const SESSION_FILE = process.env.SESSION_FILE ?? "/app/sessions/the-internet.json";

async function main(): Promise<void> {
  const browser = await connectToChromium(CDP_URL);

  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  await dismissAdIfPresent(page);

  const loginResult = await login(page, DEMO_CREDENTIALS);
  console.log(`Login ${loginResult.success ? "succeeded" : "FAILED"}: "${loginResult.message}"`);
  if (!loginResult.success) {
    throw new Error(`Adapter login failed: ${loginResult.message}`);
  }

  const extracted = await extractSecureAreaMessage(page);
  console.log(`Extracted secure-area message: "${extracted}"`);

  await mkdir(dirname(SESSION_FILE), { recursive: true });
  await context.storageState({ path: SESSION_FILE });
  console.log(`Saved real logged-in session to ${SESSION_FILE}`);

  await mkdir(OUTPUT_DIR, { recursive: true });
  const screenshotPath = `${OUTPUT_DIR}/the-internet-secure.png`;
  await page.screenshot({ path: screenshotPath });
  console.log(`Saved screenshot to ${screenshotPath}`);

  // Deliberately not calling browser.close() — see index.ts.
  process.exit(0);
}

main().catch((err) => {
  console.error("run-adapter failed:", err);
  process.exit(1);
});
