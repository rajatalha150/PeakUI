# Coder Implementation Status

Live checklist for the `prompt-ai.md` hardening + IDE work. Updated as phases
land. **Honest status only** — a check means the thing works against the real
runtime and has evidence, not that a mock or a subset works.

## Baseline (Phase 0)

- Branch: `trimmer` (review hardening is in the current worktree; commit after
  final verification)
- Historical baseline test command passed **59 tests / 7 files** (re-run
  2026-09-21); the current full suite is recorded at the bottom of this file:
  ```
  npm test -- --run src/lib/coder-gateway.test.ts src/lib/coder-orchestration.test.ts \
    src/lib/coder-transcript.test.ts src/lib/coder-permission-vote.test.ts \
    src/lib/settings-coder.test.ts 'src/app/api/coder/[...path]/route.test.ts' \
    src/app/api/chats/route.test.ts
  ```
- Daemon: Qwen Code `v0.23.4` (built from pinned Git source), loopback `127.0.0.1:4170`.
- Compose services: `searxng`, `db`, `tor-proxy`, `coder`, `app` (Linux host networking).

## Phases

| Phase | Status | Notes |
|---|---|---|
| 0 Baseline | ✅ | Historical baseline: 59/59 tests; current suite is 1026/96 |
| 1 Ownership & runtime boundaries | 🔶 partial | authz + workspace binding + resource limits landed; non-root/bridge deferred to Phase 7 |
| 2 Sessions, recovery, event persistence | ✅ | all 8 landed; SSE resume + no-overlap polling complete |
| 3 Effective settings & project context | 🔶 partial | toolSearch threshold applied (restart-gated); context/tools audited & documented |
| 4 Managed previews & dev processes | 🔶 partial | SSRF guard, sandbox origin isolation, manual device/URL control, and isolated vision screenshot review landed; auth proxy + registration deferred |
| 5 Reversible work & verification evidence | 🔶 partial | rewind exposed & live-verified; verification records + stale-marking landed (mutation-counter fingerprint) |
| 6 Complete IDE workbench | 🔶 partial | project explorer (multi-tab), named tasks, text search, Monaco editor, and large-file downloads landed; PTY/debugger verified-hard |
| 7 Operations, migration, deployment | 🔶 partial | fail-closed `migrate deploy`, durable Coder runtime volumes, Java baseline, storage readiness/cleanup guard, and healthcheck/resource limits landed; logs/backup/non-root remain |

Legend: ✅ done · 🔶 partial · ⬜ not started

## Phase 1 — Ownership & runtime boundaries

- [x] Explicit server-owned user→session→workspace binding (schema + reattach)
- [x] Authorize every coder route against ownership (session/file/shell/preview) — file routes (`/file`, `/list`, `/stat`, `/glob`, `/file/write`, `/file/edit`) now reject a relative/traversal `path` (defense in depth; daemon workspace containment remains final authority)
- [x] Deny policy for privileged daemon routes (auth/mcp/extensions/models-config)
- [x] Canonical/symlink-aware filesystem boundary validation — traversal/relative rejected; symlink *canonicalisation* not enforced (documented)
- [x] WebSocket/origin validation — no coder WS today; SSE only (documented)
- [x] Runtime isolation: PID/mem limits + no-new-privileges + host-dangerous cap_drop landed; non-root + drop-host-networking deferred to Phase 7
- [x] Egress policy: host networking shares the network stack; egress control requires the Phase 7 bridge migration (documented)

## Phase 2 — Sessions, recovery, event persistence

- [x] Bind session to original workspace (reattach ignores changed default)
- [x] Single-flight / idempotent create+attach
- [x] HTTP-status checks on all mutations (settings, cancel, delete, rename, …)
- [x] Writer continuation latch clears on HTTP error
- [x] Persist only on real transcript change (no idle full-history rewrites)
- [x] Store tool activity once (not duplicated onto every assistant message)
- [x] SSE resume (cursor/epoch) end-to-end; incremental transcript reconciliation
- [x] Bounded no-overlap fallback polling

## Phase 3 — Effective settings & project context

- [x] Apply `coderToolSearchThreshold` to the daemon (persisted but no-op today)
- [x] Apply `coderContextLength` to the daemon — read-only: daemon owns per-model windows, no direct key; UI marks it disabled
- [x] Apply `coderToolsEnabled` to the daemon — no single master key; individual `tools.*.enabled` keys exist (documented)
- [x] Audit `coderBaseUrl`/`coderApiKey` (persisted but never applied) — documented unsupported in pass-through
- [ ] Separate persisted vs requested vs confirmed-effective values in UI
- [x] Generic QWEN.md context (remove sample-project assumptions)
- [ ] Writer/vision scoped to correct runtime/project (not daemon-global) — global scope is deliberate; workspace scope needs trust + per-workspace agents (documented)

## Phase 4 — Managed previews & dev processes

