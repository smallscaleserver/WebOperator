# AGENTS.md — WebOperator

Canonical agent-facing context for this repo. Read this first, before
README.md, when picking up work here — in Claude Code, Codex CLI, or any
other agent.

## What this project is

WebOperator is a universal browser-automation platform: it logs into Gmail
and arbitrary third-party websites, extracts data, and handles unexpected
events (popups, dialogs, expired sessions, CAPTCHA/2FA) — falling back to a
human operator through a live, controllable browser screen when it can't
resolve something itself. Full architecture narrative is in `README.md`.

## Current status

**Phase 1 (Prototype) is functionally complete.** **Phase 2 (Task Engine)
started**: worker actions now run through a Redis/BullMQ queue instead of
directly. Easiest way to use the stack now is the Control Panel:

```bash
docker compose up -d redis browser-worker-chrome browser-worker-firefox
cd services/control-panel && npm install && npm start
```

Note: all three (`redis` + both browsers) need to be up for the panel to
be fully functional — if you only start one browser, Redis-dependent calls
(enqueue/jobs) will hang rather than error if Redis itself isn't running;
check `docker compose ps` if something seems stuck.

Open `http://localhost:4000` — start/stop each browser, "take control" via
an embedded noVNC view, enqueue the 4 fixed worker actions
(demo/save/restore/adapter), or **run a Workflow** — a named multi-step
JSON definition (`services/worker/workflows/*.json`) executed by a generic
action registry (`navigate`/`dismissPopup`/`login`/`extract`/`saveSession`/
`screenshot` — see `src/actions/registry.ts`) instead of one fixed script
per job. Both paths land in the same Jobs table, polling every 3s. **Click
a job row to expand its step-by-step breakdown** with ✅/❌ per step, any
scraped `extract` text, and a link to any screenshot captured. Everything
runs one at a time (queue concurrency 1) since it all shares one browser.
Local only (binds `127.0.0.1`), no auth — don't expose it to a network.
Redis is also loopback-only (`127.0.0.1:6379`), no auth, no persistence —
dev-only, same posture as everything else unauthenticated here.

If restarting the panel: on Windows, stopping the process hosting it
(e.g. a harness task-stop) has been observed to sometimes leave the
underlying `node` process running and holding port 4000. If `npm start`
fails with `EADDRINUSE`, find and kill it: `Get-NetTCPConnection -LocalPort
4000 -State Listen | Select OwningProcess`, then `Stop-Process -Id <pid>
-Force`.

Everything below also still works directly via the CLI if you'd rather not
run the panel — `docker compose run --rm worker npm run <script>` still
runs an action synchronously without touching the queue.

Run the browser + noVNC:

```bash
cp .env.example .env   # first time only
docker compose up -d browser-worker-chrome   # or browser-worker-firefox
```

Open `http://localhost:6080/vnc.html` (Chrome) or `http://localhost:6081/vnc.html`
(Firefox), enter the VNC password from `.env`, and you get a real, clickable
desktop with the browser open — same idea as the `noVNC Manual Takeover`
screen described in the README's architecture.

Run the Playwright worker (proves programmatic control over CDP — requires
`browser-worker-chrome` already up; this is the Chromium/CDP path — see
below for the separate Firefox path, which uses a different mechanism):

```bash
docker compose run --rm worker
```

It connects to the already-running Chromium, navigates to a demo page, and
writes a screenshot to `data/worker-output/example.png` on the host.

Save/restore a browser session (`storageState` — cookies + localStorage;
this demo still uses a synthetic marker on `example.com` for a generic
round-trip proof — the example site adapter below captures a *real*
logged-in session the same way):

```bash
docker compose run --rm worker npm run save     # captures the default context's state
docker compose run --rm worker npm run restore  # loads it into a fresh isolated context
```

Session files land in `data/sessions/*.json` — plaintext, dev-only, same
caveat as `data/profiles/`.

Run the example site adapter (login + popup-dismiss + extract + real session
save, against `https://the-internet.herokuapp.com` — a practice app built
for automation, not a real production site):

```bash
docker compose run --rm worker npm run adapter
```

Run a workflow by name (a generic multi-step alternative to the fixed
scripts above — `the-internet-login` reproduces the adapter's own flow as
data instead of code, proving the engine):

```bash
docker compose run --rm -e WORKFLOW_NAME=the-internet-login worker npm run workflow
```

