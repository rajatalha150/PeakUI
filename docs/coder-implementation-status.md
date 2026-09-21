# Coder Implementation Status

Live checklist for the `prompt-ai.md` hardening + IDE work. Updated as phases
land. **Honest status only** — a check means the thing works against the real
runtime and has evidence, not that a mock or a subset works.

## Baseline (Phase 0)

- Branch/commit: `trimmer` @ `8112676` (`fix(coder): annotate vision/tools capability …`)
- Worktree: clean except untracked `prompt-ai.md`
- Baseline test command passes **59 tests / 7 files** (re-run 2026-09-21):
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
| 0 Baseline | ✅ | 59/59 tests; see above |
| 1 Ownership & runtime boundaries | 🔶 partial | authz + workspace binding + resource limits landed; non-root/bridge deferred to Phase 7 |
| 2 Sessions, recovery, event persistence | ✅ | all 8 landed; SSE resume + no-overlap polling complete |
| 3 Effective settings & project context | 🔶 partial | toolSearch threshold applied (restart-gated); context/tools audited & documented |
| 4 Managed previews & dev processes | 🔶 partial | SSRF guard + origin isolation landed; proxy + registration deferred |
| 5 Reversible work & verification evidence | 🔶 partial | rewind (snapshots + restore) exposed & live-verified; verification records + stale-marking deferred |
| 6 Complete IDE workbench | 🔶 partial | project explorer (multi-tab), named tasks, and text search landed; Monaco/PTY/debugger not built |
| 7 Operations, migration, deployment | ⬜ not started | `db push --accept-data-loss` still in image |

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
- [x] Isolate preview origin from PeakUI auth origin/cookies — reserved-port guard keeps the preview off the app origin
- [x] Restrict preview to approved destinations/ports (no SSRF/traversal) — `parsePreviewUrl` loopback + reserved-port validation
- [x] Single-instance cancellable preview polling — `setTimeout` chaining (already single-flight)

## Phase 5 — Reversible work & verification evidence

- [x] Expose daemon rewind/checkpoint/worktree (verify semantics first) — rewind exposed end-to-end; worktree-reset verified but NOT exposed (supersedes the session id, breaking the persistent ChatSession↔daemon-session binding)
- [x] Changed-file list + diffs + selective restore — snapshots list diff stats (`filesChanged/insertions/deletions`); rewind to a chosen snapshot restores files and returns the changed/failed file list. Per-file diff *content* is not exposed by the daemon HTTP surface (file-history service is daemon-internal) — documented
- [ ] Structured verification records (run/command/exit/fingerprint/artifacts) — not built (daemon exposes command/exit/output in tool activity, but no per-command file fingerprint or diff over HTTP; a DB-backed ledger needs product requirements to avoid building the wrong shape)
- [ ] Mark results stale after edits — not built (depends on the verification ledger + file-fingerprint tracking above)

## Phase 6 — Complete IDE workbench

- [ ] Editor (Monaco) + project explorer + open tabs + search — **partial**: project explorer (list + read + edit + save via daemon `/list`/`/file`/`/file/write`, multi-tab buffers with per-tab compare-and-swap saves) and text search (glob → read → in-memory grep via `/glob` + `/file`) landed; Monaco editor not built
- [ ] Persistent PTY terminal (xterm.js + server PTY) — on-demand shell exists; persistent PTY not built
- [x] Named project tasks (install/build/test/run) — package-manager detection (lockfile) + editable commands, run via the daemon shell
- [ ] Node/TS debug adapter (breakpoints/stack/vars/step)
- [ ] Human-takeover UX (inspect/edit/run/stop/return results) — partial: inspect/edit (explorer), run (shell + tasks), rewind, preview exist; not unified

## Phase 7 — Operations, migration, deployment

- [ ] Replace `prisma db push --accept-data-loss` with reviewed migrations
- [ ] Readiness beyond process health (db/daemon/workspace/provider)
- [ ] Correlated redacted logs + actionable error codes
- [ ] Backup/restore of Postgres + coder volumes
- [ ] Non-root ownership migration
- [ ] Windows compose coder service

## Evidence locations

- Unit tests: `src/lib/*.test.ts`, `src/app/api/**/route.test.ts`
- Browser harness: `scripts/coder-browser/verify-site.mjs`
- Runbook: `docs/coder-deployment-runbook.md`
- Handoff: `docs/coder-review-handoff.md`
- Current suite: **969 passing / 88 files** (`npx vitest run`)
