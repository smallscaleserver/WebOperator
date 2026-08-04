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

### 2026-07-27 09:40 UTC — Claude

- Status: Done
- Context: Built the Control Panel (user confirmed I should build it, after
  I flagged their message looked like it was pasting Codex's own reply
  rather than an instruction to me — claimed here first to avoid a parallel
  Codex session starting the same work). Runs as a plain host Node process
  (`services/control-panel`, not a Docker service — its whole job is
  shelling out `docker compose`, so containerizing it would mean mounting
  the Docker socket for no real benefit at this stage; see decision log).
  Backend is Express with a **fixed action allowlist**
  (`src/actions.ts`) — the HTTP API only ever accepts a key into that table
  and runs the corresponding fixed argv via `execFile`, so no request input
  ever reaches a shell string. Binds `127.0.0.1` only. Frontend is one
  plain HTML/JS page (no framework): status polling, start/stop per
  browser, an embedded noVNC iframe for "take control," and buttons for
  the four worker actions (disabled unless Chrome is running, since the
  worker shares Chrome's network namespace).
- Files: `services/control-panel/` (new: `package.json`, `tsconfig.json`,
  `src/actions.ts`, `src/server.ts`, `public/index.html`, `public/app.js`),
  `docs/PROJECT_PLAN.md`, `AGENTS.md`.
- Verified: ran the server on host (`npm start`), curl-tested every action
  endpoint directly — `startChrome`/`stopChrome` flip `/api/status`
  correctly, an unknown action name correctly 400s without executing
  anything, and all four worker actions (`runStart`, `runSave`,
  `runRestore`, `runAdapter`) returned the same successful output already
  verified via CLI in prior sessions. Then visually verified the actual
  rendered page: connected the real Chromium to `http://host.docker.internal:4000`
  over CDP and screenshotted it — status dots/button enablement correct,
  and clicking "Take control" genuinely loaded the noVNC connect screen
  inside the embedded iframe. `docker compose down` clean afterward.
- Next: Phase 1 is functionally done except Firefox/BiDi worker
  automation. After that, Phase 2 (Task Engine: queue, scheduler, retry).

### 2026-07-29 10:05 UTC — Claude

- Status: In progress
- Context: **Claiming Phase 2 Task Engine** (Redis + BullMQ job queue, a
  job runner replacing direct `docker compose run` calls, Control Panel
  gains enqueue + job status/log view). User confirmed I should build it —
  their message again looked like it was relaying Codex's own stated plan
  ("ผมเลือกเริ่ม Phase 2... ด้วย BullMQ") rather than a direct instruction,
  so I checked (repo still at `f512590`, nothing claimed) and asked before
  starting, same as the Control Panel handoff. If you're Codex (or another
  session) reading this before a "Done" entry below: this is claimed —
  check back here or pick Firefox/BiDi instead.
- Files: none yet — planning now.
- Verified: n/a
- Next: (this entry will be updated once Phase 2 work is done and verified).

### 2026-07-29 (later) — Claude

