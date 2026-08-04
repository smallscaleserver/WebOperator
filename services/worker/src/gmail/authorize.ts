import { createServer } from "node:http";
import { getOAuth2Client, buildAuthUrl, saveTokens } from "./client.js";

// Standard CLI-based Google OAuth pattern (the same idea `gcloud auth
// login` uses): print a consent URL for the human to open in their OWN
// real browser -- we never automate the Gmail/Google login page
// ourselves -- then listen for exactly one redirect back with the
// authorization code, exchange it, and exit. The listener binds to the
// exact host/port/path parsed out of GOOGLE_REDIRECT_URI so whatever's
// registered in the Google Cloud Console always matches what this
// actually listens on.
async function main(): Promise<void> {
  const oauth2Client = getOAuth2Client();
  const redirectUri = new URL(process.env.GOOGLE_REDIRECT_URI as string);
  const authUrl = buildAuthUrl(oauth2Client);

  console.log("Open this URL in your own browser and sign in / consent:\n");
  console.log(authUrl);
  console.log(`\nWaiting for the redirect back to ${redirectUri.origin}${redirectUri.pathname} ...`);

  await new Promise<void>((resolve, reject) => {
    const server = createServer((req, res) => {
      const requestUrl = new URL(req.url ?? "/", redirectUri.origin);
      if (requestUrl.pathname !== redirectUri.pathname) {
        res.writeHead(404).end();
        return;
      }
      const code = requestUrl.searchParams.get("code");
      const error = requestUrl.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" }).end(`<p>Authorization failed: ${error}</p>`);
        server.close();
        reject(new Error(`Google returned an OAuth error: ${error}`));
        return;
      }
      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" }).end("<p>Missing \"code\" in redirect.</p>");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" }).end("<p>Authorized. You can close this tab.</p>");
      server.close();

      oauth2Client
        .getToken(code)
        .then(({ tokens }) => saveTokens(tokens))
        .then(() => {
          console.log(`Saved Gmail token to ${process.env.GMAIL_TOKEN_PATH ?? "data/gmail-tokens/gmail-token.json"}`);
          resolve();
        })
        .catch(reject);
    });
    server.listen(Number(redirectUri.port), redirectUri.hostname);
  });
}

main().catch((err) => {
  console.error("gmail:authorize failed:", (err as Error).message);
  process.exit(1);
});
