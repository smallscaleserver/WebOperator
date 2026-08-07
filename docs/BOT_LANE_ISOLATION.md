# Bot Lane Isolation — Design Doc

**Status: design only, not implemented.** Nothing in this document has
been built. It exists so the multi-account/multi-site direction gets
designed once, deliberately, instead of accreting ad hoc as each new
site/account gets bolted onto the current single-shared-browser model.

## Why this is being written now

Today, WebOperator has exactly one Chromium instance
(`browser-worker-chrome`) and one Firefox instance
(`browser-worker-firefox`), each shared by every workflow, every
adapter, and the one XC Bank Monitor, serialized through a single
BullMQ queue at `concurrency: 1`. That was the right scope while there
was one real site (XC Bank) and one monitor — see
`docs/PROJECT_PLAN.md`'s decision log for how deliberately that stayed
unabstracted ("only one real monitor exists; abstracting the check
engine itself for hypothetical future sites would be premature").

Running multiple accounts/sites concurrently needs real isolation —
one compromised or misbehaving site/account must not see another's
session, cookies, or browser profile. That means separate browser
containers per lane, not one shared Chromium logging into multiple
accounts back-to-back.

But the monitor-stability work that immediately precedes this doc
(auto-stop, page-reset, window-size — see `AGENTS.md`'s "Monitor
stability pass" section) surfaced a real, recurring problem that a
naive multi-lane design would make *worse*, not better: **Chromium can
die silently while its container keeps reporting "Up."** `docker
compose ps` and even `/api/health`'s existing noVNC check both stayed
green through three real crashes found during that round's own
verification alone. If a future multi-lane system has N independent
browser containers and no per-lane CDP-reachability signal, an
unattended lane can sit "green" and dead indefinitely, and a human has
to notice a stalled site by accident. **Lane health/recovery is
therefore part of the lane model from the start, not a follow-up.**

## Non-goals this round

- No runtime code changes. `docker-compose.yml`, `queue.ts`,
  `monitor.ts`, `health.ts`, the worker's CDP connection code — all
  stay exactly as they are today.
- No second browser container stood up for real.
- No decision here is final/irreversible — this is a proposal to
  review and adjust before any implementation work starts, same as
  every other plan in this repo that went through explicit user
  approval first (see `AGENTS.md`'s "Monitor stability pass" and
  `docs/PROJECT_PLAN.md`'s decision log for that pattern).

---

## 1. Lane model

A **lane** is the unit of isolation: one browser container, driving
one site, as one account, end to end. Nothing about a lane's browser
process, profile, session, or output is shared with any other lane.

```ts
interface Lane {
  laneId: string;        // stable, e.g. "xc-bank-demo_user" or "xc-bank-demo-2"
  siteId: string;         // matches policy.ts's SITE_POLICIES key, e.g. "xc-bank"
  accountId: string;      // the credential identity this lane logs in as
  browserType: "chromium" | "firefox";
  // Per-lane endpoints -- see "Docker/compose migration" for how these
  // map onto container names/ports today vs. later.
  novncUrl: string;       // e.g. http://localhost:6080/vnc.html (lane 1), :6082 (lane 2), ...
  cdpUrl: string | null;  // Chromium only, e.g. http://localhost:9222 -- null for a Firefox lane
  firefoxWsEndpoint: string | null; // Firefox only, mirrors today's FIREFOX_WS_ENDPOINT
}
```

Per-lane, fully separate (no field or directory shared across lanes):

| Concern | Today (single lane, implicit) | Per-lane (proposed) |
| --- | --- | --- |
| Browser container | `browser-worker-chrome` (one, hardcoded name) | `browser-worker-<laneId>` |
| Profile dir | `data/profiles/chrome` | `data/lanes/<laneId>/profile` |
| Session files | `data/sessions/*.json` (flat, one namespace) | `data/lanes/<laneId>/sessions/*.json` |
| Worker output (screenshots) | `data/worker-output/*` (flat) | `data/lanes/<laneId>/output/*` |
| Monitor state | `data/monitor-state/xc-bank.json` (one file, hardcoded) | `data/lanes/<laneId>/monitor-state.json` |
| noVNC endpoint | `:6080` (Chrome), `:6081` (Firefox) — fixed | one port per lane, allocated from the lane registry |
| CDP endpoint | `CDP_URL=http://localhost:9222` env var, one worker image | per-lane `CDP_URL`, injected into that lane's worker container only |
| MinIO artifact prefix | `screenshots/*`, `sessions/*` (flat) | `lanes/<laneId>/screenshots/*`, `lanes/<laneId>/sessions/*` |

Rationale for `data/lanes/<laneId>/...` instead of keeping today's flat
`data/sessions/`, `data/worker-output/`, `data/monitor-state/`
directories with a laneId-prefixed filename: a directory boundary is
harder to accidentally cross with a bad path-join than a filename
prefix is, and it matches the existing `data/profiles/{chrome,firefox}`
subdirectory convention already used for the two browser types today.

## 2. Queue routing

Today: one `Queue`/`Worker` pair (`worker-actions`, `concurrency: 1`)
in `services/control-panel/src/queue.ts`, shared by every action,
workflow, and the one monitor. All of it serializes onto the one
shared browser by construction.

**Proposed: one `Queue` + one `Worker(concurrency: 1)` pair per lane**,
not one queue with a laneId field routed internally. Reasons:
- It's the smallest change from what's already proven — each lane
  becomes, architecturally, its own copy of today's single-lane
  queue/worker pair, just parameterized by `laneId` (own Redis key
  prefix via BullMQ's `Queue(name, ...)` where `name` embeds
  `laneId`, own `CDP_URL`/`FIREFOX_WS_ENDPOINT`).
- `concurrency: 1` still means "at most one action driving *this
  lane's* browser at a time" — exactly the guarantee that matters,
  scoped correctly to the resource it's actually protecting (one
  browser process), not the whole system.
- Lanes then run in true parallel automatically: lane A's queue can be
  actively processing while lane B's queue is idle or also active —
  no new scheduling logic needed, BullMQ already runs each `Worker`
  instance independently.
- A bad/hung lane can't starve other lanes' jobs, because there's no
  shared queue for it to sit at the front of.

Job routing at the API layer: every enqueue call gains a required
`laneId` (or the route itself is lane-scoped, e.g. `POST
/api/lanes/:laneId/workflows/:name`) and resolves to that lane's own
`Queue` instance from a small in-process registry (`Map<laneId,
{queue, worker}>`), built once at startup from the lane registry (see
§6). Not a proxy/router job type — just "look up which `Queue` object
this laneId maps to, call `.add()` on it," mirroring how
`monitors-registry.ts` already maps a monitor id to its own
`getSummary()`/`pause()`/`stop()` functions today.

**Unhealthy lane must not silently accept work.** Before enqueueing,
check the lane's last-known health (from the cached `LaneHealth`
described in §3 — not a fresh synchronous check per enqueue, which
would make every button click pay a CDP round-trip). If the lane is
currently marked unhealthy (CDP unreachable, container down), the
enqueue call itself returns a clear 4xx/5xx with a specific reason
("lane xc-bank-demo-2: CDP unreachable since 14:32:10 — restart the
lane before retrying") instead of silently queuing a job that will
just sit and eventually time out against `waitForCdp`'s existing
30-attempt/30-second retry loop (`services/worker/src/cdp.ts`). This
mirrors `health.ts`'s existing "never silently proceed, always say
exactly what's wrong" posture, just applied per-lane instead of
system-wide.

## 3. Lane health/recovery

This is the section directly motivated by the recurring silent-crash
finding. **`docker compose ps`/container-`Up` status is explicitly
insufficient** — proven three times over in the verification pass that
immediately precedes this doc, where the container stayed `"Up"` with
zero Chromium process running and zero crash-log entry each time.

Proposed `LaneHealth` shape, one per lane, refreshed on a short poll
interval (mirroring `health.ts`'s existing `runHealthChecks()`
pattern, just scoped per-lane instead of system-wide):

```ts
interface LaneHealth {
  laneId: string;
  containerRunning: boolean;   // docker compose ps, same as today's dockerServiceChecks()
  novncReachable: boolean;     // fetch() against that lane's own noVNC HTTP endpoint
  cdpReachable: boolean;       // Chromium lanes: GET {cdpUrl}/json/version -- the actual new check
  firefoxReachable: boolean | null; // Firefox lanes: launchServer connectivity equivalent; null for Chromium lanes
  browserTargetCount: number | null; // GET {cdpUrl}/json/list -- expect exactly 1 page target; also catches tab leaks per-lane
  lastSuccessfulJobAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  crashCount: number;          // increments whenever cdpReachable flips true->false
  lastRestartAt: string | null;
  status: "healthy" | "degraded" | "unhealthy";
}
```

**Status derivation** (explicit, not vibes):
- `unhealthy`: `containerRunning` false, or `cdpReachable`/
  `firefoxReachable` false while `containerRunning` is true (this is
  exactly the blind-spot case — container up, browser dead).
- `degraded`: `browserTargetCount` is not exactly 1 (either 0 — no
  page, something's wrong with page-management — or >1 — the
  per-lane equivalent of the tab-leak bug the page-reset work already
  fixed once for the single-lane case), or `novncReachable` is false
  while everything else is fine (a human can't take manual control,
  even though automation itself might still work).
- `healthy`: everything above checks out.

**The actual new signal, not present anywhere today**: `cdpReachable`
via a real `GET {cdpUrl}/json/version` call (Chromium) — exactly the
URL `services/worker/src/cdp.ts`'s `waitForCdp()` already polls
internally on every job, just now also polled independently and
continuously by the health layer, not only reactively when a job
happens to run. This is the single most important addition in this
whole document: it is the difference between "found out the lane died
because the next scheduled monitor check failed" (today's reality) and
"found out the lane died within one health-poll interval, before
anything tried to use it."

**Explicit Restart Lane, never silent auto-heal.** A button in the
Control Center (`POST /api/lanes/:laneId/restart`, mirrors the
existing `POST /api/action/startChrome` but targeted at one lane's
container) runs `docker compose restart browser-worker-<laneId>` (see
§6 for the container-naming convention) — nothing auto-restarts a lane
on its own. This is a direct continuation of `health.ts`'s already
-established, explicitly-instructed rule: "never starts or stops
anything itself... no silent auto-start" (`AGENTS.md`'s
Health/diagnostics section). A crashed lane should read as a clear red
row with a specific fix button, exactly like every other failing check
on `/health` today reads as a clear row with a fix *command* (lanes get
an actual button here specifically because "restart this one
container" is unambiguous and low-risk in a way "run this shell
command yourself" checks were deliberately kept manual-only for other,
more consequential dependencies).

**Crash count / last-failure time surfaced in diagnostics**, not just
current status — a lane that's healthy *right now* but has crashed 5
times in the last hour is a meaningfully different operational
situation than one that's never crashed, and the UI/health API should
show that distinction (`crashCount`, `lastFailureAt`,
`lastFailureReason` in the `LaneHealth` shape above) rather than
collapsing history into a single current boolean.

**Verification this design demands before it's considered proven**
(for whoever implements it): deliberately `docker exec <lane
container> pkill chromium` (the same failure mode found empirically
this round) and confirm the lane's health flips to `unhealthy` within
one poll interval **even though `docker compose ps` still shows
`Up`** — this is the one test that actually proves the blind spot is
closed, everything else is necessary but not sufficient.

## 4. Account/session isolation

- **No shared browser context/profile/session between accounts,
  ever** — this falls out structurally from §1 (one container per
  lane) rather than needing separate enforcement: there is no code
  path by which lane A's worker could reach lane B's Chromium, because
  each worker's `network_mode: service:browser-worker-<laneId>` (see
  §6) only ever joins its own lane's network namespace, mirroring
  exactly how `worker`/`worker-firefox` are scoped to their one
  browser container today.