Workflows are validated in full (every step's action `type`, `params`
shape) before connecting to any browser — a malformed workflow fails
instantly with zero side effects rather than partially executing. The
Control Panel also does a cheap JSON/shape check at enqueue time (before a
job is even created); it doesn't duplicate the full type-registry check,
since that's what the worker-side validation already guarantees. The Jobs
API/UI also show each job's start time and duration now, not just
stdout/stderr/steps.

Run the Firefox demo (proves Playwright can automate Firefox too — via its
own `launchServer()`/`connect()` protocol, **not** literally WebDriver BiDi,
and **not** the vanilla Firefox you'd get from apt; see decision log for
why, and for two real limitations: no profile persistence, and the page a
job creates disappears from noVNC once that job's worker disconnects —
Firefox is only visibly "doing something" while a job is actively running):

```bash
docker compose run --rm worker-firefox npm run firefox-demo
```

Full checklist + decision log: [`docs/PROJECT_PLAN.md`](./docs/PROJECT_PLAN.md).
Cross-agent handoffs: [`docs/AGENT_HANDOFF.md`](./docs/AGENT_HANDOFF.md).

## Repo layout

```
README.md                    Architecture narrative, diagrams, full roadmap prose
docs/PROJECT_PLAN.md          Actionable checklist version of the roadmap + decision log
docker-compose.yml            browser-worker services (chrome + firefox) + worker + redis
services/control-panel/       Host-run Express UI + BullMQ queue: start/stop, take-control, enqueue worker actions
services/browser-worker/      Dockerfile + entrypoint.sh: Xvfb + Fluxbox + browser + x11vnc + noVNC
services/worker/              Playwright (playwright-core) worker, connects to Chromium over CDP or Firefox via launchServer/connect
services/worker/src/adapters/ Site adapters (login/extract/popup-recovery per site) — the older, hardcoded-per-site path
services/worker/src/actions/  Generic action registry (navigate/dismissPopup/login/extract/saveSession/screenshot)
services/worker/workflows/    Named JSON workflow definitions run by run-workflow.ts via the generic registry
services/browser-worker/firefox-launcher/  Node script (launch-firefox.js) that runs Playwright's own Firefox build as a launchServer
data/profiles/                Bind-mounted browser profiles (gitignored, dev-only, unencrypted)
data/worker-output/           Worker output (screenshots etc.), gitignored
data/sessions/                Saved storageState session files (gitignored, dev-only, unencrypted)
```

## Working conventions (decided — don't re-litigate without reason)

- Project name is **WebOperator** only. Do not reintroduce the old
  "WebSteward" codename.
- Core application stack (once code starts beyond the Docker scaffold):
  TypeScript/Node.js + Playwright for browser automation, Redis + BullMQ for
  the task queue, PostgreSQL for task/account metadata, MinIO/S3 for
  screenshots/video/downloads. See decision log in `docs/PROJECT_PLAN.md`.
- Both Chrome and Firefox must stay supported — this is not a Chrome-only
  tool.
- Never store plaintext credentials in source or `.env`. The `data/profiles/`
  bind mount is an explicitly-acknowledged dev-only shortcut until the
  encrypted Session Vault (Phase 2/3) exists — don't treat it as production
  storage.
- If you hit CAPTCHA/2FA/passkey handling, the answer is "stop and hand off
  to a human via the noVNC screen," not "try to bypass it."
- Any new `services/worker` script should wrap its meaningful stages in
  `step()` from `src/steps.ts` (see `run-adapter.ts` for the pattern) so
  failures show up as a specific failed step in the Control Panel's job
  detail, not just a stack trace buried in stdout.
- Firefox automation is real but different from Chromium's: no persistent
  profile, and a job's page disappears from noVNC once that job's worker
  disconnects (the Firefox *server* process itself is persistent, like
  Chrome's container — only the page/context is tied to the connection).
  Don't assume feature parity with the Chromium/CDP path without checking
  the decision log in `docs/PROJECT_PLAN.md` first.

## After making changes

Update the checklist in `docs/PROJECT_PLAN.md` (tick items off, add new ones)
so the next session — in either tool — knows what's actually done.

If another agent or human needs context, add a short entry to
`docs/AGENT_HANDOFF.md` with status, files touched, verification, and the next
recommended action. Never include secrets or browser-profile data there.
