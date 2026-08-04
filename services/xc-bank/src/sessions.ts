import { randomBytes } from "node:crypto";

export interface Session {
  id: string;
  username: string | null;
  authenticated: boolean;
  regenerateEpoch: number;
}

// Pure in-memory, keyed by a random session-cookie id -- no database, no
// file on disk, nothing that could end up anywhere near WebOperator's own
// data/ directory. Resets whenever this container restarts, which is
// expected and fine for a mock test fixture.
const sessions = new Map<string, Session>();

export function createSession(): Session {
  const id = randomBytes(16).toString("hex");
  const session: Session = { id, username: null, authenticated: false, regenerateEpoch: 0 };
  sessions.set(id, session);
  return session;
}

export function getSession(id: string | undefined): Session | undefined {
  if (!id) return undefined;
  return sessions.get(id);
}

// Used by "Logout clean" -- a full reset, distinct from a plain logout
// (which only flips `authenticated`, keeping `username` remembered).
export function deleteSession(id: string | undefined): void {
  if (!id) return;
  sessions.delete(id);
}
