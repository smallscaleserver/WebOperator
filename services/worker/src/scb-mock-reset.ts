import { connectToChromium } from "./cdp.js";
import { step } from "./steps.js";

const SCB_MOCK_LOGIN_URL = process.env.SCB_MOCK_LOGIN_URL ?? "http://scb-mock:3000/login";
const SCB_MOCK_LOGOUT_CLEAN_URL = process.env.SCB_MOCK_LOGOUT_CLEAN_URL ?? "http://scb-mock:3000/logout-clean";

async function main(): Promise<void> {
  const browser = await step("connect", () => connectToChromium(process.env.CDP_URL ?? "http://localhost:9222"));
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());

    await step("open-mock-login", () => page.goto(SCB_MOCK_LOGIN_URL, { waitUntil: "domcontentloaded" }));
    await step("logout-clean", async () => {
      const response = await page.request.post(SCB_MOCK_LOGOUT_CLEAN_URL);
      if (!response.ok() && response.status() !== 302) {
        throw new Error(`SCB mock logout-clean failed with HTTP ${response.status()}`);
      }
    });
    await step("return-to-login", () => page.goto(SCB_MOCK_LOGIN_URL, { waitUntil: "domcontentloaded" }));

    const title = await page.title();
    const url = page.url();
    console.log(`SCB_MOCK_RESET ${JSON.stringify({ url, title })}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
