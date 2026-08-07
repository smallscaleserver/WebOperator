import { connectToChromium } from "./cdp.js";
import { step } from "./steps.js";

const CDP_URL = process.env.CDP_URL ?? "http://localhost:9222";
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/app/output";
// Generous but bounded -- enough to be useful for a human deciding
// what to automate next, not a full-page dump.
const TEXT_SNIPPET_LIMIT = 2000;

// Read-only observation of whatever page is *already open* in this
// lane's browser -- deliberately never navigates, never fills/clicks
// anything, unlike run-workflow.ts's main() (which always resets to a
// fresh page first). Built for the "Assisted Manual Login" flow: a
// human logs in manually via noVNC, then this reports back what the
// resulting page looks like without the bot ever touching credentials
// or driving the login itself. If no page exists yet, opens one
// blank (about:blank) rather than navigating anywhere.
async function main(): Promise<void> {
  const browser = await step("connect", () => connectToChromium(CDP_URL));
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  const filename = `lane-analysis-${Date.now()}.png`;
  const result = await step("analyze", async () => {
    const url = page.url();
    const title = await page.title();
    const textSnippet = await page.evaluate(
      (limit) => (document.body ? document.body.innerText.slice(0, limit) : ""),
      TEXT_SNIPPET_LIMIT,
    );
    await page.screenshot({ path: `${OUTPUT_DIR}/${filename}` });
    return { url, title, textSnippet, screenshot: filename };
  });

  console.log(`LANE_PAGE_ANALYSIS ${JSON.stringify(result)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("analyze-page failed:", err);
  process.exit(1);
});
