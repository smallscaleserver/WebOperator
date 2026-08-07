// Notification-only integration -- never used to receive input, never
// used to relay credentials/OTP into any site. See docs/PROJECT_PLAN.md
// decision log for why: a bot relaying a real credential through any
// channel (chat, file, Telegram) to auto-fill a real login form was
// explicitly declined, repeatedly -- this module exists only to push
// one-way alerts (new transaction, auto-stop fired) outward.
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN_XC;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID_XC;

// Best-effort only, same posture as MinIO artifact archival
// (stepBestEffort in services/worker) -- a Telegram outage or missing
// config must never fail the monitor check itself. No-op (not an
// error) when either env var is unset, so the feature is fully
// optional and doesn't require touching any other code path to
// disable.
export async function sendTelegramMessage(text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`Telegram notification failed: ${res.status} ${body}`);
    }
  } catch (err) {
    console.error("Telegram notification failed:", (err as Error).message);
  }
}
