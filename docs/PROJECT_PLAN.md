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

## Phase 1 — Prototype

- [x] Docker เปิด Chromium/Firefox แบบเห็นหน้าจอ (`services/browser-worker`)
- [x] เชื่อม noVNC (`http://localhost:6080` / `:6081`)
- [x] ช่องทาง handoff ระหว่าง Codex/Claude/human (`docs/AGENT_HANDOFF.md`)
- [ ] Control Panel มี Start/Stop/Take control
- [ ] เปิดเว็บ ทดลอง login ด้วยมือ
- [x] บันทึกและนำ browser session กลับมาใช้ (Playwright `storageState`) — `services/worker` `npm run save`/`npm run restore`, verified round-trip via synthetic marker
- [x] ทำ adapter เว็บตัวอย่างหนึ่งเว็บ — `services/worker/src/adapters/the-internet.ts` + `npm run adapter`, verified: dismisses popup, real login, extracts flash message, saves real session
- [x] Playwright worker เชื่อมต่อเข้า browser ผ่าน CDP (Chromium) — `services/worker`, verified: navigates, reads title, screenshots
- [ ] Playwright worker เชื่อมต่อ Firefox ผ่าน WebDriver BiDi

## Phase 2 — Task Engine

- [ ] Queue และ scheduler (Redis + BullMQ)
- [ ] Step-based workflow
- [ ] screenshot/trace ทุกจุดสำคัญ
- [ ] retry, timeout และ circuit breaker
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

- [ ] แยก worker หลายเครื่อง
- [ ] Chrome และ Firefox profiles (multi-user)
- [ ] สิทธิ์ผู้ใช้และ audit log
- [ ] domain allowlist
- [ ] monitoring และแจ้งเตือน
- [ ] backup/restore session vault
- [ ] Chromium sandbox hardening (drop `--no-sandbox`, apply seccomp profile per Playwright Docker docs)
- [ ] noVNC behind HTTPS with short-lived, per-session URLs (currently plain HTTP + static password — dev only)

## Immediate next step

Build the Control Panel: Start/Stop/Take-control, a link into noVNC, and
buttons to trigger `npm run save` / `npm run restore` / `npm run adapter`
instead of running them by hand via `docker compose run`. That's the last
open Phase 1 item besides Firefox/BiDi.