- **Monitor state path is derived from `laneId`, not hardcoded** — a
  direct generalization of the existing single-lane
  `monitor.ts`'s hardcoded `STATE_PATH = .../monitor-state/xc-bank.json`
  into `.../lanes/<laneId>/monitor-state.json` (see §1's table). A
  monitor for lane A can structurally never read or write lane B's
  state file.
- **Every artifact/log line is tagged with `laneId`** — screenshots'
  MinIO prefix (`lanes/<laneId>/screenshots/*`), the existing
  `WEBOP_STEP`/`XC_BANK_DASHBOARD` stdout markers gain a `laneId`
  field, and the Jobs API's per-job record carries `laneId` alongside
  the existing `name`/`state`/`result` fields. This isn't just
  bookkeeping — it's what makes "show me only lane X's jobs/history" a
  real filter instead of a hope that nothing else ever wrote to the
  same job list.
- **Session content still never exposed through the UI/API** — the
  existing rule (`docs/PROJECT_PLAN.md`'s decision log: "the Control
  Panel has no session-related routes or UI at all," and the
  MinIO-readable-artifact-kinds allowlist that deliberately excludes
  `sessions`) carries forward unchanged, per-lane. A future
  `GET /api/lanes/:laneId/artifacts/:kind/:filename` route would keep
  the exact same `sessions`-excluded allowlist `artifacts.ts` already
  enforces today, just additionally scoped to that lane's own MinIO
  prefix.

## 5. Manual takeover / live view

- New route shape: `/lanes/:laneId/live` (or, if lanes map 1:1 onto
  today's site+account framing, `/monitors/:siteId/:accountId/live` —
  functionally the same route, whichever naming reads better once
  there's a real second lane to test against; not a decision this doc
  needs to force now).
- Each lane's live page embeds **that lane's own noVNC endpoint only**
  (`lane.novncUrl`) — directly generalizes the existing
  `xc-bank-monitor-live.html`'s embed of the single hardcoded
  `http://localhost:6080/vnc.html`, with the URL now coming from the
  lane record instead of being a page-level constant.
- **Multiple lanes' live views can be open simultaneously**, each
  pointed at a different noVNC port — this is a natural consequence of
  §1's per-lane port allocation, not new mechanism. A human can take
  manual control of lane A while lane B's automation keeps running
  unaffected, because they're genuinely different browser processes on
  different noVNC ports — unlike today's single shared browser, where
  "take control" and "the bot is running a job" are two views of the
  *same* browser and can visibly collide.
- The Control Center's own Monitors section (`monitors-registry.ts`'s
  existing `listMonitorSummaries()`/`GET /api/monitors` pattern)
  generalizes to list lanes the same data-driven way it already lists
  monitors — no per-lane hardcoding in `app.js`/`index.html`, matching
  the registry's original design intent ("a future second monitor
  shows up here automatically").

