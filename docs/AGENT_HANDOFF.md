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

### 2026-07-23 21:50 ICT — Claude

- Status: Done
- Context: Reviewed Codex's handoff-channel change (no secrets, consistent
  with existing conventions) and committed/pushed it. Earlier this session
  (separate commits) also built and verified the Phase 1 Docker/noVNC
  browser scaffold end-to-end: built both images, started
  `browser-worker-chrome` and `browser-worker-firefox`, confirmed noVNC
  served on `:6080`/`:6081` with the real browser process running inside
  each container, and confirmed clean `docker compose down` shutdown.
- Files: `docs/AGENT_HANDOFF.md`, `AGENTS.md`, `CLAUDE.md`,
  `docs/PROJECT_PLAN.md` (this commit); `docker-compose.yml`,
  `services/browser-worker/*`, `.gitattributes` (earlier commit `2dbc908`).
- Verified: `docker compose build` + `up -d` + manual process/HTTP checks for
  both browsers, `docker compose down` clean exit, `git push` succeeded.
- Next: Playwright worker that connects to a running browser-worker
  container over CDP (Chromium) — first item still unchecked in Phase 1 of
  `docs/PROJECT_PLAN.md`.

### 2026-07-23 22:05 ICT — Claude

- Status: Done
- Context: Added `services/worker` — a `playwright-core` worker that
  connects to `browser-worker-chrome` over CDP. Two non-obvious issues found
  and fixed while verifying end-to-end: (1) Chromium's profile lock files
  (`SingletonLock`) referenced a stale container hostname across restarts
  and made Chromium refuse to start at all — fixed by clearing lock files in
  `entrypoint.sh` on every startup, since only one browser process is ever
  launched per container. (2) Chromium ignores `--remote-debugging-address`
  for a headed instance and only ever binds CDP to `127.0.0.1` even with the
  flag set — fixed by giving the `worker` service `network_mode:
  "service:browser-worker-chrome"` in `docker-compose.yml` instead of trying
  to reach it over the bridge network, so the CDP port is never published or
  exposed beyond loopback.
- Files: `services/browser-worker/entrypoint.sh`, `services/worker/*`
  (new), `docker-compose.yml`, `docs/PROJECT_PLAN.md`, `AGENTS.md`,
  `README.md`.
- Verified: `docker compose build browser-worker-chrome worker`, started
  `browser-worker-chrome`, ran `docker compose run --rm worker` — connected,
  logged page title "Example Domain", wrote
  `data/worker-output/example.png` (visually confirmed it's a real render,
  not blank/error). Re-checked noVNC still returns 200 and Chromium has a
  normal (non-crash-looped) process tree afterward. `docker compose down`
  exits clean, no orphaned containers.
- Next: This worker is a one-shot proof script, not a long-running task
  runner. Next Phase 1 items per `docs/PROJECT_PLAN.md`: Playwright
  `storageState` save/restore for sessions, then a Control Panel with
  Start/Stop/Take-control, then one real site adapter.

### 2026-07-23 22:20 ICT — Codex

- Status: Done
- Context: Shutdown-safe checkpoint before powering off. Verified local `main`
  is at commit `5f30513` and has no commits ahead of `origin/main`; only
  untracked file is `note`, which contains personal Codex CLI command notes and
  is not project work. Docker has no WebOperator services running.
- Files: `docs/AGENT_HANDOFF.md`, `docs/PROJECT_PLAN.md`
- Verified: `git status --short`, `git log --oneline -5`,
  `git log --oneline origin/main..HEAD`, `docker compose ps`, `docker ps
  --filter name=weboperator`
- Next: On resume, read `AGENTS.md`, this file, then `docs/PROJECT_PLAN.md`.
  Continue Phase 1 with Playwright `storageState` save/restore for sessions,
  then the Control Panel, then one real site adapter.

### 2026-07-26 17:58 UTC — Claude

- Status: Done
- Context: Added `storageState` session save/restore to `services/worker`
  (`npm run save`, `npm run restore`). No real site adapter exists yet, so
  this proves the mechanism generically: sets a synthetic marker (a cookie +
  a localStorage value, both an ISO timestamp) on `example.com` in the
  default/visible context, saves it via `context.storageState()`, then loads
  it into a **fresh, isolated** `browser.newContext({ storageState })` and
  reads the marker back — confirming isolated-context creation works against
  a real, non-Playwright-launched Chrome over CDP, not just the default
  context. Shared the CDP connect/retry logic into `src/cdp.ts` (used by
  `index.ts` and both new scripts).
- Files: `services/worker/src/cdp.ts` (new), `save-session.ts` (new),
  `restore-session.ts` (new), `index.ts` (refactored to use `cdp.ts`,
  behavior unchanged), `package.json`, `docker-compose.yml` (added
  `data/sessions` mount), `docs/PROJECT_PLAN.md`, `AGENTS.md`, `README.md`.
- Verified: `docker compose build worker`, started `browser-worker-chrome`,
  ran `save` (logged marker `2026-07-26T17:54:55.282Z`, wrote
  `data/sessions/example.json` — inspected on host, has both the cookie and
  the `origins[].localStorage` entry), ran `restore` (logged back the exact
  same value for both cookie and localStorage). Re-checked noVNC still 200
  and Chromium's process tree normal afterward (closing the isolated context
  didn't disturb the shared browser). `docker compose down` clean.
- Next: Control Panel with Start/Stop/Take-control, then one real site
  adapter — the adapter is what turns this generic proof into an actual
  "log in once by hand, reuse automatically" flow.

### 2026-07-27 01:20 UTC — Claude

- Status: Done
- Context: Built the example site adapter (user chose this over Control
  Panel after I flagged their message mixed their own instruction with a
  pasted Codex recommendation for the opposite order — confirmed via
  AskUserQuestion). Target: `https://the-internet.herokuapp.com`, a free
  practice app built specifically to be automated against (publishes its own
  test credentials) — sidesteps any real-site-authorization question.
  `services/worker/src/adapters/the-internet.ts` exports `dismissAdIfPresent`,
  `login`, `extractSecureAreaMessage`; `run-adapter.ts` chains them: dismiss
  popup → real login → extract flash message → `context.storageState()` to
  `data/sessions/the-internet.json` (a *real* session now, not the synthetic
  marker from the previous change) → screenshot.
  Found and fixed a real bug while verifying: the site shows its ad modal via
  `setTimeout(showAd, 500)`, not on initial render, so checking
  `modal.isVisible()` immediately after `goto` always saw "not present" —
  fixed by `modal.waitFor({ state: 'visible', timeout: 2000 })` instead.
- Files: `services/worker/src/adapters/the-internet.ts` (new),
  `services/worker/src/run-adapter.ts` (new), `package.json`,
  `docs/PROJECT_PLAN.md`, `AGENTS.md`.
- Verified: ran `npm run adapter` 7 times total across debugging. Confirmed
  both branches of the popup logic (modal present → dismissed; modal absent
  on the very next run, matching the site's own "won't reappear once closed"
  behavior). Login succeeded each time, flash message extracted cleanly
  after fixing a "×" close-icon text leak. Inspected
  `data/sessions/the-internet.json` on host — contains a real `rack.session`
  HttpOnly cookie, not a synthetic value. Viewed
  `data/worker-output/the-internet-secure.png` — genuine logged-in Secure
  Area page. noVNC still 200 afterward, `docker compose down` clean.
- Next: Control Panel (Start/Stop/Take-control + buttons for
  save/restore/adapter instead of raw `docker compose run`) is the last open
  Phase 1 item besides Firefox/BiDi.
