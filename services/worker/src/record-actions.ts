import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright-core";
import { connectToChromium, disconnectFromChromium } from "./cdp.js";
import { step } from "./steps.js";
import { REDACTED_FIELD_SENTINEL } from "./actions/registry.js";

const CDP_URL = process.env.CDP_URL ?? "http://localhost:9222";
const RECORDINGS_DIR = process.env.RECORDINGS_DIR ?? "/app/recordings";
// Required -- identifies this recording session's own stop-flag file, so
// two recording sessions (however unlikely, given queue concurrency=1)
// can never be confused with each other.
const RUN_ID = process.env.RECORDING_RUN_ID;
const STOP_FLAG_PATH = RUN_ID ? path.join(RECORDINGS_DIR, `.stop-${RUN_ID}`) : "";
const POLL_INTERVAL_MS = 1000;
// Same auto-stop-caution posture as every other unattended-loop feature
// this session (XC Bank/SCB monitor autoStopMinutes) -- a recording
// session against the real SCB lane must never run forever unattended
// just because a human forgot to click Stop.
const MAX_DURATION_MS = 15 * 60 * 1000;

// Best-effort credential-field signal, shared by both the page-level
// guard (below, via a CSS selector built from this list) and the
// in-page per-field redaction (installRecorderInPage's
// isCredentialField). type="password" is the one *structural*
// signal that's reliably present on real login forms; the rest are
// heuristic (id/name/autocomplete containing one of these words) to
// also catch OTP/PIN/token/secret-style fields that aren't literally
// type="password" but are still clearly credential-shaped. This is
// NOT a guarantee -- a field that matches none of these (a custom
// masked-text widget with an unrelated id, for instance) won't be
// caught. Documented plainly in docs/PROJECT_PLAN.md.
const CREDENTIAL_HINT_KEYWORDS = ["password", "otp", "pin", "token", "secret"];

interface RawEvent {
  kind: "click" | "typed" | "key";
  selector?: string;
  x?: number;
  y?: number;
  text?: string | null; // null = redacted (credential field)
  key?: string;
  at: number;
}

interface CompiledStep {
  type: "clickSmart" | "typeText" | "pressKey";
  params: Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Runs inside the page. Passed DIRECTLY to page.evaluate() as a real
// function reference (never via .toString()+eval() of a separately
// stringified function) -- found empirically that tsx/esbuild's
// __name() helper wrapping (added when transpiling named function
// declarations) breaks a manually re-eval'd standalone function body,
// since __name isn't defined in that isolated context. Playwright's
// own page.evaluate() handles serializing a function passed directly
// without that problem, so everything the recorder needs in-page is
// nested inside this single function instead of split across several
// top-level ones. Installed once per real document (guarded by a
// window flag, idempotent if ever injected twice into the same
// document) -- listens for click/input/keydown at the document level
// and reports each already-processed (redacted, if applicable) event
// back to Node via the exposed __webopRecordEvent__ binding.
// Credential fields (type=password or autocomplete containing
// "password") are detected here, in-page, before anything ever
// crosses back to Node -- the real keystroke content for those fields
// never leaves the browser at all, not even transiently.
// Every helper below is a `const` arrow-function expression, not a
// `function name() {}` declaration -- found empirically that esbuild
// (tsx's transpiler) wraps NAMED function declarations in a
// `__name(fn, "fn")` helper call to preserve `.name`, and since these
// are declared *inside* installRecorderInPage, that wrapping call
// lands inside its own body, so it comes along when Playwright
// stringifies the whole outer function to ship it into the page --
// `__name` doesn't exist in that isolated browser context, so it
// throws. Arrow-function expressions assigned to `const` don't get
// this treatment. See docs/PROJECT_PLAN.md's decision log.
// tsx/esbuild wraps a function EXPRESSION in a `__name(fn, "name")`
// helper call whenever it's assigned to a local const/let binding --
// confirmed directly (not guessed): `const f = (x) => x` transpiles to
// `const f = __name(x => x, "f")`, while the exact same arrow function
// passed as a bare argument or assigned to a property does NOT get
// wrapped. installRecorderInPage below declares several such local
// consts (computeSelector/isCredentialField/flush), so their wrapping
// calls end up embedded inside its own body -- which matters because
// that's exactly the text Playwright ships into the page when this
// function is handed to page.evaluate(). `__name` doesn't exist in
// that isolated browser context, so it throws. Rather than avoid every
// local-const pattern in every future in-page function (impractical),
// this defines a permanent, harmless `window.__name` passthrough shim
// once per page -- cheap, and fixes the whole class of issue, not just
// this one call site.
async function installRecorderWithShim(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __name?: (fn: unknown, name: string) => unknown };
    w.__name = w.__name || ((fn: unknown) => fn);
  });
  await page.evaluate(installRecorderInPage);
}