## 6. Docker/compose migration

Today's `docker-compose.yml` (read in full while writing this doc) has
exactly one Chromium service (`browser-worker-chrome`), one Firefox
service (`browser-worker-firefox`), and matching `worker`/
`worker-firefox` services bound to them 1:1 via `network_mode:
service:<browser-service-name>`. There is no templating today — each
service is a literal, hand-written block.

**Proposed naming convention**, extending that same hand-written
pattern rather than introducing a compose-generation tool this round:
- `browser-worker-<laneId>` (replaces the fixed
  `browser-worker-chrome`/`browser-worker-firefox` names for anything
  lane-managed) — `environment: BROWSER=chromium|firefox`, `RESOLUTION`,
  `VNC_PASSWORD` all stay as they are today, just per-lane values where
  it matters (e.g. a distinct `VNC_PASSWORD` per lane is a reasonable
  future hardening step, out of scope to decide here).
- `worker-<laneId>` — `network_mode: service:browser-worker-<laneId>`,
  `CDP_URL=http://localhost:9222` (still correct — CDP is loopback
  -only inside that lane's own container/network namespace, same
  reasoning as today, just scoped per-lane instead of globally
  singular), volumes remapped to `./data/lanes/<laneId>/...` per §1's
  table.
- **Port allocation**: today's fixed `6080`/`6081` become
  lane-allocated (`6080 + laneIndex`, or an explicit `novncPort` field
  in the lane registry — either works; explicit is safer against
  accidental collision if lanes are ever added/removed out of order).
  `CDP_URL` itself never needs a *published* port change (it's
  reached via the shared network namespace exactly like today, not
  published to the host) — only noVNC needs a host-reachable port per
  lane.

