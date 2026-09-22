# Coder Review Handoff

Honest state of the `prompt-ai.md` hardening + IDE work, for the reviewing AI.
An unfinished item is marked unfinished; nothing here is dressed up as complete.

## TL;DR

The **ownership + session + settings hardening (Phases 1–3)** is substantially
done and tested (file-route authorization is now also closed). **Reversible work
(Phase 5)** is partially done: rewind is exposed end-to-end and live-verified,
and verification results are recorded structurally and marked stale after edits.
A **project-explorer + tasks + search + Monaco slice of the IDE workbench
(Phase 6)** is landed: browse, read, edit and save workspace files through the
daemon's file routes (as multi-tab buffers, now in a bundled Monaco editor); run
named tasks over the daemon shell; and search workspace files via the
glob→read→grep composition. **Preview SSRF guarding (Phase 4)** is now enforced
at both the client and the server, and the **operations slice (Phase 7)** landed
  `migrate deploy` plus a db/daemon readiness
endpoint. The **managed-previews auth proxy (Phase 4), the rest of the IDE
workbench (PTY/debugger, Phase 6 — both verified hard)** and the remaining
**operations work (logs/backup/non-root/Windows, Phase 7)** remain **not done** —
documented as gaps. This is a deliberate honest-partial handoff, per the spec.

- Tests: **1001 passing / 91 files** (`npm test`), `npx tsc --noEmit` clean;
  production browser smoke also passes against the deployed app.
- Daemon: Qwen Code `v0.23.4` live at `127.0.0.1:4170`; key wire contracts
  re-verified against the running daemon and its pinned source under
  `/opt/qwen-code/dist`.

## What is DONE (with evidence)

### Phase 1 — Ownership & runtime boundaries (partial)

- **Server-owned user→session→workspace binding.** New `ChatSession.coderWorkspace`
  column (`prisma/schema.prisma`, migration `20260921_bind_coder_session_workspace`),
  threaded through `src/lib/chat-sessions.ts` and `/api/chats`. `CodingView` binds
  the daemon session to the stored cwd on reattach (`sessionWorkspaceRef`) and
  persists the binding after create/load.
