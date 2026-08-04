import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { connectToChromium } from "./cdp.js";
import { step, stepBestEffort } from "./steps.js";
import { uploadArtifact } from "./artifacts.js";
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
  const browser = await step("connect", () => connectToChromium(CDP_URL));

  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  await step("dismiss-ad", () => dismissAdIfPresent(page));

  const loginResult = await step("login", async () => {
    const result = await login(page, DEMO_CREDENTIALS);
    if (!result.success) {
      throw new Error(`Adapter login failed: ${result.message}`);
    }
    return result;
  });
  console.log(`Login succeeded: "${loginResult.message}"`);

  const extracted = await step("extract", () => extractSecureAreaMessage(page));
  console.log(`Extracted secure-area message: "${extracted}"`);

  await step("save-session", async () => {
    await mkdir(dirname(SESSION_FILE), { recursive: true });
    await context.storageState({ path: SESSION_FILE });
  });
  console.log(`Saved real logged-in session to ${SESSION_FILE}`);

  const screenshotPath = `${OUTPUT_DIR}/the-internet-secure.png`;
  await step(
    "screenshot",
    async () => {
      await mkdir(OUTPUT_DIR, { recursive: true });
      await page.screenshot({ path: screenshotPath });
    },
    { screenshot: "the-internet-secure.png" },
  );
  console.log(`Saved screenshot to ${screenshotPath}`);
  await stepBestEffort("archive-screenshot", () =>
    uploadArtifact(screenshotPath, "screenshots/the-internet-secure.png"),
  );

  // Deliberately not calling browser.close() — see index.ts.
  process.exit(0);
}

main().catch((err) => {
  console.error("run-adapter failed:", err);
  process.exit(1);
});
