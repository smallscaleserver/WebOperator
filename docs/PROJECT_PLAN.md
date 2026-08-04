# WebOperator — Project Plan

Actionable version of the roadmap in `README.md`. Update the checkboxes as
work lands — this file (together with `AGENTS.md`) is the canonical place to
see current status, regardless of which tool (Claude Code, Codex CLI, or a
human) is picking the work back up.

## Decision Log

| Decision | Choice | Why |
| --- | --- | --- |
| Project name | **WebOperator** (single name, repo + product) | Repo was already public under this name; earlier "WebSteward" codename retired to avoid confusion. |
| Core stack | TypeScript/Node.js + Playwright | Best Chromium/Firefox automation ecosystem; persistent profiles, trace/video, headed mode all supported natively. |
| Browsers | Chrome **and** Firefox from Phase 1 | User requirement: must feel like a real PC, not a single-browser bot. |
| Display/remote control | Xvfb + Fluxbox + x11vnc + noVNC | Gives a real, clickable desktop reachable from any browser tab — no native VNC client needed. |
| Sandbox | Chromium runs with `--no-sandbox` for now | Simplest path to a working Phase 1. Real seccomp/user-namespace hardening per Playwright's official Docker guide is deferred to Phase 5. |
| Session storage | Plain bind-mounted volume (`data/profiles/*`) for now | Placeholder for the future encrypted Session Vault (Phase 2/3). Not safe for real credentials yet — dev-only. |
| Worker transport | `playwright-core` + `connectOverCDP`, worker container joins `browser-worker-chrome`'s network namespace (`network_mode: service:...`) | Chromium ignores `--remote-debugging-address` for a headed instance and only ever binds CDP to `127.0.0.1` — sharing the network namespace reaches it without publishing the (unauthenticated) CDP port anywhere. Firefox has no CDP equivalent; needs WebDriver BiDi later. |
| Session proof method | Synthetic marker (cookie + localStorage on `example.com`), not a real login | No site adapter exists yet (separate checklist item). Proves the `storageState` save/restore mechanism generically; a real login-based proof lands with the first adapter. |
| Session file storage | Plain JSON under `data/sessions/*` for now | Same caveat already logged for `data/profiles/*` — placeholder for the encrypted Session Vault (Phase 2/3), not safe for real credentials yet. |
| Demo adapter target | `https://the-internet.herokuapp.com` (`/login`, `/entry_ad`) | Free, purpose-built practice app that exists specifically to be automated against; publishes its own test credentials. Sidesteps any "is it okay to automate this real site" question while still exercising a real login, a real session cookie, and a real popup-dismissal case. |
| Control Panel deployment | Runs as a plain host Node process (`services/control-panel`, `npm start`), not a Docker service | Its whole job is running `docker compose` commands. Containerizing it would mean mounting the Docker socket (Docker-out-of-Docker) just to shell back to the same Docker Desktop already on the host — real security surface (socket access ≈ root on host) for no benefit at this stage. Revisit if/when this needs to run somewhere without a host Docker CLI. |
| Redis | `redis:7-alpine` compose service, bound to `127.0.0.1:6379` only, no volume | No auth on Redis by default, so loopback-only — same posture as CDP/Control Panel. Ephemeral (no persistence) is fine; job history doesn't need to survive `docker compose down` at this stage. |
| Queue worker location | ~~BullMQ producer *and* consumer both run inside the Control Panel process~~ **Superseded**: split into two processes (`npm start` = API/UI producer, `npm run worker` = consumer) within the same `services/control-panel` project — see the later "queue consumer split" row below. |
| Queue concurrency | 1 | All 4 queueable actions connect to the same shared `browser-worker-chrome` over CDP — the queue's job is to serialize access to that one browser, not parallelize it. Verified via BullMQ `processedOn` timestamps: job N+1's `processedOn` exactly equals job N's `finishedOn`. |
| Step reporting | Post-hoc, parsed out of captured stdout (`WEBOP_STEP {...}` lines), not live-streamed | True live progress needs `spawn` + incremental parsing + BullMQ `job.updateProgress()` — real complexity for a slice that's mainly about debugging after the fact, which post-hoc parsing already delivers. Live streaming is a reasonable follow-up, not required now. |
| Step/screenshot scope | Step name + ok/error + optional detail message + optional screenshot filename + timestamp. No DOM snapshot, console/network log capture, or full Playwright `.trace.zip` yet | README's Event Recovery Engine table wants much more (DOM snapshot, console/network errors); kept to the smallest slice that makes job failures debuggable without reading raw logs. Fuller trace capture stays open. |
| Workflow definition format | Named JSON files checked into `services/worker/workflows/*.json`, not request-supplied JSON | Auditable (it's source, reviewed like any other code), and the Control Panel only ever needs to validate a *name* against real files on disk before enqueueing — no new arbitrary-JSON-from-a-web-request input-validation surface to design. |
| Workflow engine vs fixed actions | Added *alongside* the existing 4 fixed actions/`adapters/the-internet.ts`, not a replacement | Those were already proven working across several sessions; no reason to destabilize them to add the new generic path. Migrating the old path onto the new engine is a deliberate follow-up, not bundled into this change. |
| Firefox automation mechanism | Playwright's own `launchServer()`/`connect()` protocol, **not** literally WebDriver BiDi | Empirically tested before building: Playwright has no public API for connecting to an *externally-launched* Firefox the way `connectOverCDP` works for Chromium. It needs its own patched Firefox build (`npx playwright install firefox`, not apt `firefox-esr`) and a `launchServer()` call in the browser-worker-firefox container + a separate `connect()` call from `worker-firefox` — this does work, tested directly. The original checklist wording ("BiDi") was an unverified assumption; corrected here rather than left wrong. |
| Firefox profile persistence | Dropped | `launchServer()` explicitly rejects a `-profile` argument ("Pass userDataDir to launchPersistentContext instead"), and `launchPersistentContext` has no server/connect equivalent — Playwright forces a choice between "persistent profile, single process" and "separate connecting process," and our architecture (long-lived browser container + short-lived worker containers) needs the latter. `storageState` remains the real session-continuity mechanism (already proven for Chromium); the `data/profiles/firefox` bind mount is now unused (left in place, harmless, cheaper than restructuring further). |
| Firefox page/context lifecycle | Tied to the connecting client, unlike Chromium | Discovered while verifying: after `worker-firefox`'s script disconnects, the page/context it created disappears from the noVNC view (confirmed via process count + a direct before/after check), even though the Firefox *server* process itself survives (same persistent-container model as Chrome). So a human watching noVNC only sees Firefox actually doing something *while* a job is running, not before or after — a real, documented difference from Chromium's persistent default page. Not fixed now; noted as a real limitation. |
| Firefox automation scope | One demo script (`run-firefox-demo.ts`) proving the connection mechanism, not full adapter/workflow parity | Matches how Chromium's own CDP support was scoped in its first session — prove the mechanism, extend later. |
| Workflow validation depth | Full structural validation (every step's `type` known, `params` shape) happens in `run-workflow.ts` *before connecting to any browser*; the Control Panel only does a cheap JSON/shape sanity check at enqueue time, not a full type-registry check | The registry (`ACTION_HANDLERS`) lives in the separate `services/worker` npm project — duplicating it into `services/control-panel` would just be a second list to keep in sync for no real safety gain, since the worker-side check already guarantees zero partial execution (it runs first, before any step, before any browser interaction). |
| Job timing fields | Added `processedOn`/`durationMs` to the job API (from BullMQ's own `job.processedOn`/`job.finishedOn`, already tracked internally, just not previously surfaced) | Cheap, no new instrumentation needed — the data already existed inside BullMQ. |
| Per-step retry defaults | Only `navigate`/`dismissPopup`/`extract`/`screenshot` retry by default (2 attempts, 1s fixed delay); `login`/`saveSession` get zero implicit retry, only if a workflow step explicitly sets `retry` | The first four are read-only or idempotent — safe to retry blindly. `login`/`saveSession` are state-changing; blind retry risks double-submitting a form or writing a session file mid-failure. Matches the explicit ask: retry the safe stuff by default, require an explicit opt-in for anything state-changing. |
| Per-step retry backoff | Fixed delay, no cap on `attempts` beyond "must be positive" | Consistent with the existing job-level retry policy (also fixed delay). Workflow JSON is trusted source (reviewed like any other code), not untrusted input, so an artificial attempts cap isn't adding real safety — the existing 120s exec timeout is already the outer bound. |
| Attempt info visibility | Only shown when it's actually informative: on success, only if it took more than one attempt; always shown once all attempts are exhausted on failure | First implementation showed `(attempt 1/2)` on *every* successful default-retryable step, even ones that succeeded immediately — pure noise. Caught by testing the real workflow end-to-end and comparing before/after, not assumed; fixed same-session. |
| Queue consumer split | Split into two processes within `services/control-panel`: `src/server.ts` (`npm start`) is now API/UI + producer only; new `src/worker.ts` (`npm run worker`) is the consumer only. Not a separate top-level service/project. | Restarting the panel used to also kill whatever job was mid-flight, since one process owned both roles. Verified both directions directly: killed the API process while a job was actively running on the worker — job still completed; killed the worker with the API up — the next enqueued job correctly sat in `waiting` (not lost) until the worker came back and picked it up. |
| Redundant Queue connection in the worker process | Accepted, not fixed | `queue.ts`'s module-level `Queue` producer object is created unconditionally at import time regardless of which entry point imports it, so the worker process ends up holding an unused producer connection to Redis alongside its consumer connection. Splitting `queue.ts` further into producer-only/consumer-only modules would remove this, but it's a harmless extra Redis client, not worth the extra file churn for a dev tool. |
| Windows orphan-process gotcha, take two | Confirmed the same issue documented for the Control Panel API process also affects the new worker process | The worker holds no port, so the `Get-NetTCPConnection -LocalPort 4000` check used to detect the API's orphaned process doesn't apply — verify via `Get-CimInstance Win32_Process | Where CommandLine -like '*worker.ts*'` instead. Hit and had to work around this again while verifying this very change. |

*The 6 generic action types (`navigate`/`dismissPopup`/`login`/`extract`/`saveSession`/`screenshot`) live in `services/worker/src/actions/registry.ts`. `dismissPopup` carries forward a real lesson from `adapters/the-internet.ts`: the-internet's ad modal appears via `setTimeout(showAd, 500)`, not on initial render, so the handler waits for visibility rather than checking it immediately.*

## Phase 1 — Prototype

- [x] Docker เปิด Chromium/Firefox แบบเห็นหน้าจอ (`services/browser-worker`)
- [x] เชื่อม noVNC (`http://localhost:6080` / `:6081`)
- [x] ช่องทาง handoff ระหว่าง Codex/Claude/human (`docs/AGENT_HANDOFF.md`)
- [x] Control Panel มี Start/Stop/Take control — `services/control-panel`, `npm start` → `http://localhost:4000`, verified: start/stop both browsers, embedded noVNC "take control", all four worker actions run through the UI
- [ ] เปิดเว็บ ทดลอง login ด้วยมือ
- [x] บันทึกและนำ browser session กลับมาใช้ (Playwright `storageState`) — `services/worker` `npm run save`/`npm run restore`, verified round-trip via synthetic marker
- [x] ทำ adapter เว็บตัวอย่างหนึ่งเว็บ — `services/worker/src/adapters/the-internet.ts` + `npm run adapter`, verified: dismisses popup, real login, extracts flash message, saves real session
- [x] Playwright worker เชื่อมต่อเข้า browser ผ่าน CDP (Chromium) — `services/worker`, verified: navigates, reads title, screenshots
- [x] Playwright worker เชื่อมต่อ Firefox — via Playwright's own `launchServer()`/`connect()` protocol, not literally WebDriver BiDi (see decision log). `services/worker/src/firefoxConnect.ts` + `run-firefox-demo.ts`, new `worker-firefox` compose service. Verified end-to-end through direct CLI and the real Control Panel queue. Scope: connection-proof only (one demo script), not full adapter/workflow parity yet. Profile persistence and cross-job page visibility are *not* preserved for Firefox — see decision log.

## Phase 2 — Task Engine

- [x] Queue และ scheduler (Redis + BullMQ) — `services/control-panel` `src/queue.ts`, Control Panel UI enqueues the 4 worker actions instead of running them synchronously; verified: async return, sequential execution (concurrency 1), retry config wired (`attempts: 2`). Job API/UI now also surfaces start time + duration (`processedOn`/`durationMs`) and exit code, not just stdout/stderr/steps. The queue consumer now runs as its own process (`npm run worker`), separate from the API/UI (`npm start`) — verified a job survives the API process being killed mid-run, and a job enqueued while the worker is down correctly waits rather than being lost.
- [x] Step-based workflow — `services/worker/src/run-workflow.ts` + `src/actions/registry.ts` + `workflows/the-internet-login.json`: a job now runs a *sequence of generic, parameterized actions* defined as data, not one hardcoded script. Control Panel: `GET /api/workflows`, `POST /api/enqueue-workflow/:name`. Verified end-to-end through the real queue, including the `extract` step's scraped text surfacing in the job detail UI. Added alongside the existing 4 fixed actions, which are unchanged. Workflows are now validated in full (every step's action `type` checked against the registry) *before* connecting to any browser, so a malformed workflow fails instantly with zero side effects instead of partially executing — verified directly (a bad `type` fails on a `validate` step with no `connect` line ever logged) and through the real Control Panel (a genuinely-broken-JSON file 400s at enqueue time, before a job even exists).
- [x] screenshot/trace ทุกจุดสำคัญ — partial: `services/worker/src/steps.ts` `step()` wrapper reports name/status/detail/screenshot per stage in all 4 worker scripts, parsed by `services/control-panel/src/exec.ts` and shown in an expandable job row (`/screenshots/*` static route). Full DOM/console/network trace capture still open.
- [x] retry (partial) — whole-job retry already existed; now also **per-step retry** in the workflow engine (`services/worker/src/steps.ts` `stepWithRetry`), configurable via an optional `retry: {attempts, delayMs}` field per step, with safe defaults (`navigate`/`dismissPopup`/`extract`/`screenshot` retry automatically, `login`/`saveSession` require explicit opt-in). Verified: a genuinely-flaky step recovers and reports which attempt succeeded; an always-failing step exhausts its attempts and reports the count; a clean first-try success shows no attempt noise. No circuit breaker yet, no timeout-per-step beyond Playwright's own action timeouts.
- [ ] ดาวน์โหลดและจัดเก็บข้อมูล (MinIO/S3)

## Phase 3 — Gmail

- [ ] Google OAuth
- [ ] อ่าน ค้นหา และดาวน์โหลดไฟล์แนบผ่าน Gmail API
- [ ] Browser fallback เฉพาะกรณีจำเป็น
- [ ] Encrypted token vault

## Phase 4 — Universal Adapters

- [ ] ระบบ plugin สำหรับเพิ่มเว็บไซต์
- [ ] Popup rules กลาง
- [ ] page-state detection
- [ ] selector หลายระดับ: role → label → text → CSS
- [ ] workflow versioning เพื่อย้อนกลับเมื่อเว็บเปลี่ยน

## Phase 5 — Production

- [x] แยก worker หลายเครื่อง (partial) — the queue consumer is now a separate *process* from the Control Panel API (`services/control-panel` `npm run worker`); still runs on the same host today, not literally distributed across machines yet, but the architectural split (independent restart/crash, independent scaling) is done.
- [ ] Chrome และ Firefox profiles (multi-user)
- [ ] สิทธิ์ผู้ใช้และ audit log
- [ ] domain allowlist
- [ ] monitoring และแจ้งเตือน
- [ ] backup/restore session vault
- [ ] Chromium sandbox hardening (drop `--no-sandbox`, apply seccomp profile per Playwright Docker docs)
- [ ] noVNC behind HTTPS with short-lived, per-session URLs (currently plain HTTP + static password — dev only)

## Immediate next step

**Phase 1 is now functionally complete.** Phase 2 has a queue (now running
as an independently-restartable process), per-step status/screenshots with
retry, and a generic multi-action workflow engine proven against one real
example workflow. Still open: migrating the 4 fixed actions onto the
workflow engine (optional consolidation, not required), object storage
(MinIO/S3), `.env.example` additions, and — if it ever becomes worth the
effort — a way to keep a Firefox page alive across worker connections
(would need a small always-connected keep-alive client; not pursued now).