function installRecorderInPage(): void {
  const w = window as unknown as {
    __webopRecorderInstalled?: boolean;
    __webopRecordEvent__?: (event: unknown) => void;
    __webopFlushPending?: () => void;
  };
  if (w.__webopRecorderInstalled) return;
  w.__webopRecorderInstalled = true;

  const computeSelector = (el: Element): string => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const testId = el.getAttribute("data-testid");
    if (testId) return `[data-testid="${testId}"]`;
    const aria = el.getAttribute("aria-label");
    if (aria) return `[aria-label="${aria}"]`;
    const text = (el.textContent || "").trim();
    if (text && text.length > 0 && text.length < 60) {
      // Quoted -- Playwright's text= engine treats an UNQUOTED pattern
      // as a case-insensitive substring match, found empirically to
      // cause real ambiguity on replay (e.g. "Transfers" also
      // substring-matches a "Payments and Transfers" parent link
      // elsewhere on the same page, and clickSmart's .first() then
      // clicks whichever happens to come first in DOM order -- not
      // necessarily the one that was actually clicked when recorded).
      // Quoting requires the FULL text to match exactly instead.
      return `text="${text.replace(/"/g, '\\"')}"`;
    }
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let segment = node.tagName.toLowerCase();
      if (typeof node.className === "string" && node.className.trim()) {
        const firstClass = node.className.trim().split(/\s+/)[0];
        segment += `.${firstClass}`;
      }
      parts.unshift(segment);
      node = node.parentElement;
    }
    return parts.join(" > ");
  };

  let pending: { selector: string; el: Element; redacted: boolean } | null = null;

  // Keyword list duplicated here (not imported/shared) because this
  // whole function is shipped into the browser as a string via
  // page.evaluate() -- it can't reference a Node-side module binding.
  // Keep in sync with CREDENTIAL_HINT_KEYWORDS above; both exist so
  // this in-page redaction check and the Node-side page-level guard
  // agree on what counts as "credential-shaped."
  const isCredentialField = (el: Element): boolean => {
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "password") return true;
    const hints = ["password", "otp", "pin", "token", "secret"];
    const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
    const id = (el.getAttribute("id") || "").toLowerCase();
    const name = (el.getAttribute("name") || "").toLowerCase();
    return hints.some((h) => autocomplete.includes(h) || id.includes(h) || name.includes(h));
  };

  const flush = (): void => {
    if (!pending) return;
    const { selector, el, redacted } = pending;
    pending = null;
    const value = redacted ? null : (el as HTMLInputElement).value ?? "";
    if (!redacted && !value) return; // nothing actually typed, e.g. click-then-blur
    w.__webopRecordEvent__?.({ kind: "typed", selector, text: value, at: Date.now() });
  };
  w.__webopFlushPending = flush;

  document.addEventListener(
    "input",
    (ev) => {
      const el = ev.target as Element | null;
      if (!el || !("value" in el)) return;
      const tag = el.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA") return;
      // Flush whatever was pending for a DIFFERENT field first -- found
      // empirically that programmatic fills (Playwright's .fill(), used
      // by typeText/the recorder's own test harness) move between
      // fields without an intervening click/Tab/Enter, so without this
      // check every field except the very last one typed into was
      // silently dropped (overwritten by the next field's input event
      // before ever being flushed).
      if (pending && pending.el !== el) {
        flush();
      }
      const redacted = isCredentialField(el);
      pending = { selector: computeSelector(el), el, redacted };
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (ev) => {
      if (ev.key === "Enter" || ev.key === "Tab" || ev.key === "Escape") {
        flush();
        w.__webopRecordEvent__?.({ kind: "key", key: ev.key, at: Date.now() });
      }
    },
    true,
  );

  document.addEventListener(
    "click",
    (ev) => {
      flush();
      const el = ev.target as Element | null;
      if (!el) return;
      w.__webopRecordEvent__?.({
        kind: "click",
        selector: computeSelector(el),
        x: (ev as MouseEvent).clientX,
        y: (ev as MouseEvent).clientY,
        at: Date.now(),
      });
    },
    true,
  );
}

