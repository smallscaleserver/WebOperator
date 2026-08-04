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
docker compose up -d redis minio browser-worker-chrome browser-worker-firefox
cd services/control-panel && npm install
npm start          # terminal 1: API/UI (producer) -> http://localhost:4000
npm run worker     # terminal 2: queue consumer -- jobs don't run without this
```

Every screenshot a job takes, and every session file it saves, is also
mirrored to MinIO (S3-compatible object storage, `weboperator-artifacts`
bucket, `screenshots/*` and `sessions/*` prefixes) — console at
`http://localhost:9001` (creds: `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` in
`.env`, defaults `weboperator`/`changeme123`). This is best-effort and
additive: local files under `data/worker-output/` and `data/sessions/`
and the Control Panel's `/screenshots/*` route are unchanged and remain
the source of truth: a MinIO outage shows up as a failed
`archive-screenshot`/`archive-session` step in the job detail, not a
failed job. Session files stay plaintext dev-only in MinIO too — this is
a second storage location, not an encryption upgrade. If
`worker`/`worker-firefox` run outside Docker Compose (rare), set
`MINIO_ENDPOINT`/`MINIO_PORT` to reach MinIO directly — inside Compose
this defaults correctly via service DNS.

The Control Panel also reads artifacts *back* from MinIO now, not just
local disk: each job step's `screenshot` link in the expandable step
detail gets a second "MinIO" link alongside it, shown only when that
job's `archive-screenshot` step actually succeeded. The route is
`GET /api/artifacts/:kind/:filename` — generalized beyond just
screenshots, with an explicit allowlist (`screenshots`, `downloads`,
`videos`, `traces` — **`sessions` is deliberately never in that list**,
so session content can never be read through this route regardless of
what else changes here). Only `screenshots` has real content today;
`downloads`/`videos`/`traces` are reserved prefixes with no producer yet
(see `docs/PROJECT_PLAN.md` decision log — downloads specifically hit a
real architectural blocker with `connectOverCDP` against an
externally-launched, separate-container Chromium, not a code bug). The
local `/screenshots/*` route is unchanged and still the source of truth —
the MinIO route is a second, independently-failing read path: if MinIO is
down or the object is missing, it returns a clear JSON error (502/404),
it does not affect any other route or crash the panel.

**The API and the queue consumer are two separate processes now** — `npm
start` only serves the UI and enqueues jobs; nothing actually *executes* a
job unless `npm run worker` is also running. A job enqueued while the
worker is down just sits in `waiting` state in Redis (not lost, not an
error) until the worker starts. This is deliberate: restarting the API to
pick up a UI change (or if it crashes) no longer interrupts a job that's
mid-flight on the worker, and vice versa — verified directly by killing
each process while the other kept working.

Note: `redis` + both browsers need to be up for the panel to be fully
functional — if you only start one browser, Redis-dependent calls (enqueue/
jobs) will hang rather than error if Redis itself isn't running; check
`docker compose ps` if something seems stuck.

Open `http://localhost:4000` — start/stop each browser, "take control" via
an embedded noVNC view, or run automation. **The workflow engine is now
the primary orchestration path**: a named multi-step JSON definition
(`services/worker/workflows/*.json`) executed by a generic action
registry (`navigate`/`dismissPopup`/`login`/`extract`/`saveSession`/
`screenshot` — see `src/actions/registry.ts`) instead of one fixed script
per job. The "Run demo" and "Run example adapter" buttons enqueue
workflows (`demo`, `the-internet-login`) under the hood now, not a fixed
action — same buttons, same behavior from the UI's perspective, different
backend path. Only "Save session" and "Restore session" remain true fixed
actions: neither maps onto the current generic action registry (`save`
sets a synthetic marker via bespoke inline JS with no generic
equivalent; `restore` needs a fresh isolated context the workflow
engine's one-shared-context-per-run model doesn't support) — see
`docs/PROJECT_PLAN.md` decision log for the full reasoning. Their
underlying `services/worker` npm scripts (`npm run start`/`npm run
adapter`) still work directly via CLI even though the Panel no longer
enqueues them as fixed actions. Every path lands in the same Jobs table,
polling every 3s. **Click a job row to expand its step-by-step
breakdown** with ✅/❌ per step, any scraped `extract` text, and a link to
any screenshot captured. Everything runs one at a time (queue concurrency
1) since it all shares one browser. Local only (binds `127.0.0.1`), no
auth — don't expose it to a network. Redis is also loopback-only
(`127.0.0.1:6379`), no auth, no persistence — dev-only, same posture as
everything else unauthenticated here.

If restarting either process: on Windows, stopping a process hosting it
(e.g. a harness task-stop) has been observed to sometimes leave the
underlying `node` process running. For the API (`npm start`, holds port
4000): `Get-NetTCPConnection -LocalPort 4000 -State Listen | Select
OwningProcess`, then `Stop-Process -Id <pid> -Force`. For the worker
(`npm run worker`, holds no port — this check won't find it): `Get-CimInstance
Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine
-like '*worker.ts*' }`, then `Stop-Process -Id <pid> -Force`. Hit this for
*both* processes while verifying the split — check both, not just the API.

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

Steps can opt into per-step retry via an optional `retry` field:
```json
{ "type": "navigate", "params": { "url": "..." }, "retry": { "attempts": 3, "delayMs": 2000 } }
```
`navigate`/`dismissPopup`/`extract`/`screenshot` retry automatically (2
attempts, 1s delay) even without a `retry` field, since they're read-only
or idempotent. `login`/`saveSession` never retry implicitly — only if a
step explicitly sets `retry` — since blindly retrying a state-changing
action risks double-submitting a form. The step UI only shows attempt
info when it's actually informative (a retry happened, or all attempts
were exhausted) — a clean first-try success stays exactly as quiet as
before.

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
services/control-panel/       Host-run Express UI + BullMQ (src/server.ts = API/UI/producer, src/worker.ts = queue consumer -- two separate processes)
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
