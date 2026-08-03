const { firefox } = require("playwright-core");

const PORT = Number(process.env.FIREFOX_WS_PORT || 9223);
const WS_PATH = process.env.FIREFOX_WS_PATH || "firefox";

// Fixed port/wsPath (Playwright randomizes wsPath by default for security)
// so worker-firefox can reach a predictable ws://localhost:9223/firefox --
// same no-auth-but-loopback-only posture as Chromium's CDP: never published
// to the host, only reachable by a container sharing this network namespace.
(async () => {
  const server = await firefox.launchServer({
    headless: false,
    port: PORT,
    wsPath: WS_PATH,
  });
  console.log(`Firefox server ready: ${server.wsEndpoint()}`);

  const shutdown = async () => {
    console.log("Shutting down Firefox server...");
    await server.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
})().catch((err) => {
  console.error("Failed to launch Firefox server:", err);
  process.exit(1);
});