- Status: Done
- Context: Added a Redis/BullMQ queue in front of the 4 worker actions.
  New `redis:7-alpine` compose service (`127.0.0.1:6379` only, no auth, no
  volume — ephemeral, dev-only). Both the BullMQ producer (`Queue`) and
  consumer (`Worker`, concurrency 1) run inside the existing Control Panel
  process rather than a separate service — reuses the exact `docker
  compose run --rm worker npm run <script>` execution path already built,
  pulled the shell-exec logic out of `server.ts` into `src/exec.ts` so both
  the old synchronous `/api/action/:name` and the new queue processor call
  the same code. New `POST /api/enqueue/:name` (4 worker actions only —
  browser start/stop stay synchronous, they're not automation jobs) and
  `GET /api/jobs`. Frontend: worker-action buttons now enqueue instead of
  blocking; new Jobs table polls every 3s.
- Files: `docker-compose.yml` (redis service), `services/control-panel/src/exec.ts`
  (new — shared exec logic), `src/queue.ts` (new), `src/server.ts` (routes),
  `package.json` (added `bullmq`), `public/index.html` + `public/app.js`
  (Jobs table, enqueue buttons), `docs/PROJECT_PLAN.md`, `AGENTS.md`.
- Verified: `npx tsc --noEmit` clean. `curl -X POST
  localhost:4000/api/enqueue/runStart` returned a `jobId` in ~0.26s (proves
  async — the old endpoint blocked for several seconds). Polled
  `/api/jobs`, watched it reach `completed` with the same output already
  verified via CLI in prior sessions. Enqueued two jobs back-to-back and
  checked BullMQ's `processedOn`/`finishedOn` directly (not just polling) —
  job N+1's `processedOn` exactly equalled job N's `finishedOn`, so
  concurrency:1 is genuinely serializing, not just appearing to. Confirmed
  `POST /api/enqueue/<invalid>` and `.../startChrome` (valid action, but not
  queueable) both correctly 400 without executing anything. Visually
  verified the real UI: connected actual Chromium to
  `http://host.docker.internal:4000` over CDP, clicked the "Run demo"
  button for real, screenshotted the job going from `active` to
  (confirmed via API) `completed`. `docker compose down` clean afterward.
  One caveat: didn't get clean confirmation of the graceful-shutdown log
  line when stopping the control-panel process via the harness's task
  stop — Node's `SIGTERM` handling is known to be unreliable on Windows
  (no real POSIX signals); the shutdown code itself follows the standard
  correct pattern, just noting it's unverified specifically on this
  platform.
- Next: Phase 1 — Firefox/BiDi worker automation. Phase 2 — step-based
  workflow (multi-action jobs instead of one script per job), trace/
  screenshot capture per step, MinIO/S3 storage.

### 2026-07-29 (later still) — Claude

- Status: In progress
- Context: **Claiming step-based workflow + screenshot-per-step**. Same
  pattern as the last two claims: user's message read like Codex's own
  stated plan ("ผมเลือก Phase 2: step-based workflow... ครับ") rather than a
  direct instruction, so I checked (repo still at `c5d0254`, nothing
  claimed) and asked before starting. If you're Codex (or another session)
  reading this before a "Done" entry below: this is claimed — check back
  here or pick Firefox/BiDi instead.
- Files: none yet — planning now.
- Verified: n/a
- Next: (this entry will be updated once the work is done and verified).

### 2026-07-29 (later still 2) — Claude

- Status: Done
- Context: Added step-level reporting + screenshot links to the Control
  Panel's job detail. New `services/worker/src/steps.ts` exports `step(name,
  fn, opts?)` — wraps a stage, logs `WEBOP_STEP {...}` (name/status/detail/
  screenshot/timestamp) to stdout on success or failure, rethrows on error
  so existing `main().catch(...)` exit-1 behavior is unchanged. Wrapped the
  meaningful stages in all 4 worker scripts (`index.ts`, `save-session.ts`,
  `restore-session.ts`, `run-adapter.ts`) — `run-adapter.ts`'s `login` step
  now throws (and reports `error`) when the adapter's `login()` returns
  `{success:false}`, instead of silently continuing. Control Panel's
  `exec.ts` regex-parses `WEBOP_STEP` lines out of captured stdout into
  `ActionResult.steps`; `server.ts` gained a read-only `/screenshots/*`
  static route over the existing `data/worker-output` bind-mount directory
  (no new plumbing — same files worker containers already write there).
  Frontend: job rows are now clickable, expanding a sibling row with the
  step list (✅/❌, detail text, screenshot link); expanded state tracked in
  a `Set` so it survives the 3s poll re-render instead of collapsing.
  Deliberately **not** live-streamed — steps are parsed from the complete
  stdout after the job finishes, not pushed while it runs; see decision log
  for the trade-off.
- Files: `services/worker/src/steps.ts` (new), `index.ts`,
  `save-session.ts`, `restore-session.ts`, `run-adapter.ts` (all wrapped),
  `services/control-panel/src/exec.ts` (parsing + `StepEvent`/`ActionResult`
  types), `src/server.ts` (`/screenshots` route), `public/index.html` +
  `public/app.js` (expandable rows), `docs/PROJECT_PLAN.md`, `AGENTS.md`.
- Verified: `npx tsc --noEmit` clean in both `services/worker` and
  `services/control-panel`. Enqueued `runAdapter` through the real queue —
  `result.steps` came back as all 6 expected stages
  (`connect`/`dismiss-ad`/`login`/`extract`/`save-session`/`screenshot`),
  each `status: "ok"`, screenshot filename attached on the last one.
  Deliberately broke `index.ts`'s navigation (bad `TARGET_URL`) via direct
  CLI run — confirmed the `navigate` step logged `status: "error"` with the
  real Playwright error message as `detail`, while `connect` still showed
  `ok` — proves failures pinpoint the actual failing stage, not just "the
  job failed." Verified `/screenshots/the-internet-secure.png` serves the
  identical file (byte-for-byte size match) as the one on disk. Visually
  verified in the real Chromium (`host.docker.internal:4000` over CDP):
  clicked a job row, screenshotted the expanded step list with a working
  screenshot link, waited through a full 3s poll cycle, screenshotted again
  — identical, confirming expanded state persists. `docker compose down`
  clean.
  Also hit and documented a real Windows gotcha while restarting the panel:
  a harness task-stop left the previous `node` process alive holding port
  4000 (`EADDRINUSE` on restart) — found and killed it via
  `Get-NetTCPConnection -LocalPort 4000 -State Listen` +
  `Stop-Process -Force`. Not deterministic (a second stop/restart cycle
  during the same session worked cleanly), so noted as "has been observed,"
  not "always happens," with the fix command in `AGENTS.md`.
- Next: Firefox/BiDi (Phase 1), or continue Phase 2 — real multi-action
  step-based workflow (a job running several distinct actions in sequence,
  not one script per job), per-step retry, MinIO/S3 storage.

### 2026-07-29 (session 2) — Claude

- Status: In progress
- Context: **Claiming the real multi-action workflow runner** (workflow
  definition with action types like navigate/dismissPopup/login/extract/
  saveSession/screenshot; Control Panel enqueues a whole workflow, not one
  fixed script per job). Same pattern as the last three claims — user's
  message read like Codex's own stated plan rather than a direct
  instruction, so I checked (repo still at `cbc7923`, nothing claimed) and
  asked before starting. If you're Codex (or another session) reading this
  before a "Done" entry below: this is claimed — check back here or pick
  Firefox/BiDi instead.
- Files: none yet — planning now.
- Verified: n/a
- Next: (this entry will be updated once the work is done and verified).

### 2026-07-29 (session 2, later) — Claude

- Status: Done
- Context: Added a real multi-action workflow engine alongside the
  existing 4 fixed actions (not replacing them). New generic action
  registry (`services/worker/src/actions/registry.ts`) with 6 handlers —
  `navigate`, `dismissPopup` (generalizes `adapters/the-internet.ts`'s
  `dismissAdIfPresent`, carrying forward the `waitFor({state:"visible"})`
  fix rather than an immediate `isVisible()` check — the site's modal
  appears via a 500ms `setTimeout`), `login`, `extract`, `saveSession`,
  `screenshot`. New `run-workflow.ts` reads `WORKFLOW_NAME` env, loads
  `services/worker/workflows/<name>.json`, executes each step through the
  registry using the existing `step()` reporting wrapper — zero changes
  needed to the step-reporting/parsing/UI pipeline built last session, it
  just worked. Added `workflows/the-internet-login.json`, a 7-step
  reproduction of `run-adapter.ts`'s own flow as data instead of code, to
  prove the engine end-to-end. `steps.ts` gained an optional `data` field
  + `captureResult` option so `extract`'s scraped text is visible in the
  job detail UI (not just implied by success). Control Panel: `exec.ts`
  refactored `runAction`'s exec+parse logic into a shared `execAndParse`
  now also used by new `runWorkflow(name)`; `queue.ts` branches the worker
  processor on a `workflow:` job-name prefix; new `GET /api/workflows` +
  `POST /api/enqueue-workflow/:name` (validated against real files on disk
  before executing anything, same posture as the existing action
  endpoint); new "Workflows" section in the UI, `renderSteps()` extended to
  show `step.data`.
- Files: `services/worker/src/actions/registry.ts` (new),
  `run-workflow.ts` (new), `workflows/the-internet-login.json` (new),
  `steps.ts` (data field), `package.json`, `Dockerfile` (+`COPY
  workflows`), `docker-compose.yml` (+workflows bind mount),
  `services/control-panel/src/exec.ts`, `queue.ts`, `server.ts`,
  `public/index.html` + `public/app.js`, `docs/PROJECT_PLAN.md`,
  `AGENTS.md`.
- Verified: `npx tsc --noEmit` clean in both projects. Direct CLI run of
  the workflow — all 7 steps `ok`, `5-extract`'s `data` held the real flash
  text ("You logged into a secure area!"), screenshot file confirmed
  identical size to source. Through the real Control Panel: `GET
  /api/workflows` → `["the-internet-login"]`; enqueue returned a `jobId` in
  0.24s (async, not blocking); polled to `completed` with all 8 steps
  (including `connect`) correct; `POST /api/enqueue-workflow/not-real` →
  400, nothing executed. Regression check: enqueued the original
  `runAdapter` fixed action through `/api/enqueue/:name` after the
  `exec.ts` refactor — still `completed`/`ok`, unaffected. Visually
  verified in the real Chromium (`host.docker.internal:4000` over CDP):
  screenshotted the new Workflows section and the expanded workflow job
  row — step list renders correctly including the extract step's scraped
  text inline. `docker compose down` clean. Hit the documented Windows
  port-4000 orphan-process issue again restarting the panel mid-session —
  confirmed the documented fix command still works.
- Next: Firefox/BiDi (Phase 1), or continue Phase 2 — migrate the 4 fixed
  actions onto the workflow engine (optional consolidation), per-step
  retry, MinIO/S3 storage.

### 2026-07-29 (session 3) — Claude

- Status: In progress
- Context: **Claiming Firefox/BiDi worker automation** — direct
  instruction from the user this time, not a Codex-relay message, but
  checked `git log` first anyway (repo still at `52c0645`, nothing
  claimed) per the now-established habit before starting anything
  nontrivial. If you're Codex (or another session) reading this before a
  "Done" entry below: this is claimed — check back here or pick a
  different open item instead.
- Files: none yet — researching actual Playwright/Firefox BiDi capability
  before designing anything (unlike Chromium's `connectOverCDP`, which is
  stable and already proven in this repo, connecting to an
  externally-launched Firefox over WebDriver BiDi is much less certain to
  be supported the same way — don't want to design around an assumption
  that turns out wrong, the way the ad-modal timing bug taught us to
  verify rather than assume).
- Verified: n/a yet.
- Next: (this entry will be updated once the work is done and verified).

### 2026-07-29 (session 3, later) — Claude

- Status: Done
- Context: Firefox worker automation lands, via Playwright's own
  `launchServer()`/`connect()` — **not** literally WebDriver BiDi, corrected
  from the checklist's original (unverified) wording after real testing.
  Key findings, all confirmed empirically before building anything:
  (1) `npx playwright install firefox` downloads a Playwright-patched
  Firefox build; the apt `firefox-esr` we used before cannot be automated
  by Playwright at all, so it's removed from `services/browser-worker`'s
  Dockerfile. (2) `launchServer()` (in the browser container) +
  `connect()` (from a separate worker container) is the real mechanism —
  proven directly on host before touching Docker. (3) Passing `-profile
  <dir>` to `launchServer()` is explicitly rejected by Playwright itself,
  which points you at `launchPersistentContext` instead — but that has no
  server/connect equivalent, so persistent-profile and
  separate-process-connect are mutually exclusive. Chose the split-process
  architecture (matches Chromium's shape); `storageState` remains the real
  session-continuity mechanism, so this costs less than it sounds.
  (4) Discovered while verifying, not predicted: the page/context a
  worker-firefox job creates disappears from noVNC once that job's script
  disconnects, even though the Firefox *server* process (and Xvfb/x11vnc/
  noVNC around it) stays up exactly like Chrome's — so Firefox is only
  visibly "doing something" while a job is actively running, not
  before/after. Documented plainly rather than glossed over.
  Built: `services/browser-worker/firefox-launcher/` (Node + playwright-core
  + `launch-firefox.js`, fixed port 9223/wsPath so it's reachable without
  publishing an unauthenticated endpoint to the host — same posture as
  CDP), Dockerfile updated to Node 20 via NodeSource (Debian's apt nodejs
  is 18, too old for playwright-core 1.62), `entrypoint.sh`'s firefox
  branch now runs the launcher instead of bare `firefox`.
  `services/worker/src/firefoxConnect.ts` (retry-based connect, since
  there's no CDP-style HTTP health-check endpoint to poll) +
  `run-firefox-demo.ts` (connect → navigate → screenshot, same `step()`
  reporting as every other script — needed zero changes to the existing
  step-parsing/queue/UI pipeline). New `worker-firefox` compose service
  (mirrors `worker`, pointed at `browser-worker-firefox`'s network
  namespace). Control Panel: `runFirefoxDemo` added to `actions.ts` +
  `QUEUEABLE_ACTIONS`; UI buttons gained `data-requires="chrome"/"firefox"`
  so enablement checks the right browser per button instead of always
  Chrome.
- Files: `services/browser-worker/Dockerfile`, `entrypoint.sh`,
  `firefox-launcher/package.json` + `launch-firefox.js` (new);
  `services/worker/src/firefoxConnect.ts` + `run-firefox-demo.ts` (new),
  `package.json`; `docker-compose.yml` (`worker-firefox` service);
  `services/control-panel/src/actions.ts`, `queue.ts`, `public/index.html`
  + `public/app.js`; `docs/PROJECT_PLAN.md`, `AGENTS.md`.
- Verified: `docker compose build browser-worker-firefox` succeeded (~110MB
  Firefox build + system deps via `--with-deps`). Started it — log showed
  `Firefox server ready: ws://...`; confirmed via `ps aux` the full Firefox
  process tree was running. Ran `run-firefox-demo` directly via
  `docker compose run --rm worker-firefox npm run firefox-demo` — all 3
  steps `ok`, screenshot visually confirmed as a genuine Firefox render
  (distinct font rendering from Chromium's). Through the real Control
  Panel: enqueued `runFirefoxDemo`, it completed with identical step
  detail in the Jobs UI; regression-checked `runStart` (Chromium) still
  works unaffected. Visually verified the full UI (both browsers running,
  5 worker-action buttons, Firefox demo button, both job types in the Jobs
  table with real results) via the established `host.docker.internal:4000`
  CDP screenshot technique. Hit a new, separate gotcha mid-session: had
  stopped `redis` earlier without restarting it alongside the browsers —
  every Redis-touching Control Panel endpoint (enqueue, jobs list) hung
  for 20+ seconds instead of erroring, until Redis came back (ioredis
  queues commands during a connection outage rather than failing fast).
  Documented in `AGENTS.md` so it's not mysterious next time. Also
  re-hit the known Windows port-4000 orphan-process issue restarting the
  panel — same fix as before. `docker compose down` clean afterward.
- Next: Phase 1 is now functionally complete. Phase 2 continuation:
  migrate the 4 fixed actions onto the workflow engine (optional), per-step
  retry, MinIO/S3 storage. If ever worth the effort: a small always-connected
  keep-alive client so a Firefox page stays visible in noVNC between jobs
  the way Chrome's does — not pursued now.

### 2026-08-03 — Claude

- Status: Done
- Context: Added `docs/SUMMARY_FOR_CHATGPT.md` — a self-contained
  narrative progress summary for pasting into a fresh ChatGPT/Codex
  conversation without repo access (complements the other docs, which all
  assume repo access). Forgot to log it here at the time — this entry
  covers that gap retroactively.
- Files: `docs/SUMMARY_FOR_CHATGPT.md` (new).
- Verified: reviewed for accuracy against the actual decision log/checklist
  before committing.
- Next: fix a stale commit-hash reference inside that same summary file
  (it named the *previous* commit, not the one that actually added it —
  caught by Codex reviewing it), plus a stale "no real site adapter yet"
  line in `AGENTS.md` left over from before the adapter/workflow work
  landed. Claimed together with workflow-validation + job-detail hardening
  below.

### 2026-08-03 (later) — Claude

- Status: In progress
- Context: **Claiming**: (1) the two stale-doc fixes above, (2) workflow
  validation before enqueueing (reject an unknown action `type` up front
  instead of partially executing a workflow and failing mid-way), (3)
  modest job-detail hardening (start time, duration). User confirmed I own
  this — same pattern as prior claims (message read like Codex's own
  offer, "ผมเริ่มจากข้อ 1–2 ได้เลยครับ", not a direct instruction), checked
  `git log` first (still at `fef76c5`, nothing claimed). Explicitly *not*
  in scope this round: per-step retry, MinIO/Gmail, splitting the queue
  worker into its own process, `.env.example` additions — those are listed
  as later steps, not part of what was offered.
- Files: none yet — planning now.
- Verified: n/a
- Next: (this entry will be updated once the work is done and verified).

### 2026-08-03 (later still) — Claude

- Status: Done
- Context: Fixed both stale docs (commit hash in
  `docs/SUMMARY_FOR_CHATGPT.md`, "no real site adapter yet" line in
  `AGENTS.md` — the real adapter has existed for a while now). Also
  discovered and fixed the decision-log table in `docs/PROJECT_PLAN.md`
  being split into two disconnected tables by an italic note paragraph
  planted in the middle of it (the Firefox rows had no header row of their
  own) — merged back into one contiguous table.
  Workflow validation: `run-workflow.ts` now validates the *entire*
  workflow (every step's `type` exists in `ACTION_HANDLERS`, `params` is an
  object if present) via a `step("validate", ...)` call *before*
  `step("connect", ...)` — a bad step anywhere fails the job instantly with
  zero browser interaction, instead of executing earlier steps first.
  Control Panel's `/api/enqueue-workflow/:name` gained a cheap JSON/shape
  check (`validateWorkflowFile` in `exec.ts`) so genuinely broken JSON 400s
  before a job even exists — deliberately *not* duplicating the action-type
  registry there (lives in a separate npm project; the worker-side check
  already guarantees no partial execution, so duplicating would only add
  sync burden, not real safety).
  Job-detail hardening: `ActionResult` gained `exitCode` (0 on success,
  the real exec error code on failure when numeric); `JobSummary` gained
  `processedOn`/`durationMs` (from BullMQ's own `job.processedOn`, already
  tracked, just not surfaced before). UI shows a "Started X — duration Ys"
  line above each job's expanded step list.
- Files: `services/worker/src/run-workflow.ts`,
  `services/control-panel/src/exec.ts`, `queue.ts`, `server.ts`,
  `public/app.js`, `public/index.html`, `docs/SUMMARY_FOR_CHATGPT.md`,
  `AGENTS.md`, `docs/PROJECT_PLAN.md`.
- Verified: `npx tsc --noEmit` clean in both projects. Created a temporary
  workflow file with an unknown action `type` — direct CLI run failed on
  `validate` with zero `connect`/browser lines logged (proving zero side
  effects). Through the real Control Panel: a genuinely-malformed-JSON
  workflow file 400'd at enqueue time with a clear parse error; the
  bad-type-but-valid-JSON file enqueued fine then failed cleanly on
  `validate` (job state `completed`, `result.ok: false` — consistent with
  how failures have always been represented here, not a new inconsistency).
  Regression-checked the real `the-internet-login` workflow and
  `runAdapter` — both still succeed, with correct `durationMs` values
  (~5s for real work, ~1.3s for the instant validation failure). Visually
  confirmed the "Started X — duration Ys" line renders in the real
  Control Panel UI via the established `host.docker.internal:4000` CDP
  screenshot technique. Removed all temporary test workflow files before
  committing. `docker compose down` clean; re-hit and re-fixed the Windows
  port-4000 orphan-process gotcha again restarting the panel.
  Noted but *not* fixed (pre-existing, out of scope): a failed job's
  "Result" column in the UI can show a raw stack-trace line instead of a
  clean message, because `shortResult()` in `app.js` takes the last line
  of `result.error`, which for an uncaught-exception failure can itself be
  multi-line. Not introduced by this change — exists for any failing
  action already.
- Next: per-step retry, MinIO/S3, splitting the queue worker into its own
  process, `.env.example` additions, migrating the 4 fixed actions onto
  the workflow engine, or Phase 3 (Gmail) — whichever the user picks. Minor
  polish candidate whenever convenient: clean up `shortResult()`'s handling
  of multi-line error messages (noted above).

### 2026-08-04 — Claude

- Status: In progress
- Context: **Claiming per-step retry for the workflow engine**. Same
  pattern as prior claims — user's message read like Codex's own
  recommendation rather than a direct instruction, so I checked `git log`
  first (still at `acb37b2`, nothing claimed) and asked before starting.
  If you're Codex (or another session) reading this before a "Done" entry
  below: this is claimed — check back here or pick a different open item
  instead.
- Files: none yet — planning now.
- Verified: n/a
- Next: (this entry will be updated once the work is done and verified).

### 2026-08-04 (later) — Claude

- Status: Done
- Context: Added per-step retry to the workflow engine.
  `services/worker/src/steps.ts` gained `stepWithRetry(name, fn, {attempts,
  delayMs}, opts?)`, sharing one internal implementation with `step()`
  (which calls it with `{attempts: 1, delayMs: 0}`) — every existing
  script (`index.ts`, `save-session.ts`, `restore-session.ts`,
  `run-adapter.ts`) is completely unaffected. `run-workflow.ts` gained a
  `resolveRetry()` policy: `navigate`/`dismissPopup`/`extract`/`screenshot`
  retry by default (2 attempts, 1s delay) since they're read-only/
  idempotent; `login`/`saveSession` get zero implicit retry, only retrying
  if a step explicitly sets a `retry: {attempts, delayMs}` field — matches
  the explicit ask not to blind-retry state-changing actions.
  `validateWorkflow()` also checks `retry` field shape (positive
  `attempts`, non-negative `delayMs`) upfront, same as everything else
  there. Control Panel: `StepEvent` type updated for the new optional
  `attempt`/`attempts` fields (no behavior change, `parseSteps` already
  forwarded them); UI shows `(attempt X/Y)` next to a step name.
  **Found and fixed a real UX bug while verifying, not assumed**: the
  first implementation showed attempt info on *every* successful
  default-retryable step, even ones that succeeded on the very first try
  (since those steps are always configured with `attempts: 2`) — pure
  noise on every clean run. Fixed so attempt info only appears when a
  retry actually happened (succeeded after attempt 1) or all attempts were
  exhausted on failure; a clean first-try success stays exactly as quiet
  as before the change.
- Files: `services/worker/src/steps.ts`, `run-workflow.ts`,
  `services/control-panel/src/exec.ts`, `public/app.js`,
  `docs/PROJECT_PLAN.md`, `AGENTS.md`.
- Verified: `npx tsc --noEmit` clean. Isolated unit-level test of
  `stepWithRetry` (no browser involved, fast/deterministic): clean
  first-try success emits no attempt fields; a step that fails once then
  succeeds shows `attempt:2,attempts:2` and the elapsed time matched the
  configured delay almost exactly (803ms for an 800ms configured delay);
  a step that always fails exhausts all 3 configured attempts and rethrows
  with `attempt:3,attempts:3`. Then real end-to-end proof through
  `run-workflow.ts` and the actual Control Panel queue: a `navigate` to a
  permanently-bad domain (fails fast via DNS error, not a slow 30s
  actionability timeout) correctly retried twice and failed with `(after 2
  attempts)`; a `login` step with a bad selector correctly did *not*
  retry (single ~30s Playwright timeout, no `attempt`/`attempts` fields,
  confirmed via wall-clock timing that only one attempt happened).
  Regression-checked the real `the-internet-login` workflow and
  `runAdapter` through the real Control Panel — both still succeed, and
  after the UX fix, none of the successful steps show any attempt
  clutter. Visually confirmed in the real Chromium
  (`host.docker.internal:4000` CDP screenshot technique) that a step
  which exhausted its retries renders `1-navigate (attempt 2/2): ...
  (after 2 attempts)` in the expanded job panel, while sibling clean jobs
  show no such text. Removed all temporary test workflow files/scripts
  before committing. `docker compose down` clean; re-hit and re-fixed the
  Windows port-4000 orphan-process gotcha again restarting the panel.
- Next: MinIO/S3, splitting the queue worker into its own process,
  `.env.example` additions, migrating the 4 fixed actions onto the
  workflow engine, or Phase 3 (Gmail) — whichever the user picks. Minor
  polish candidate whenever convenient: `shortResult()` in `app.js`
  showing a raw stack-trace line for some failures (noted last session,
  still not fixed, still out of scope).

### 2026-08-04 (session 2) — Claude

- Status: In progress
- Context: **Claiming: split the BullMQ queue consumer out of the
  Control Panel process into its own process.** This time the user's
  message genuinely mixed two conflicting choices (their own typed
  instruction "migrate fixed actions onto the workflow engine" vs.
  Codex's separately-relayed recommendation to split the queue worker) —
  asked directly which to do and who should do it; user chose the
  queue-worker split, explicitly confirmed Claude owns it and to claim
  here before starting. Repo was still at `d654f43`, nothing claimed, when
  checked. If you're Codex (or another session) reading this before a
  "Done" entry below: this is claimed — check back here or pick a
  different open item (e.g. migrating fixed actions onto the workflow
  engine) instead.
- Files: none yet — planning now.
- Verified: n/a
- Next: (this entry will be updated once the work is done and verified).

### 2026-08-04 (session 2, later) — Claude

- Status: Done
- Context: Split the BullMQ queue consumer out of the Control Panel API
  process into its own process, both still inside `services/control-panel`
  (not a new top-level service). `server.ts` no longer calls
  `startWorker()` — it's now API/UI + producer only. New `src/worker.ts`
  entry point (`npm run worker`) calls `startWorker()`/`closeQueue()`,
  which already handled "no worker in this process" gracefully via
  optional chaining, so `queue.ts` itself needed zero changes. Accepted
  tradeoff, logged rather than hidden: the module-level `Queue` producer
  object in `queue.ts` is created unconditionally at import time, so the
  worker process ends up holding an unused producer connection alongside
  its consumer connection — not worth further splitting the module for a
  dev tool.
- Files: `services/control-panel/src/server.ts`, `src/worker.ts` (new),
  `package.json`, `docs/PROJECT_PLAN.md`, `AGENTS.md`.
- Verified: `npx tsc --noEmit` clean. Ran both processes as genuinely
  separate terminals/processes (not just separate function calls) —
  confirmed via each process's own startup log. Enqueued a job, confirmed
  it completed via `/api/jobs` with only the worker process's
  `startWorker()` ever having been called (the API literally can't
  process jobs anymore, so completion proves the separate consumer did
  it). **The actual point of the change, proven both directions**: (1)
  enqueued a job, killed the API process while it was still running on
  the worker, waited, restarted the API — `/api/jobs` showed it completed
  successfully despite the API being fully down for the entire run; (2)
  killed the worker process with the API still up, enqueued a job —
  correctly sat in `waiting` state (not lost, not errored) — restarted
  the worker, confirmed it picked up and completed the pending job.
  Regression-checked `runAdapter` end to end afterward.
  **Hit and had to work around the Windows orphan-process gotcha for
  *both* processes this time**, not just the API: `TaskStop` on the
  worker process left it running in the background too (confirmed via
  `Get-CimInstance Win32_Process` search, since the worker holds no port
  so the existing `Get-NetTCPConnection` check doesn't catch it) — this
  briefly produced a false-negative test result (a job "mysteriously"
  completed despite the worker supposedly being stopped) until caught and
  fixed. Documented the detection method for the worker process
  specifically in `AGENTS.md` so this doesn't cost time again.
  `docker compose down` clean; both host processes confirmed actually
  dead before finishing.
- Next: MinIO/S3, `.env.example` additions, migrating the 4 fixed actions
  onto the workflow engine, or Phase 3 (Gmail) — whichever the user picks.
  Minor polish candidate whenever convenient: `shortResult()` in `app.js`
  showing a raw stack-trace line for some failures (still not fixed,
  still out of scope, noted twice now).

### 2026-08-04 (session 3) — Claude

- Status: Done
- Context: MinIO/S3 artifact storage, starting with screenshots. Explicit
  direct instruction (user answered their own question with exactly
  who/what: "ให้ Claude claim ใน AGENT_HANDOFF.md แล้วเริ่มจาก screenshots
  artifacts"), no ambiguity to resolve — still checked `git log` first
  anyway per the now-standard habit before starting anything nontrivial.
  Added *alongside* the existing local `data/worker-output/*` files, not
  replacing them — same additive pattern as every other feature this
  project. Archival is best-effort/non-fatal by design: a new
  `stepBestEffort()` primitive reports ok/error like any step (visible in
  the Jobs UI) but never fails the job.
- Files: `docker-compose.yml` (new `minio` service, `MINIO_ENDPOINT=minio`
  on `worker`/`worker-firefox`), `.env.example` (MinIO root creds),
  `services/worker/package.json` (`minio` npm dep),
  `services/worker/src/artifacts.ts` (new — `uploadArtifact`, bucket
  auto-create), `services/worker/src/steps.ts` (new `stepBestEffort`),
  `services/worker/src/index.ts` / `run-adapter.ts` /
  `run-firefox-demo.ts` / `run-workflow.ts` (each now calls
  `stepBestEffort("archive-screenshot", ...)` right after its existing
  screenshot step — `run-workflow.ts`'s covers *any* workflow using the
  generic `screenshot` action, not just one hardcoded script),
  `docs/PROJECT_PLAN.md` (5 new decision-log rows + Phase 2 checklist
  tick, partial), `AGENTS.md` (dev-run instructions + MinIO console URL).
- Verified: `npx tsc --noEmit` clean. Rebuilt the `worker` image (new npm
  dep needs a rebuild, not just a bind-mount refresh — caught when the
  first run failed with `ERR_MODULE_NOT_FOUND: minio` against the stale
  image). `docker compose run --rm worker npm run start` — both
  `screenshot` and `archive-screenshot` steps reported `status: "ok"`.
  **Genuine round-trip proof, not just "upload didn't throw"**: a
  throwaway host-side script fetched the uploaded object back from
  `127.0.0.1:9000` and compared SHA-256 hashes against the local file —
  byte-identical (15319 bytes both sides), script deleted after.
  **Non-fatal proof**: `docker compose stop minio`, re-ran the same job —
  `archive-screenshot` reported `status: "error"`
  (`getaddrinfo ENOTFOUND minio`) while the job still exited 0 and the
  screenshot itself still saved locally; restarted MinIO after. Ran the
  real `the-internet-login` workflow through the actual Control Panel
  queue (both `npm start` and `npm run worker` processes up) —
  `archive-screenshot` showed up correctly as the 10th step in
  `/api/jobs` alongside the existing 9; confirmed the existing
  `/screenshots/*` route still serves the file unchanged (regression
  check, HTTP 200). `docker compose down`; both host processes confirmed
  actually dead afterward (port-4000 check for the API, command-line
  search for the worker — both gotchas checked again).
- Next: extending archival to session files (`data/sessions/*`), wiring
  the Control Panel to read artifacts back from MinIO instead of only
  local disk, migrating the 4 fixed actions onto the workflow engine, or
  Phase 3 (Gmail) — whichever the user picks.

### 2026-08-04 (session 4) — Claude

- Status: Done
- Context: Session-file archival to MinIO. User's explicit choice
  ("ถ้าจะให้ Claude ทำต่อ ผมจะเลือก: session-file archival to MinIO ครับ"),
  following on directly from the just-finished screenshot archival.
  Checked `git log` first — still at `7da30cd`, nothing new claimed.
  Scope as specified: archive `storageState` JSON files
  (`data/sessions/*.json`) to MinIO under a `sessions/` prefix (separate
  from `screenshots/`), same best-effort/non-fatal pattern as screenshots
  (`stepBestEffort`) — a MinIO hiccup must not fail `save-session`.
  Constraint on session content never appearing in the UI/logs turned out
  to already be satisfied by construction: the Control Panel has zero
  session-related routes/UI today (confirmed by grep), and
  `stepBestEffort` never passes `captureResult`, so the `archive-session`
  step only ever reports name/status/timestamp/error — never file
  content — same shape as `archive-screenshot`. Still dev-only/plaintext
  in MinIO too, same caveat as the local file today — not an encryption
  upgrade, just a second storage location.
- Files: `services/worker/src/save-session.ts` (new `archive-session`
  step after `save-storage-state`), `services/worker/src/run-adapter.ts`
  (new `archive-session` step after its existing `save-session` step, on
  a file that already imported `stepBestEffort`/`uploadArtifact` for
  screenshots), `services/worker/src/run-workflow.ts` (new
  `if (workflowStep.type === "saveSession")` archival block in the
  execution loop, mirroring the existing `screenshot` one — covers *any*
  workflow using the generic `saveSession` action). No changes needed to
  `artifacts.ts`/`steps.ts` — `uploadArtifact`/`stepBestEffort` are
  already generic, reused as-is. `docs/PROJECT_PLAN.md` (3 new/extended
  decision-log rows + Phase 2 checklist update), `AGENTS.md` (dev-run
  note extended to cover session archival).
- Verified: `npx tsc --noEmit` clean (no rebuild needed — no new
  dependency this time, only bind-mounted `src/` changes).
  `docker compose run --rm worker npm run save` — `save-storage-state`
  and `archive-session` both `status: "ok"`. `npm run adapter` (real
  login, not the synthetic marker) — same, plus its existing
  `archive-screenshot` unaffected. **Round-trip proof**: a throwaway
  host-side script fetched both `sessions/example.json` and
  `sessions/the-internet.json` back from `127.0.0.1:9000` and compared
  SHA-256 hashes against the local files — byte-identical (1238B and
  2885B respectively), script deleted after. **Non-fatal proof**:
  `docker compose stop minio`, re-ran `npm run save` — `archive-session`
  reported `status: "error"` (`getaddrinfo ENOTFOUND minio`) while the
  job still exited 0 and the local session file still saved; restarted
  MinIO after. Ran the real `the-internet-login` workflow through the
  actual Control Panel queue (both `npm start` and `npm run worker`
  processes up) — `6-archive-session` showed up correctly in `/api/jobs`
  right after `6-saveSession`, alongside the existing
  `7-archive-screenshot`. `docker compose down`; both host processes
  confirmed actually dead afterward (port-4000 check for the API,
  command-line search for the worker).
- Next: wiring the Control Panel to read artifacts back from MinIO
  instead of only local disk, migrating the 4 fixed actions onto the
  workflow engine, or Phase 3 (Gmail) — whichever the user picks.

### 2026-08-04 (session 5) — Claude

- Status: Done
- Context: Wiring the Control Panel to read artifacts back from MinIO.
  Explicit direct instruction with a full user-specified scope. Checked
  `git log` first — still at `7898dcd`, nothing new claimed. Scope as
  given: new route/API to read screenshots from MinIO; job step detail UI
  gets a MinIO link *in addition to* the existing local
  `/screenshots/*` link; session content never exposed in UI/log;
  `/screenshots/*` regression-checked; MinIO down → readable failure, not
  a crash; new `minio` dep in `services/control-panel` installed and
  `package-lock.json` committed; end-to-end verification through the real
  queue. Chose a server-side streaming proxy route over a browser-facing
  presigned-URL redirect specifically so every failure mode (MinIO down,
  object missing, bad filename) is caught in one place and returned as a
  clear JSON error, rather than the browser hitting a raw, unhandled
  connection error against MinIO directly.
- Files: `services/control-panel/src/artifacts.ts` (new — `getArtifactStream`,
  same shape as the worker's own `artifacts.ts` but read-only, separate
  project so not shared code), `services/control-panel/src/server.ts`
  (new `GET /api/artifacts/screenshots/:filename` route — filename
  validated against a strict allowlist regex before touching MinIO, same
  defensive posture as the existing fixed action allowlist in
  `actions.ts`), `services/control-panel/public/app.js` (`renderSteps()`
  now adds a "MinIO" link next to the existing "screenshot" link, only
  when that step's matching `archive-*` step reports `status: "ok"` —
  avoids a dead link), `services/control-panel/package.json` +
  `package-lock.json` (new `minio` dependency), `docs/PROJECT_PLAN.md` (5
  new decision-log rows + Phase 2 checklist update), `AGENTS.md` (new
  paragraph on the MinIO read path).
- Verified: `npx tsc --noEmit` clean after `npm install`. Ran the real
  `the-internet-login` workflow through the actual Control Panel queue
  (both `npm start`/`npm run worker` up, all 4 Docker services up) —
  `archive-screenshot` succeeded. `curl
  /api/artifacts/screenshots/the-internet-workflow.png` returned the
  image; SHA-256 hash matched the local file in `data/worker-output/`
  exactly (proving it's genuinely coming from MinIO, not coincidentally
  serving something else). **Regression check**: `/screenshots/*` still
  serves the same file unchanged. **Fail-readable check**: `docker
  compose stop minio`, hit the new route — got a clean `502` JSON error,
  and `/api/status`/`/api/jobs` kept responding normally throughout (the
  Control Panel process never went down). Caught and fixed two real bugs
  during this check, not assumed correct: (1) a connection-refused error
  is a Node `AggregateError` with an **empty** `.message` (the real
  detail is in `.code`, e.g. `"ECONNREFUSED"`) — first version returned
  the useless `"MinIO unavailable: "`, fixed to fall back to `.code`; (2)
  a missing object is a `S3Error` with `.code === "NoSuchKey"`, **not**
  reflected in `.message` either — first version misclassified every
  not-found as a generic 502, fixed to check `.code` directly and now
  correctly returns 404. Re-verified both fixes directly (blank-message
  case now reads `"MinIO unavailable: ECONNREFUSED"`; a genuinely missing
  object now returns 404 with a clear message) before considering this
  done. Restarted MinIO after. Confirmed the served `app.js` reflects the
  UI change (`curl /app.js | grep minioLink`). `docker compose down`;
  both host processes confirmed actually dead afterward (port-4000 check
  for the API, command-line search for the worker).
- Next: MinIO-backed downloads/video artifacts, migrating the 4 fixed
  actions onto the workflow engine, or Phase 3 (Gmail) — whichever the
  user picks.

### 2026-08-04 (session 6) — Claude

- Status: Done (scope changed mid-implementation — see below)
- Context: Claimed as downloads/video artifact archival with a full
  user-specified scope (see original claim text preserved in git history
  at `3b09861`). Checked `git log` first — was at `0940fbb`, nothing new
  claimed. Implemented a new `download` worker action (Playwright
  `waitForEvent("download")` + `download.saveAs()`) and a demo workflow
  against `the-internet.herokuapp.com/download` (page structure confirmed
  live via curl during planning). **Empirically found a real
  architectural blocker while verifying it, not a code bug**: both
  `download.saveAs()` and `download.createReadStream()` fail to retrieve
  actual file bytes when Playwright connects via `connectOverCDP` to
  Chromium running as a raw external process in a *separate container*
  from the worker — confirmed twice (shared default page, and a fresh
  Playwright-created context), same failure both times, ruling out a
  shared-context timing issue. Root cause: the worker and
  `browser-worker-chrome` share a network namespace but not a
  filesystem, and Playwright's download-artifact retrieval assumes local
  filesystem access to wherever Chromium wrote the file. Stopped and
  asked the user how to proceed rather than guessing or quietly shipping
  something broken; user chose (matching their own stated fallback):
  defer downloads the same way as video/trace — document the blocker and
  the real fix in the decision log, don't build a live producer this
  round — and directed the remaining effort at making the **generalized
  artifact-read abstraction** solid, which was the actual stated goal for
  this round anyway.
- Files: **Reverted** (not shipped): `services/worker/src/actions/registry.ts`,
  `services/worker/src/run-workflow.ts`, `services/worker/src/steps.ts`
  changes for the `download` action, and the
  `services/worker/workflows/the-internet-download.json` demo workflow —
  all reverted to their pre-session state via `git checkout`/`rm` once the
  blocker was confirmed and the user chose to defer, so nothing
  non-functional or half-working landed. **Shipped**:
  `services/control-panel/src/server.ts` — generalized
  `GET /api/artifacts/screenshots/:filename` (single-kind, from session 5)
  into `GET /api/artifacts/:kind/:filename` with an explicit
  `READABLE_ARTIFACT_KINDS` allowlist (`screenshots`, `downloads`,
  `videos`, `traces` — `sessions` deliberately never included, so session
  content is now excluded by an active check rather than just "no route
  exists"). `docs/PROJECT_PLAN.md` (5 new decision-log rows: the downloads
  blocker with full root-cause detail, the real fix left undone on
  purpose, video/trace deferral, and the route generalization itself),
  `AGENTS.md` (updated artifact-route description).
- Verified: `npx tsc --noEmit` clean in both `services/worker` (after
  revert, confirms it's back to known-good) and `services/control-panel`.
  Ran the real `the-internet-login` workflow through the actual queue for
  a fresh screenshot. **Regression check**: `/api/artifacts/screenshots/*`
  (same URL shape as before the generalization) and local
  `/screenshots/*` both still return the identical file — SHA-256 hash
  matched across the MinIO copy, the local copy, and the on-disk file, all
  three identical. **Allowlist check**: `/api/artifacts/sessions/*` and an
  unknown kind (`/api/artifacts/bogus/*`) both correctly 400 "Unknown or
  unreadable artifact kind"; `/api/artifacts/downloads/*`,
  `/api/artifacts/videos/*`, `/api/artifacts/traces/*` all correctly 404
  "Artifact not found" (kind is valid, no object exists — proves the
  route is genuinely generic, not screenshots-only in disguise).
  **Fail-readable check**: `docker compose stop minio`, confirmed a clean
  502 from the artifact route while `/api/status`/other routes kept
  responding normally; restarted MinIO, confirmed the route works again.
  `docker compose down`; both host processes confirmed actually dead
  afterward (port-4000 check for the API, command-line search for the
  worker).
- Next: the real downloads fix (shared Docker volume between
  `browser-worker-chrome`/`worker` + raw CDP `Page.setDownloadBehavior` +
  worker-side file-watching — deliberately deferred, see decision log),
  video/trace (same treatment, needs a concrete workflow use case first),
  migrating the 4 fixed actions onto the workflow engine, or Phase 3
  (Gmail) — whichever the user picks.

### 2026-08-04 (session 7) — Claude

- Status: Done
- Context: Migrate the 4 fixed worker actions onto the workflow engine.
  Explicit direct instruction. Checked `git log` first
  — still at `0b4cfba`, nothing new claimed. Scope as given: replace
  demo/save/restore/adapter with workflow JSON *to the extent the
  existing generic action registry supports it*; Control Panel buttons
  can stay but should enqueue a workflow instead of the fixed script;
  fixed scripts may stay as dev/debug CLI, no need to delete immediately;
  docs should say the workflow engine is the primary path; verify the
  existing UI buttons and job step/artifact display still work the same
  way from a user's perspective. Read all 4 fixed scripts and the
  registry (`navigate`/`dismissPopup`/`login`/`extract`/`saveSession`/
  `screenshot`) before planning: `demo` (index.ts — navigate + screenshot)
  and `adapter` (run-adapter.ts — login + extract + saveSession +
  screenshot against the-internet.herokuapp.com) map cleanly onto
  existing generic actions; `adapter` in fact already has an equivalent,
  already-proven workflow (`the-internet-login.json`) sitting unused by
  the Control Panel's fixed-action buttons. `save`/`restore`
  (save-session.ts/restore-session.ts) do **not** map cleanly: `save` sets
  a synthetic cookie+localStorage marker via bespoke inline JS with no
  generic-action equivalent, and `restore` creates a fresh *isolated*
  browser context pre-loaded with `storageState` and reads cookies/
  localStorage back directly — the workflow engine's current model
  assumes one shared context/page for an entire run, so this doesn't fit
  without adding new action types, which the explicit "to the extent
  generic actions support it" instruction rules out for this round. Per
  the user's own hedge, plan is to migrate demo+adapter for real (2 of 4)
  and explicitly not force save/restore, documenting why rather than
  bolting on new action types to hit a number. If you're Codex (or
  another session) reading this before a "Done" entry below: this is
  claimed — check back here or pick a different open item instead.
- Files: `services/worker/workflows/demo.json` (new — navigate +
  screenshot, faithful equivalent of `index.ts`/`runStart`),
  `services/control-panel/src/actions.ts` (removed `runStart`/
  `runAdapter` from the `ACTIONS` table), `services/control-panel/
  src/queue.ts` (removed them from `QUEUEABLE_ACTIONS` too),
  `services/control-panel/public/index.html` (the two buttons now use
  `data-workflow="demo"`/`data-workflow="the-internet-login"` instead of
  `data-action="runStart"`/`data-action="runAdapter"` — same visible
  button, label, position), `services/control-panel/public/app.js`
  (`.worker-action` click handler now checks `dataset.workflow` first,
  falling back to `dataset.action`), `docs/PROJECT_PLAN.md` (4 new
  decision-log rows: the migration itself, why `save`/`restore` don't
  migrate, and an unrelated stale-image fix found while regression
  testing), `AGENTS.md` (workflow engine described as the primary path).
  `save-session.ts`/`restore-session.ts` and their Control Panel wiring
  are completely untouched.
- Verified: `npx tsc --noEmit` clean in `services/control-panel`. With
  the real stack up (both Control Panel processes, all 4 Docker
  services): `POST /api/enqueue/runStart` and `/runAdapter` both now
  cleanly 400 "not a queueable action" — confirms no dangling
  half-registered path. `POST /api/enqueue-workflow/demo` ran
  navigate→screenshot→archive-screenshot correctly, both local and MinIO
  screenshot links returned 200. `POST /api/enqueue-workflow/
  the-internet-login` (now what "Run example adapter" actually triggers)
  ran its full 7-step sequence correctly, same as every prior
  verification of that workflow. **Regression-checked what's
  intentionally unchanged**: `runSave` and `runRestore` still enqueue and
  complete correctly (`restore` read back the exact marker `save` had
  just written, proving the round-trip still works end to end).
  `runFirefoxDemo` also checked — **found and fixed an unrelated stale
  Docker image** in the process: `worker-firefox`'s image had never been
  rebuilt since `minio` was added to `services/worker/package.json` in an
  earlier session (only the plain `worker` image had been), so it failed
  with `ERR_MODULE_NOT_FOUND: minio`; `docker compose build
  worker-firefox` fixed it, re-verified working afterward. Confirmed via
  `curl` that the served `index.html`/`app.js` actually reflect the new
  `data-workflow` attributes and click-handler logic, not just the source
  files. `docker compose down`; both host processes confirmed actually
  dead afterward (port-4000 check for the API, command-line search for
  the worker).
- Next: the real downloads fix, video/trace (needs a concrete workflow
  use case), or Phase 3 (Gmail) — whichever the user picks.

### 2026-08-04 (session 8) — Claude

- Status: Done
- Context: Phase 3 Gmail — OAuth/Gmail API scaffold, round one. Explicit
  direct instruction with a full user-specified scope. Checked `git log`
  first — still at `ae5d9ac`, nothing new claimed.
  Scope as given: dev/local Gmail API + OAuth scaffold only; **no browser
  automation of the Gmail login page at all**; no plaintext
  credentials/tokens in source or `.env`; a separate Gmail
  adapter/service module (`services/worker/src/gmail/*`); config via env
  vars only (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/
  `GOOGLE_REDIRECT_URI`); token storage either a clearly-documented
  dev-only placeholder or no persistence at all if avoidable — **not** a
  real encrypted vault this round, that's tracked as its own explicitly
  unfinished checklist item; a script/command for generating the OAuth
  consent URL and doing the callback/token exchange, as far as that's
  doable in local dev; a minimal Gmail API read/list proof gated on
  having a token from env/dev storage; Control Panel may get a
  button/placeholder but a full OAuth UI flow is explicitly not required
  if that's too big for this round; verify via TypeScript build plus a
  readable no-token/mocked failure path (not a live Gmail call — that
  needs real credentials/an account, and the user must be asked before
  any live test happens). Matches the existing README/`docs/PROJECT_PLAN.md`
  Phase 3 checklist already in the repo (Google OAuth, Gmail API read/
  search/attachments, browser fallback only when necessary, encrypted
  token vault as its own later item) — this claim doesn't redefine scope,
  it's the first real slice of what was already planned. If you're Codex
  (or another session) reading this before a "Done" entry below: this is
  claimed — check back here or pick a different open item instead.
- Files: `services/worker/src/gmail/client.ts` (new — env-based OAuth2
  client construction with clear missing-var errors, `buildAuthUrl()`
  with `gmail.readonly` scope + `access_type: offline` + `prompt:
  consent`, dev-only plaintext token save/load at
  `data/gmail-tokens/gmail-token.json`, `getAuthorizedClient()` with a
  clear no-token error), `authorize.ts` (new — CLI: prints the consent
  URL, runs a one-shot local HTTP listener parsed from
  `GOOGLE_REDIRECT_URI` to capture the callback, exchanges the code,
  saves the token), `list-messages.ts` (new — minimal
  `users.messages.list` read proof, count + IDs only, never content),
  `services/worker/package.json` (+`googleapis`, +`google-auth-library`
  as an explicit direct dependency since types are imported from it
  directly, +`gmail:authorize`/`gmail:list` scripts), `.env.example`
  (+`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI`, left
  blank — no safe fake default exists for per-developer OAuth creds,
  unlike MinIO's dev defaults), `services/control-panel/public/index.html`
  (static informational Gmail section only — env vars, the two CLI
  commands, dev-only token caveat; no new JS/API route), `AGENTS.md` (new
  Gmail section), `docs/PROJECT_PLAN.md` (Phase 3 checklist partially
  ticked + 8 new decision-log rows).
- Verified: picked `googleapis@174.0.0` specifically (not an older
  version) after `npm audit` flagged a moderate transitive `uuid`
  vulnerability on the version first tried — `0 vulnerabilities` after
  the bump. `npx tsc --noEmit` clean. **Readable failure paths, no real
  credentials needed**: `gmail:authorize` with env vars unset fails with
  the specific "Missing required env var GOOGLE_CLIENT_ID..." message;
  `gmail:list` with fake-but-well-formed env vars and no token file fails
  with "No Gmail token found at ... run npm run gmail:authorize first." —
  neither hangs or dumps a raw stack trace. **Auth URL shape, still no
  real credentials**: built with fake client ID/secret, confirmed every
  expected query param (`client_id`, `redirect_uri`,
  `scope=...gmail.readonly`, `access_type=offline`, `prompt=consent`,
  `response_type=code`). **Callback listener exercised for real**:
  started `authorize.ts` with fake credentials, curled the callback URL
  with a fake `code` — confirmed the listener parsed it, responded to
  the "browser" (200, "Authorized. You can close this tab."), then
  attempted the real token exchange with Google, which correctly
  rejected the fake credentials (`invalid_client`) — caught cleanly by
  the script's own error handling (exit 1, readable message, not a stack
  trace), listener port confirmed closed afterward. This exercised our
  own request-handling code against a real (expected) rejection from
  Google's token endpoint — **not** a live account/data test, since no
  real Google Cloud OAuth client exists in this environment and one
  wasn't set up, per the explicit instruction to ask before any live
  test. **Gitignore check**: created a dummy file at
  `data/gmail-tokens/gmail-token.json`, confirmed via `git status`
  (nothing shown) and `git check-ignore -v` (matched the blanket `data/`
  rule) that it's genuinely untracked, not just assumed to be — deleted
  after. Control Panel still starts cleanly with the new static section;
  confirmed via `curl /index.html` that it's actually served; `/api/status`
  still responds normally (`/api/jobs` predictably hangs without Redis
  running this round — pre-existing, documented behavior, not a
  regression from this change).
- Next: a live OAuth test against a real Google Cloud project (needs the
  user's own credentials and explicit go-ahead), Gmail search/message-
  content/attachment reading, the real encrypted token vault, the real
  downloads fix, video/trace, or whichever else the user picks.
