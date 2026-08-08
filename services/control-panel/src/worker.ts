import "./env.js";
import { startWorker, closeQueue } from "./queue.js";
import { startTelegramCommandPolling } from "./telegram-commands.js";

console.log("WebOperator queue worker starting (concurrency 1)...");
startWorker();
console.log("Queue worker ready — waiting for jobs. Bound to no port; runs entirely against Redis.");

// Polling (not a webhook), no-op if Telegram isn't configured (see
// telegram.ts) -- picks up /screenshot and /status commands sent to
// the already-configured private chat or group, enqueued through the
// same queue as every other job so they can't race a scheduled check.
startTelegramCommandPolling();
console.log("Telegram command polling started (/screenshot, /status).");

async function shutdown(): Promise<void> {
  console.log("Shutting down queue worker...");
  await closeQueue();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
