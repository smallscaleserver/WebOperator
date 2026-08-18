# CLAUDE.md

This project's agent context lives in [`AGENTS.md`](./AGENTS.md) — read that
first. It has the project summary, current status, repo layout, and working
conventions, kept in one place so Claude Code and Codex CLI stay in sync.

For cross-tool session handoffs, also read and update
[`docs/AGENT_HANDOFF.md`](./docs/AGENT_HANDOFF.md). It is the shared inbox for
Claude Code, Codex CLI, and humans. Nothing Claude-specific beyond that yet.

## Credential automation note

Follow `AGENTS.md`'s Credential Automation Policy. Do not treat older wording as an absolute ban on every possible runtime credential entry: the durable rule is that plaintext credentials must never be recorded, stored, logged, exposed, or committed. Any future `typeSecret(secretRef)` mechanism must be lane/account approved, resolve secrets only at runtime, and must never automate OTP/2FA/CAPTCHA/passkey/security challenges.
