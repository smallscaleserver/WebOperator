// Notification-only integration -- never used to receive input, never
// used to relay credentials/OTP into any site. See docs/PROJECT_PLAN.md
// decision log for why: a bot relaying a real credential through any
// channel (chat, file, Telegram) to auto-fill a real login form was
// explicitly declined, repeatedly -- this module exists only to push
// one-way alerts (new transaction, auto-stop fired) outward.
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
