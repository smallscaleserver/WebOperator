# Agent Handoff Channel

Shared communication channel for Codex CLI, Claude Code, and humans working on
WebOperator. Use this file for short handoffs that should survive across tools
and sessions.

## How To Use

1. Read the latest entry before starting work.
2. Add a new entry when you change direction, stop mid-task, or finish a chunk
   that the next agent needs to know about.
3. Keep entries concise: current state, files touched, verification run, and
   next recommended action.
4. Do not put secrets, tokens, passwords, cookies, profile contents, or private
   customer data in this file.
5. Keep durable roadmap/checklist updates in `docs/PROJECT_PLAN.md`; this file
   is for session-to-session coordination.

## Entry Template

```markdown
### YYYY-MM-DD HH:MM TZ — AgentName

- Status: Done / In progress / Blocked
- Context: What changed or what was learned.
- Files: `path/to/file`, `another/path`
- Verified: Command(s) run, or `Not run` with reason.
- Next: The most useful next action.
```

## Handoff Log

### 2026-07-23 05:05 ICT — Codex

- Status: Done
- Context: Created this shared handoff channel so Codex CLI, Claude Code, and
  humans have one durable place to leave session notes.
- Files: `docs/AGENT_HANDOFF.md`, `AGENTS.md`, `CLAUDE.md`,
  `docs/PROJECT_PLAN.md`
- Verified: Documentation-only change; no runtime tests run.
- Next: On each future session, read `AGENTS.md`, then this file, then
  `docs/PROJECT_PLAN.md` before editing.