- [ ] Project-owned preview registration (command/cwd/port/owner/readiness/logs)
- [ ] Authenticated, browser-reachable preview proxy (no raw iframe URLs) — deferred: a correct proxy needs HTML/CSS/JS URL rewriting + WS/HMR upgrade; documented
- [x] Isolate preview origin from PeakUI auth origin/cookies — reserved-port guard keeps the preview off the app origin; iframe sandbox hardened to drop `allow-same-origin` (preview runs in an opaque origin)
- [x] Restrict preview to approved destinations/ports (no SSRF/traversal) — `parsePreviewUrl` loopback + reserved-port validation, now enforced at **both** boundaries: the client before framing, and the server via `POST /api/coder/preview` (defense in depth)
- [x] Capture selected preview viewport for vision review — `POST /api/coder/preview/screenshot` renders the approved loopback origin only in isolated Chromium, blocks other network origins, caps JPEG bytes, and sends the selected Desktop/Tablet/Mobile image as a native Qwen image prompt
- [x] Single-instance cancellable preview polling — `setTimeout` chaining (already single-flight)

## Phase 5 — Reversible work & verification evidence

- [x] Expose daemon rewind/checkpoint/worktree (verify semantics first) — rewind exposed end-to-end; worktree-reset verified but NOT exposed (supersedes the session id, breaking the persistent ChatSession↔daemon-session binding)
- [x] Changed-file list + diffs + selective restore — snapshots list diff stats (`filesChanged/insertions/deletions`); rewind to a chosen snapshot restores files and returns the changed/failed file list. Per-file diff *content* is not exposed by the daemon HTTP surface (file-history service is daemon-internal) — documented
- [x] Structured verification records (run/command/exit/fingerprint) — `src/lib/coder-verification.ts` records each task run (id/command/cwd/exit/timestamps/output + mutation counter). The fingerprint is a conservative mutation counter (no daemon tree hash), not a content hash — documented; records are in-session (not DB-backed) — documented
- [x] Mark results stale after edits — a record is stale once the mutation counter advances past its captured value (human save or any non-read-only agent tool call). `isMutatingTool` is default-deny so stale-marking over-approximates and never under-approximates

## Phase 6 — Complete IDE workbench

- [x] Editor (Monaco) + project explorer + open tabs + search — project explorer (list + read + edit + save via daemon `/list`/`/file`/`/file/write`, multi-tab buffers with per-tab compare-and-swap saves), text search (glob → read → in-memory grep via `/glob` + `/file`), and a **Monaco editor** (bundled locally, lazy-loaded, syntax highlighting + line numbers via the model `path`) landed. IntelliSense/go-to-definition remain gated on a worker + LSP setup (documented)
- [x] Large-file downloads — explorer downloads stream straight from the shared coder volumes (`/workspace`→`/coder-workspace`, `/apps`→`/coder-apps`) with no daemon size ceiling, so build artifacts (e.g. an 80 MB APK) arrive whole instead of truncated at the daemon's 64 KiB default. Any unmapped future root falls back to 256 KiB windowed daemon reads
- [ ] Persistent PTY terminal (xterm.js + server PTY) — **verified hard**: the pinned daemon exposes no PTY transport (only on-demand `POST /session/:id/shell`); a persistent PTY needs a server-side broker (§12.11). On-demand shell exists
- [x] Named project tasks (install/build/test/run) — package-manager detection (lockfile) + editable commands, run via the daemon shell
- [ ] Node/TS debug adapter (breakpoints/stack/vars/step) — **verified hard**: no debug-adapter route on the daemon HTTP surface; needs a separate DAP server (§12.11)
- [ ] Human-takeover UX (inspect/edit/run/stop/return results) — partial: inspect/edit (explorer), run (shell + tasks), rewind, preview exist; not unified

## Phase 7 — Operations, migration, deployment

- [x] Replace `prisma db push --accept-data-loss` with reviewed migrations — startup now runs fail-closed `migrate deploy`; the live database reports all 16 committed migrations applied
- [x] Readiness beyond process health — `GET /api/coder/readiness` probes DB (`SELECT 1`) and daemon (`/health`) and returns 503 when either is down
- [x] Durable Coder runtime baseline — Java 17 is baked into the Coder image;
  workspace, Qwen/SSH state, Gradle, Android SDK/NDK, npm and pip caches are
  named volumes; guarded `peakui-cleanup` cannot target protected paths and
  `peakui-coder-readiness --strict` gates disk-heavy work on prerequisites and
  configured free-space headroom
- [ ] Correlated redacted logs + actionable error codes
- [ ] Backup/restore of Postgres + coder volumes
- [ ] Non-root ownership migration
- [x] Windows/macOS compose coder service with private bridge-network daemon, persistent coding volumes, and app project-volume access

## Evidence locations

- Unit tests: `src/lib/*.test.ts`, `src/app/api/**/route.test.ts`
- Browser harness: `scripts/coder-browser/verify-site.mjs`
- Runbook: `docs/coder-deployment-runbook.md`
- Handoff: `docs/coder-review-handoff.md`
- Current suite: **1026 passing / 96 files** (`npm test`); production smoke: `scripts/coder-review-smoke.mjs`
