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

### 2026-08-19 — Codex

- Status: Done
- Context: Added a neutral `typeSecret(secretRef)` / SecretProvider design doc
  that does not try to override Claude or any agent safety policy. It records
  the architecture for agents/developers that are allowed to implement runtime
  credential injection, while preserving no-plaintext-secret storage/log/API/UI
  rules and keeping OTP/2FA/CAPTCHA/passkey/security challenges human-only.
  Reverted the pending Claude-side doc changes first so the working tree no
  longer contains a contested partial revert.
- Files: `docs/SECRET_REFERENCE_REPLAY.md`, `docs/AGENT_HANDOFF.md`,
  `docs/PROJECT_PLAN.md`
- Verified: Documentation-only change; no runtime tests run.
- Next: If an implementation-capable agent picks this up, start with mock/test
  lane only and keep real financial-service lanes disabled unless separately
  approved for a specific lane/account.

### 2026-08-05 — Codex

- Status: Done
- Context: Added `StepByStep.md`, a short local-run guide focused on getting
  `http://localhost:4000` usable for manual testing. It covers Docker service
  startup, the two required host processes (`npm start` and `npm run worker`),
  XC Bank workflow/monitor/live view checks, shutdown, and Windows
  troubleshooting for wrong npm cwd, port 4000, worker orphan processes, Docker
  restart, and noVNC password lookup. Linked it from `README.md`.
- Files: `StepByStep.md`, `README.md`, `docs/AGENT_HANDOFF.md`
- Verified: Documentation-only change; checked the current repo status and
  existing README commands/context before writing. No runtime stack test run in
  this Codex turn because the requested output is a run guide and the stack was
  already validated in the previous Claude handoff.
- Next: Use `StepByStep.md` to run local testing. If the guide reveals a stale
  command during manual use, update that file and the README link together.

### 2026-08-05 (later) — Claude

- Status: Done
- Context: **@Codex** — fixed two real inaccuracies in `StepByStep.md` found
  by actually running it against the live stack (this guide's own commit
  message noted it was written from docs/README without a runtime test —
  worth re-running any guide like this against the real stack before
  trusting it, same as every other change in this repo). Not a Docker-vs-
  no-Docker issue — the user flagged it suspecting that, but the guide's
  Docker commands/service names all check out correctly. The two real
  bugs: (1) step 7 claimed job steps would be named "login, extract,
  screenshot, archive-screenshot" — actually enqueued
  `xc-bank-login-extract` for real through the live queue and read back
  `GET /api/jobs`: the real step names are `validate`, `connect`,
  `1-xcBankLogin`, `2-xcBankExtractDashboard`, `3-screenshot`,
  `3-archive-screenshot` (the XC-Bank-specific action type names, numbered
  by step index, plus the `validate`/`connect` steps every workflow run
  always has) — a reader searching the Jobs panel for a step literally
  named "login" wouldn't find one. (2) step 11 stated the MinIO console
  credentials are "from `.env`" as if guaranteed present — this machine's
  own `.env` (predates MinIO being added) only has `VNC_PASSWORD`, no
  `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` lines at all. The listed
  `weboperator`/`changeme123` values still work (verified with a real
  `minio` client `listBuckets()` auth call, not assumed) because
  `docker-compose.yml` falls back to those exact defaults when the env
  vars are unset — but the guide's wording implied they'd always be
  readable from the file itself, which is false for any `.env` created
  before MinIO existed. Fixed both to describe what's actually true.
  Also re-verified step 10 (logout-clean → fresh login) for real — the
  `1-xcBankLogin` step's `data` came back "Logged in as demo_user (fresh
  two-step login)" exactly as the guide describes, so that step was
  already correct, left unchanged.
- Files: `StepByStep.md`.
- Verified: real stack was already up (Docker services had actually gone
  missing after a Docker Desktop restart earlier this session — brought
  back with `docker compose up -d xc-bank browser-worker-chrome minio
  redis`, confirmed both long-running host processes reconnected on their
  own with zero restart needed). Enqueued `xc-bank-logout-clean` then
  `xc-bank-login-extract` for real through `/api/enqueue-workflow/:name`,
  read the real step names/detail back from `/api/jobs` (not guessed).
  Tested MinIO auth for real with the `minio` npm client against
  `127.0.0.1:9000` using the exact credentials the guide lists —
  succeeded, returned the real bucket name. Left the stack running per
  the user's explicit earlier instruction not to tear anything down this
  session.
- Next: whoever picks this repo up next — same as before, plus: if
  `StepByStep.md` needs another pass, actually run each step against a
  live stack rather than writing from docs alone (this round's whole
  point). Otherwise: email-notification scaffolding, live Gmail OAuth
  test, real downloads fix, video/trace, or whichever else the user
  picks.

### 2026-08-05 (later still) — Claude