function compileSteps(events: RawEvent[]): { steps: CompiledStep[]; redactedCount: number } {
  const steps: CompiledStep[] = [];
  let redactedCount = 0;
  for (const ev of events) {
    if (ev.kind === "click") {
      steps.push({ type: "clickSmart", params: { selector: ev.selector, x: ev.x, y: ev.y } });
    } else if (ev.kind === "key") {
      steps.push({ type: "pressKey", params: { key: ev.key } });
    } else if (ev.kind === "typed") {
      if (ev.text === null) {
        redactedCount += 1;
        steps.push({ type: "typeText", params: { selector: ev.selector, text: REDACTED_FIELD_SENTINEL } });
      } else {
        steps.push({ type: "typeText", params: { selector: ev.selector, text: ev.text } });
      }
    }
  }
  return { steps, redactedCount };
}

async function main(): Promise<void> {
  if (!RUN_ID) {
    throw new Error("RECORDING_RUN_ID env var is required");
  }
  const browser = await step("connect", () => connectToChromium(CDP_URL));
  try {
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  await step("guard-not-login-page", async () => {
    // Universal, not SCB-specific: refuse to start while ANY
    // credential-shaped field is visible, on any site. type="password"
    // is a real structural DOM signal; the id/name/autocomplete
    // keyword checks are heuristic, best-effort (see
    // CREDENTIAL_HINT_KEYWORDS's own comment) -- together this is the
    // same criterion installRecorderInPage's isCredentialField() uses
    // per-field for redaction, so the page-level guard and the
    // field-level redaction always agree with each other. Recording
    // the login flow isn't just discouraged -- it's structurally
    // impossible with this tool, on purpose. If a human genuinely
    // needs to log in first, they do that manually via noVNC, then
    // start recording afterward.
    const attrParts = CREDENTIAL_HINT_KEYWORDS.flatMap((kw) => [
      `input[autocomplete*="${kw}" i]`,
      `input[id*="${kw}" i]`,
      `input[name*="${kw}" i]`,
    ]);
    const credentialSelector = ['input[type="password"]', ...attrParts].join(", ");
    const onLoginPage = await page
      .locator(credentialSelector)
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    if (onLoginPage) {
      throw new Error("REFUSED: a credential-shaped field (password/OTP/PIN/token/secret) is currently visible on this page -- recording a login/credential flow is not permitted, log in manually first");
    }
  });

  const rawEvents: RawEvent[] = [];
  await step("install-recorder", async () => {
    await page.exposeFunction("__webopRecordEvent__", (event: RawEvent) => {
      rawEvents.push(event);
    });
    await installRecorderWithShim(page);
    // Re-install after any in-session navigation (SPA route changes don't
    // trigger this, but a genuine full page load would) -- cheap and
    // idempotent thanks to the __webopRecorderInstalled guard above.
    page.on("load", async () => {
      await installRecorderWithShim(page).catch(() => {});
    });
  });

  await mkdir(RECORDINGS_DIR, { recursive: true });
  const startedAt = Date.now();
  await step("record-until-stopped", async () => {
    for (;;) {
      const stopRequested = await access(STOP_FLAG_PATH)
        .then(() => true)
        .catch(() => false);
      const timedOut = Date.now() - startedAt > MAX_DURATION_MS;
      if (stopRequested || timedOut) break;
      await sleep(POLL_INTERVAL_MS);
    }
  });

  // Final flush -- catches text typed into a field the human never
  // explicitly blurred/pressed Enter on before stopping.
  await page.evaluate(() => (window as unknown as { __webopFlushPending?: () => void }).__webopFlushPending?.()).catch(() => {});
  await sleep(200); // let the final exposeFunction call land before compiling

  await rm(STOP_FLAG_PATH, { force: true }).catch(() => {});

  const { steps, redactedCount } = compileSteps(rawEvents);
  console.log(`SCB_RECORDING_RESULT ${JSON.stringify({ steps, redactedCount, eventCount: rawEvents.length })}`);
  } finally {
    await disconnectFromChromium(browser);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("record-actions failed:", err);
  process.exit(1);
});
