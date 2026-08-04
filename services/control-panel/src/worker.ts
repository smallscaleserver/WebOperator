import { startWorker, closeQueue } from "./queue.js";

console.log("WebOperator queue worker starting (concurrency 1)...");
startWorker();
console.log("Queue worker ready — waiting for jobs. Bound to no port; runs entirely against Redis.");

async function shutdown(): Promise<void> {
  console.log("Shutting down queue worker...");
  await closeQueue();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