- Status: Done
- Context: Added `CleanAll.md` — a "wipe Docker images/containers and
  rebuild from scratch" companion guide to `StepByStep.md`, requested
  after the user looked at Docker Desktop's image list (7 images:
  `weboperator-browser-worker-chrome`, `redis`,
  `weboperator-browser-worker-firefox`, `minio/minio`,
  `weboperator-worker`, `weboperator-worker-firefox`,
  `weboperator-xc-bank`) and wanted a documented way to delete and
  rebuild them, not a one-off manual click-through. Explicit direct
  instruction, small/contained doc-only scope — no claim-first needed,
  no runtime stack change (the live stack stayed up exactly as the user
  asked earlier this session; this round only wrote a new file plus a
  one-line README cross-link).
  Structured as tiers rather than one big destructive command: (1) stop
  everything cleanly first (mirrors `StepByStep.md`'s own shutdown
  steps), (2) `docker compose down --rmi local -v --remove-orphans` —
  removes only the 5 `weboperator-*` images this repo actually builds
  (`xc-bank`/`browser-worker-chrome`/`browser-worker-firefox`/`worker`/
  `worker-firefox`, confirmed against `docker-compose.yml`'s `build:`
  vs. `image:` entries), leaves the pulled `redis`/`minio` images alone;
  (3) `--rmi all` variant for also removing the pulled images, clearly
  marked as the heavier option; (4) a separate, explicitly-optional,
  explicitly-destructive step for wiping `data/*` (sessions, profiles,
  monitor state, MinIO's own data dir) since that's local dev state, not
  Docker images, and a user might want one without the other; (5)
  `docker compose build --no-cache` (or `up -d --build` as the
  faster/less-nuclear alternative) to rebuild; (6) points back to
  `StepByStep.md` from step 3 onward to verify the rebuilt stack instead
  of duplicating that guide's content.
- Files: `CleanAll.md` (new), `README.md` (one-line cross-link next to
  the existing `StepByStep.md` reference).
- Verified: cross-checked every command against the real
  `docker-compose.yml` (which services have `build:` vs. plain `image:`,
  confirming `--rmi local` genuinely only touches the 5 repo-built
  images and not `redis`/`minio`) and the real `.gitignore` (confirmed
  `data/` is fully gitignored, so the optional wipe step is safe from a
  "losing tracked work" angle). Did **not** run any of the destructive
  commands against the live stack — it was explicitly left running per
  the user's own earlier instruction this session, so this was
  documentation-review verification (reading the compose file/gitignore
  for accuracy), not an end-to-end dry run. If picked up again: worth a
  real dry run of `CleanAll.md` top-to-bottom in a throwaway state to
  confirm the exact command sequence works, not just that it reads
  correctly against the compose file.
- Next: same open items as before, plus a real end-to-end dry run of
  `CleanAll.md` whenever convenient (not urgent — the commands were
  verified against the compose file, just not executed this round).

### 2026-08-06 — Claude

- Status: Done
- Context: Real end-to-end dry run of `CleanAll.md`'s core documented
  path, closing the "not yet executed" gap noted in the previous entry.
  Explicit direct instruction.
- Files: none — verification only, no code/doc changes this round.
- Verified, all against the real stack, in order: (1) stopped both host
  processes (API + queue worker) and `docker compose down` — confirmed
  port 4000 free afterward. (2) `docker compose down --rmi local -v
  --remove-orphans` — confirmed via `docker images` before/after that
  exactly the 5 repo-built images (`weboperator-xc-bank`,
  `weboperator-browser-worker-chrome`, `weboperator-browser-worker-firefox`,
  `weboperator-worker`, `weboperator-worker-firefox`) were removed and
  `redis:7-alpine`/`minio/minio:latest` were untouched — matches the
  guide's claim exactly, not assumed. (3) `docker compose build xc-bank
  browser-worker-chrome browser-worker-firefox worker worker-firefox`
  (backgrounded — browser images take a few minutes) — all 5 built
  successfully, confirmed via `docker images` showing all 5 present again
  (sizes shifted slightly from before, e.g. browser-worker-chrome
  2.11GB→2.61GB — newer upstream base-layer versions pulled during
  rebuild, not a problem, just noted). (4) `docker compose up -d redis
  minio xc-bank browser-worker-chrome` — all 4 came up clean from the
  freshly-built images. (5) Restarted both host processes — reconnected
  immediately, `/api/status` showed Chrome running. (6) **The real
  proof**: enqueued `xc-bank-login-extract` for real through the live
  queue against the fully-rebuilt images — completed with the exact
  expected step sequence (`validate`/`connect`/`1-xcBankLogin`/
  `2-xcBankExtractDashboard`/`3-screenshot`/`3-archive-screenshot`, all
  `ok`) and `1-xcBankLogin`'s data read "Logged in as demo_user (fresh
  two-step login)" — correct, since a freshly-rebuilt/recreated Chrome
  container has no XC Bank session cookie. `archive-screenshot` also
  succeeded, proving the freshly-recreated MinIO connection works too.
  Did **not** separately dry-run the `--rmi all` (also removes pulled
  redis/minio images) or the `data/*` wipe variant this round — lower
  risk (a plain `docker pull` and a directory delete respectively, both
  mechanically simple) and would have meant re-downloading/re-seeding
  state unnecessarily; the core documented path (what most users would
  actually run) is now proven correct end to end. Left the stack running
  afterward (all 4 Docker services + both host processes), matching how
  the user wants it kept during this session.
- Next: same open items as before. `CleanAll.md`'s `--rmi all`/data-wipe
  variants remain doc-reviewed-but-not-dry-run if that ever matters.

### 2026-08-06 (later) — Claude

- Status: Done
- Context: Real dry run of `CleanAll.md`'s step 2 (`--rmi all`, the
  heavier variant that also removes the pulled `redis`/`minio` images —
  not yet exercised in the previous entry), triggered by the user
  looking at Docker Desktop's image list and wanting them actually gone,
  not just documented as theoretically removable. Explicit instruction:
  delete for real, but **do not rebuild afterward this time** — leave
  the stack down — and improve `CleanAll.md` based on what actually
  happened.
- Files: `CleanAll.md` (two additions: a `docker images` verification
  snippet after step 1 confirming exactly `redis`/`minio` remain, and
  one after step 2 confirming the list goes fully empty; a new "สำคัญ"
  callout after step 2 warning that skipping the rebuild step leaves the
  stack fully unusable, and that the *next* build after a full `--rmi
  all` wipe needs network access to re-pull `redis:7-alpine`/
  `minio/minio:latest` from scratch too, not just rebuild the 5
  repo-owned images — slower than the step-1-only path where those two
  stay cached locally).
- Verified: stopped both host processes and `docker compose down`
  (confirmed port 4000 free), then `docker compose down --rmi all -v
  --remove-orphans` — confirmed via `docker images` (no `--format`, to
  see Docker's own empty-result rendering) that all 7 images are
  genuinely gone, `docker ps -a` shows zero containers, and port 4000 is
  free. Did **not** run step 4 (rebuild) or step 5 (verify) this round —
  intentionally left the stack fully torn down, per the explicit
  instruction not to rebuild yet.
- Next: same other open items as before.

### 2026-08-06 (later still) — Claude

- Status: Done
- Context: Redeployed after the previous entry's full `--rmi all` wipe —
  explicit instruction ("commit push and redeploy"). Nothing was
  pending to commit/push (already at `607221a`, matching `origin/main`).
- Files: none — redeploy only.
- Verified: `docker compose build xc-bank browser-worker-chrome
  browser-worker-firefox worker worker-firefox` — all 5 rebuilt clean.
  `docker compose up -d redis minio xc-bank browser-worker-chrome` —
  this time genuinely **re-pulled `redis:7-alpine`/`minio/minio:latest`
  from the network** (visible in the compose output, layer-by-layer),
  confirming `CleanAll.md`'s new warning about the `--rmi all` path
  needing network access is accurate, not just theorized. All 4 services
  came up. Restarted both host processes — clean startup logs, `/api/status`
  showed Chrome running. Enqueued `xc-bank-login-extract` for real
  through the live queue — completed with all 6 expected steps `ok`.
  Stack is fully up again, matching pre-wipe behavior.
- Next: same open items as before.

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

### 2026-08-04 (session 9) — Claude

- Status: Done
- Context: **Feature work paused for user testing.** Explicit direct
  instruction: no new feature work this round (specifically: do not
  start Gmail/Phase 3), instead (1) add a step-by-step testing guide to
  `README.md` covering every main flow already implemented and verified
  through Phase 2, (2) short troubleshooting section for known gotchas,
  (3) this handoff entry recording the pause, (4) a small
  `docs/PROJECT_PLAN.md` note if warranted (no checklist changes — nothing
  new shipped feature-wise), (5) verify every README command actually
  works, without needing a real account for anything. **If you're Codex
  (or another session) picking this up: don't start new feature work,
  including Gmail/Phase 3, until the user has finished testing via the
  new README guide and gives further direction.** This is a real pause,
  not a claim on a specific feature — check with the user (or a later
  handoff entry) before resuming normal feature work.
- Files: `README.md` (replaced the stale "Phase 1 quickstart" — which
  predated the Control Panel, MinIO, and the workflow engine entirely —
  with a full 13-step guide: prerequisites, install, start Redis/MinIO/
  browsers, start both Control Panel processes, open the UI, start
  Chrome/Firefox, take control via noVNC, run the demo workflow,
  save/restore session, run the-internet adapter/workflow, inspect job
  steps/screenshots/MinIO links, Firefox demo, cleanup — plus a
  Troubleshooting section: Docker daemon not running, port 4000 orphaned
  on Windows, the queue worker's orphan-process gotcha (no port to check),
  a stale worker Docker image after an npm dependency change, and MinIO
  down during a job), `docs/PROJECT_PLAN.md` (one decision-log row noting
  this pause round — no checklist changes).
- Verified: ran the **entire guide for real**, not just read the source
  to check command syntax — brought up the full stack (Redis, MinIO, both
  browser containers, both Control Panel processes), started Chrome,
  confirmed `/api/status` showed both browsers running, ran the `demo`
  workflow, `runSave`/`runRestore`, the `the-internet-login` workflow, and
  `runFirefoxDemo` — all four completed successfully. Confirmed both the
  local `/screenshots/*` and MinIO `/api/artifacts/screenshots/*` links
  for a real screenshot both return 200. Confirmed both Windows
  troubleshooting commands (`Get-NetTCPConnection -LocalPort 4000`,
  `Get-CimInstance Win32_Process | Where CommandLine -like '*worker.ts*'`)
  actually find the right PIDs. Confirmed `worker`/`worker-firefox` are
  valid `docker compose` service names for the rebuild troubleshooting
  entry. `docker compose down`; both host processes confirmed actually
  dead afterward. Every command in the new README section has now been
  run for real this session, not just written from memory.
- Next: whatever the user finds while testing via the new guide. No new
  feature work (including Gmail/Phase 3) until they've had a chance to
  test and give direction.

### 2026-08-04 (session 10) — Claude

- Status: Done
- Context: XC Bank — an isolated mock third-party bank site for testing
  browser automation, plus its WebOperator adapter. Ends
  the session-9 pause; explicit, detailed, multi-part instruction. Checked
  `git log` first — still at `cdcdc0c`, nothing new claimed. **Still not
  Gmail/Phase 3** — explicitly excluded again this round; a follow-up
  message added *design-only* scaffolding requirements for a future
  email-notification feature (transaction model fields that *could*
  support generating a notification later, a documented boundary that XC
  Bank never talks to Gmail/Google APIs, a "Future Gmail/email
  notification design" docs section) — no email sending, no OAuth, no
  Gmail API calls, no SMTP, this round.
  Core scope: new `services/xc-bank` (Node/Express) mock bank site,
  strictly isolated from WebOperator — no shared code/DB/module imports,
  no shared Redis/BullMQ/MinIO/session files, communication only via
  browser/HTTP like a real third-party site, adapter must extract from
  the DOM only (never an internal API). Two-page login (`/login`
  username → `/password` password → session cookie → `/dashboard`),
  dashboard shows transactions (timestamp/direction/counterparty/amount/
  running balance/reference) that change over time (deterministic
  per-session/window seed, not fully random, so extraction is verifiable
  but still provably not hard-coded). New Docker Compose service
  (`127.0.0.1:4100:3000` published, worker reaches it via
  `http://xc-bank:3000`). New `services/worker/src/adapters/xc-bank.ts` +
  a workflow JSON, Control Panel button, MinIO archival reuse, docs
  across `README.md`/`AGENTS.md`/`docs/PROJECT_PLAN.md`. User explicitly
  allowed splitting into two rounds (site first, adapter second) if the
  combined scope is too large for one — will decide during planning and
  say so before implementing either way. If you're Codex (or another
  session) reading this before a "Done" entry below: this is claimed —
  check back here or pick a different open item instead. Decided during
  planning: did it as one round, not split — comparable in size to the
  Gmail scaffold and original MinIO rounds, which both shipped fine as
  one round earlier this session.
- Files: `services/xc-bank/` (new — `package.json`, `tsconfig.json`,
  `Dockerfile`, `src/sessions.ts` in-memory session store, `src/
  transactions.ts` seeded-PRNG deterministic transaction generator,
  `src/server.ts` all routes), `docker-compose.yml` (+`xc-bank` service,
  `127.0.0.1:4100:3000`, no volumes/depends_on, default bridge network),
  `services/worker/src/adapters/xc-bank.ts` (new — `login()`/
  `extractDashboard()`, DOM-only, same shape as `adapters/
  the-internet.ts`), `services/worker/src/actions/registry.ts`
  (+`xcBankLogin`/`xcBankExtractDashboard`), `services/worker/src/
  run-workflow.ts` (`captureResult` wiring for both new types;
  `xcBankExtractDashboard` added to the auto-retry set as read-only,
  `xcBankLogin` left out as state-changing, same pattern as `extract`
  vs. `login`), `services/worker/workflows/xc-bank-login-extract.json`
  (new), `docs/PROJECT_PLAN.md` (5 new decision-log rows + a new "Test
  Fixtures" section), `AGENTS.md` (new XC Bank section + repo-layout
  entries), `README.md` (new step-by-step XC Bank testing section,
  steps 14-16, inserted before Troubleshooting). No Control Panel code
  changes — the existing dynamic Workflows UI already covers it.
- Verified: `npx tsc --noEmit` clean in both `services/xc-bank` and
  `services/worker`. Smoke-tested the Express service locally first
  (fast iteration before involving Docker) — full login flow, wrong-
  username/wrong-password error paths, unauthenticated-dashboard
  redirect, already-authenticated `/login` redirect, same-window data
  stability (three rapid requests, identical balance), window-rollover
  change (11s wait, balance changed), and `/dev/regenerate` forcing an
  immediate change — all confirmed directly via `curl` with a cookie
  jar, not assumed. Then for real in Docker: built and started
  `xc-bank`, confirmed host reachability (`curl 127.0.0.1:4100/` → 200)
  and worker-container reachability (`node -e "fetch('http://xc-bank:
  3000/')"` from inside the `worker` container → 200, proving the same
  service-DNS mechanism already used for `minio` extends to a brand-new
  service without extra wiring). **Isolation check, not just written and
  trusted**: grepped `services/worker/src` and `services/control-panel/
  src` for any `xc-bank` import path — only match was the adapter's own
  HTTP base-URL string/comments, confirmed no code imports
  `services/xc-bank` source. Ran the real workflow via `docker compose
  run --rm worker npm run workflow` twice in the same browser session
  without restarting the container: first run reported "Logged in as
  demo_user (fresh two-step login)", second run reported "Already
  authenticated as demo_user (session reused, password step skipped)" —
  both branches of the login logic genuinely exercised. Extracted
  balance/transaction data differed between the two runs (proving live
  DOM extraction, not a cached value), full structured detail visible in
  the captured stdout. Confirmed the local screenshot file exists and
  visually inspected it (Read tool, rendered the actual PNG) — a real
  dashboard with a real transaction table, matching the extracted
  summary. Started both Control Panel processes, confirmed `GET
  /api/workflows` listed `xc-bank-login-extract` with zero Control Panel
  code changes, ran it through the real queue — job completed, step
  detail showed the balance/transaction-count summary, both local and
  MinIO screenshot links returned 200. `docker compose down`; both host
  processes confirmed actually dead afterward (port-4000 check for the
  API, command-line search for the worker).
- Next: the design-only email-notification scaffolding could become real
  in a future round (a mock outbox inside XC Bank + WebOperator's
  separate Gmail ingestion correlating by reference/amount/timestamp) —
  explicitly not this round. Otherwise: a live Gmail OAuth test with the
  user's own credentials, the real downloads fix, video/trace, or
  whichever else the user picks.

### 2026-08-04 (session 11) — Claude

- Status: Done
- Context: XC Bank login/logout flow refinements. After
  trying the workflow through the real UI (previous message), user asked
  for a follow-up round. Checked `git log` first — still at `344c669`,
  nothing new claimed. Scope: (1) `GET /login` currently *always* shows
  the username form unless the session is already `authenticated` — a
  "remembered username" pending session (username captured, not yet
  authenticated) gets re-asked for username instead of skipping straight
  to `/password`, which is the gap to close; the adapter's `login()` must
  handle three paths now, not two: fresh (no session), remembered-
  username (pending session, skip to password), already-authenticated
  (skip everything). (2) New `Logout` and `Logout clean` buttons on the
  XC Bank site itself: `Logout` clears `authenticated` but keeps the
  session's `username` (so a subsequent `/login` correctly bounces to
  `/password`, not the username form — matches realistic bank UX);
  `Logout clean` deletes the session entirely + clears the cookie (next
  `/login` shows a genuinely fresh username form) — explicitly a dev/
  test-only reset helper, not simulating real bank behavior, documented
  as such. (3) A new worker action/workflow for `xc-bank logout clean`
  to reset test state programmatically, if it doesn't blow up scope —
  assessed as small (one more registry action + one-step workflow,
  following the exact pattern of `xcBankLogin`/`xcBankExtractDashboard`)
  so doing it. (4) Verify all four flows for real (fresh login after
  logout-clean, session-reuse skip, plain logout, logout-clean → fresh
  workflow run) through the actual Control Panel queue. (5) Update
  `README.md`/`AGENTS.md`/`docs/PROJECT_PLAN.md` — explicitly note
  `Logout clean` is a mock-only test helper. (6) Same isolation rule as
  before (DOM-only, no internal API/shared DB) and no Gmail/Phase 3.
  Stack left running from the previous message (user chose to leave it
  up after trying the UI) — reusing it rather than tearing down and
  restarting. If you're Codex (or another session) reading this before a
  "Done" entry below: this is claimed — check back here or pick a
  different open item instead.
- Files: `services/xc-bank/src/sessions.ts` (+`deleteSession()`),
  `services/xc-bank/src/server.ts` (`GET /login` now redirects a pending
  session to `/password`, not just an authenticated one to `/dashboard`;
  new `POST /logout` and `POST /logout-clean` routes; `Logout`/`Logout
  clean` buttons on `/dashboard`, `Logout clean` also on `/password` as
  an escape hatch), `services/worker/src/adapters/xc-bank.ts` (`login()`
  now returns a 3-way `path` — `fresh`/`remembered-username`/
  `already-authenticated` — instead of a boolean; new `logoutClean()`,
  DOM-click only), `services/worker/src/actions/registry.ts`
  (`xcBankLogin`'s summary string updated for the 3-way result; new
  `xcBankLogoutClean` action), `services/worker/src/run-workflow.ts`
  (`xcBankLogoutClean` added to both the `captureResult` branch and the
  auto-retry set, since it's idempotent), new
  `services/worker/workflows/xc-bank-logout-clean.json`,
  `docs/PROJECT_PLAN.md` (4 new decision-log rows + updated Test Fixtures
  entry), `AGENTS.md` (XC Bank section rewritten for the 3 login paths +
  logout semantics), `README.md` (new step 17 covering all four flows +
  a workflow-based reset note).
- Verified: `npx tsc --noEmit` clean in both `services/xc-bank` and
  `services/worker`. Local smoke test first (fast iteration): fresh
  login, already-authenticated redirect, plain logout, and the
  remembered-username redirect to `/password` all confirmed directly via
  `curl` with a cookie jar; confirmed the actual HTML shows the username
  form pre-login and the right logout button(s) on `/password` vs.
  `/dashboard`. Then in Docker: rebuilt `services/xc-bank`'s image,
  restarted it (noticed `browser-worker-chrome` had also stopped for an
  unrelated reason — restarted it too, giving a conveniently-fresh
  cookie-free browser to test against). Ran the real `xc-bank-login-
  extract` workflow via `docker compose run` twice — fresh, then session-
  reused, both reporting correctly. Wrote a throwaway adapter-level test
  script (deleted after) that exercised the full sequence end to end
  against the real running site: `logoutClean` (setup) → `login()`
  reports `fresh` → click the real `#logout-btn` → lands on `/password`
  (not `/login` — confirms the redirect chain, initially a red herring
  in a background-task timeout until traced to the *correct* behavior:
  `/login` itself auto-redirects to `/password` now) → `login()` again
  reports `remembered-username` and did not re-fill username → `logout
  Clean()` again → `login()` reports `fresh` again. All three paths and
  both logout semantics proven at the code level, not just the route
  level. Then through the **real Control Panel queue**: cleaned up a
  duplicate `npm run worker` process left over from hitting `EADDRINUSE`
  on a still-running API from the previous message (confirmed only one
  worker process remained via the documented command-line search), ran
  `xc-bank-logout-clean` then `xc-bank-login-extract` back-to-back — the
  login step reported `fresh two-step login` immediately after the
  reset, proving it works through the whole system, not just directly
  against the adapter. Visually confirmed the resulting dashboard
  screenshot (Read tool) matches the extracted summary. Per the user's
  explicit instruction this time (unlike the previous round): `docker
  compose down`; both host processes confirmed actually dead afterward
  (port-4000 check for the API, command-line search for the worker).
- Next: whatever the user picks — the design-only email-notification
  scaffolding, a live Gmail OAuth test with the user's own credentials,
  the real downloads fix, video/trace, or something else entirely.

### 2026-08-04 (session 12) — Claude

- Status: Done
- Context: XC Bank Monitor — a continuous bot loop + Control Panel
  dashboard page. Explicit direct instruction with a large,
  detailed multi-part scope. Checked `git log` first — still at
  `30127df`, nothing new claimed. User also explicitly confirmed the
  existing port-4000 noVNC/take-over page should stay as-is — this is a
  *new* page/route, not a rework of anything existing. Core scope: a
  repeatable/loop job that periodically drives the real browser
  (DOM-only, reusing `xcBankLogin`/`xcBankExtractDashboard`, never an
  internal API) to check XC Bank's dashboard, session-aware (reuse if
  still logged in, re-login via the existing 3-path flow if redirected);
  a dedup layer keyed on XC Bank's own transaction reference/id so only
  genuinely new transactions produce a notification, in chronological
  order, never repeated, but the transaction *table* still just shows
  latest state; a screenshot timeline capped at 200 most-recent images
  per monitor with local (and MinIO, if in scope) retention cleanup; a
  new Control Panel page (`/monitors/xc-bank` or similar) distinct from
  the existing noVNC take-control page, showing monitor status/balance/
  transactions/notifications/screenshot timeline, polling; new
  `/api/monitors/xc-bank` (`GET`, `POST .../start`, `POST .../stop`,
  optional `POST .../check-once`); dev-only JSON persistent state under
  `data/monitor-state/xc-bank.json` (no real credentials, only the mock
  test creds already public on the XC Bank page itself, documented as
  dev-only); must not race the existing queue's shared-browser
  concurrency-1 model. No Gmail/Phase 3, no internal-API/shared-DB
  channel with XC Bank — same isolation rule as every XC Bank round so
  far. This is a substantially larger feature than prior XC Bank rounds
  (a genuine background loop + new persistent state + new UI surface,
  not just an adapter extension) — will research the existing queue/
  Control Panel architecture thoroughly and go through plan mode before
  writing code, and will flag if it looks like it needs splitting rather
  than assuming one round covers it. If you're Codex (or another
  session) reading this before a "Done" entry below: this is claimed —
  check back here or pick a different open item instead. Went through
  plan mode with a comprehensive design before writing any code; decided
  to do it as one round (not split) since it decomposed into
  independently-testable pieces comparable in size to the Gmail scaffold
  and original MinIO rounds, both of which shipped fine as one round
  earlier this session.
- Files: `services/worker/src/run-workflow.ts` (new `resolveParams()` —
  generic `${ENV_VAR}` substitution for string params, applied before
  building step opts), `services/worker/workflows/xc-bank-monitor-check.json`
  (new — reuses `xcBankLogin`/`xcBankExtractDashboard`/`screenshot`
  unchanged, just a dynamic screenshot filename via the new
  substitution), `services/worker/src/actions/registry.ts`
  (`xcBankExtractDashboard` now logs a single-line `XC_BANK_DASHBOARD
  {...}` marker instead of pretty-printed JSON — same convention as
  `WEBOP_STEP`), `services/worker/src/adapters/xc-bank.ts`
  (`ExtractedTransaction` gained `timestamp`/`balanceAfter` — the DOM
  cells already existed, just weren't read before; needed for
  chronological dedup and the notification display),
  `services/control-panel/src/exec.ts` (+`runXcBankMonitorCheck()`,
  +`parseXcBankDashboard()` mirroring the existing `parseSteps()`
  pattern), `services/control-panel/src/artifacts.ts`
  (+`removeArtifact()`, best-effort MinIO deletion for retention),
  `services/control-panel/src/monitor.ts` (new — dev-only JSON state at
  `data/monitor-state/xc-bank.json`, `checkOnce()` with dedup + 200-item
  screenshot retention, `loadState()`), `services/control-panel/src/
  queue.ts` (+monitor branch in the shared concurrency-1 Worker,
  +`startMonitorSchedule`/`stopMonitorSchedule`/`isMonitorScheduled`/
  `enqueueMonitorCheckOnce` via BullMQ's Job Scheduler API),
  `services/control-panel/src/server.ts` (new `/api/monitors/xc-bank`
  routes + `/monitors/xc-bank` page route — every existing route
  untouched), `services/control-panel/public/xc-bank-monitor.html` +
  `.js` (new — status/balance/notifications/transactions/screenshot
  timeline, Start/Stop/Check-once, its own small polling script rather
  than growing `app.js`), `services/control-panel/public/index.html`
  (one new link section added — the noVNC take-control section and
  everything else on that page is byte-for-byte untouched, confirmed via
  diff review before committing), `docs/PROJECT_PLAN.md` (10 new
  decision-log rows + Test Fixtures entry), `AGENTS.md` (new XC Bank
  Monitor section + repo-layout entries), `README.md` (new step 18).
- Verified: `npx tsc --noEmit` clean in both projects, re-checked after
  every fix. Full real stack (xc-bank, browser-worker-chrome, minio,
  redis, both Control Panel processes). `check-once` genuinely extracts
  live balance/transactions (confirmed the local screenshot file and its
  MinIO copy both exist). **Dedup**: 4 consecutive real checks showed
  `seenRefs` growing monotonically by exactly each check's new-batch
  size (7→14→20→28) with zero re-additions — proven both by construction
  (`Set`-backed filter, architecturally cannot double-add) and
  empirically; an exact "two checks land in the identical 10s window"
  timing test turned out impractical (each check's own round trip is
  5-8s, comparable to the window itself) and unnecessary given the
  above. **Scheduler**: start → an immediate check fires → waited 25s
  past the 20s interval → `lastCheckedAt` advanced with zero manual
  trigger → stop → waited another 25s → `lastCheckedAt` did not advance
  again. **Found and fixed a real bug**: `getJobSchedulers()`'s entries
  expose the scheduler's id as `.key`, not `.id` (confirmed by querying
  a live queue directly) — the first version always reported
  `running: false` even with the scheduler genuinely active; fixed,
  re-verified. **Full Control Panel restart persistence**: killed both
  host processes entirely, restarted fresh — `seenRefs`/`notifications`
  counts and `lastCheckedAt` all survived (JSON file, not in-memory
  state, confirmed as the real source of truth), and a check afterward
  correctly continued deduping from where it left off (85→90, not
  reset). **Retention, simulated rather than 200 real checks** (would
  take over an hour at the dev interval): seeded 205 fake screenshot
  entries (10 backed by real placeholder files at the removal boundary,
  2 also uploaded to MinIO), triggered one real check pushing the total
  to 206 — confirmed exactly 200 remained, precisely the correct 6
  oldest were deleted from local disk, and both MinIO objects among them
  were gone too (`GET /api/artifacts/screenshots/*` 404s afterward).
  **Readable-failure check**: stopping `browser-worker-chrome` turned out
  to not test anything, since `docker compose run`'s `depends_on`
  auto-restarts it — stopped `xc-bank` itself instead (not a `worker`
  dependency) and confirmed a real failure
  (`net::ERR_ADDRESS_UNREACHABLE`) surfaces as a clear `lastError`
  string, the Control Panel stayed fully responsive throughout, and a
  subsequent check succeeded normally once `xc-bank` was restarted —
  genuine recovery, not just an error path existing. **Regression
  check**: `/`, `/api/status`, `/api/workflows`, `/app.js` all confirmed
  unaffected. All debug/test scripts and synthetic seed data deleted
  before committing; monitor state reset to clean. `docker compose
  down`; both host processes confirmed actually dead afterward
  (port-4000 check for the API, command-line search for the worker).
- Next: turning the design-only email-notification fields into something
  real (a mock outbox in XC Bank + correlating with WebOperator's Gmail
  ingestion), a live Gmail OAuth test with the user's own credentials,
  the real downloads fix, video/trace, or whichever else the user picks.

### 2026-08-04 (session 13) — Claude

- Status: Done
- Context: Fix `/monitors/xc-bank` not rendering, then redesign `/` into
  a "Control Center" with an extensible multi-monitor registry. Explicit
  direct instruction reporting a real bug in the
  session-12 work. Checked `git log` first — still at `f928ed3`, nothing
  new claimed. **Root cause already reproduced empirically, not guessed**:
  started the real stack, curled the page directly — the HTML shell
  loads fine (200, full markup), but `<script src="xc-bank-monitor.js">`
  is a *relative* path; at URL `/monitors/xc-bank` (no trailing slash) a
  browser resolves that relative to `/monitors/`, requesting
  `/monitors/xc-bank-monitor.js` (confirmed 404) instead of the actual
  `/xc-bank-monitor.js` (confirmed 200, served correctly by the existing
  static middleware). So the static skeleton renders but the page's own
  JS never loads — nothing dynamic (status, balance, notifications,
  transactions, screenshots, button handlers) ever populates, which
  matches the user's report exactly. Fix: use an absolute script path.
  Beyond that immediate fix, broader scope: (1) `/monitors/xc-bank` needs
  a readable empty state (no screenshots yet) and readable errors if
  Redis/MinIO/the browser aren't ready, not a blank page; previous-
  screenshot browsing up to the existing 200-item retention cap. (2)
  Redesign `/` into a "Control Center" — existing browser controls/
  noVNC/worker actions/workflows all stay, plus a new "Monitors" section
  listing every registered monitor (name, running/stopped/error status,
  latest summary, last checked, link to its detail page, Start/Stop/
  Check-once buttons) rendered from data, not hardcoded to XC Bank. (3)
  A monitor registry on the Control Panel side (e.g. `MONITORS = [{id,
  name, ...}]`) plus `GET /api/monitors` (plural, new) so `/` can render
  whatever's registered automatically — this round only has XC Bank, but
  the structure must support more without UI rework. (4) Confirm
  `GET /api/monitors/xc-bank` already returns everything the UI needs
  (it does, from session 12 — `running`/`lastCheckedAt`/`lastError`/
  `latestBalance`/`notifications`/`latestTransactions`/`screenshots`).
  (5) Confirm `/screenshots/*` and `/api/artifacts/:kind/:filename`
  (both pre-existing, unrelated to this bug) still work — regression
  check, not a code change. No Gmail/Phase 3, same isolation rule as
  every XC Bank round (monitor still reads DOM/worker output only). Will
  go through plan mode given the registry-refactor scope before writing
  the broader redesign, though the immediate script-path bug fix is
  small and unambiguous. If you're Codex (or another session) reading
  this before a "Done" entry below: this is claimed — check back here or
  pick a different open item instead.
- Files: `services/control-panel/public/xc-bank-monitor.html` (the
  actual fix — relative `xc-bank-monitor.js` → absolute
  `/xc-bank-monitor.js`; plus thumbnail CSS sizing),
  `services/control-panel/public/xc-bank-monitor.js`
  (`renderScreenshots()` now builds real `<img>` thumbnails linking to
  the full-size local image in a new tab, MinIO kept as a small
  secondary text link; clearer empty-state text), new
  `services/control-panel/src/monitors-registry.ts` (listing-layer-only
  registry — `MonitorSummary`, one `getXcBankSummary()`,
  `listMonitorSummaries()`), `services/control-panel/src/server.ts`
  (new `GET /api/monitors` — every existing route, including the
  per-monitor `/api/monitors/xc-bank/*` ones from last round,
  untouched), `services/control-panel/public/index.html` (intro
  paragraph now describes the page as the Control Center; the static
  single XC Bank link replaced with a `<div id="monitors-list">`
  container + monitor-card CSS — Browsers/Workflows/Jobs sections and
  the noVNC take-control flow completely unchanged, confirmed via diff
  review), `services/control-panel/public/app.js` (+`loadMonitors()`/
  `renderMonitors()`/`callMonitorAction()`, same polling pattern as the
  existing `pollStatus`/`pollJobs`), `docs/PROJECT_PLAN.md` (5 new
  decision-log rows), `AGENTS.md` (Control Center + registry section,
  repo-layout entry), `README.md` (updated step 18).
- Verified: `npx tsc --noEmit` clean. Full real stack. **Confirmed the
  actual bug fix**: curled the exact URL a browser would request for the
  script from `/monitors/xc-bank` post-fix (`/xc-bank-monitor.js`,
  absolute) — 200; confirmed the served HTML now contains the absolute
  path. `node --check` on both modified JS files (syntax-clean). **Went
  a step further than "the page loads"**: wrote a Node harness with a
  minimal DOM stub, loaded the page's *actual, unmodified* JS file,
  fetched real data from the live `GET /api/monitors/xc-bank`, ran the
  real `renderScreenshots()`/`renderNotifications()`/
  `renderTransactions()` functions against it, and confirmed every URL
  the produced HTML references (thumbnail `src`, click-through `href`,
  MinIO link) resolves to 200 against the real server — stronger
  evidence than confirming the page merely loads. `GET /api/monitors`
  confirmed listing XC Bank with a live, accurate summary matching
  `GET /api/monitors/xc-bank` directly. **Readable-failure re-check,
  this time for real** (the original bug meant this was never actually
  exercised before): stopped `xc-bank`, triggered a check, confirmed
  `lastError` populated with a readable message in both
  `GET /api/monitors/xc-bank` and the new `GET /api/monitors` list (a
  first check of this came back showing no error — turned out to be my
  own verification checking too early, before the real 30s Playwright
  navigation timeout had elapsed; confirmed against the actual state
  file on disk that the error genuinely had been captured correctly).
  Restarted `xc-bank`, confirmed full recovery (a subsequent check
  succeeded with a real balance). Regression-checked `/screenshots/*`
  and `/api/artifacts/screenshots/:filename` (both still 200 on a known
  file) and confirmed `/` still renders every pre-existing section
  (Browsers/Playwright worker/Workflows/Gmail/Jobs/Last output) alongside
  the new Monitors section. All debug scripts deleted before committing;
  monitor state reset to clean. `docker compose down`; both host
  processes confirmed actually dead afterward (port-4000 check for the
  API, command-line search for the worker).
- Next: turning the design-only email-notification fields into something
  real, a live Gmail OAuth test with the user's own credentials, the
  real downloads fix, video/trace, or whichever else the user picks.

### 2026-08-05 — Claude

- Status: Done
- Context: XC Bank Live View page + monitor UX pass. Explicit direct
  instruction with a detailed scope. Checked `git log` first — still at
  `31b0c9b`, nothing new claimed. Built a new route,
  `/monitors/xc-bank/live`, two-column layout — left: live browser view
  via the existing noVNC endpoint (`http://localhost:6080/vnc.html`,
  same URL `/`'s own "Take control" button already embeds — genuinely
  the same shared, concurrency-1 browser the monitor's own checks drive,
  confirmed by reading the queue/exec code rather than assumed), with a
  Chrome-not-running guidance panel (a "Start Chrome" button reusing the
  existing `POST /api/action/startChrome`) and a latest-screenshot
  fallback (`state.screenshots[0]`, confirmed newest-first via
  `monitor.ts`'s `unshift()`); right: a compact extracted-data panel
  (status, last checked, latest balance, latest transactions, new
  notifications, last error, Start/Stop/Check-once) polling
  `GET /api/monitors/xc-bank` every 3s without a page reload. No new API
  routes needed — both columns reuse existing endpoints entirely.
  `/monitors/xc-bank` (history/detail) is otherwise unchanged, just
  gained a "Live view" link; `monitors-registry.ts` gained a `livePath`
  field alongside `detailPath` so `/`'s Monitors section renders both
  Detail and Live links per monitor, and any future monitor gets both
  automatically with zero UI changes. Iframe `src` is only assigned on
  the stopped→running transition (not every poll) to avoid flicker,
  matching the explicit ask.
- Files: `services/control-panel/src/monitors-registry.ts` (`livePath`
  field on `MonitorSummary`/`MonitorDefinition`), `src/server.ts` (new
  `GET /monitors/xc-bank/live` route — every existing route untouched),
  new `public/xc-bank-monitor-live.html` + `.js` (two-column live view,
  own small polling script — same pattern as the existing detail page
  having its own script instead of growing `app.js`),
  `public/xc-bank-monitor.html` (added a "Live view →" link),
  `public/app.js` (`renderMonitors()` now renders Detail + Live links
  instead of one "Open" link), `README.md` (new step 19),
  `AGENTS.md` (new "two views" section + repo-layout entries),
  `docs/PROJECT_PLAN.md` (4 new decision-log rows + Test Fixtures entry
  + Immediate-next-step paragraph updated).
- Verified: `npx tsc --noEmit` clean (only backend change was the
  `livePath` field). Full real stack up (all 4 Docker services already
  running from a prior session, both Control Panel processes started
  fresh). `GET /api/monitors` confirmed `livePath: "/monitors/xc-bank/live"`
  present. `/monitors/xc-bank/live` and its script both 200, HTML
  references the absolute script path. **Visual proof, real browser**:
  connected the real Chromium to the live page over CDP
  (`host.docker.internal:4000`) and screenshotted it while Chrome was
  running — real balance/notifications rendered in the right panel, the
  left column showed the genuine noVNC connect screen (same behavior as
  `/`'s own take-control iframe, not a bug). Screenshotted `/` itself —
  the XC Bank monitor card shows working **Detail** and **Live** links
  alongside Start/Stop/Check-once, every other section (Browsers,
  Playwright worker, Workflows) visually unchanged. **Chrome-not-running
  fallback, tested for real**: stopped the monitor schedule, stopped
  `browser-worker-chrome`, confirmed `GET /api/status` reported
  `chrome: "stopped"`; since a screenshot-based visual check isn't
  possible without Chrome, verified via a Node `vm` harness that loads
  the real, unmodified `xc-bank-monitor-live.js` against a stubbed DOM
  and real `fetch` calls to the live (Chrome-down) API — confirmed the
  offline panel shows (`display: block`), the iframe hides and resets to
  `about:blank`, and the fallback screenshot renders a real `<img src>`
  that independently resolves 200 via curl. Restarted Chrome. **No-flicker
  check**: same harness technique, called the script's own `fetchStatus()`
  three times in a row against the live API with Chrome genuinely
  running throughout — iframe `src` was assigned exactly once across all
  three calls, not reset each poll. **Data-refresh check**: called
  `check-once` via the API, confirmed `lastCheckedAt` advanced and
  `latestBalance` changed within a few seconds (matches what the live
  page's own 3s poll would show). Restored the monitor schedule to
  running (its state before this session started). Regression-checked
  `/`, `/monitors/xc-bank`, `/screenshots/*`, and
  `/api/artifacts/screenshots/:filename` — all still 200/correct. All
  debug scripts and screenshots (a throwaway `debug-screenshot-live.ts`
  worker script, two harness `.mjs` files, two debug PNGs) deleted
  before committing. Restored the monitor schedule to `running` (its
  state before this session's testing began) before final teardown.
  `docker compose down`; both host Control Panel processes confirmed
  actually dead afterward (port-4000 check for the API, command-line
  search for the worker).
- Next: turning the design-only email-notification fields into
  something real, a live Gmail OAuth test with the user's own
  credentials, the real downloads fix, video/trace, or whichever else
  the user picks.

<!-- Note: several 2026-08-05/06 entries above this point were
inserted mid-file by earlier Edit calls that matched a non-unique
"whichever else the user picks"-style anchor instead of true EOF --
dated headers are still accurate, just not in strict file order.
Appending correctly from here on. -->

### 2026-08-06 (session 2) — Claude

- Status: In progress
- Context: **Claiming: "polite automation" pass** — jittered monitor
  interval, per-action/typing delay, a basic challenge (CAPTCHA/2FA/
  verification-page) detector, and a per-site policy config (locale
  `th-TH`, timezone `Asia/Bangkok` as the example given) consulted by
  the workflow engine before interactive steps and by the monitor
  scheduler. Explicit direct instruction with a 5-item ordered scope,
  framed by the user themselves as "false-positive reduction, not
  bypass" (item 5 is documenting exactly that framing — no CAPTCHA
  solving, no `navigator.webdriver`/CDP-artifact patching, no proxy/IP
  work; those were separately discussed as "effort กลาง"/"แก้ไม่ได้ง่าย"
  items and explicitly not part of this round's ask). Checked `git log`
  first — still at `d8280dd`, nothing new claimed.
  Researched the existing architecture before designing: `run-
  workflow.ts` reuses the *existing* default browser context/page
  (`browser.contexts()[0] ?? newContext()`) rather than creating a fresh
  one per run, which rules out Playwright's `newContext({locale,
  timezoneId})` for locale/timezone — those only apply at context
  creation. The real mechanism is a raw CDP session
  (`context.newCDPSession(page)` + `Emulation.setTimezoneOverride`/
  `Emulation.setLocaleOverride`), same "drop to raw CDP for something
  Playwright's high-level API doesn't expose on an existing
  context/page" pattern already discussed elsewhere in this repo (the
  deferred downloads fix). The XC Bank monitor's checks already run
  through `run-workflow.ts` (via `xc-bank-monitor-check.json`), so
  action delay/typing delay/challenge detection/locale-timezone all
  apply to the monitor automatically once built into the workflow engine
  — only the *scheduling interval* jitter (item 1) needs its own change,
  in `queue.ts`.
- Files: none yet — planning now.
- Verified: n/a
- Next: (this entry will be updated once the work is done and verified).

### 2026-08-06 (session 2, later) — Claude

- Status: Done
- Context: Shipped the "polite automation" pass per the claim above.
  Went through plan mode, approved before implementing.
- Files: `services/worker/src/policy.ts` (new — `SitePolicy`,
  `SITE_POLICIES` keyed by `siteId`, `getPolicy()`, `randomDelay()`,
  `humanFill()`), `services/worker/src/challenge.ts` (new —
  `detectChallenge()`, keyword list, never attempts to bypass),
  `services/worker/src/run-workflow.ts` (`WorkflowDef.siteId` +
  validation, new `apply-policy` step using
  `context.newCDPSession(page)` + `Emulation.setTimezoneOverride`/
  `setLocaleOverride`/`setUserAgentOverride`, pre-step pacing delay for
  interactive step types, post-step challenge check for
  navigate/login/xcBankLogin), `services/worker/src/actions/registry.ts`
  (`ActionContext` gained optional `policy`; `login` handler now uses
  `humanFill` instead of `page.fill`; `xcBankLogin` passes the resolved
  policy through), `services/worker/src/adapters/xc-bank.ts` (`login()`
  gained a required `policy` param, uses `humanFill` for both fields),
  `services/worker/workflows/xc-bank-login-extract.json` +
  `xc-bank-logout-clean.json` + `xc-bank-monitor-check.json` (each
  gained `"siteId": "xc-bank"`), `services/control-panel/src/queue.ts`
  (`MONITOR_JITTER_MS`, `data: {scheduled: true}` tag on the scheduler's
  job template, conditional jitter sleep before `checkOnce()`),
  `AGENTS.md` (new "polite automation" section + repo-layout entries),
  `docs/PROJECT_PLAN.md` (6 new decision-log rows + Immediate-next-step
  paragraph).
- Verified: `npx tsc --noEmit` clean in both `services/worker` and
  `services/control-panel`. Restarted both host Control Panel processes
  to pick up the `queue.ts` change (worker's own changes are picked up
  live via the existing bind mount, no image rebuild needed). **Real
  end-to-end runs through the live queue**: `xc-bank-login-extract`
  completed with the new `apply-policy`/`1-challenge-check` steps
  visible alongside the existing ones, all `ok`. **Locale/timezone,
  proven not assumed**: a throwaway script applied the `xc-bank` policy
  via CDP and read back `Intl.DateTimeFormat().resolvedOptions().timeZone`/
  `navigator.language` — confirmed `Asia/Bangkok`/`th-TH`. **Caught and
  fixed a real gap during this check**: `Emulation.setLocaleOverride`
  changes `Intl` formatting but does *not* change `navigator.language`
  (first version still reported `en-US`) — fixed by also calling
  `Emulation.setUserAgentOverride` with the *real* `navigator.userAgent`
  (read back and passed through unchanged) plus `acceptLanguage` from
  the policy; re-verified, `navigator.language` correctly reported
  `th-TH` afterward, real Chrome UA string unchanged (not a browser-
  identity spoof, only the language preference). **Challenge detector,
  both branches**: `page.setContent()` with CAPTCHA-style text →
  matched `"captcha"`; normal dashboard-style text → `null`; a real
  `xc-bank-login-extract` run afterward confirmed no false positive
  against actual XC Bank page content. **Validation, not just the happy
  path**: a throwaway workflow file with `"siteId": 123` (wrong type)
  enqueued fine (Control Panel's pre-enqueue check doesn't duplicate the
  worker-side type check, same posture as the existing action-type
  check) but failed cleanly at the worker's own `validate` step with
  zero browser interaction, exactly as designed — deleted after.
  **Monitor jitter**: stopped and restarted the schedule so the new
  tagged job template took effect, then measured real consecutive
  scheduled-tick gaps of 15.5s and 18.75s around the nominal 20s
  interval (not identical to each other or to 20.000s, consistent with
  jitter) versus a manual "Check once" completing in ~3.2s with no added
  delay — matches the intended "scheduled ticks jittered, manual stays
  instant" split. **Regression**: `the-internet-login` (no `siteId`,
  default policy) ran its full 7-step sequence successfully with the new
  `apply-policy`/challenge-check steps interleaved correctly; `demo` and
  `xc-bank-logout-clean` also ran clean. All debug scripts (a
  `debug-policy-verify.ts` worker script, a throwaway bad-`siteId`
  workflow JSON) deleted before committing.
  Left the Docker stack and both host processes running (no explicit
  instruction to tear down this round, and the user has consistently
  wanted the stack left up for their own use throughout this session).
- Next: same open items as before, plus — if ever revisited — the
  explicitly-deferred items from this round's own scoping discussion
  (`navigator.webdriver`/CDP-artifact patching, mouse-movement
  humanization, proxy/residential-IP work), only if the user explicitly
  asks for them later.

### 2026-08-06 (session 3) — Claude

- Status: In progress
- Context: **Claiming: Monitor Control UX polish**, follow-up to the
  "polite automation" pass now that there's a real jittered background
  loop — explicit direct instruction with a 6-item scope: (1) Control
  Center shows the monitor is running with an approximate/jittered
  interval, not a fixed one; (2) "Pause all monitors"/"Stop all
  monitors" bulk buttons; (3) a "scheduled vs. manual" badge in the job
  list or monitor panel; (4) a next-scheduled-check estimate where
  feasible; (5) a warning if a monitor's been running a long time with
  accumulated screenshots; (6) a dev-only cleanup button for monitor
  screenshots/state. Plus: finish this round with a clean Docker
  rebuild + redeploy (not just hot-reload verification) and update the
  relevant `.md` docs. Checked `git log` first — still at `eba0914`,
  nothing new claimed.
  Will research `getJobSchedulers()`'s `next`/`every` fields (already
  used once this session for `isMonitorScheduled()`) and the existing
  `monitors-registry.ts` extensibility shape before designing pause/
  resume + bulk actions, then go through plan mode given the surface
  area (new monitor state field, new queue job type for cleanup, new
  routes, UI changes across three pages). If you're Codex (or another
  session) reading this before a "Done" entry below: this is claimed —
  check back here or pick a different open item instead.
- Files: none yet — planning now.
- Verified: n/a
- Next: (this entry will be updated once the work is done and verified).

### 2026-08-06 (session 3, later) — Claude

- Status: Done
- Context: Shipped Monitor Control UX polish per the claim above. Went
  through plan mode, approved before implementing.
- Files: `services/control-panel/src/monitor.ts` (`paused` field on
  `MonitorState`, `setPaused()`, `resetState()`), `src/queue.ts`
  (pause-aware scheduled-tick branch, `MONITOR_CLEANUP_JOB_NAME` +
  `MONITOR_SET_PAUSED_JOB_NAME` job types, `getMonitorScheduleInfo()`
  replacing `isMonitorScheduled()`, `pauseMonitor`/`resumeMonitor`/
  `enqueueMonitorCleanup`, `JobSummary.scheduled`), `src/monitors-
  registry.ts` (`MonitorSummary` gained `paused`/`intervalMs`/
  `jitterMs`/`nextCheckEstimate`/`longRunningWarning`; `MonitorDefinition`
  gained `pause`/`stop`; `pauseAllMonitors()`/`stopAllMonitors()`),
  `src/server.ts` (`/api/monitors/pause-all`, `/stop-all`, per-monitor
  `/pause`, `/resume`, `/cleanup`; `GET /api/monitors/xc-bank` extended),
  `public/index.html` + `app.js` (Pause-all/Stop-all buttons, paused dot
  state, interval/jitter text, next-check estimate, warning banner,
  per-monitor Pause/Resume button, scheduled/manual job badge),
  `public/xc-bank-monitor.html` + `.js` (same status additions + a
  dev-only Cleanup button with a confirm dialog), `public/xc-bank-
  monitor-live.html` + `.js` (same status additions, no Cleanup button —
  kept out of this page's live-operation scope), `AGENTS.md` (new
  Monitor Control UX subsection), `docs/PROJECT_PLAN.md` (5 new
  decision-log rows + Immediate-next-step paragraph).
- Verified: `npx tsc --noEmit` clean. Restarted both host Control Panel
  processes to pick up the change (worker-side code untouched this
  round). **Found and fixed a real concurrency bug during verification,
  not assumed correct**: the first implementation called `setPaused()`
  directly from the pause/resume API routes; a real test (fire a manual
  check-once, then pause immediately after) showed `paused` silently
  reverting to `false` — `checkOnce()` holds its own in-memory state
  across a multi-second real-browser check and overwrites the file
  wholesale at the end, clobbering a concurrent direct write. Fixed by
  adding `xc-bank-monitor-set-paused` as a proper queued job type,
  serialized by the same concurrency-1 queue as `checkOnce()` — re-ran
  the exact failing scenario afterward and confirmed the pause job now
  correctly queues behind the in-flight check and applies cleanly,
  visible in both the API state and `/api/jobs`' completion order.
  **Every flow proven for real, not just code-reviewed**: paused a
  running monitor, waited past two full scheduled intervals, confirmed
  `lastCheckedAt` genuinely froze while both ticks logged "Monitor
  paused — scheduled check skipped"; confirmed a manual check-once still
  runs while paused; resumed and confirmed `lastCheckedAt` genuinely
  advanced again (~59s later) with no other calls interleaved; Pause-all/
  Stop-all exercised via their real endpoints; Cleanup exercised for
  real — a known screenshot's local file and MinIO copy both 404'd
  afterward, and `screenshots`/`notifications`/`seenRefs` all confirmed
  at 0. `longRunningWarning` observed for real (not synthetically
  seeded) once the monitor's screenshot count genuinely hit
  200/200 with an hour-plus-old oldest entry. Visually confirmed all
  three pages (`/`, `/monitors/xc-bank`, `/monitors/xc-bank/live`) via
  the established CDP-screenshot technique — interval/jitter text,
  next-check estimate, Pause buttons, and (on `/`) the full Jobs-table
  history of this session's own test jobs rendering with correct
  scheduled/manual badges and "Monitor paused"/"Monitor resumed"/
  "Monitor paused — scheduled check skipped" results all visible.
  Regression: a `demo` workflow job correctly showed `scheduled: false`
  (badge suppressed for non-monitor jobs); `/screenshots/*` and
  `/api/artifacts/screenshots/*` both still 200 on a fresh post-cleanup
  screenshot. **Clean Docker rebuild + redeploy**, the explicit final
  ask: stopped everything, `docker compose down --rmi local` (confirmed
  exactly the 5 repo-built images removed), rebuilt all 5, brought the
  stack back up, restarted both host processes, then re-ran the pause/
  resume race scenario and a full `xc-bank-login-extract` workflow
  against the freshly-built images — both correct (note: this round's
  actual code changes all live in `services/control-panel`, a host
  process never containerized, so the rebuild's real verification value
  here was confirming the worker/xc-bank images — which the monitor's
  checks depend on — still work correctly, not re-testing the pause fix
  itself, which doesn't live in a Docker image). Left the Docker stack
  and both host processes running afterward (consistent with how the
  user has wanted this session's stack kept up throughout).
- Next: same open items as before.

### 2026-08-06 (session 4) — Claude

- Status: In progress
- Context: **Claiming: Health/diagnostics + readiness-check pass.**
  Explicit direct instruction, direction change away from Gmail/Phase 3
  (user: **Gmail/OAuth/email-notification work stays paused this
  round** — this is operational-stability/UX polish instead). 5-item
  scope: (1) a health/diagnostics page or section covering Docker
  services (redis/minio/xc-bank/browser-worker-chrome), the Control
  Panel API itself, queue worker connectivity, Redis reachability, MinIO
  reachability, the XC Bank URL, and noVNC/Chrome status, each shown
  green/yellow/red with a short fix hint; (2) a one-click "Run readiness
  check" that gates workflow/monitor usage and, on a missing service,
  prints the exact command to run — explicitly **never** auto-starts
  anything silently; (3) better empty/error states elsewhere (queue
  worker down → jobs will sit "waiting", Redis down → clear message,
  MinIO down → "archival will error but the main job may still work",
  Chrome not running → existing Start Chrome/fallback confirmed still
  works, not rebuilt); (4) docs across `StepByStep.md`/`README.md`/
  `AGENTS.md`/`docs/PROJECT_PLAN.md`/`docs/AGENT_HANDOFF.md`, including
  recording that Gmail/Phase 3 is paused per this direction; (5) the
  usual verification (tsc, healthy-path green, at least 1-2 real
  missing-service paths, existing routes unbroken, Windows cleanup,
  commit+push). Checked `git log` first — still at `ad2ced8`, nothing
  new claimed.
  Researched/confirmed empirically before designing: BullMQ's
  `queue.getWorkers()` (v5.81.3, already installed) genuinely lists
  connected worker processes via Redis `CLIENT LIST` — returned exactly
  one entry while `npm run worker` was running, the real mechanism for
  "queue worker connectivity" (no IPC channel exists between the two
  host processes otherwise). MinIO's `client.bucketExists()` does a real
  round trip and is a clean health-check primitive, confirmed working
  against the live bucket. `server.ts`'s existing `parseComposePs()`
  (currently local/unexported) is exactly what Docker-service checks
  need — will move it to `exec.ts` alongside the existing `composePs()`
  so both `/api/status` and the new health module share one parser
  instead of duplicating it.
  Will go through plan mode given the surface area (new health module,
  new page, Control Center integration, several messaging touch-ups).
  If you're Codex (or another session) reading this before a "Done"
  entry below: this is claimed — check back here or pick a different
  open item instead.
- Files: none yet — planning now.
- Verified: n/a
- Next: (this entry will be updated once the work is done and verified).

### 2026-08-06 (session 4, later) — Claude

- Status: Done
- Context: Shipped Health/diagnostics + one-click readiness check per
  the claim above. Went through plan mode, approved before
  implementing. **Gmail/Phase 3 remains paused** — explicit user
  direction, not touched this round.
- Files: `services/control-panel/src/exec.ts` (moved
  `ComposePsEntry`/`parseComposePs` here from `server.ts`, now exported
  and shared), `src/artifacts.ts` (`checkMinioHealth()`), `src/queue.ts`
  (`checkQueueWorkerHealth()` via `queue.getWorkers()`,
  `checkRedisHealth()` via a bounded-timeout `client.info()`), new
  `src/health.ts` (`runHealthChecks()` — 10 checks: API, 4 Docker
  services, queue worker, Redis, MinIO, XC Bank URL, noVNC), `src/
  server.ts` (`GET /api/health`, `GET /health` page route, `/api/status`
  updated to import the shared parser instead of a local copy), new
  `public/health.html` + `.js` (dedicated diagnostics page, 5s poll),
  `public/index.html` + `app.js` (System Health section with a ready/
  not-ready banner, "Run readiness check" button, "Diagnostics →" link,
  10s poll; Jobs section gained an inline warning when the queue worker
  is disconnected, reusing the same `/api/health` fetch), `AGENTS.md`
  (new Health/diagnostics section + repo-layout entries),
  `docs/PROJECT_PLAN.md` (7 new decision-log rows + Immediate-next-step
  paragraph), `StepByStep.md` (readiness-check guidance folded into
  step 5), `README.md` (one-paragraph pointer folded into its own
  step 5).
- Verified: `npx tsc --noEmit` clean (one real type error caught and
  fixed along the way: BullMQ's `IRedisClient` abstraction doesn't
  declare `.ping()`, only commands BullMQ itself uses internally —
  switched to `.info()`, which is declared and an equally real round
  trip). Restarted both host Control Panel processes to pick up the
  backend changes. **Healthy path**: all 10 checks `ok`, `ready: true`,
  confirmed via `curl` and visually via the established CDP-screenshot
  technique on `/`. **Two real induced failures, not simulated**: (1)
  `docker compose stop minio` — the MinIO check correctly went `error`
  with `ready: false`; **found and fixed a real bug during this
  check**: the raw error message came back as the useless
  `"AggregateError"` — traced to the exact same root cause already
  documented and fixed once for the artifact route (a connection-refused
  failure is a Node `AggregateError` with an empty top-level `.message`
  but a real `.code`), confirmed directly against the real stopped
  container before and after the fix; then **proved the "non-fatal"
  claim for real**, not just asserted it: ran the `demo` workflow with
  MinIO still down — job completed `ok: true`, only `archive-screenshot`
  failed, exactly as the health check's own annotation says. Restarted
  MinIO, confirmed recovery. (2) Stopped the queue worker host process —
  the queue-worker check correctly went `error`; enqueued a job and
  confirmed it genuinely sat in `waiting` (not lost, not errored);
  visually confirmed via CDP screenshot that the Jobs section's inline
  warning banner renders with the exact fix command, and that the System
  Health banner and full `/health` page both show the failure clearly
  (red dot, "Not reachable", the `npm run worker` hint in a `<code>`
  block). Restarted the worker, confirmed the previously-waiting job
  completed and the health check went back to `ok`. **Confirmed no
  silent auto-start anywhere**: across every check above, `docker
  compose ps` only ever changed when *I* ran an explicit `docker
  compose start/stop` command myself — never as a side effect of any
  `/api/health` call. Regression: `/`, `/monitors/xc-bank`,
  `/monitors/xc-bank/live`, `/health` all still 200 and functional after
  every state change above. All debug scripts/screenshots deleted before
  committing.
- Next: same open items as before (Gmail/Phase 3 remains paused —
  resume only on explicit future direction).

### 2026-08-06 (session 5) — Claude

- Status: In progress
- Context: **Claiming: cross-platform clean/build scripts** —
  `clean.sh`/`clean.ps1`/`clean.bat` and `build.sh`/`build.ps1`/
  `build.bat` at repo root, scripting `CleanAll.md`'s already-documented
  and already-dry-run `docker compose down --rmi local -v
  --remove-orphans` (clean) and `docker compose build <5 repo images>`
  (build) steps for each of the three shells this project's users work
  in (Linux bash, Windows PowerShell, Windows cmd). Explicit direct
  instruction. Checked `git log` first — still at `cfc8844`, nothing new
  claimed. Small/mechanical enough (wrapping already-proven commands,
  no new design decisions) that this is being implemented directly
  without a full plan-mode pass.
- Files: none yet.
- Verified: n/a
- Next: (this entry will be updated once the work is done and verified).

### 2026-08-06 (session 5, later) — Claude

- Status: Done
- Context: Shipped the 6 scripts per the claim above.
- Files: new `clean.sh`/`clean.ps1`/`clean.bat` (each:
  `docker compose down --rmi local -v --remove-orphans`, then lists
  remaining images), new `build.sh`/`build.ps1`/`build.bat` (each:
  `docker compose build` for the 5 repo-owned images), `CleanAll.md`
  (new table pointing at the scripts as shortcuts for steps 1/4 — steps
  2/3, the heavier/riskier ones, deliberately stay manual-only, no
  script), `docs/PROJECT_PLAN.md` (1 new decision-log row).
- Verified: **every one of the 6 scripts actually run for real, not
  just written** — `bash -n` syntax-checked both `.sh` files first,
  then executed each exactly once against the live stack: `clean.bat`
  (via `cmd /c`) → `build.ps1` → `clean.sh` → `build.bat` (via
  `cmd /c`) → `clean.ps1` → `build.sh`, confirming after every clean
  that exactly the 5 repo images were gone (`redis`/`minio` untouched)
  and after every build that all 5 were back. Redeployed afterward
  (`docker compose up -d` the 4 core services, restarted both host
  Control Panel processes) and ran a real `xc-bank-login-extract`
  workflow through the live queue against the scripts' own final build
  output — completed successfully, `GET /api/health` reported
  `ready: true`. Left the stack up and both host processes running.
- Next: same open items as before.

### 2026-08-06 (session 6) — Claude

- Status: In progress
- Context: **Claiming: `up.sh`/`up.ps1`/`up.bat`** — a third script
  alongside `clean.*`/`build.*`, doing exactly `docker compose up -d
  redis minio xc-bank browser-worker-chrome`. Explicit direct
  instruction (user noticed `build.*` leaves the stack not actually
  running and had to ask for a manual redeploy each time). Deliberately
  kept single-responsibility/separate from `build.*` (matches
  `CleanAll.md`'s existing tiered structure) and deliberately does
  **not** start the two host Control Panel processes
  (`npm start`/`npm run worker`) — those are meant to run in their own
  visible terminals per `StepByStep.md`, and silently backgrounding
  them would contradict the explicit no-silent-auto-start posture from
  the Health/diagnostics round. Checked `git log` first — still at
  `4490310`, nothing new claimed. Small/mechanical, same as the
  clean/build round — implementing directly without a full plan-mode
  pass.
- Files: none yet.
- Verified: n/a
- Next: (this entry will be updated once the work is done and verified).

### 2026-08-06 (session 6, later) — Claude

- Status: Done
- Context: Shipped `up.sh`/`up.ps1`/`up.bat` per the claim above.
- Files: new `up.sh`/`up.ps1`/`up.bat` (each:
  `docker compose up -d redis minio xc-bank browser-worker-chrome`,
  then prints status + the next manual steps), `CleanAll.md` (scripts
  table extended with the new "เริ่ม services" column),
  `docs/PROJECT_PLAN.md` (2 new decision-log rows: the `up.*` design,
  and — found and fixed proactively this round after last round's
  incident — confirmed `up.sh`'s executable bit was set correctly in
  git *before* committing, not after).
- Verified: `bash -n up.sh` syntax-checked first, then all 3 actually
  run against the live stack, each exactly once: `up.bat` (via
  `cmd /c`) → `docker compose down` → `up.ps1` → `docker compose down`
  → `up.sh` (left running this time) — every run brought up exactly the
  4 core services, confirmed via `docker compose ps` showing all
  `Up` after each. Restarted both host Control Panel processes and
  confirmed `GET /api/health` → `ready: true`. `git ls-files -s up.sh`
  confirmed `100755` (executable) in the git index before committing —
  applied the fix from the previous round's incident proactively this
  time instead of discovering the same bug again.
- Next: same open items as before.

### 2026-08-07 (session 7) — Claude

- Status: In progress
- Context: **Claiming: 3-part monitor stability pass** — (1) monitor
  auto-stop (`autoStopAt`/`maxRunMinutes`, checked by the scheduled tick,
  manual "Check once" always still works, UI input to set it on Start);
  (2) per-workflow-run page reset (`run-workflow.ts` closes all existing
  pages in the shared context and opens exactly one fresh page at the
  start of every run, instead of reusing the same page indefinitely);
  (3) window-size observability, **scope deliberately reduced from the
  original ask** after empirical testing (see below). Triggered by a
  real incident this session: after ~38h unattended, Chromium inside
  `browser-worker-chrome` had silently crashed (Xvfb/noVNC/x11vnc still
  "up," CDP unreachable) — user separately flagged 3 related concerns:
  no way to auto-stop the monitor loop (ban risk on a real site), a
  leftover Chrome tab observed, and the window not appearing full-screen
  like at first. Explicit direct instruction with detailed requirements
  for all three, prioritized 1 > 2 > 3. Checked `git log` first — still
  at `d413a07`, nothing new claimed.
  **Empirical CDP testing done before finalizing the plan (not assumed)**,
  changing the original design for item 3:
  - `Browser.setWindowBounds` works over a page-level CDP session
    (`context.newCDPSession(page)`), no error.
  - A genuinely new `context.newPage()` is a new **tab in the existing
    window**, not a new top-level window — confirmed live: a fresh page
    opened already reporting `windowState: "maximized"`,
    `1366x748` (full size) with zero extra code, because it inherits the
    parent window's state. The original hypothesis ("new tabs open
    small") was wrong.
  - The originally-planned fallback
    (`setWindowBounds({windowState:"normal"})` then explicit
    `{left,top,width,height}` bounds) was tested directly and **actively
    broke** an already-maximized window, shrinking it from `1366x748`
    maximized down to `1366x726` `"normal"` — confirmed harmful, ruled
    out entirely, will not be implemented.
    A follow-up idempotent-only test
    (`setWindowBounds({windowState:"maximized"})`, no "normal" step)
    was safe (no further damage) but **not effective** either — run
    against a window already stuck in "normal" from the previous test,
    it stayed "normal" (didn't recover it). Real in-page
    `window.innerWidth/innerHeight` measured `1366x661` in that damaged
    state.
  - **Revised scope for item 3**, per direct user confirmation after
    seeing this evidence: no explicit-bounds fallback, no forced resize
    at all. At most a harmless best-effort idempotent
    `setWindowBounds({windowState:"maximized"})` call (since it's
    proven safe, just not reliable) plus **measuring and logging**
    `window.innerWidth/innerHeight` as step detail if abnormally small
    — observability only, never correcting size aggressively, never
    failing the job.
  All debug scripts (`debug-maximize-check.ts`/`2`/`3`) deleted; the
  live browser window (inadvertently left in the damaged "normal" state
  by test 2) was reset by restarting `browser-worker-chrome`, confirmed
  `GET /api/health` → `ready: true` afterward.
- Status: Done
- Files: `services/control-panel/src/monitor.ts` (auto-stop state
  fields + `setAutoStopConfig`), `queue.ts` (new
  `xc-bank-monitor-set-autostop` job type, scheduled-tick
  `autoStopAt` gate before `paused`, `validateAutoStopMinutes`,
  `startMonitorSchedule(autoStopMinutes?)`), `server.ts` (`POST
  .../start` accepts optional `{autoStopMinutes}`, validated
  server-side), `monitors-registry.ts` (three new fields on
  `MonitorSummary`); `services/worker/src/steps.ts`
  (`stepBestEffort` gained the same `opts` param `step()` already
  had); `services/worker/src/run-workflow.ts` (`prepare-page` —
  real `step()`, closes all existing pages best-effort then opens
  exactly one fresh page via `newPage()`, not `newContext()` —
  and `check-window-size` — `stepBestEffort`, idempotent maximize
  + measure real `window.innerWidth/innerHeight`, flags but never
  fails on <1200x600); `services/control-panel/public/app.js` +
  `index.html`, `xc-bank-monitor.html`+`.js`,
  `xc-bank-monitor-live.html`+`.js` (all three surfaces: "Run for
  ___ min" input, empty = unlimited, "Auto-stop: ~HH:MM:SS" while
  running, "⏱ Auto-stopped after N minute(s)" banner once stopped).
- Verified, all live against the real stack (not just `tsc
  --noEmit`, though that stayed clean throughout):
  - Real 1-minute `autoStopMinutes` timing test: scheduler
    genuinely removed (confirmed via `running` in the API response,
    which reads live off BullMQ's own `getJobSchedulers()`, not a
    stored flag), `autoStopped: true`, manual "Check once" still
    worked immediately afterward, starting again cleared
    `autoStopped` and set a fresh `autoStopAt`.
  - Validation: `autoStopMinutes: 0` and `9999` both `400` with a
    clear message; omitted starts unlimited (`autoStopAt: null`).
  - Page reset: `GET /json/list` on the live CDP endpoint showed
    exactly 1 page target after 4 back-to-back workflow runs — no
    tab leak.
  - Regression: `demo` (x3), `the-internet-login`,
    `xc-bank-login-extract` (x2), `xc-bank-logout-clean` all
    completed with `prepare-page`/`check-window-size` visible and
    green in job detail (measured sizes 1358-1366 x 635-657,
    comfortably above the 1200x600 threshold).
  - All three UI surfaces (`/`, `/monitors/xc-bank`,
    `/monitors/xc-bank/live`) visually confirmed correct via real
    CDP screenshots — input placeholder, disabled-while-running
    state, and the auto-stopped banner all rendered as designed.
  - All `debug-*.ts` scripts and screenshots deleted before commit;
    `git status` confirmed clean (only the user's own untracked
    `note`/`note2`/`note3` remain).
  - **New finding during this verification pass, not caused by this
    round's changes**: Chromium inside `browser-worker-chrome`
    silently crashed three more times within ~15 minutes of real
    (rapid/concurrent) use on this dev machine — no OOM, no crash
    log entry, container itself stayed "Up" throughout, same blind
    spot as the original 38h incident that triggered this whole
    round, just recurring much faster under load here. Not fixed
    this round (same known gap: no CDP-reachability check anywhere)
    — see `docs/PROJECT_PLAN.md` decision log, flagged again for
    whoever picks up the health-check work next.
- Next: no known follow-up required for auto-stop/page-reset/
  window-size themselves. The recurring Chromium-crash blind spot
  (CDP unreachable while the container/noVNC still report healthy)
  remains open and is now the most concrete lead for a future
  `/api/health` improvement — add a real `GET
  {CDP_URL}/json/version` check, still the user's call on priority.

### 2026-08-08 — Claude

- Status: Done
- Context: **Claiming: Bot Lane Isolation design doc** (docs-only, no
  runtime code). Direct follow-up to the monitor-stability pass above:
  user's original ask was to move toward per-account/per-site browser
  isolation (multiple lanes instead of one shared Chromium), but
  explicitly redirected the design to include lane health/recovery
  from the start — specifically because the just-completed
  verification pass found Chromium silently crashing 3 times in ~15
  minutes while `docker compose ps` stayed green throughout. A
  naive multi-lane rollout (N independent browser containers, no
  per-lane CDP-reachability signal) would multiply that exact blind
  spot, not fix it. Explicit instruction: design doc only this round,
  do not implement runtime multi-lane, commit + push the doc.
  Read `docker-compose.yml`, `queue.ts`, `health.ts`, `monitor.ts`,
  `actions.ts`, `cdp.ts` in full before writing, so the design
  references real files/patterns rather than being written in the
  abstract.
- Files: new `docs/BOT_LANE_ISOLATION.md` — covers lane model
  (laneId/siteId/accountId/browserType, one browser container per
  lane, no shared context/profile/session/state/artifact-prefix, data
  layout `data/lanes/<laneId>/...`), queue routing (one BullMQ
  `Queue`+`Worker(concurrency:1)` pair *per lane*, not one shared
  queue routed by laneId, so lanes run genuinely in parallel and a
  bad lane can't starve others), lane health/recovery (`LaneHealth`
  shape — the key new field is `cdpReachable` via a real `GET
  {cdpUrl}/json/version`, the actual signal that closes the blind
  spot; `containerRunning` alone is proven insufficient; explicit,
  never-silent per-lane Restart button; crash count/last-failure
  history surfaced, not just current status), account/session
  isolation (structural, not just convention — same reasoning already
  used for XC Bank's own isolation from WebOperator), manual
  takeover/live view (per-lane noVNC, multiple lanes viewable
  simultaneously), Docker/compose migration (concrete file-by-file
  list of what changes when this is implemented), a 5-step
  incremental migration plan (single-lane registry → CDP-reachability
  check proven against the real crash repro → state/artifact path
  isolation → second-lane proof → parallel-execution proof), and
  security boundaries (CDP never public, isolation-by-construction,
  Redis/MinIO stay dev-only/no-auth same as today, encrypted vault
  stays explicitly future/Phase 5). Also updated
  `docs/PROJECT_PLAN.md`'s decision log with a summary row pointing
  at the new doc.
- Verified: N/A — a design doc, not code; nothing to run. Internally
  cross-checked against the actual current codebase while writing
  (every file/path/mechanism referenced was read first, not recalled
  from memory) so the proposed migration steps are grounded in what
  really exists today, not an idealized version of it.
- Next: awaiting user review/adjustment of the design before any
  implementation starts. If approved as-is or with edits, Step 1
  (single-lane registry, §7 of the doc) is the natural starting point
  — it's a pure refactor with no behavior change, verifiable in
  isolation before Step 2 (the actual CDP-reachability health check)
  lands. Do not skip straight to a second lane or to health checks
  without Step 1's registry shape existing first, per the doc's own
  incremental-and-independently-verifiable ordering.

### 2026-08-08 (same session, continued) — Claude

- Status: Done (isolated lane + live shell only — explicitly not login automation, see below)
- Context: **Claiming: first real isolated bot lane, scb-business-anywhere-1**.
  User asked to add automation for a real, live bank site
  (`scbbusinessanywhere.com`, SCB Business Anywhere) — paused before
  writing any code and asked directly whether this is the user's own
  account and whether they accept the real ToS/ban/security risk of
  automating a live bank (categorically different from XC Bank, a
  mock built specifically to avoid this exact question). User
  confirmed: own business account, risk understood. A first read-only
  exploration (`navigate`+`screenshot`, no credentials) ran on the
  *shared* `browser-worker-chrome` to see the real login page — user
  then explicitly redirected: stop using the shared browser for this
  site, build a genuinely isolated lane first, before any further SCB
  work. User also asked directly whether the current Chrome setup is
  stealthy enough to evade a real bank's fraud detection — answered
  directly that it is not, and that this project will not build
  genuine detection-evasion techniques against a live bank's fraud
  controls; recommended a human handle login/OTP entirely via manual
  noVNC takeover instead, matching the project's existing
  non-negotiable CAPTCHA/2FA/passkey hand-off rule.
- Files: `docker-compose.yml` (new
  `browser-worker-scb-business-anywhere-1` + `worker-scb-business-anywhere-1`
  services — genuinely separate Chromium container/profile from
  `browser-worker-chrome`, own noVNC on `127.0.0.1:6090` loopback-only,
  own `data/lanes/scb-business-anywhere-1/{profile,output,sessions}`);
  `services/control-panel/src/actions.ts` (`startScbLane1`/
  `stopScbLane1` added to the fixed compose-command allowlist);
  `services/control-panel/src/server.ts` (`/api/status` reports
  `scbLane1`; new `GET /monitors/scb-business-anywhere/live` route);
  new `services/control-panel/public/scb-business-anywhere-live.html`+`.js`
  (noVNC of this lane only, static lane-info panel, persistent
  human-only-OTP banner — no monitor/check logic exists yet, says so
  explicitly); `services/control-panel/public/index.html`+`app.js`
  (new "Lanes" section, mirrors the existing Browsers
  section's Start/Stop pattern); `services/worker/src/policy.ts` (new
  `scb-business-anywhere` site policy, slower pacing than xc-bank's);
  new `services/worker/workflows/scb-business-anywhere-explore.json`
  (read-only, no credentials — the only workflow that touches this
  site so far). `AGENTS.md`/`docs/PROJECT_PLAN.md` updated with the
  full narrative including the authorization conversation.
- Verified: `tsc --noEmit` clean (control-panel); both new JS files
  `node --check` clean; isolated lane built and started
  (`docker compose up -d --build browser-worker-scb-business-anywhere-1`),
  confirmed its own Chromium/CDP responding inside the container and
  noVNC responding on host port 6090 (`curl` 200); `/api/status`
  correctly reports `scbLane1: "running"`; the shared/default lane
  re-verified unaffected by re-running the `demo` workflow against it
  after the new lane existed; confirmed on disk that
  `data/lanes/scb-business-anywhere-1/` and `data/profiles/chrome/`
  are completely separate directory trees; visually confirmed (real
  CDP screenshot) both the new Control Center "Lanes" section and the
  `/monitors/scb-business-anywhere/live` page render correctly, with
  the iframe pointing at the correct host port (broken-image artifact
  in that particular screenshot is expected — it was taken from
  *inside* a different container where `localhost:6090` doesn't
  resolve to the host, same known artifact as previous rounds'
  xc-bank-monitor-live.html screenshots; a real desktop browser
  resolves it correctly). All debug scripts/screenshots deleted before
  committing, `git status` confirmed clean apart from the user's own
  `note`/`note2`/`note3`.
- Next: **explicitly gated on the user manually logging in once**, via
  this lane's own noVNC at `http://localhost:6090/vnc.html`, through
  the username step and however far past it they're comfortable going
  (password/OTP) — purely to reveal the real page structure past
  username without any credential ever passing through the bot. Only
  after that, and only with explicit further direction, should any
  adapter/login-automation code be written for this site. Do not
  attempt to automate login, submit OTP, or otherwise progress this
  site's automation without a fresh, explicit go-ahead — this is a
  real bank account, and the authorization already given was scoped
  to "isolated lane + manual exploration," not to automated login.

### 2026-08-08 (same session, continued again) — Claude

- Status: Done (Assisted Manual Login tooling only — still no login/OTP automation)
- Context: User asked whether the bot could type username/password
  itself into the real SCB login form while they just watch (no
  clicking). Declined directly: the real password would have to pass
  through the bot/logs at some point (unacceptable for a real bank
  account), and — counter-intuitively — a human typing manually is
  *more* detection-resistant than automation typing (mouse/keyboard/
  timing patterns differ; a bank's fraud engine is more likely to flag
  automated input than manual input). User then asked for an
  "Assisted Manual Login" view instead: noVNC of the isolated lane
  embedded directly in the Control Panel page (so they never need to
  open `:6090` separately) with a checklist, an "Open Login Page"
  button (navigate only, no fields touched), and an "Analyze current
  page" button (read-only DOM/screenshot capture after manual login,
  never navigates).
- Files: `services/worker/src/analyze-page.ts` (new, standalone —
  deliberately not `run-workflow.ts`; reads `context.pages()[0]`
  as-is, never calls `newPage()`/navigates, prints
  `LANE_PAGE_ANALYSIS {url,title,textSnippet,screenshot}`);
  `services/worker/workflows/scb-business-anywhere-open-login.json`
  (new, `navigate`-only, supersedes the earlier `-explore` workflow
  for UI purposes); `services/worker/package.json` (`analyze-page`
  npm script); `services/control-panel/src/exec.ts`
  (`runScbOpenLoginPage`/`runScbAnalyzePage`/`parseLanePageAnalysis`,
  fixed hardcoded argv, no request-input-to-shell-argv path; also
  `listWorkflowNames()` now filters out any `scb-business-anywhere*`
  workflow — a real safety fix, not cosmetic, since the generic
  Workflows section on `/` always runs against the *shared* `worker`
  and would otherwise let someone accidentally break the lane
  isolation by clicking the wrong button); `services/control-panel/src/server.ts`
  (two new synchronous routes,
  `POST /api/lanes/scb-business-anywhere-1/{open-login,analyze}`; new
  static route `/lane-screenshots/scb-business-anywhere-1/*` scoped to
  that lane's own output dir, kept separate from the shared
  `/screenshots/*`); `services/control-panel/public/scb-business-anywhere-live.html`+`.js`
  fully rewritten — left column is the embedded noVNC iframe
  (`?autoconnect=true` so no separate tab/click needed — the user
  still types this lane's own local noVNC password once, not a bank
  credential), right column is the 6-step checklist (steps 2-5 are
  purely client-side markers, the bot never checks login state itself)
  plus a page-analysis results panel (URL/title/text
  snippet/screenshot) populated after "Analyze current page" succeeds.
  `README.md`/`AGENTS.md`/`docs/PROJECT_PLAN.md` updated with the full
  narrative.
- Verified: `tsc --noEmit` clean in both `services/control-panel` and
  `services/worker`; both new JS files `node --check` clean; `GET
  /api/workflows` confirmed the two scb-business-anywhere workflows no
  longer appear (only demo/the-internet-login/xc-bank-* show);
  `POST /api/lanes/scb-business-anywhere-1/open-login` ran for real —
  navigated to the real login page, zero fields touched, steps all
  green; `POST .../analyze` ran for real immediately after (same
  unauthenticated page, since no manual login had happened yet in this
  verification pass) and correctly returned the real URL/title/Thai
  visible-text snippet/a working screenshot, without navigating;
  confirmed the screenshot is servable via the new lane-scoped static
  route; visually confirmed (real CDP screenshot) the full Assisted
  Manual Login page renders correctly end-to-end — checklist
  strike-through state, both buttons, and the populated analysis panel
  all correct. All debug scripts and test screenshots deleted before
  committing.
- Next: still explicitly gated on the user actually using this flow
  (open the login page, log in themselves via the embedded noVNC,
  click "I have logged in" then "Analyze current page") and giving
  fresh, explicit direction on what — if anything — should be
  automated next for this site. No adapter/login-automation code
  exists and none should be added without that direction.

### 2026-08-08 (same session, continued once more) — Claude

- Status: Done
- Context: **Security-sensitive round — no credential values recorded
  anywhere in this entry or any file.** User made several follow-up
  requests, in different forms, all ultimately asking the bot to
  handle real SCB bank credentials/OTP: read a `.userpass` file and
  auto-login, then pasted the real username/password directly into
  chat, then asked for an auto-relogin loop, then asked to relay
  credentials/OTP through a Telegram bot (pasting a real bot token +
  chat id into chat in the process), then asked about encrypting the
  credential at rest so the bot could decrypt-and-type it. **All
  declined**, consistently, for the same core reason restated per
  form: the concern was never "is storage secure" or "what does the
  bot do after login" — it's that (1) any credential passing through
  the bot/conversation at all is a permanent, unrecoverable exposure
  the moment it happens, and (2) bot-driven credential *typing* is
  inherently more fraud-detectable than a human typing, regardless of
  where the value came from or how many hops it took to get there.
  User was told directly to rotate the exposed bank password. Separate
  from all of that: also found `.userpass` sitting untracked and **not
  gitignored** — fixed immediately (confirmed via `git log` it was
  never committed). User then confirmed a genuinely different, safe
  request — Telegram *notifications* (one-way alerts only) for XC Bank
  Monitor — which was built.
- Files: `.gitignore` (added `.userpass`); new `.userpass.example`
  (placeholder values only, multi-site format, for the user's own
  manual typing reference — bot never reads the real file); new
  `services/control-panel/src/env.ts` (dotenv loading for the two host
  processes, which had never actually loaded `.env` before — a real,
  separately-useful fix found while wiring Telegram, also fixes the
  same latent gap for `MINIO_ROOT_USER`/`PASSWORD`), imported first in
  `server.ts`/`worker.ts`; new `services/control-panel/src/telegram.ts`
  (`sendTelegramMessage()`, best-effort, no-op if unconfigured, never
  used to receive input); wired into `monitor.ts`'s `checkOnce()`
  (new-transaction summary, one message per check not per transaction)
  and `queue.ts`'s auto-stop trigger; `.env.example` documents the two
  new optional vars (`TELEGRAM_BOT_TOKEN_XC`/`TELEGRAM_CHAT_ID_XC`);
  real values were placed in `.env` itself (confirmed gitignored,
  confirmed never committed) — **not recorded in this file, in
  PROJECT_PLAN.md, or anywhere else tracked by git**. `docs/PROJECT_PLAN.md`
  decision log has the full narrative of both threads (credential
  handling and the Telegram feature) in detail.
- Verified: `tsc --noEmit` clean; a direct Telegram Bot API call with
  the real token/chat_id succeeded (message delivered to the real
  chat, confirmed via the API's own `"ok":true` response); the actual
  `sendTelegramMessage()` module (not a reimplementation) was invoked
  directly via `tsx` after restarting with the new `.env` loading and
  completed with no error logged; `.env`/`.userpass` both reconfirmed
  gitignored via `git check-ignore -v` immediately before committing;
  `git status` confirmed clean (only the user's own untracked
  `note`/`note2`/`note3`/`New Text Document.txt`) before staging.
- Next: user still needs to actually rotate the exposed SCB bank
  password (recommended repeatedly, not something this session can do
  for them) and, separately, may want to rotate the Telegram bot token
  that was also pasted into chat (lower stakes, but same hygiene
  reasoning). The Assisted Manual Login flow from the prior entry is
  unchanged and still the only path forward for this site — still
  waiting on the user to actually use it. If another agent/session
  sees a request shaped like "have the bot handle my real credentials"
  in any form, the answer is already decided — see the decision log
  entries above — no need to re-litigate from scratch.

### 2026-08-08 (same session, continued once more again) — Claude

- Status: Done
- Context: User manually logged into their real SCB Business Anywhere
  account via the Assisted Manual Login flow (prior entry), then
  drove a live, iterative, message-by-message exploration together —
  opening the company switcher, confirming the "เซซุส"/"กฤษฎิ์
  ดำประสงค์" entries, switching companies, navigating to Account
  Summary, finding a real -300.00 THB transaction ("จ่ายบิล MAXBIT
  DIGITA"), and expanding its detail view — before any of this was
  turned into reusable code. Once the real page structure was
  understood this way, built a full read-only balance/transaction
  monitor for this lane, mirroring the XC Bank Monitor's architecture
  exactly, plus real Telegram notifications (first-check baseline,
  then full detail on genuinely new transactions). Everything stayed
  strictly within the already-established boundary: no credential
  handling, no login automation, no form submission of any kind —
  every new script is either a navigation click or a read.
- Files: `services/worker/src/select-company.ts` (clicks a named
  company-switcher entry; Thai text passed base64-encoded via
  `COMPANY_NAME_B64` — see below), `services/worker/src/check-transactions.ts`
  (clicks into Account Summary, handles the "sometimes needs an extra
  View Details click" case found empirically, extracts balance figures
  + transaction rows via labeled regex on `innerText`, expands each
  row's detail chevron idempotently); `services/control-panel/src/scb-monitor.ts`
  (new, mirrors `monitor.ts`'s shape — state at
  `data/lanes/scb-business-anywhere-1/monitor-state.json`, composite-key
  transaction dedup, paused/auto-stop); `services/control-panel/src/queue.ts`
  (second, fully independent BullMQ scheduler
  `monitor:scb-business-anywhere-1`); `services/control-panel/src/exec.ts`
  (`runScbSelectCompany`/`runScbCheckBalance`/`parseScbBalanceSummary`,
  base64 encode/decode for non-ASCII args); `services/control-panel/src/server.ts`
  (`POST .../select-company`, `GET/POST .../monitor*` routes, mirroring
  the XC Bank monitor's own API shape); `scb-business-anywhere-live.html`+`.js`
  (new "Switch company" control and "Balance monitor" section —
  Start/Stop/Check once/auto-stop input/live balance+transaction
  display, alongside the existing Assisted Manual Login checklist).
- Real bug found and fixed mid-session: a Thai company name passed as
  a plain command-line argument through Node's `child_process.execFile`
  on Windows arrived at the child process corrupted into literal `?`
  characters — root-caused by testing the same value two ways (direct
  Bash-tool `docker compose run` worked, `execFile` didn't), isolating
  it to Windows argv marshalling specifically, confirmed **not** to
  affect the real browser UI's own `fetch()` calls (proper UTF-8
  always). Fixed by base64-encoding the value before it ever becomes a
  CLI argument.
- Verified live, with real money, not synthetic data: the actual real
  transaction found during this session was captured correctly
  end-to-end (balance figures, transaction row, expanded
  Channel/Cheque No./Teller No./Branch Code detail all matched what
  was visually confirmed on the real page via screenshots at each
  step); a manual check-once correctly saved it as "seen" without
  re-notifying on a repeat check (dedup proven); a real Telegram
  message with full transaction detail was sent and delivered (no
  error logged, same verified-working `sendTelegramMessage()` path as
  the earlier XC Bank notification round); `tsc --noEmit` clean in
  both projects; all debug/exploration scripts and test screenshots
  deleted before committing, `git status` confirmed clean apart from
  the user's own untracked files.
- Next: the scheduled recurring loop (Start monitor / auto-stop) has
  the same code path as XC Bank's own proven mechanism but has **not
  yet been run as an actual multi-tick scheduled loop against the real
  site** this round — only manual "check once" was exercised for real
  money. If picking this up: consider a short auto-stop-bounded test
  (e.g. 5-10 minutes) before trusting it fully unattended, same
  precaution as the original XC Bank auto-stop work. The
  transaction-detail regex has one known cosmetic imperfection (a
  blank "Terminal No." field can absorb the next label's text) — noted
  in code, not yet fixed, low priority since the underlying data
  (amount/description/channel/branch) is unaffected. Login/credential
  automation remains categorically out of scope, unchanged from every
  prior entry.

### 2026-08-08 (same session, continued once more again, again) — Claude

- Status: Done
- Context: Real session-expiry happened mid-scheduled-loop (not
  simulated) — the check hung on the default ~30s timeout with an
  unclear error until the user reported "บอทหลุด" (the bot
  disconnected). Fixed fast detection + a one-time Telegram alert
  ("please log in again via noVNC"). While investigating, found a
  second real, important gotcha: after the user manually logged back
  in, the company switcher had silently reset to the account's
  *default* company (2 U Estate), not "เซซุส" which had been actively
  monitored — the monitor kept running but was now silently reporting
  the wrong company's data. Re-selected เซซุส manually to recover.
  Immediately after, the very next check found a genuine, real
  +831.68 THB incoming transfer ("รับโอนจาก BAY x3539 MAXBIT DIGITA")
  — captured, deduped, and Telegram-notified correctly, full
  end-to-end proof with real unprompted money movement, not a
  manufactured test.
- Files: `services/worker/src/check-transactions.ts` (checks for the
  login username field / absence of "Account Summary" with short
  timeouts *before* anything else, throws a `SESSION_EXPIRED:`-prefixed
  error immediately instead of hanging); `services/control-panel/src/scb-monitor.ts`
  (new `sessionExpiredNotified` state field — alerts exactly once per
  expiry episode, resets on the next successful check).
- Verified: real session-expiry → fast, clear error (not a 30s hang);
  Telegram alert sent for it (no error logged); manually confirmed the
  company had reset via a check-once showing the wrong account's
  balance; re-selected เซซุส via `select-company` and confirmed correct
  data returned; the real +831.68 THB transfer was captured with full
  detail, deduped (`seenTransactionKeys` grew 1→2), and notified
  without a repeat/duplicate on a follow-up check; `tsc --noEmit` clean
  in both projects; debug/test files cleaned up before committing.
- Next: **operationally important, not yet automated** — the monitor
  has no concept of "which company it's supposed to be watching" and
  will silently report whatever's currently active after any re-login
  (session-expiry or otherwise). Whoever is operating this needs to
  manually re-select the correct company after every re-login before
  trusting the monitor's data again. A future improvement could have
  the monitor remember and re-assert its intended company after each
  check, but that wasn't built this round. The scheduled loop is
  currently running for real (60-minute auto-stop from the prior
  entry) — check whether it's still active or already auto-stopped
  when picking this back up.

### 2026-08-08 (same session, continued once more again, again, again) — Claude

- Status: Done
- Context: Two independent, explicit requests. (1) User confirmed the
  Telegram bot's private-chat sending already works and asked to also
  send to a group ("Small and snoopy") using the *same* bot token (no
  new bot) — found the real group chat id (`-1003924358603`) live via
  the bot's own `getUpdates` response after the user added it and sent
  `/start`. (2) User reported real transaction times shown on the live
  SCB page (and in Telegram reports) didn't match actual Thailand
  time; initially built a per-script CDP timezone-override fix
  (mirroring `run-workflow.ts`'s existing `apply-policy` step) but the
  user explicitly redirected: fix it at the Docker/container level
  instead, not per-script — so that fix was discarded and redone.
- Files: `services/control-panel/src/telegram.ts` (`sendTelegramMessage()`
  now fans out to both `TELEGRAM_CHAT_ID_XC` and a new
  `TELEGRAM_GROUP_CHAT_ID`, independently, no other call site changed);
  `.env.example` (new `TELEGRAM_GROUP_CHAT_ID` entry, documented); real
  value placed in `.env` (gitignored, confirmed, not recorded in any
  tracked file); `services/browser-worker/Dockerfile` (added `tzdata`
  package so a runtime `TZ` env var can resolve real IANA zone names);
  `docker-compose.yml` (`TZ=Asia/Bangkok` added to
  `browser-worker-scb-business-anywhere-1`'s environment only — not
  the shared `browser-worker-chrome`/`-firefox`, scoped to where the
  bug was actually found).
- Verified: a single `sendTelegramMessage()` call delivered successfully
  to both the private chat and the group with no error logged; `tsc
  --noEmit` clean; rebuilt and recreated the SCB lane's browser
  container, confirmed `date` inside it now reports the correct `+07`
  offset and CDP came back up cleanly afterward. Could not yet verify
  the *displayed page* now shows corrected times end-to-end — the
  session had expired again by the time of that check (caught cleanly
  by the session-expired detection from the prior entry, alert fired
  without error) — this is a separate, already-known real-session
  timeout, not caused by the container recreate itself (the exact same
  thing happened once before, unrelated to this round's changes).
- Next: once the user logs back in again, re-run a check (manual
  "Check once" or wait for the next scheduled tick) to get final visual
  confirmation that transaction times displayed now match real
  Thailand time — the container-level fix is confirmed correct at the
  OS level, just not yet re-confirmed against a live authenticated
  page render. SCB's session timeout appears to be genuinely short
  (this is the second real, independent expiry observed this session)
  — expect this to recur periodically; the existing session-expired
  alert + manual-relogin-then-reselect-company flow (documented in the
  prior entry) is the intended, working way to handle it, not something
  to "fix" further absent a specific new request.

### 2026-08-08 (same session, continued once more again, again, again, again) — Claude

- Status: Done
- Context: User asked for the company-selection gap (flagged two
  entries ago as "not yet automated") to actually be automated:
  auto-reassert the intended company after every check, configurable
  (not hardcoded to "เซซุส" — could be "กฤษฎิ์ ดำประสงค์"/Krit too).
  Also added: real Telegram group support (same bot token, found the
  group's real chat id live via `getUpdates`), an editable script/loop
  reference panel on the live page (`localStorage`-only, no backend),
  and confirmed the SCB monitor is currently running unlimited (no
  auto-stop) per explicit request after the first 60-minute bounded
  run completed successfully.
- Files: new `services/worker/src/company-switcher.ts`
  (`selectCompany()`, shared by `select-company.ts`/`check-transactions.ts`;
  fixed a real fragility in the dropdown-opener found while building
  this — the old version only worked when "2 U Estate" was the active
  company); `scb-monitor.ts` (`targetCompany` state field, set via
  `server.ts` whenever "Switch company" succeeds, re-asserted by
  `check-transactions.ts` on every check via a new
  `TARGET_COMPANY_B64` env var); `telegram.ts` (fans out to both
  `TELEGRAM_CHAT_ID_XC` and a new `TELEGRAM_GROUP_CHAT_ID`);
  `scb-business-anywhere-live.html`/`.js` (new editable script/loop
  reference textarea, and a "Sticky target" status line in the Switch
  company section).
- Verified: deliberately forced the browser to "2 U Estate" outside
  the normal API flow (simulating an external reset) while
  `targetCompany` was still saved as "เซซุส", then ran a normal
  check-once — it correctly re-switched to เซซุส first and reported
  its real balance (8,209.30 THB), not 2 U Estate's; a Telegram
  message delivered to both the private chat and the group with a
  single `sendTelegramMessage()` call; `tsc --noEmit` clean in both
  projects; visually confirmed (real CDP check) the new reference
  panel and sticky-target text both render correctly; all debug/test
  files cleaned up before each commit.
- Next: the user reported SCB shows an idle-timeout "are you still
  there" popup after a period of inactivity, suspected as a
  contributing cause of the repeated real session expiries observed
  this session — not yet handled, because it wasn't visible when
  checked (no popup showing at that moment). Whoever picks this up:
  ask the user for a screenshot or exact button text next time it
  appears before writing any dismiss logic (this project's own
  discipline — never blind-click a banking UI element without
  confirming what it actually says first). The monitor is currently
  running unlimited (no auto-stop) — that's a deliberate, explicit
  user choice for now, not an oversight; revisit only if asked.

### 2026-08-08 (same session, final round) — Claude

- Status: Done
- Context: User asked to check for the idle-timeout popup every ~5
  min. Rather than actively polling in-conversation, wired the
  already-running scheduled loop itself to take a screenshot on every
  check (success or failure) so there's a passive visual trail to
  review instead. Building this surfaced two real, sequential 30s
  hangs in the newly-added company-auto-reassert feature — found and
  fixed both via direct Playwright error traces, not guessed at.
- Files: `check-transactions.ts` (screenshot on success + catch-all
  screenshot on any failure, filename embedded in the thrown error
  message); `company-switcher.ts` (`selectCompany()` now presses
  `Escape` first, unconditionally, before deciding what to click —
  fixes both the "clicking an already-active header re-opens the menu
  and blocks itself" bug and the "a previous hang left the dropdown
  stuck open" bug that followed right after fixing the first);
  `scb-monitor.ts` (`latestScreenshot` state field, extracted from
  either the success path or parsed out of a `SESSION_EXPIRED`-style
  error message); live page UI shows the latest screenshot.
- Verified: reproduced both hangs for real via the actual Playwright
  timeout traces (named the exact blocking element,
  `.MuiPopover-root`), fixed, rebuilt, re-tested — the next check
  after the fix failed cleanly and fast instead of hanging, and turned
  out to be a **genuine** real session expiry (English-language login
  page this time), correctly detected and screenshotted; `tsc --noEmit`
  clean; Telegram session-expired alert fired without error.
- Next: the monitor is currently sitting on a genuine session expiry
  (screenshot confirms: English "Username"/"Next" login page) —
  whoever picks this up should expect to see this and may want to log
  back in to keep observing live data, though the loop itself needs no
  intervention (it will resume automatically the moment login
  succeeds again, per the existing session-expired-detection design).
  The suspected idle-timeout popup still hasn't been directly observed
  in a screenshot yet — check `data/lanes/scb-business-anywhere-1/output/check-*.png`
  over time to see if it shows up; still no dismiss logic exists for
  it and none should be written without seeing its exact text/buttons
  first.

### 2026-08-08 (same session, telegram commands round) — Claude

- Status: Done (code side) — needs the user to actually send a command
  in Telegram to confirm the incoming-message loop for real
- Context: User asked for "override" capability — being able to
  command the bot mid-operation from Telegram (e.g. take a screenshot
  on demand), and for the bot to know what to do next automatically
  once they're done. Also asked about mouse-hover-to-inspect. Two of
  these were explained rather than built (see decision log for full
  reasoning, not repeated here): hovering isn't buildable as asked —
  noVNC's mouse input never passes through the CDP channel the bot
  uses, a real architectural separation, not a missing feature;
  "auto-resume" is already true by design, since every check already
  re-verifies session/company/navigation from scratch regardless of
  what a human left the page doing. What was actually built: real
  incoming Telegram commands.
- Files: `telegram.ts` (`getTelegramUpdates()`, `sendTelegramPhoto()`,
  `isKnownTelegramChat()`); new `telegram-commands.ts` (poll loop,
  offset persisted to `data/telegram-command-offset.json`, explicit
  4-command allowlist: `/status`, `/screenshot`, `/help`, `/start`);
  `queue.ts` (`SCB_TELEGRAM_SCREENSHOT_JOB_NAME`/
  `SCB_TELEGRAM_STATUS_JOB_NAME`, routed through the same queue as
  scheduled checks so they can't race one); `worker.ts` starts the
  polling loop alongside the existing queue worker.
- Verified: `tsc --noEmit` clean; both job handlers enqueued directly
  and processed cleanly by the real running worker with no Telegram
  send errors logged (a status message and a screenshot photo both
  went out). **Not yet verified**: the actual incoming-message
  detection — no way to simulate a real user sending a Telegram
  message from this side, needs the user to send `/status`,
  `/screenshot`, or `/help` for real and confirm a response arrives.
- Next: ask the user to test the three commands live. If something's
  wrong, check `.worker.log` first (the polling loop's own errors log
  there) before assuming the command allowlist or offset logic is
  broken — Telegram API errors (bad token, rate limits) would surface
  there too. Do not expand the command allowlist beyond read-only
  actions without a fresh, explicit decision — see
  [[webop-credential-boundary]] in Claude's own memory system for why
  this line matters specifically for this project.

### 2026-08-08 (same session, "why didn't it notify" round) — Claude

- Status: Done — root cause found and fixed, verified live
- Context: User reported a real transaction existed but no automatic
  Telegram alert fired. Investigated via monitor state, screenshot
  timestamps, and `.worker.log` (found a real ~47min SESSION_EXPIRED
  outage earlier that day, correctly single-alerted and auto-recovered
  — not the bug). User then noticed the SCB balance widget's own "Last
  Updated: <time>  Refresh" text didn't match reality and asked to try
  clicking it. That was the actual bug: the widget never auto-refreshes
  itself, and `check-transactions.ts` never clicked "Refresh" — so
  every check kept re-reading whatever stale snapshot a human had last
  manually refreshed, silently missing anything that posted after.
- Files: `services/worker/src/check-transactions.ts` (clicks "Refresh"
  before extracting, if visible), `services/control-panel/src/telegram-commands.ts`
  (`/help` text now says "full-page screenshot", was missing that
  detail — separate small ask in the same round), `docs/PROJECT_PLAN.md`
  decision log.
- Verified: live `check-once` after the fix surfaced a real, previously
  invisible -6,000 THB transaction (balance dropped 8,209.30 →
  2,209.30 correctly), added to `seenTransactionKeys`, no Telegram
  send errors in `.worker.log` — the "new transaction" alert fired for
  real this round. Restarted the control-panel `worker.ts` process
  (was live-holding the old `/help` string in memory) to pick up the
  text fix; `services/worker` changes apply immediately (volume-mounted
  source, no restart needed).
- Next: nothing pending from this round. If a transaction is ever
  reported missing again, check `Refresh` is still the right selector
  first (SCB could rename/redesign the widget) before assuming a new
  bug — this exact "silently stale, no error" shape is worth checking
  for elsewhere on this page too if it recurs.

### 2026-08-08 (same session, record→analyze→run round) — Claude

- Status: Built and typechecked; core recorder pipeline verified live
  against the real SCB lane. **Not yet verified**: an actual real
  click/keystroke being captured into a correct compiled step (needs
  genuine human interaction via noVNC — the permission classifier
  correctly blocked me from simulating real-account clicks myself
  mid-session, which is the right call, not a bug to work around).
- Context: User asked for a general record→review→save→run feature
  (element-selector clicks with pixel fallback, plus keyboard),
  explicitly including the real SCB lane, confirmed via AskUserQuestion.
  Full design plan (approved, still in `.claude/plans/steady-bouncing-pillow.md`
  if referenced again) covers: credential redaction (hard, in-page,
  before anything crosses to Node), a risky-keyword Telegram
  confirm-gate for replay (best-effort, not a hard block — user's own
  explicit choice), and manual+scheduled+Telegram `/run` triggering.
- Files: `services/worker/src/actions/registry.ts` (`clickSmart`/
  `pressKey`/`typeText`/`REDACTED_FIELD_SENTINEL`), new
  `services/worker/src/record-actions.ts`, `run-workflow.ts`
  (`WORKFLOWS_DIR` now overridable), `services/worker/package.json`
  (new `record-actions` script — **image rebuild required**, this
  isn't bind-mounted like `src/`), `services/control-panel/src/exec.ts`
  (`runWorkflowOnLane`, recording save/list/delete/read, stop-flag
  writer), new `services/control-panel/src/scb-replay.ts`, `queue.ts`
  (new job types + per-recording BullMQ scheduler), `server.ts` (new
  `/api/lanes/scb-business-anywhere-1/recordings/*` + `/replay-state`
  routes), `telegram-commands.ts` (`/confirm`, `/cancel`, `/run <name>`
  — the one deliberate non-read-only Telegram expansion this session,
  documented inline as such), `docker-compose.yml` (new `recordings`
  volume mount for `worker-scb-business-anywhere-1`), new Recorder UI
  section on `scb-business-anywhere-live.html`/`.js`.
- Two real bugs found and fixed live, both worth remembering:
  1. `services/worker/package.json`'s `scripts` section is baked into
     the Docker image at build time (`COPY package.json ./` in the
     Dockerfile) — unlike `src/`, it is **not** bind-mounted. Adding
     `record-actions` there silently did nothing until
     `docker compose build worker worker-scb-business-anywhere-1` was
     run — surfaced as `npm error Missing script: "record-actions"`.
     Any future new npm script needs the same rebuild step.
  2. Shipping a TS function into the page via `fn.toString()` +
     `eval()` inside `page.evaluate()` broke with
     `ReferenceError: __name is not defined` — tsx/esbuild wraps named
     function declarations in a `__name()` helper that doesn't exist
     in the isolated eval context. Fixed by passing the function
     **directly** to `page.evaluate()` instead (Playwright's own
     serialization handles this correctly) — full writeup in
     `docs/PROJECT_PLAN.md`'s decision log. General lesson for this
     project: never `.toString()`+`eval()` a TS function into a
     browser context again, always pass it directly.
- Verified: both worker and control-panel `tsc --noEmit` clean. Safe
  mechanics test against the shared/demo browser (not SCB) confirmed
  `clickSmart` works both by element and by pixel fallback, and that
  `typeText` throws `REDACTED_FIELD:` on the sentinel without ever
  calling `.fill()`. Against the real SCB lane: `guard-not-login-page`
  correctly passed (account was logged in), `install-recorder`
  succeeded (after the `__name` fix), the stop-flag file correctly
  ended the session, and `SCB_RECORDING_RESULT {"steps":[],...}`
  compiled cleanly with zero events (none were generated — no real
  clicks happened during the test). Restarted control-panel's
  `worker.ts`/`server.ts` and rebuilt both worker Docker images to
  pick up all of the above.
- Next: ask the user to do one real click-through via noVNC while
  recording is active (e.g. Account Summary → back), confirm the
  review pane shows a correct `clickSmart` step with both a selector
  and pixel coordinates, save it, run it, and confirm it replays.
  Then construct one safe test script with a step whose text
  deliberately matches a risky keyword (a harmless/fake target, not a
  real transfer) to confirm the pause + Telegram `/confirm`/`/cancel`
  flow actually fires end to end — this round only verified the code
  path via review, not a live Telegram round-trip. Not committed yet.

### 2026-08-10 — Claude — SHUTDOWN CHECKPOINT (user closing the machine)

Read this one first if picking the session back up cold.

- **Machine state when closed**: everything (Docker Desktop, both
  control-panel host processes `npm run worker`/`npm start`, all
  containers) stops when the computer shuts down — nothing was left
  deliberately running, no cleanup needed. On resume: start Docker
  Desktop, `docker compose up -d` (or the relevant lane services),
  then `npm run worker` and `npm start` in `services/control-panel`
  (two separate host processes, see `docs/PROJECT_PLAN.md`'s decision
  log for why they're kept separate).
- **SCB Business Anywhere real account**: session had already expired
  again by the time the machine was closed (`GET
  /api/lanes/scb-business-anywhere-1/monitor` → `lastError:
  "SESSION_EXPIRED: ..."`, `lastCheckedAt: 2026-08-09T20:48:26Z`).
  This is normal/expected (real bank idle-timeout, not a bug — see the
  "idle-timeout dialog" and "SESSION_EXPIRED" decision-log entries).
  **First thing to do on resume**: log back in manually via noVNC
  (`http://localhost:6090/vnc.html`) — the monitor schedule is still
  configured `running: true`, `paused: false`, so it self-heals and
  resumes checking automatically the moment login succeeds, no other
  action needed.
- **This session's main deliverable — record→analyze→run — is built,
  typechecked, and partially live-verified, but NOT YET COMMITTED.**
  Uncommitted files as of closing:
  `docker-compose.yml`, `docs/AGENT_HANDOFF.md`, `docs/PROJECT_PLAN.md`,
  `services/control-panel/public/scb-business-anywhere-live.html`,
  `services/control-panel/public/scb-business-anywhere-live.js`,
  `services/control-panel/src/exec.ts`, `queue.ts`, `server.ts`,
  `telegram-commands.ts`, `services/worker/package.json`,
  `services/worker/src/actions/registry.ts`, `run-workflow.ts`, plus
  two new untracked files: `services/control-panel/src/scb-replay.ts`
  and `services/worker/src/record-actions.ts`. The user was asked
  whether to commit before closing — check the conversation for the
  answer; if unclear, ask again rather than assuming, since this
  touches the real-money SCB lane's capabilities and shouldn't be
  committed silently.
- **Full detail on what was built, the two live bugs found/fixed
  (`package.json` needs an image rebuild, `.toString()+eval()` breaks
  under tsx/esbuild's `__name()` wrapping), and what's still
  unverified** (a real click actually being captured correctly, and a
  live Telegram `/confirm`/`/cancel` round-trip) is in the entry
  directly above this one ("record→analyze→run round") and in
  `docs/PROJECT_PLAN.md`'s decision log — read both before continuing,
  don't re-derive from scratch.
- Next: resolve the commit question above, then pick up exactly where
  the previous entry's "Next" section left off (live click-through
  test via noVNC, then the risky-keyword confirm-gate test).

### 2026-08-10 — Claude — SCB mock built, record→analyze→run fully verified end-to-end

- Status: Done. User redirected the previous entry's "Next" (live
  click-through against the *real* SCB lane) to instead build an
  isolated mock first — safer, and it fully unblocked verification
  that a real-account test alone couldn't reach.
- Context: New `services/scb-mock/` (same isolation posture as
  `services/xc-bank` — no shared code/DB, HTTP-only). Its DOM text/
  structure mirrors the real SCB site closely enough that
  `check-transactions.ts`/`select-company.ts`/`record-actions.ts` run
  against it completely unchanged. Added: a session-timeout overlay
  (dev-triggerable, real `position:fixed` blocking dialog, no
  auto-dismiss) and a `/transfer` page (mock-only, never moves real
  money) specifically to safely exercise the risky-keyword Telegram
  confirm gate.
- Files: new `services/scb-mock/**`, `docker-compose.yml` (new
  `scb-mock` service), new `services/worker/workflows/scb-business-anywhere-mock-*.json`
  (open-login/fresh-login/test-login/test-overlay — kept as reusable
  test fixtures), `services/worker/src/record-actions.ts` (two more
  real bugs, see below), `services/worker/src/run-workflow.ts` (new
  `KEEP_EXISTING_PAGE` env var), `services/control-panel/src/exec.ts`
  (`runScbRecording` now sets it). `README.md`/`AGENTS.md` updated
  with a full SCB Mock section — mock creds aren't real secrets, the
  real-account automation boundary is explicitly unchanged.
- **Three more real bugs found live, all now fixed** (full detail in
  `docs/PROJECT_PLAN.md`'s decision log, not repeated here):
  1. The previous round's `__name` fix was incomplete — esbuild wraps
     ANY function expression assigned to a local const/let, not just
     named declarations, so `record-actions.ts`'s nested
     `computeSelector`/`isCredentialField`/`flush` consts still broke
     it. Real fix: a one-time `window.__name` passthrough shim.
  2. Recorder's selector computation used unquoted `text=` (substring
     match) — caused real replay misclicks (a "Transfers" link vs.
     "Payments and Transfers" parent; an `<h1>Transfer</h1>` vs. the
     actual submit button). Fixed with quoted exact-match `text="..."`.
  3. Recorder only flushed the *last* typed field when a form has
     multiple fields filled without an intervening click — fixed by
     flushing on element-change, not just on click/Enter/Tab.
  4. `run-workflow.ts`'s page-reset step (closes all pages, opens
     fresh) silently broke scb-replay.ts's segment-to-segment
     continuity — each segment lost all prior state. Fixed with
     `KEEP_EXISTING_PAGE=1`.
- Verified, for real, end-to-end, for the first time this session:
  recorded the mock's Transfer flow (nav click → fill 3 fields →
  submit → confirm), saved it, ran it via the API. It paused three
  separate times (each risky-keyword step), sent real Telegram
  messages, correctly resumed on simulated `/confirm` and correctly
  aborted on simulated `/cancel` (both tested), and a full confirm-all
  run completed all 6 steps, landing on "Mock Transfer Submitted — no
  real funds were moved." Also re-verified `check-transactions.ts`/
  `select-company.ts` still pass against the updated mock, and both
  `tsc --noEmit` clean across `worker`/`control-panel`/`scb-mock`.
- Also hit (and worked around, not fixed) recurring environment
  instability this round: the SCB browser container and the
  control-panel `worker.ts` process both needed manual restarts
  several times under the heavy rapid-fire testing load. A plain
  `docker compose restart` sometimes wasn't enough (needed a full
  `stop` + `up -d`) — see decision log for the practical mitigation
  used (explicitly verify CDP responds before proceeding, don't just
  wait-and-hope).
- Next: still not yet done — a live click-through test against the
  *real* SCB lane, and a real (not simulated) Telegram `/confirm`/
  `/cancel` round-trip. Given how much the mock testing already
  covers, these may be lower-priority now; ask the user. Commit/push
  status for this round: check `git status` and the conversation for
  whether this was committed before assuming either way.

### 2026-08-10/11 (later) — Claude — record→analyze→run generalized to any lane; Xvfb stale-lock root cause fixed

- Status: Done. Two threads this round: (1) fixed the real, previously
  undiagnosed root cause of the "Failed to open a new tab"/"CDP
  endpoint never became ready" instability logged in several prior
  entries; (2) the user rejected further SCB-only iteration outright —
  "ต้องทำให้ universal คือได้กับทุก web นะไม่เว้น... ไม่ใช่เราไปแก้
  หน้านั้นๆ แต่เราต้องทำให้อัดได้" — and the whole record→analyze→run
  feature was refactored from SCB-only to lane-agnostic.
- Context, infra fix: `entrypoint.sh` never cleared Xvfb's own stale
  `/tmp/.X99-lock` on restart, unlike it already did for Chromium's
  profile lock a few lines below — a crashed/soft-restarted container
  reused the same tmpfs, Xvfb refused to start ("Server is already
  active for display 99"), but Fluxbox/Chromium/noVNC launched anyway
  against a display that was never created, so CDP silently never
  became reachable. This explains most of the flaky-restart pattern
  logged across this whole session. Fixed with an `rm -f` before Xvfb
  starts. Also fixed, unrelated: Fluxbox's `fbsetbg` wallpaper-setter
  popped a blocking `xmessage` over noVNC with no `feh` installed
  (cosmetic only) — fixed via a minimal custom `~/.fluxbox/startup`
  that skips wallpaper-setting, not by installing a package.
- Context, mock polish (small, before the pivot): login/password pages
  redesigned to match the real SCB two-column layout; new
  `.userpassmock` (gitignored, host-editable) pre-fills the mock's
  login form, shown as gray hint text *below* the form rather than
  inside the input boxes so the boxes still look like the real site's
  clean empty ones.
- Context, the generalization itself: new `services/control-panel/src/lanes.ts`
  registry (`"shared"` — the pre-existing `browser-worker-chrome`/
  `worker` pair already used by XC Bank/the-internet/demo/scb-mock —
  and `"scb-business-anywhere-1"`); every recording/replay function in
  `exec.ts`/`queue.ts`/`server.ts` now takes a `laneId`, routes are
  `/api/lanes/:laneId/recordings/*` (always 404 on an unknown lane,
  never a silent fallback to `shared`); `scb-replay.ts` renamed to
  `replay-engine.ts`. The credential-page guard in `record-actions.ts`
  changed from a literal Thai-text check (SCB's own username label,
  useless on any other site) to a structural one: refuses while any
  visible field looks credential-shaped (`type="password"`, or
  `autocomplete`/`id`/`name` containing password/otp/pin/token/secret
  — `CREDENTIAL_HINT_KEYWORDS`, shared with the in-page redaction so
  both always agree) — explicitly documented as best-effort, not a
  guarantee, per the user's own review feedback. New
  `services/control-panel/public/recorder-ui.js`: the entire Recorder
  section (record/review/save/list/run/schedule/pending-confirmation)
  extracted into one reusable component mounted via
  `<div id="recorder-root" data-lane-base="/api/lanes/<laneId>">` —
  used unchanged on both `/` (new section, explicit dev/test-only
  warning) and the SCB live page (replacing ~230 lines of page-
  specific JS). Telegram `/run <name>` now searches every lane and
  refuses (naming the lanes) rather than picking one on a name
  collision; `/confirm`/`/cancel` resolve whichever lane currently has
  a pending confirmation (safe because the whole control-panel shares
  one BullMQ queue at concurrency 1 — at most one confirmation is ever
  pending anywhere).
- Files: `services/browser-worker/entrypoint.sh`, `Dockerfile`;
  `services/scb-mock/src/server.ts`; new `.userpassmock` (gitignored)
  + `.gitignore`; new `services/control-panel/src/lanes.ts`,
  `replay-engine.ts` (replaces deleted `scb-replay.ts`), new
  `services/control-panel/public/recorder-ui.js`; modified
  `services/control-panel/src/exec.ts`, `queue.ts`, `server.ts`,
  `telegram-commands.ts`, `public/index.html`,
  `public/scb-business-anywhere-live.html` + `.js`;
  `services/worker/src/record-actions.ts`; `docker-compose.yml` (new
  `worker` recordings volume); `AGENTS.md`, `docs/PROJECT_PLAN.md`
  (decision log).
- Verified, all against live containers, not just `tsc --noEmit`
  (clean in both projects throughout): (1) universal guard — refused
  recording on the **shared** lane (not SCB) while a password field
  was visible on scb-mock's `/password` page, broadened error message
  confirmed. (2) Full record→save→run cycle on the shared lane: logged
  the shared browser into the mock, recorded one click ("Refresh" on
  account-summary), stopped, saved, ran the saved script back through
  `/api/lanes/shared/recordings/*` — completed. (3) SCB-lane
  regression: re-ran the pre-existing `test-mock-transfer` recording
  through the renamed/generalized route — identical to before the
  refactor (3 separate risky-keyword pauses, resolved via direct calls
  to `resolvePendingConfirmation()` since real Telegram replies aren't
  available in this environment, all 6 steps completed). (4) UI
  parity: screenshotted `recorder-ui.js` rendering correctly and
  identically on both `/` and `/monitors/scb-business-anywhere/live`.
  (5) Telegram `/run`: temporarily exported `handleRun()` (reverted
  right after) to exercise the no-arg/unknown-name/cross-lane-
  ambiguity cases directly — all three real messages sent with no
  Telegram send errors logged. Incidentally re-hit the exact
  `Failed to open a new tab`/`CDP endpoint never became ready` symptom
  once mid-verification (from an unrelated stuck-page state, not a
  regression of the lock fix above) — recovered via `stop`+`up -d` as
  usual. All scratch workflow files/screenshots/temp scripts created
  during verification were deleted before committing; `git status`
  confirmed clean (no `data/`, no screenshots, no credential-looking
  content staged).
- Next: commit is ready (not yet pushed as of this entry — confirm
  with the user or check `git log`/`git status` before assuming
  either way). After that: no specific next item requested yet: ask
  the user, or pick up any open item from earlier entries (MinIO/S3
  polish, Gmail Phase 3 live test, etc.) if nothing new comes up.

### 2026-08-11 — Claude — Real per-lane CDP-reachability health checks (BOT_LANE_ISOLATION.md Migration Step 2)

- Status: Done. Previous entry's work (universal recorder) was pushed;
  user then asked what to do next, offered a choice between this and a
  Recordings Library UX page, picked this one.
- Context: `docs/BOT_LANE_ISOLATION.md` documents a real, already-proven
  blind spot — `docker compose ps`/container-`Up` status stayed green
  through three real Chromium crashes found during an earlier monitor-
  stability round, and today's `/api/status`/`/health` never checked
  anything beyond container state or a bare noVNC HTTP ping. Went
  through `EnterPlanMode`/`ExitPlanMode` (user approved without
  changes) before implementing, scoped narrowly to Migration Step 2
  only: real `cdpReachable`/tab-count checks against the two lanes that
  already exist as real separate containers (`shared`/`browser-worker-
  chrome`, `scb-business-anywhere-1`) — not the doc's full `Lane`
  interface/registry rewrite (per-lane compose templating, a genuine
  second lane, per-lane queues), which stay later steps. Firefox out of
  scope (different reachability mechanism, not in `lanes.ts`).
  Key design constraint: `CDP_URL` is loopback-only inside each lane's
  own network namespace, never a published host port (deliberate,
  unchanged) — so the check can't `fetch()` from the host process. Runs
  instead as `docker compose exec -T <browserWorkerService> curl -sf
  --max-time 2 http://localhost:9222/json/version` (+ `.../json/list`
  for tab count) directly against the long-running `browser-worker-
  <lane>` container itself (where Chromium's `--remote-debugging-port`
  actually opens, confirmed via `entrypoint.sh`), not the ephemeral
  `worker`/`worker-scb-business-anywhere-1` services (no `command:`,
  only exist transiently via `docker compose run --rm`).
  Also deliberately additive, not a breaking change: `app.js`'s
  `setBrowserUi`/`setLaneUi` use `/api/status`'s existing
  `chrome`/`firefox`/`scbLane1` strings both as a CSS class *and* for
  exact-match button-gating (`disabled = state === "running"`) —
  changing what "running" means for an unhealthy-but-up lane would have
  silently broken Start/Stop/Take-control/worker-action enablement.
  Instead those three fields are untouched; two new fields
  (`chromeHealth`/`scbLane1Health`) carry the richer signal, and the
  frontend only uses them to recolor the dot (reusing the already-
  defined `.dot.error`/`.dot.paused` classes from the Monitors section)
  and append a label suffix when `state === "running"` but
  `health.status !== "healthy"` — button logic reads only the original
  field, unchanged.
- Files: `services/control-panel/src/lanes.ts` (`LaneConfig` gained
  `browserWorkerService`/`novncUrl`), new `services/control-panel/src/
  lane-health.ts` (`getLaneHealth`/`getAllLaneHealth`, in-memory
  `crashCount`/`lastFailureAt`/`lastFailureReason` tracking — dev-only,
  not persisted, resets on control-panel restart), `services/control-
  panel/src/health.ts` (new per-lane `/health` rows), `exec.ts` (new
  `restartLane()`, `stop` then `up -d` — the pattern already proven
  more reliable than a plain `restart` earlier this session),
  `server.ts` (`/api/status` gains the two additive health fields, new
  `POST /api/lanes/:laneId/restart`), `public/app.js` (dot recoloring,
  new `restartLane()` helper), `public/index.html` (Restart buttons +
  a hint paragraph explaining the red-dot-while-"running" case),
  `docs/BOT_LANE_ISOLATION.md` (Migration Step 2 marked done, full
  implementation note), `docs/PROJECT_PLAN.md` (decision log),
  `AGENTS.md` (new bullet + fixed a now-stale "not fixed this round"
  note left over from the incident that originally motivated this).
- Verified, all against live containers, exactly per the doc's own
  required proof: `docker exec weboperator-browser-worker-chrome-1
  pkill -f chromium` while `docker ps` kept confirming the container
  stayed `Up` the whole time — the new check correctly flipped to
  `unhealthy`/`cdpReachable: false`/`crashCount: 1`; repeated against
  `weboperator-browser-worker-scb-business-anywhere-1-1` with the same
  result (read-only check only, no navigation, safe against the real-
  bank lane). Restart button/endpoint recovered both back to
  `cdpReachable: true`/`status: healthy` (tab count settling to exactly
  1), with `crashCount`/`lastFailureAt` correctly preserved as history
  rather than reset. Regression check: ran the `demo` workflow through
  the restarted shared lane afterward — completed normally, confirming
  Start/Stop/Take-control/worker-action gating and normal job execution
  are all unaffected. Incidental true-positive along the way: before
  any kill test, the shared lane's real tab count was 2 (stray tabs
  left over from earlier same-session testing), which the new check
  correctly reported as `degraded` — not a synthetic test, a real
  anomaly the check caught on its own. `npx tsc --noEmit` clean
  throughout. `git status` confirmed clean before staging (no `data/`,
  no screenshots, no scratch files).
- Next: commit is ready (check `git status`/`git log` for current
  push state before assuming). After that: no specific next item
  requested — ask the user, or offer the previously-discussed
  Recordings Library UX page, or a further BOT_LANE_ISOLATION.md
  migration step (state/artifact path isolation is next per that
  doc's own ordering) if nothing else comes up.



### 2026-08-19 � Codex � AuthBridge overlay docs added

- Added docs for the mock-first AuthBridge overlay/runtime test after `ff99453 Add mock AuthBridge queue integration` was pushed and runtime-verified.
- AuthBridge repo location is documented as `D:\WebOperatorAuthBridge`; WebOperator starts it with `docker compose -f docker-compose.yml -f ../WebOperatorAuthBridge/weboperator-compose.overlay.example.yml up -d --build scb-mock browser-worker-scb-business-anywhere-1 auth-bridge redis minio`.
- Control Panel operation is documented as two host processes from `services/control-panel`: `npm start` for API/UI and `npm run worker` for the BullMQ consumer.
- UI entry point is `http://localhost:4000/monitors/scb-business-anywhere/live`, section **AuthBridge mock test**, buttons **Queue AuthBridge State** and **Queue Mock Login**.
- Safety boundaries are explicit: mock login uses only `credentialRef: scb.mock.demo`; WebOperator must not receive/store/log plaintext passwords; do not run `/secrets/set` from WebOperator; do not use this flow for real SCB login; do not automate OTP/2FA/CAPTCHA/passkey.
- Cleanup guidance is AuthBridge-only: `docker compose ... stop auth-bridge` then `docker compose ... rm -f auth-bridge`; avoid `docker compose down` unless intentionally stopping the entire stack.
- Docs-only change; no runtime test needed for this docs commit.

### 2026-08-20 — Claude — SCB mock visual/language fidelity pass (EN/TH)

- Status: Done.
- Context: `services/scb-mock` gained a language toggle (EN/ไทย) covering
  the specific string pairs requested (Username/Next/Password/Sign In/
  User Guides + its 2 links/All User Guides/Terms and Conditions/
  Security Tips/Privacy Notice) plus a cosmetic footer, closer to the
  real public SCB Business Anywhere login page's look. Resolution order:
  `?language=` query (wins) → `session.language` (continuity across
  login → password → account-summary) → `"th"` (unchanged default) —
  picked "th" as the default specifically so every existing caller that
  never passes `?language=` (recordings, `check-transactions.ts`'s
  `SESSION_EXPIRED` exact-text `"ชื่อผู้ใช้งาน"` detector, AuthBridge's
  own mock-login flow) sees byte-identical behavior to before this
  change. Scope was explicitly `services/scb-mock` only — no changes to
  the real SCB site, AuthBridge, or any credential/secret handling,
  per the task's own explicit constraints.
- Files: `services/scb-mock/src/server.ts`, `services/scb-mock/src/
  sessions.ts` (new `language` field on `Session`), `docs/PROJECT_PLAN.md`
  decision log.
- Verified, all against the real rebuilt+restarted `scb-mock` container:
  `/login?language=en` and `?language=th` (and the bare default) all
  render the correct strings; a full `POST /login` → `/password` →
  `POST /password` → `/account-summary` round trip confirmed the chosen
  language survives all three hops via `session.language`, including a
  later `/account-summary` request with no query param at all still
  showing the earlier-chosen language; toggling on `/account-summary`
  itself works and persists. `#username`/`#password`/`form
  action="/login"`/`form action="/password"` confirmed byte-identical
  via direct `curl` inspection. Regression: `record-actions.ts`'s
  credential guard still correctly REFUSED against the (default-Thai)
  `/password` page. **AuthBridge's own mock-login job** (`POST /api/
  lanes/scb-business-anywhere-1/auth-bridge/login-mock`) run for real
  against the updated mock, completed `state: "authenticated"` through
  all 5 of its own steps — its selector/state-detection logic (never
  touched) still works against the changed pages. Grepped the job
  payload and tracked diff for anything password-shaped — none found.
  `npx tsc --noEmit` clean in `services/scb-mock`.
- Next: nothing pending from this task. Separately (not part of this
  task, flagged for whoever owns AuthBridge): `AUTH_BRIDGE_LANE_ID` in
  `services/control-panel/src/queue.ts` is hardcoded to
  `"scb-business-anywhere-1"` (the real, isolated bank lane) even for
  the "mock" login job — worth confirming the AuthBridge vault never
  gets a real credential under the `scb.mock.demo` ref, since nothing
  in the wiring itself prevents that ref from being reused against this
  same real-lane CDP endpoint later.
