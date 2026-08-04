import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { google } from "googleapis";
import type { OAuth2Client, Credentials } from "google-auth-library";

// Minimal, least-privilege scope for the read-only proof this round --
// send/modify scopes are a separate, later concern once a real feature
// needs them (README's own OAuth principle: request only what's needed).
const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

const TOKEN_PATH = process.env.GMAIL_TOKEN_PATH ?? "data/gmail-tokens/gmail-token.json";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var "${name}" -- set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and ` +
        `GOOGLE_REDIRECT_URI (see .env.example) before running a Gmail script.`,
    );
  }
  return value;
}

export function getOAuth2Client(): OAuth2Client {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = requireEnv("GOOGLE_REDIRECT_URI");
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// access_type "offline" + prompt "consent" are both required to reliably
// get a refresh_token back -- without prompt=consent, Google only issues
// one on a user's *first* authorization, not on repeat runs.
export function buildAuthUrl(oauth2Client: OAuth2Client): string {
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
  });
}

// Dev-only token storage: a plain JSON file under the repo's already
// fully-gitignored data/ directory -- same posture already documented
// and accepted for data/profiles/* and data/sessions/*. Plaintext,
// unencrypted, not safe for a real account; a placeholder until the real
// encrypted vault (its own separate, later Phase 3 checklist item)
// exists. Not pretending otherwise.
export async function saveTokens(tokens: Credentials): Promise<void> {
  await mkdir(dirname(TOKEN_PATH), { recursive: true });
  await writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2), "utf-8");
}

async function loadTokens(): Promise<Credentials> {
  try {
    const raw = await readFile(TOKEN_PATH, "utf-8");
    return JSON.parse(raw) as Credentials;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`No Gmail token found at ${TOKEN_PATH} -- run "npm run gmail:authorize" first.`);
    }
    throw err;
  }
}

export async function getAuthorizedClient(): Promise<OAuth2Client> {
  const oauth2Client = getOAuth2Client();
  const tokens = await loadTokens();
  oauth2Client.setCredentials(tokens);
  return oauth2Client;
}
