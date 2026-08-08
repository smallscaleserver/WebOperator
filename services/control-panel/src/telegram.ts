import { readFile } from "node:fs/promises";
import path from "node:path";

// Notification-only by default -- never used to relay credentials/OTP
// into any site, no matter what. See docs/PROJECT_PLAN.md decision
// log for why: a bot relaying a real credential through any channel
// (chat, file, Telegram) to auto-fill a real login form was
// explicitly declined, repeatedly. Incoming commands (added
// alongside outbound notifications, see telegram-commands.ts) are
// held to the exact same boundary -- an explicit, tiny allowlist of
// strictly read-only actions, never a general text-to-automation
// channel.
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN_XC;
// Private chat (unchanged, original destination) and a group chat --
// both optional and independent. Group chat ids from Telegram's own
// API are negative (supergroups start with "-100"), confirmed live
// against the real "Small and snoopy" group's own getUpdates response
// before wiring this in, not assumed from the id's shape alone.
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID_XC;
const TELEGRAM_GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;

// Best-effort only, same posture as MinIO artifact archival
// (stepBestEffort in services/worker) -- a Telegram outage or missing
// config must never fail the monitor check itself. No-op (not an
// error) when the bot token or this specific chatId is unset.
async function sendTelegram(chatId: string | undefined, text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !chatId) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`Telegram notification failed (chat ${chatId}): ${res.status} ${body}`);
    }
  } catch (err) {
    console.error(`Telegram notification failed (chat ${chatId}):`, (err as Error).message);
  }
}

// Unchanged signature/behavior for every existing call site (monitor.ts,
// scb-monitor.ts, queue.ts) -- fans out to both the private chat and
// the group chat if configured, independently (one failing/unset
// never blocks the other). Never removes the original private-chat
// capability, only adds the group alongside it, per explicit request.
export async function sendTelegramMessage(text: string): Promise<void> {
  await Promise.all([sendTelegram(TELEGRAM_CHAT_ID, text), sendTelegram(TELEGRAM_GROUP_CHAT_ID, text)]);
}

async function sendPhoto(chatId: string | undefined, filePath: string, caption?: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !chatId) return;
  try {
    const fileBuffer = await readFile(filePath);
    const form = new FormData();
    form.append("chat_id", chatId);
    if (caption) form.append("caption", caption.slice(0, 1024)); // Telegram's own caption length limit
    form.append("photo", new Blob([fileBuffer]), path.basename(filePath));
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`Telegram sendPhoto failed (chat ${chatId}): ${res.status} ${body}`);
    }
  } catch (err) {
    console.error(`Telegram sendPhoto failed (chat ${chatId}):`, (err as Error).message);
  }
}

// Same fan-out shape as sendTelegramMessage -- both destinations,
// independent, best-effort.
export async function sendTelegramPhoto(filePath: string, caption?: string): Promise<void> {
  await Promise.all([sendPhoto(TELEGRAM_CHAT_ID, filePath, caption), sendPhoto(TELEGRAM_GROUP_CHAT_ID, filePath, caption)]);
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
  };
}

// Polling (getUpdates), not a webhook -- no public endpoint exists for
// Telegram to call back into this dev-only, loopback-bound stack.
// offset excludes every update already seen (Telegram's own
// getUpdates contract: passing the last update_id + 1 acknowledges
// and clears everything before it).
export async function getTelegramUpdates(offset: number): Promise<TelegramUpdate[]> {
  if (!TELEGRAM_BOT_TOKEN) return [];
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${offset}&timeout=0`,
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { ok: boolean; result?: TelegramUpdate[] };
    return data.ok && data.result ? data.result : [];
  } catch (err) {
    console.error("Telegram getUpdates failed:", (err as Error).message);
    return [];
  }
}

// Exported so telegram-commands.ts's allowlist can check "is this
// chat one of ours" without duplicating the env var reads.
export function isKnownTelegramChat(chatId: string): boolean {
  return chatId === TELEGRAM_CHAT_ID || chatId === TELEGRAM_GROUP_CHAT_ID;
}
