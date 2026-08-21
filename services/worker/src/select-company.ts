import { connectToChromium, disconnectFromChromium } from "./cdp.js";
import { step } from "./steps.js";
import { selectCompany } from "./company-switcher.js";

const CDP_URL = process.env.CDP_URL ?? "http://localhost:9222";
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/app/output";
// Selects which company/account entry to click in the already-open (or
// reopened) company switcher dropdown -- e.g. "เซซุส" or
// "กฤษฎิ์ ดำประสงค์" / "Krit Dumprasong". Never touches credentials,
// never navigates away from the current authenticated session.
//
// Base64-encoded (COMPANY_NAME_B64), not passed as plain text --
// found empirically that a non-ASCII (Thai) command-line argument
// passed through Node's child_process.execFile on Windows gets
// mangled into literal "?" characters (a Windows console-codepage
// issue, not a bug in this script or in docker itself -- the same
// value passed directly via the Bash tool's own docker invocation
// worked fine, isolating the corruption to Node's execFile argv
// marshalling specifically). Base64 is pure ASCII, sidestepping the
// issue entirely regardless of the host's active code page.
const COMPANY_NAME = process.env.COMPANY_NAME_B64
  ? Buffer.from(process.env.COMPANY_NAME_B64, "base64").toString("utf-8")
  : (process.env.COMPANY_NAME ?? "");

async function main(): Promise<void> {
  if (!COMPANY_NAME) {
    throw new Error("COMPANY_NAME_B64 (or COMPANY_NAME) env var is required");
  }
  const browser = await step("connect", () => connectToChromium(CDP_URL));
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());

    const result = await step("select-company", async () => {
      await selectCompany(page, COMPANY_NAME);
      const url = page.url();
      const textSnippet = await page.evaluate(() =>
        document.body ? document.body.innerText.slice(0, 2000) : "",
      );
      const filename = `select-company-${Date.now()}.png`;
      await page.screenshot({ path: `${OUTPUT_DIR}/${filename}`, fullPage: true });
      return { url, textSnippet, screenshot: filename };
    });

    console.log(`LANE_PAGE_ANALYSIS ${JSON.stringify(result)}`);
  } finally {
    await disconnectFromChromium(browser);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("select-company failed:", err);
  process.exit(1);
});