**Files that need to change when this is actually implemented** (not
done now, listed here so the scope is concrete for whoever picks this
up):
- `docker-compose.yml` — add lane-specific service blocks (or a
  compose override file per lane, if the list grows large enough that
  hand-editing one file stops being practical — a call to make once
  there are more than a couple of real lanes, not now).
- `services/control-panel/src/queue.ts` — per-lane `Queue`/`Worker`
  registry (§2), replacing the current module-level singleton
  `queue`/`worker`.
- `services/worker/src/cdp.ts` — no logic change needed; `CDP_URL`
  already comes from an env var per worker container, which per-lane
  compose services already provide naturally.
- `services/control-panel/src/monitor.ts` — generalize the hardcoded
  `xc-bank.json` state path into a per-`laneId` path (§1/§4); likely
  becomes a factory (`createMonitorState(laneId)`) rather than a
  module of free functions closed over one fixed path, similar in
  spirit to how `monitors-registry.ts` already treats "one monitor" as
  a pluggable unit today.
- `services/control-panel/src/monitors-registry.ts` (or a renamed/
  generalized `lanes-registry.ts`) — becomes the lane registry itself:
  static list (dev) of `Lane` records (§1), each wired to its own
  queue/monitor-state/artifact-prefix.
- `services/control-panel/src/health.ts` — gains the new per-lane CDP
  -reachability check (§3) as a first-class check, not just a
  system-wide one.