- **Authorization on every coder route.** `src/lib/coder-authorization.ts` +
  wiring in `src/app/api/coder/[...path]/route.ts`: ownership check per session,
  admin-only for privileged daemon paths (`/auth` `/mcp` `/extensions` `/usage`
  `/stats`), canonical workspace-path validation rejecting relative/traversal.
  File routes (`/file` `/list` `/stat` `/glob` `/file/write` `/file/edit`) now
  reject a relative/traversal `path` before forwarding (defense in depth; the
  daemon's workspace containment is the final authority). Tests:
  `src/lib/coder-authorization.test.ts`.
- **Shared-runtime boundary.** The current coder daemon is one root, host-network
  runtime. Until per-user runtimes and bridge networking land, the gateway allows
  coder access only to `ADMIN` users; `USER`/`MANAGER` requests are rejected rather
  than being allowed to share a privileged runtime. `docker-compose.yml` also adds:
  `pids_limit`, `mem_limit`, `no-new-privileges`, `cap_drop` of host-dangerous
  caps. **Not done:** non-root, dropping host networking, egress policy — those
  need the Phase 7 bridge-network migration (documented in §9.7 of
  `docs/coding-environment.md` and the runbook).

### Phase 2 — Sessions, recovery, event persistence (complete)

- Session bound to original workspace on reattach (above).
- Single-flight `ensureDaemonSession` (`ensurePromiseRef` + staleness guard).
- HTTP-status checks on every mutation (settings save reverts on failure, cancel,
  delete, writer continuation latch).
- Persist only on real transcript change (signature dedup); tool activity stored
  once (not duplicated onto every assistant message).
- **SSE resume end-to-end.** New `src/lib/coder-sse.ts` (fetch-based client
  sending `Last-Event-ID` + `X-Qwen-Event-Epoch`, streaming parser) replaces
  `EventSource` in `CodingView`; the gateway forwards the resume headers
  (`src/lib/coder-gateway.ts`). Tests: `src/lib/coder-sse.test.ts`,
  `src/lib/coder-gateway.test.ts`.
- **Bounded no-overlap polling** on the transcript + status polls (reentrancy
  guards).

### Phase 3 — Effective settings & project context (partial)

- `coderToolSearchThreshold` → daemon `tools.toolSearch.threshold` (verified
  against the live daemon; `requiresRestart: true`, stated in the UI).
- `coderContextLength` audited — no daemon key (read-only, already disabled in UI).
- `coderToolsEnabled` audited — no single master key (per-tool `tools.*.enabled`).
- `coderBaseUrl`/`coderApiKey` audited — persisted but unused by the pass-through.
- QWEN.md de-sample-ified: now generic discovery guidance (`scripts/coder-workspace/QWEN.md`).
- **Not done:** persisted-vs-effective UI separation (beyond the restart hint);
  writer/vision scoped to a runtime instead of daemon-global (documented in §17.1).

### Phase 4 — Managed previews (partial)

- **Server-side SSRF validation.** New `POST /api/coder/preview` re-validates a
  preview URL at the API boundary via `parsePreviewUrl` (loopback-only, reserved
  ports refused) before it is framed — defense in depth on top of the existing
  client-side check. Tests: `src/app/api/coder/preview/route.test.ts`.
- **Sandbox origin hardening.** The preview iframe dropped `allow-same-origin`,
  so the framed dev server now runs in an opaque origin and cannot reach the
  parent's cookies/localStorage even if it ever landed on the app origin.
- **Not done:** the authenticated preview *proxy* (a correct one must rewrite
  relative URLs and upgrade HMR websockets) and project-owned preview
  registration — documented as gaps.

### Phase 5 — Reversible work (partial)

- **Rewind exposed end-to-end.** New `src/lib/coder-rewind.ts` parses/validates
  the two daemon payloads — `GET /session/:id/rewind/snapshots` →
  `{ snapshots: [{ promptId, turnIndex, timestamp, diffStats }] }` and
  `POST /session/:id/rewind` `{ promptId, rewindFiles }` →
  `{ rewound, targetTurnIndex, filesChanged, filesFailed }` — rejecting malformed
  responses rather than rendering them. `CodingView` gained a **Rewind** panel
  (header button) that lists rewindable turns with their diff stats and rewinds
  to a chosen snapshot (`rewindFiles: true`, the daemon default, restores
  workspace files). Tests: `src/lib/coder-rewind.test.ts` + route tests.
- **Semantics verified against the running daemon.** The request/response shapes
  were extracted from the pinned daemon source (`server-MVEYQQX7.js`,
  `chunk-5TCDEHHY.js`, `acpAgent-NOEM4F3D.js`) and the live routes probed at
  `127.0.0.1:4170` (snapshots return `{"snapshots":[]}` for a fresh session;
  a bogus id returns the daemon's `session_not_found` envelope — the shape the
  parser is written against).
- **Verification records landed.** New `src/lib/coder-verification.ts` turns each
  completed task run into a structured record (run id, command, cwd, exit code,
  start/finish timestamps, output, and the workspace mutation counter captured at
  run start). Because the daemon exposes per-file hashes but no workspace tree
  hash, the fingerprint is a conservative *mutation counter* — advanced by every
  human save (explorer) and every agent tool call that is not a known read-only
  tool (`isMutatingTool` is default-deny, so stale-marking over-approximates and
  never under-approximates). `isVerificationStale` marks a record stale once the
  counter moves past its captured value. `CodingView`'s Tasks panel shows a
  **Verification runs** list with `passed`/`failed`/`error`/`stale` status; a
  failed run stays visible and is never silently restyled as success. Tests:
  `src/lib/coder-verification.test.ts`.
- **Not exposed / not done:** `POST /session/:id/worktree-reset` (supersedes the
  session id, breaking the persistent `ChatSession`↔daemon-session binding);
  per-file diff *content* (the file-history service is daemon-internal and has no
  HTTP route); a content-level fingerprint (the mutation counter is a
  conservative proxy, not a content hash); persisted/DB-backed verification
  records (they live in-session and reset on session switch).

### Phase 6 — IDE workbench (explorer + tasks + search slice only)

- **Project explorer landed (multi-tab).** New `src/lib/coder-files.ts`
  parses/validates the daemon's file payloads — `GET /list` →
  `{ path, entries[{name,kind,ignored}], truncated }`, `GET /file` →
  `{ content, hash, sizeBytes, truncated }`, `POST /file/write` →
  `{ created, hash, sizeBytes }` — rejecting malformed responses. `CodingView`
  gained a **Files** panel: browse directories (`/api/coder/list`), open/read
  files (`/api/coder/file`), edit in a textarea, and save via `POST /file/write`
  with `mode:"replace"` + the `expectedHash` from the read (compare-and-swap, so
  a save cannot clobber a concurrent agent edit). A truncated (hash-less) read
  refuses save rather than guessing. Opened files stay resident as **tabs** (each
  with its own buffer, dirty flag, hash, and save state); re-opening a file
  re-activates its buffer instead of re-reading, and closing a tab keeps unsaved
  buffers isolated. The wire shapes were read from the pinned daemon source and
  confirmed live against `127.0.0.1:4170` (list + read returned the documented
  shape). Tests: `src/lib/coder-files.test.ts` + route tests.
- **Named project tasks landed.** `src/lib/coder-tasks.ts` detects the package
  manager from the workspace-root lockfile (`package-lock.json`/`yarn.lock`/
  `pnpm-lock.yaml`/`bun.lockb`) and builds the four default tasks
  (install/build/test/run) for it; `parseShellResult` validates the daemon shell
  response. `CodingView` gained a **Tasks** panel: editable per-task commands,
  run via `POST /session/:id/shell`, per-task output + exit code. Tests:
  `src/lib/coder-tasks.test.ts`.
- **Workspace text search landed.** New `src/lib/coder-search.ts` composes the
  two client routes — `GET /glob` to enumerate candidates, then `GET /file` per
  candidate with a bounded in-memory case-insensitive line search — since the
  daemon's ripgrep search is an agent tool, not an HTTP endpoint. `parseGlobResult`
  validates the glob payload and `searchLines` never fabricates a match;
  `absoluteWorkspacePath` joins a match to its workspace root and skips the `.`
  root entry. `CodingView` gained a **Search** panel: query input, per-file
  results with 1-based line numbers, bounded candidate count (200) and file size
  (256 KiB). Tests: `src/lib/coder-search.test.ts`.
- **Monaco editor landed.** New `src/app/components/CodeEditor.tsx` bundles
  `monaco-editor` locally (via `loader.config`, no CDN — the container stays
  self-contained) and is lazy-loaded with `next/dynamic({ ssr: false })`, so it
  never enters the server bundle. It replaces the explorer's plain textarea with
  a syntax-highlighted, line-numbered editor; the model `path` is the workspace
  file path, so Monaco infers the language from the extension. The standalone
  build explicitly falls back to Monaco's main-thread editor service when
  language workers are unavailable; IntelliSense / go-to-definition remain
  gated on a worker + LSP setup (documented as a gap).
- **Not built:** persistent PTY and the Node/TS debug adapter — both **verified
  hard** against the pinned daemon's HTTP surface: there is no PTY transport
  (only the on-demand `POST /session/:id/shell`) and no debug-adapter route — see
  `docs/coding-environment.md` §12.11. The unified human-takeover UX (single
  pane tying together explorer/tasks/rewind/preview) is also not built. The
  on-demand shell remains the only terminal.

### Phase 7 — Operations (migration + readiness slice)

- **`migrate deploy` fail-closed.** The image startup command runs only
  `npx prisma migrate deploy`; an unbaselined or inconsistent database stops the
  app instead of silently changing schema with `db push`. Verified on redeploy:
  all 16 committed migrations are applied and the app came up clean.
- **Readiness beyond process health.** New `GET /api/coder/readiness` probes the
  database (`SELECT 1`) and the daemon (`/health`) and returns `503` when either
  is down — separate from `/api/health` (chat/Ollama) and from the daemon's own
  self-reported `/health`. Tests:
  `src/app/api/coder/readiness/route.test.ts`.
- **Not done:** correlated redacted logs, backup/restore, non-root ownership, and
  the Windows compose variant — documented as gaps.

## What is NOT done (honest gaps)

| Phase | Item | Why / where |
|---|---|---|
| 1 | Non-root, drop host networking, egress policy | needs Ollama-reachability bridge redesign — `docs/coding-environment.md` §9.7, runbook |
| 3 | Persisted vs effective value UI | partial (restart hint only) |
| 3 | Writer/vision per-runtime scope | needs workspace trust + per-workspace agents — §17.1 |
| 4 | Managed previews auth proxy + registration | a correct proxy must rewrite relative URLs + upgrade HMR websockets; SSRF guard + sandbox origin isolation landed |
| 5 | Content fingerprint + persisted records | mutation counter is a proxy (not a content hash); records are in-session only; worktree-reset + per-file diff not exposed (see above) |
| 6 | IDE workbench (PTY/debugger) | PTY + debugger verified hard — no daemon transport (§12.11); Monaco editor + explorer + tasks + search landed |
| 7 | Redacted logs, backup/restore, non-root, Windows | not done; migrations + readiness landed |

## Where to look

- **Status checklist (single source of truth):** `docs/coder-implementation-status.md`
- **Design + wire contracts:** `docs/coding-environment.md` (new §12.6 SSE resume,
  §9.7 settings/isolation gaps, §17.1 scope note)
- **Deploy/rollback:** `docs/coder-deployment-runbook.md`
- **Spec being implemented:** `prompt-ai.md`

## Things a reviewer should double-check

1. `CodingView.tsx` `ensureDaemonSession` — the `cwd = sessionWorkspaceRef.current
   || workspace` precedence and the staleness guard (`activeSessionIdRef`).
2. `src/lib/coder-sse.ts` — the reconnect loop's backoff and abort handling; the
   streaming parser's handling of a frame split across `read()` chunks.
3. The gateway authorization — confirm no coder route bypasses
   `authorizeCoderRequest` (GET/POST/PATCH/DELETE all call it).
4. The `cap_drop` set in `docker-compose.yml` — verify the daemon's `--enable-session-shell`
   and `node-pty` still work under the dropped capabilities on a real redeploy
   (not yet exercised against a rebuilt container in this session).
5. The rewind wiring in `CodingView.tsx` — `doRewind` echoes the snapshot's
   `promptId` back verbatim to `POST /session/:id/rewind` (never derived from
   user input), and `parseRewindSnapshots`/`parseRewindResult` reject malformed
   daemon payloads before the UI renders them.
6. The file-route authorization in `route.ts` — confirm `extractFilePath` reads
   `path` from the query for GET routes and from the body for `/file/write` and
   `/file/edit`, and that a traversal/relative `path` is 400'd before the daemon
   is reached (covered by route tests). Also confirm the explorer's save path
   (`saveFile`) refuses a truncated read (null hash) rather than writing without
   a compare-and-swap precondition.
7. The search composition in `CodingView.tsx` `runSearch` — confirm the candidate
   count (`.slice(0, 200)`) and per-file read cap (`maxBytes=262144`) bound the
   request fan-out, and that a non-OK `/file` read is skipped rather than
   erroring the whole search.
8. The verification staleness wiring in `CodingView.tsx` — confirm `workspaceMutation`
   is `humanSaveCount + <mutating tool count>`, that `isMutatingTool` is
   default-deny (unknown tool name ⇒ mutating, so stale-marking can't under-mark),
   and that `verificationRecords`/`humanSaveCount` reset on every session switch
   (load/create/delete) so records never leak across sessions.
9. The preview hardening — `POST /api/coder/preview` re-validates the URL
   server-side via `parsePreviewUrl` (loopback-only, reserved ports refused), and
   the preview iframe sandbox no longer includes `allow-same-origin`.
10. The Monaco editor — `CodeEditor.tsx` bundles `monaco-editor` locally via
    `loader.config({ monaco })` (no CDN) and is lazy-loaded with `ssr: false`; it
    falls back to Monaco's main-thread editor service when language workers are
    unavailable, so IntelliSense is not expected.
11. The migration + readiness slice — the Dockerfile CMD runs
    `npx prisma migrate deploy`, and `GET /api/coder/readiness` returns 503 when
    the DB or daemon is down.
