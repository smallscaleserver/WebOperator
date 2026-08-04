import { google } from "googleapis";
import { getAuthorizedClient } from "./client.js";

// Minimal existence proof, not a mail reader -- deliberately prints only
// message count and IDs, not subjects/snippets/bodies, to avoid dumping
// potentially sensitive content to stdout/logs by default.
async function main(): Promise<void> {
  const auth = await getAuthorizedClient();
  const gmail = google.gmail({ version: "v1", auth });

  const { data } = await gmail.users.messages.list({ userId: "me", maxResults: 5 });
  const messages = data.messages ?? [];

  console.log(`Fetched ${messages.length} message ID(s) (resultSizeEstimate: ${data.resultSizeEstimate ?? "?"}):`);
  for (const message of messages) {
    console.log(`  - ${message.id}`);
  }
}

main().catch((err) => {
  console.error("gmail:list failed:", (err as Error).message);
  process.exit(1);
});