- `services/control-panel/src/artifacts.ts` — MinIO prefix helper
  gains a `laneId` segment (§1/§4).
- Control Center UI (`app.js`/`index.html` and the monitor detail/live
  page pair) — lane-scoped rendering, generalized from the existing
  monitor-card pattern.

## 7. Migration steps

Deliberately incremental — each step should be independently mergeable
and independently verifiable, matching how every other feature in this
project has landed (see the empirical-verification discipline
throughout `docs/PROJECT_PLAN.md`'s decision log).

1. **Single-lane registry.** Introduce the `Lane`/lane-registry
   concept (§1, §6) with exactly **one** entry, mapped onto today's
   existing `browser-worker-chrome` + XC Bank monitor unchanged. No
   behavior change — this step is purely "does the current single-lane
   system still work identically when expressed through the new
   registry shape." Proves the abstraction doesn't break anything
   before a second lane ever exists.
2. **Lane health/CDP reachability.** Add the real `cdpReachable` check
   (§3) against that one existing lane, surfaced on `/health` and the
   Control Center. Verify by deliberately killing Chromium inside the
   container (`docker exec ... pkill chromium`, the exact repro from
   this round's own incident) and confirming the new check catches it
   while `docker compose ps` still says `Up` — the concrete test named
   in §3. This step alone is valuable even with only one lane; it
   directly closes the blind spot this whole doc was motivated by.
3. **State/artifact path isolation.** Move the one existing lane's
   monitor state and worker output onto the `data/lanes/<laneId>/...`
   layout (§1). Still one lane, still no behavior change from a user's
   perspective — just proving the path-isolation plumbing works before
   a second lane depends on it being correct.
4. **Second lane proof.** Stand up a genuinely second lane (e.g.
   `xc-bank-demo-2` — same XC Bank site, a second mock account, second
   `browser-worker-xc-bank-demo-2` container) and confirm: separate
   noVNC port, separate CDP endpoint, separate session/profile/state,
   separate MinIO prefix, and that an action on lane 2 has zero
   observable effect on lane 1 (verify by running something on lane 1,
   then lane 2, then re-checking lane 1's state is untouched).
5. **Parallel execution.** Run jobs on both lanes genuinely
   concurrently (not just sequentially proven-separate) and confirm
   via timestamps that lane 2's job's `processedOn` does **not** wait
   for lane 1's job to finish — the same style of proof
   `docs/PROJECT_PLAN.md` already used to confirm today's
   single-queue `concurrency: 1` serialization (`processedOn`/
   `finishedOn` timestamp comparison), just proving the opposite
   property (independence, not serialization) across lanes.

## 8. Security boundaries + limitations

- **CDP must never be exposed publicly**, per lane, same as today —
  each lane's `CDP_URL` stays loopback-only, reached exclusively via
  that lane's own `network_mode: service:...` namespace, never a
  published Docker port. This is unchanged from the existing, already
  -verified reasoning in `docs/PROJECT_PLAN.md`'s decision log
  ("Chromium ignores `--remote-debugging-address`... sharing the
  network namespace reaches it without publishing the [unauthenticated]
  CDP port anywhere") — multiplying the number of lanes must not
  multiply the number of exposed unauthenticated CDP ports.
- **A compromised lane must not be able to see another lane's
  data** — enforced structurally by §1 (separate container, separate
  filesystem mounts, separate network namespace) rather than by an
  application-level permission check that a bug could bypass. This is
  the same "isolation by construction, not by convention" reasoning
  already applied to XC Bank's own isolation from WebOperator itself
  (`docs/PROJECT_PLAN.md`: "verified structurally, not just by
  convention: grepped... for any xc-bank import path").
- **Redis and MinIO stay dev-only/no-auth**, unchanged posture from
  today, for all lanes — this doc does not attempt to add
  authentication to either. A multi-lane Redis instance with no auth
  means any lane's worker process *could* technically reach another
  lane's queue keys if it tried to (BullMQ queues are namespaced by
  string key, not hard-isolated) — acceptable for the same reason
  today's single-queue no-auth Redis is acceptable (loopback-only,
  local dev, no external network exposure), but worth stating
  explicitly: **queue-name isolation is a naming convention, not a
  security boundary**, unlike the container/filesystem isolation
  above which is a real boundary.
- **Per-account encrypted credential vault remains explicitly future,
  production-phase work** — same placeholder-not-production posture
  already documented repeatedly in this repo for `data/profiles/*`,
  `data/sessions/*`, and `data/gmail-tokens/*` (`AGENTS.md`'s Working
  Conventions: "the `data/profiles/` bind mount is an
  explicitly-acknowledged dev-only shortcut until the encrypted
  Session Vault (Phase 2/3) exists"). Multi-lane multiplies the number
  of plaintext dev-only credential/session files on disk (one set per
  lane instead of one set total) — it does not change their security
  posture, and does not bring the encrypted vault any closer on its
  own. That remains Phase 5 (Production) scope per
  `docs/PROJECT_PLAN.md`.

---

## Open questions for whoever implements this

Deliberately left open rather than force a premature decision:

- Static lane registry (a JSON/TS file, dev-only, matching how
  `monitors-registry.ts`'s `MONITORS` array works today) vs. a
  database-backed one — static is almost certainly right for the
  first few lanes (matches this project's consistent "don't add
  infrastructure ahead of a real need" pattern), but worth an explicit
  call once lane count grows past what's comfortable to hand-edit.
- Exact route naming (`/lanes/:laneId/...` vs.
  `/monitors/:siteId/:accountId/...`) — functionally equivalent,
  cosmetic choice, best made once a second real lane exists to name
  concretely rather than in the abstract.
- Whether `browserTargetCount !== 1` should be `degraded` (as
  proposed in §3) or `unhealthy` — proposed as `degraded` here because
  the existing single-lane page-reset step (`prepare-page` in
  `run-workflow.ts`) already self-heals this on the *next* job run by
  closing stale pages; a persistently wrong count between runs is the
  more concerning signal and may deserve escalation to `unhealthy` —
  worth revisiting once real multi-lane data exists to calibrate
  against.
