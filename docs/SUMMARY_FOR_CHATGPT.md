# WebOperator — Progress Summary (for a fresh ChatGPT/Codex session)

This is a narrative catch-up doc, meant to be pasted into a new
conversation that doesn't have repo access or prior context. For live,
maintained project state, see (in this repo): `AGENTS.md` (agent
entry point), `docs/PROJECT_PLAN.md` (checklist + decision log),
`docs/AGENT_HANDOFF.md` (session-by-session log). This file is a snapshot
as of **2026-08-03**, commit `fef76c5` (the commit that added this file).

## What WebOperator is

A universal browser-automation platform: it logs into Gmail and arbitrary
third-party websites, extracts data, and handles unexpected events
(popups, dialogs, expired sessions, CAPTCHA/2FA) — falling back to a human
operator through a live, controllable browser screen when it can't resolve
something itself. Repo: `github.com/smallscaleserver/WebOperator`.

## Architecture in one paragraph

Docker Compose runs a long-lived, real (headed, not headless) Chrome or
Firefox in its own container, visible and clickable via noVNC in any
browser tab. A separate, short-lived "worker" container connects to that
browser programmatically (Playwright) to run automation — login, popup
dismissal, data extraction, session save/restore — while a human can watch
or take over the same session at any time. A Control Panel (a small web
UI) ties it together: start/stop the browsers, "take control" via an
embedded noVNC view, and trigger automation jobs through a real job queue
instead of typing Docker commands by hand.

## What's actually been built and verified (not just planned)

**Phase 1 — Prototype: functionally complete.**

- Dockerized Chrome and Firefox, each with its own noVNC-viewable desktop
  (Xvfb + Fluxbox + x11vnc + noVNC), visible on `:6080`/`:6081`.
- A Playwright worker connects to the running Chrome over the Chrome
  DevTools Protocol (CDP) and drives it — navigate, screenshot, fill
  forms, etc. — proven with a real login flow against a public practice
  site (`the-internet.herokuapp.com`), including popup dismissal and data
  extraction.
- Playwright's `storageState` (cookies + localStorage) save/restore is
  proven working, including loading a saved session into a *fresh,
  isolated* browser context — the mechanism a real "log in once, reuse the
  session" flow depends on.
- Firefox automation also works, but via a **different mechanism** than
  Chrome: Playwright doesn't support connecting to an externally-launched
  Firefox over CDP or WebDriver BiDi the way it does for Chromium. It
  needs its own patched Firefox build and a `launchServer()` (in the
  browser container) + `connect()` (from the worker container) split. This
  works, but with two real trade-offs accepted on purpose: no persistent
  browser profile for Firefox (Playwright doesn't allow combining a
  persistent profile with the separate-process-connect model), and a
  worker's page disappears from the noVNC view once that job finishes
  (only visibly active while a job is running, not idle).
- A minimal Control Panel (plain Express + vanilla JS, no framework) runs
  on the host: start/stop each browser, an embedded noVNC iframe for "take
  control," and buttons to trigger automation.

**Phase 2 — Task Engine: in progress, core pieces working.**

- A real Redis/BullMQ job queue replaced direct synchronous execution.
  Jobs run one at a time (concurrency 1, since everything shares one
  browser) — verified with BullMQ's own internal timestamps that job N+1
  only starts the instant job N finishes, not before.
- Every job reports **step-by-step status** (connect → navigate → login →
  extract → …), each step ok/error with an optional message and an
  optional screenshot, visible by clicking a job row in the Control Panel.
  A failing job shows exactly which stage failed, not just a raw stack
  trace.
- A genuine **multi-action workflow engine**: instead of one hardcoded
  script per job, a job can now be a named JSON file describing a sequence
  of generic actions (`navigate`, `dismissPopup`, `login`, `extract`,
  `saveSession`, `screenshot`), executed by a shared action registry. One
  real example workflow reproduces the earlier hardcoded login-adapter's
  behavior as data instead of code, proving the engine end-to-end. This
  was added *alongside* the original fixed scripts, not as a replacement —
  both still work.

## How this got built (working style, for context)

Every non-trivial change went through the same loop: plan first (explored
the actual constraints, sometimes ran small experiments to verify an
assumption before committing to an architecture — e.g. discovering
Firefox's real automation mechanism by testing it directly rather than
trusting the original "WebDriver BiDi" assumption), implement, then
actually run it in Docker and check real output — screenshots were
visually inspected, not just assumed to exist because a command returned
exit code 0. Several real bugs were caught this way (a popup that only
appears after a 500ms timer, not on page load; Chromium ignoring a CDP
flag it appears to accept; a stale profile lock file breaking container
restarts) and are documented rather than silently patched over. Everything
gets committed and pushed after being verified working, with a decision
log recording *why* each non-obvious choice was made, so future sessions
(in either Claude Code or Codex CLI) don't have to re-derive or
re-litigate them.

## What's explicitly still open

- Migrating the 4 original fixed action-scripts onto the new generic
  workflow engine (optional consolidation, not required — both coexist
  fine today).
- Per-step retry and a circuit breaker (whole-job retry already exists).
- Real object storage (MinIO/S3) for screenshots/downloads — currently
  just local bind-mounted files.
- Phase 3 (Gmail via OAuth) and Phase 4 (a general adapter/plugin system
  for arbitrary sites) haven't been started.
- Everything session-related (`data/profiles/`, `data/sessions/`) is
  explicitly plaintext and dev-only — no encrypted Session Vault yet.

## A few things worth knowing if you're picking this up cold

- The whole stack (Redis, both browsers, the Control Panel) is designed to
  be loopback-only / no-auth by default — intentional for a local dev tool,
  documented everywhere it applies, not an oversight.
- If the Control Panel seems to hang on any Redis-touching endpoint, check
  `docker compose ps` for `redis` first — ioredis queues requests during an
  outage instead of failing fast, so it hangs rather than errors.
- On Windows, stopping the Control Panel process sometimes leaves the
  underlying `node` process alive holding its port — check
  `Get-NetTCPConnection -LocalPort 4000 -State Listen` before restarting it.
