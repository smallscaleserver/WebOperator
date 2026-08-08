import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./exec.js";
import { getTelegramUpdates, isKnownTelegramChat, sendTelegramMessage } from "./telegram.js";
import { enqueueScbTelegramScreenshot, enqueueScbTelegramStatus } from "./queue.js";

const OFFSET_PATH = path.join(REPO_ROOT, "data", "telegram-command-offset.json");
const POLL_INTERVAL_MS = 5000;

async function loadOffset(): Promise<number> {
  try {
    const raw = await readFile(OFFSET_PATH, "utf-8");
    return (JSON.parse(raw) as { offset?: number }).offset ?? 0;
  } catch {
    return 0;
  }
}

async function saveOffset(offset: number): Promise<void> {
  await mkdir(path.dirname(OFFSET_PATH), { recursive: true });
  await writeFile(OFFSET_PATH, JSON.stringify({ offset }), "utf-8");
}

// Explicit, tiny allowlist -- both strictly read-only (see queue.ts's
// SCB_TELEGRAM_SCREENSHOT_JOB_NAME/SCB_TELEGRAM_STATUS_JOB_NAME
// handlers: one reuses analyze-page.ts, which never navigates/clicks/
// types; the other only reads already-saved state). Never expand this
// to anything that types/clicks/navigates freely from arbitrary
// Telegram text -- that would turn this into exactly the kind of
// credential/login-automation channel already declined repeatedly
// this session (see docs/PROJECT_PLAN.md decision log). Command
// lookup is case-insensitive and ignores a "@botname" suffix (Telegram
// appends this automatically for commands used in a group).
const HELP_TEXT = [
  "🤖 WebOperator SCB monitor — available commands:",
  "",
  "/status — current balance + latest transactions on the page right now",
  "/screenshot — a fresh full-page screenshot of the SCB lane's current browser state",
  "/help — this list",
  "",
  "All commands are strictly read-only — the bot never types, clicks, or navigates a real login/transfer form, and never will, regardless of what's asked.",
].join("\n");

const COMMANDS: Record<string, () => Promise<unknown>> = {
  "/screenshot": enqueueScbTelegramScreenshot,
  "/status": enqueueScbTelegramStatus,
  "/help": () => sendTelegramMessage(HELP_TEXT),
  // Telegram's own default first command when a user opens a bot chat --
  // answering it with the same help text instead of silently ignoring
  // it is a small but real usability win.
  "/start": () => sendTelegramMessage(HELP_TEXT),
};

function normalizeCommand(text: string): string {
  return text.trim().toLowerCase().split(/[\s@]/)[0];
}

// Polling (getUpdates), not a webhook -- this stack is dev-only and
// loopback-bound, no public endpoint exists for Telegram to call back
// into. Only messages from the already-configured private chat or
// group (see telegram.ts's isKnownTelegramChat) are ever acted on --
// a message from anyone/anywhere else is silently ignored, not just
// unrecognized-command-ignored.
export function startTelegramCommandPolling(): void {
  let offset = 0;
  let ready = false;
  loadOffset()
    .then((saved) => {
      offset = saved;
      ready = true;
    })
    .catch(() => {
      ready = true;
    });

  setInterval(async () => {
    if (!ready) return;
    const updates = await getTelegramUpdates(offset);
    if (updates.length === 0) return;

    for (const update of updates) {
      offset = Math.max(offset, update.update_id + 1);
      const chatId = update.message?.chat?.id?.toString();
      const text = update.message?.text;
      if (!chatId || !text || !isKnownTelegramChat(chatId)) continue;

      const command = normalizeCommand(text);
      const handler = COMMANDS[command];
      if (handler) {
        await handler().catch((err) => console.error(`Telegram command "${command}" failed:`, err));
      }
    }
    await saveOffset(offset);
  }, POLL_INTERVAL_MS);
}
