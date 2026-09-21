# Coder Review Handoff

Honest state of the `prompt-ai.md` hardening + IDE work, for the reviewing AI.
An unfinished item is marked unfinished; nothing here is dressed up as complete.

## TL;DR

The **ownership + session + settings hardening (Phases 1–3)** is substantially
done and tested (file-route authorization is now also closed). **Reversible work
(Phase 5)** is partially done: rewind is exposed end-to-end and live-verified. A
**project-explorer + tasks + search slice of the IDE workbench (Phase 6)** is
landed: browse, read, edit and save workspace files through the daemon's file
routes (as multi-tab buffers); run named tasks over the daemon shell; and search
workspace files via the glob→read→grep composition. The **managed-previews proxy
(Phase 4), verification records (Phase 5), the rest of the IDE workbench
(Monaco/PTY/debugger, Phase 6)** and the **operations migration (Phase 7)**
remain **not done** — documented as gaps. This is a deliberate honest-partial
handoff, per the spec.

- Tests: **969 passing / 88 files** (`npx vitest run`), `npx tsc --noEmit` clean.
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
- **Container isolation (additive).** `docker-compose.yml` coder service:
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
- **Not exposed / not done:** `POST /session/:id/worktree-reset` (supersedes the
  session id, breaking the persistent `ChatSession`↔daemon-session binding);
  per-file diff *content* (the file-history service is daemon-internal and has no
  HTTP route); structured verification records; marking results stale after edits.

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
- **Not built:** Monaco editor, persistent PTY, Node/TS debug adapter, and the
  unified human-takeover UX. The on-demand shell (already present) remains the
  only terminal.

## What is NOT done (honest gaps)

| Phase | Item | Why / where |
|---|---|---|
| 1 | Non-root, drop host networking, egress policy | needs Ollama-reachability bridge redesign — `docs/coding-environment.md` §9.7, runbook |
| 3 | Persisted vs effective value UI | partial (restart hint only) |
| 3 | Writer/vision per-runtime scope | needs workspace trust + per-workspace agents — §17.1 |
| 4 | Managed previews (auth proxy, SSRF guard) | raw iframe + `.peakui-preview.json` poll remain |
| 5 | Verification records + stale-marking | not built; worktree-reset + per-file diff not exposed (see above) |
| 6 | IDE workbench (Monaco/PTY/debugger) | project-explorer (multi-tab) + named-tasks + search slices only (see above) |
| 7 | `db push --accept-data-loss` → reviewed migrations | Dockerfile still uses `db push` |
| 7 | Readiness beyond process health, redacted logs, backup/restore, non-root, Windows | not done |

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
