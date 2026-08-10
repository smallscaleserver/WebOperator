import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT, listRecordings } from "./exec.js";
import { getTelegramUpdates, isKnownTelegramChat, sendTelegramMessage } from "./telegram.js";
import { enqueueScbTelegramScreenshot, enqueueScbTelegramStatus, enqueueRunRecording } from "./queue.js";
import { resolvePendingConfirmation } from "./replay-engine.js";
import { laneIds } from "./lanes.js";

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

// Originally strictly read-only (/status, /screenshot -- both SCB
// lane-specific). /confirm, /cancel, and /run are a deliberate,
// explicit exception to that, added per direct request -- NOT a drift
// from the boundary below, a conscious decision recorded in
// docs/PROJECT_PLAN.md's decision log. Even so, they're narrowly
// scoped, not a general text-to-automation channel:
//   - /confirm, /cancel only ever do anything when replay-engine.ts
//     has a pendingConfirmation waiting (a risky-keyword step
//     mid-replay, e.g. Transfer/Pay/Confirm/Submit) -- a stray reply
//     with nothing pending is a documented no-op.
//   - /run <name> only runs a script that was already recorded,
//     reviewed, and explicitly saved through the Recorder UI, on
//     whichever lane it was saved against (see lanes.ts) -- it can
//     never execute arbitrary text as actions, and every recording it
//     can point to already had its own credential-field redaction
//     applied at record time (see record-actions.ts).
// Still never expand this to typing/clicking/navigating from
// arbitrary Telegram text directly -- that remains the hard line (see
// docs/PROJECT_PLAN.md decision log). Command lookup is
// case-insensitive and ignores a "@botname" suffix (Telegram appends
// this automatically for commands used in a group).
const HELP_TEXT = [
  "🤖 WebOperator — available commands:",
  "",
  "/status — SCB lane: current balance + latest transactions on the page right now",
  "/screenshot — SCB lane: a fresh full-page screenshot of its current browser state",
  "/run <name> — run a saved recorded script (searches every lane for that name)",
  "/confirm — approve a script's currently-paused risky step (Transfer/Pay/Confirm/Submit/etc.)",
  "/cancel — reject a script's currently-paused risky step",
  "/help — this list",
  "",
  "/status and /screenshot are strictly read-only. /run executes only scripts you already recorded, reviewed, and saved yourself -- it never types/clicks/navigates from raw text. Any risky step in a script always pauses for a live /confirm here first.",
].join("\n");

async function handleConfirm(confirmed: boolean): Promise<void> {
  const resolved = await resolvePendingConfirmation(confirmed);
  if (!resolved) {
    await sendTelegramMessage("(nothing is currently waiting for confirmation)");
  }
}

// No lane prefix in the Telegram UX (/run <name>, not /run <lane> <name>)
// -- searches every known lane for a saved recording with this name and
// runs it wherever found. Ambiguous (same name saved on more than one
// lane) asks the human to rename/delete one rather than silently
// picking -- this can only ever happen if someone deliberately reuses
// a name across lanes, not from normal use of the Recorder UI.
async function handleRun(recordingName: string | undefined): Promise<void> {
  if (!recordingName) {
    await sendTelegramMessage("Usage: /run <name> — see the Recorder page for saved script names.");
    return;
  }
  const matches: string[] = [];
  for (const laneId of laneIds()) {
    const known = await listRecordings(laneId);
    if (known.includes(recordingName)) matches.push(laneId);
  }
  if (matches.length === 0) {
    await sendTelegramMessage(`No saved recording named "${recordingName}" on any lane.`);
    return;
  }
  if (matches.length > 1) {
    await sendTelegramMessage(`"${recordingName}" is saved on more than one lane (${matches.join(", ")}) — rename or delete one via the Recorder UI first.`);
    return;
  }
  await enqueueRunRecording(matches[0], recordingName);
  await sendTelegramMessage(`▶️ Running "${recordingName}" (lane: ${matches[0]})...`);
}

const COMMANDS: Record<string, (arg?: string) => Promise<unknown>> = {
  "/screenshot": enqueueScbTelegramScreenshot,
  "/status": enqueueScbTelegramStatus,
  "/help": () => sendTelegramMessage(HELP_TEXT),
  // Telegram's own default first command when a user opens a bot chat --
  // answering it with the same help text instead of silently ignoring
  // it is a small but real usability win.
  "/start": () => sendTelegramMessage(HELP_TEXT),
  "/confirm": () => handleConfirm(true),
  "/cancel": () => handleConfirm(false),
  "/run": (arg) => handleRun(arg),
};

function normalizeCommand(text: string): string {
  return text.trim().split(/\s+/)[0].toLowerCase().split("@")[0];
}

function commandArg(text: string): string | undefined {
  const rest = text.trim().split(/\s+/).slice(1).join(" ").trim();
  return rest.length > 0 ? rest : undefined;
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
        await handler(commandArg(text)).catch((err) => console.error(`Telegram command "${command}" failed:`, err));
      }
    }
    await saveOffset(offset);
  }, POLL_INTERVAL_MS);
}
