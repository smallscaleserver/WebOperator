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
