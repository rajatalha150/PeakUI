# PeakUI Coding Environment: Implementation and Deployment Handoff

## Prompt for the Implementing AI

You are the engineer responsible for hardening and completing PeakUI's Coding
environment. Read this entire file, inspect the current implementation, and then
implement, test, document, and deploy the work below. This is an execution task,
not a request for another proposal. Work through the phases in dependency order.
Do not claim completion when only the UI, mocks, or a subset of the phases works.

Preserve existing projects, user files, accounts, credentials, conversations,
settings, and unrelated PeakUI features. Keep Qwen Code as the agent execution
engine. Reuse its verified capabilities instead of building a competing agent
loop. Add the application-side ownership, persistence, supervision, and IDE
interfaces needed to make that engine dependable.

The user intends to return the completed work to another AI for review. Make the
result reviewable: maintain an implementation checklist, record test evidence,
document deployment and rollback procedures, and provide a final handoff report.
Be explicit about unresolved limitations. Never turn a failed or skipped check
into a passing claim.

## Current Implementation Update

The original assessment below is the requirements baseline. The current reviewed
implementation is committed on branch `trimmer` at `b14886b` and deployed with
`docker compose up -d --build --force-recreate app coder`. It includes server-owned
session/workspace binding, coder gateway authorization, SSE resume, multi-tab
Monaco editing, file CAS saves, workspace search, named tasks, rewind and
verification records, preview SSRF validation, readiness checks, resource limits,
fail-closed Prisma migrations, and isolated preview screenshots sent to the
vision-capable coding agent. The production smoke test is
`node scripts/coder-review-smoke.mjs http://127.0.0.1:3000`; the current suite is
1004 tests across 92 files. Remaining gaps are documented in
`docs/coder-review-handoff.md`: per-user runtimes, non-root/bridge isolation,
managed preview proxy, persistent PTY, debugger, backups, redacted operations
logs, and Windows coder deployment.

## Scope and Working Rules

- Implement the reliability improvements AND the IDE capabilities in this guide.
  Ship them in independently verifiable phases rather than one giant rewrite.
- Read applicable repository instructions and inspect the worktree before edits.
  Preserve changes made by the user or other agents.
- Do not reset the repository, delete volumes, replace existing projects, rotate
  credentials, or change unrelated production services to simplify the task.
- The requested work includes deployment. Proceed with ordinary implementation,
  tests, isolated staging, backups, and deployment within that scope. Ask only
  for missing information that cannot be established from the environment or for
  materially destructive decisions outside this scope. Continue independent work
  while a clarification is pending.
- Use the existing stack, conventions, shared UI components, and auth helpers.
  Introduce dependencies only where they provide substantial domain capability.
- Refactor CodingView along real responsibilities as needed for this work. Avoid
  unrelated formatting changes or a repository-wide architectural rewrite.
- Treat repository contents, generated apps, tool output, and model output as
  untrusted data. They must not grant permissions or redefine platform policy.
- Keep secrets out of source control, logs, screenshots, fixtures, reports, and
  browser payloads. Scope provider, Git, and preview credentials appropriately.
- Use structured parsers and validation for configuration and API contracts.
- Do not silently narrow scope. If a requirement proves infeasible, document the
  specific blocker, evidence, completed work, and remaining acceptance criteria.

## Product Outcome

Build an IDE where the user can:

1. Open the correct project and resume its session after refresh or interruption.
2. Watch, steer, pause, cancel, and inspect the agent's work with accurate status.
3. Edit files, search code, use terminals, run tests, and debug without the agent.
4. Review every change, compare revisions, and restore selected work safely.
5. Preview applications from a remote device, including live reload.
6. Trust that completion claims refer to actual tests of the actual revision.
7. Use multiple sessions without accidental cross-project or cross-user access.
8. Upgrade and recover the installation without losing projects or history.

An idle spinner, a successful HTTP response, or a screenshot alone is not proof
that a task succeeded. Show actual state and attach evidence to results.

## Starting Architecture and Evidence

The assessment on 2026-09-21 found this architecture:

```text
Browser: /coder -> CodingView
    | authenticated /api/coder/*
Next.js gateway
    | Qwen HTTP API / SSE
Qwen Code daemon in coder container
    | model providers, agent tools, filesystem, subprocesses
Persistent workspace / apps / Qwen state / home volumes

Browser also saves a conversation projection through /api/chats to PostgreSQL.
User coder preferences are stored through /api/settings.
```

Revalidate these observations against the checked-out revision before modifying
anything. This guide describes observed implementation, not a guarantee that
the code has remained unchanged.

### Read These Files First

| Area | Files |
| --- | --- |
| Coder UI and lifecycle | `src/app/coder/page.tsx`, `src/app/components/CodingView.tsx` |
| Daemon proxy | `src/app/api/coder/[...path]/route.ts`, `src/lib/coder-gateway.ts` |
| Transcript and interactions | `src/lib/coder-transcript.ts`, `src/lib/coder-permission-vote.ts` |
| Delegation | `src/lib/coder-orchestration.ts` |
| Authentication and authorization | `src/lib/request-auth.ts`, `src/lib/permissions.ts`, `src/lib/auth.ts` |
| Conversation persistence | `src/app/api/chats/route.ts`, `src/app/api/chats/[id]/route.ts`, `src/lib/chat-sessions.ts` |
| Configuration and schema | `src/lib/settings.ts`, `src/app/api/settings/route.ts`, `prisma/schema.prisma`, `prisma/migrations/` |
| Runtime and deployment | `Dockerfile.coder`, `Dockerfile`, `docker-compose.yml`, `docker-compose.windows.yml` |
| Model sync and context | `scripts/sync-coder-models.mjs`, `scripts/coder-workspace/QWEN.md` |
| Browser verification | `scripts/coder-browser/verify-site.mjs`, `scripts/coder-browser/package.json` |
| Existing file UI | `src/app/components/workspace-files/`, `docs/workspace-files-panel.md` |
| Intent and CI | `docs/coding-environment.md`, `.github/workflows/ci.yml`, `package.json` |

The existing WorkSpaces file panel uses a different filesystem/backend from the
coder container. Reuse suitable UI pieces, but do not point coder file operations
at host WorkSpaces paths or assume their ownership model is interchangeable.

### Findings to Address

- The coder gateway checks the broad `workspace-tool.use` permission but does not
  bind forwarded session/workspace operations to the authenticated user.
- All users reach a shared daemon. Writer and vision settings are applied at
  global/user scope in that daemon, despite preferences being per PeakUI user.
- The inspected coder container runs as root with host networking and no
  configured CPU, memory, or PID limit. A persistent volume is not a backup.
- ChatSession has no explicit coder project/workspace binding. Reattachment uses
  the current workspace preference, which may differ from the original session.
- Async session create/load operations can overlap; state changes inside
  `ensureDaemonSession` are not fully guarded by the caller's cancellation flag.
- The gateway drops SSE resume headers. The UI fetches the full transcript every
  1.5 seconds, including when idle, and rebuilds it on each fetch.
- Rebuilding messages triggers repeated idle persistence. Each assistant message
  receives the complete tool-activity list, duplicating data on save and restore.
- Writer fallback continuation is driven by a browser effect. An HTTP error does
  not clear its retry latch because `fetch` resolves on non-2xx responses.
- Several mutations, including settings save and cancellation, do not check HTTP
  success. UI selections can disagree with effective daemon configuration.
- Tool-search budget is persisted but not applied to the daemon. Other coder
  fields, including base URL/API key/tools-enabled, need an end-to-end audit.
- The global QWEN.md injects specific sample-project assumptions and capability
  claims into sessions for unrelated repositories.
- Preview embeds raw URLs in the viewer's browser. Server-side localhost is not
  the viewer's localhost. Some preview polling branches schedule duplicate timers.
- Terminal UI submits one command and waits for output; it is not a persistent
  interactive PTY. CodingView does not provide a full editor/debugger/Git UI.
- App startup runs `prisma db push --accept-data-loss`. Previous deployment
  exposed migration-history/schema divergence that must be reconciled carefully.
- The Windows compose file inspected during the assessment has no coder service.
  Do not claim Windows coder support without implementing and testing it.

The installed Qwen source contained SSE resume support, persisted-session load
paths, session rewind, branches/worktrees, and language-server infrastructure.
Inspect the pinned version's source, `/capabilities`, SDK, and official docs to
establish exact contracts. Existing infrastructure does not prove a feature is
enabled, supported by PeakUI's proxy, or adequate for the desired UX.

In particular, surviving a browser disconnect, restoring conversation history,
and resuming a process after a container restart are DIFFERENT guarantees. Do
not promise that an arbitrary shell process or model request survives a restart.

## Phase 0: Establish a Reproducible Baseline

1. Record the branch/commit, worktree state, image identities, daemon version,
   available capabilities, compose services, and relevant deployment topology.
2. Read the code paths above, existing tests, schema, and migration history.
3. Inventory existing sessions, workspace registrations, and volume ownership
   without exposing private transcripts or credentials in the report.
4. Create an isolated staging deployment with separate ports, credentials,
   volumes, test users, projects, and database. Never connect fault-injection or
   destructive tests to production volumes or live user sessions.
5. Run the focused baseline below. Run required broader repository checks too.
6. Create `docs/coder-implementation-status.md` with phases, decisions, evidence,
   and open blockers. Keep it updated as implementation progresses.

Baseline command, executed from the repository root:

```bash
npm test -- --run src/lib/coder-gateway.test.ts src/lib/coder-orchestration.test.ts src/lib/coder-transcript.test.ts src/lib/coder-permission-vote.test.ts src/lib/settings-coder.test.ts 'src/app/api/coder/[...path]/route.test.ts' src/app/api/chats/route.test.ts
```

At assessment time this passed 59 tests across seven files. That is historical
evidence only; rerun it and report the new result.

## Phase 1: Ownership and Runtime Boundaries

### Authorization

- Introduce an explicit server-owned association between authenticated user,
  project, session, runtime, and allowed filesystem roots. Separate display names
  from identities and canonical paths. Persist these relationships.
- Authorize every session read/mutation, transcript, event stream, permission
  vote, file operation, shell/PTY, preview, Git action, and project operation.
- Derive runtime routing server-side. Caller-provided IDs, workspace paths, client
  headers, model output, and localStorage are not proof of ownership.
- Filter collections by ownership as well as checking individual objects. Do not
  leak foreign workspace names, session IDs, transcripts, or provider metadata.
- Reserve daemon-wide auth/provider/MCP/extension/configuration changes for the
  appropriate administrative boundary. Do not proxy all privileged daemon routes
  merely because a user can use the coder.
- Preserve supported routes without recreating the earlier accidental whitelist
  breakage. Define a tested capability/operation policy with explicit deny rules
  for unknown privileged operations and compatibility tests for required routes.
- Validate filesystem boundaries using canonical paths and symlink-aware checks.
  Cover traversal, encoded paths, renames, uploads, and symlink changes.
- Authenticate WebSocket upgrades and authorize their target. Validate origins
  for cookie-authenticated mutations and WebSockets according to app conventions.
- Define session/token expiry behavior for long-lived streams and terminals.

### Runtime Isolation

- Select and document a supported isolation model. Mutually untrusted users must
  not execute arbitrary shell commands in the same filesystem/security context.
  Per-project runtimes are preferable where projects require separate secrets.
- Run project commands as a non-root user. Add appropriate CPU, memory, PID,
  concurrency, output, and storage limits with configurable defaults.
- Remove coder host networking. Expose only required services through controlled
  routes. Private bridge networking alone is not an egress policy: explicitly
  prevent access to internal database/admin services and host control endpoints.
- Preserve access to configured model providers and package registries through
  deliberate network rules. Verify Linux host-Ollama connectivity after changes.
- Require daemon authentication even where the operator considers the network
  trusted. Keep tokens server-side and out of generated project environments.
- Do not give generated projects the Docker socket. If runtime provisioning needs
  a privileged broker, keep it outside project runtimes with narrowly defined
  operations, validated mounts, images, limits, and owner checks.
- Migrate existing root-owned files and credentials without losing data or making
  private keys readable to other users. Avoid blanket permission loosening.
- Add runtime readiness, graceful shutdown, and process-tree cleanup. Preserve
  installed browser dependencies and verification capability after image rebuilds.

Acceptance: two test users cannot enumerate, read, alter, cancel, or attach to
each other's resources by changing IDs, paths, headers, or stream targets. An
unprivileged project cannot access host control services or another runtime's
secrets. Resource exhaustion is contained and produces a useful status.

## Phase 2: Sessions, Recovery, and Event Persistence

### Durable Identity and Lifecycle

- Bind each coder session to its original project, canonical workspace/worktree,
  runtime, and effective model/approval configuration. Changing a default setting
  must not move an existing session to another project.
- Preserve the relationship between PeakUI session IDs and Qwen storage/runtime
  IDs explicitly; do not assume every upstream identifier is interchangeable.
- Migrate legacy sessions conservatively. Use verified daemon metadata where
  possible; mark ambiguous bindings for resolution without opening the wrong
  project or assigning a shared workspace to an arbitrary user.
- Implement a testable lifecycle/state machine. Include connecting, recovering,
  idle, running, waiting for permission, waiting for user, cancelling, interrupted,
  completed, and failed states where applicable. Server state is authoritative.
- Make create/attach single-flight and idempotent. Use request generation/session
  identity checks and abort signals so late responses cannot update another tab's
  or another selected session's view.
- Keep switching away separate from cancelling/deleting. Delete the requested
  daemon session even if it is not the currently selected UI session. Define
  recoverable cleanup when either database or daemon deletion fails.
- Scope saved active-session preferences to the user and clear stale selections.
- Preserve composer drafts on failed submission. Give submitted prompts stable
  request identities and reconcile uncertain acknowledgements before retrying.
- Cancellation must confirm the server outcome and stop the intended turn and
  relevant children. Distinguish task processes from intentionally retained dev
  servers. Do not show successful cancellation after an HTTP error.

### Recovery and Persistence

- Use Qwen's verified restore paths for persisted history. Do not fabricate agent
  memory by showing a database transcript over a fresh unrelated daemon session.
- Move essential continuation/recovery supervision out of React effects. Reuse
  Qwen's own mechanisms first; add a server supervisor only for proven gaps.
- Make continuation idempotent with durable task/notification identities. Prevent
  two tabs or workers from resuming the same notification twice. Bound retries,
  use backoff, and report terminal failure without losing the pending task.
- After a crash, reconcile interrupted operations and their effects before
  resuming. Never automatically replay an unknown-outcome external mutation.
- Designate an authoritative transcript/event store and a deliberate database
  projection. Avoid two independent writers overwriting history from stale views.
- Store tool calls once, linked to their actual turn/message. Preserve ordering,
  permissions, relevant usage, and output references without duplicating entire
  session activity on every assistant message.
- Use transactional/versioned projection updates as needed for multiple clients.
  Saving a title must not overwrite a newer transcript or vice versa.

### Streaming and Performance

- Carry supported SSE cursor and epoch information end to end. If native
  EventSource cannot express the required headers, use a proven streaming client
  or authenticated fetch streaming with correct SSE parsing.
- Handle duplicate/out-of-order events, replay gaps, epoch changes, and bounded
  retention explicitly. Fetch a snapshot or missing pages when needed.
- Use incremental transcript reconciliation, not full-history polling every 1.5
  seconds. Keep bounded fallback polling with no overlapping requests.
- Persist only on real changes. Limit/render large histories incrementally and
  bound tool-output buffers without silently losing the durable transcript.
- Add timeouts, retry classifications, heartbeat/stall detection, and connection
  state that distinguishes offline from idle. Preserve pending interactions when
  streams reconnect.

Acceptance: refresh, tab closure, rapid switching, two tabs, dropped events,
duplicate delivery, provider outage, and staged daemon restart do not merge
projects, duplicate prompts, or silently erase history. An idle session does not
rewrite its full transcript continuously. Interrupted work is visibly recoverable
without claiming process continuity that the runtime cannot provide.

## Phase 3: Effective Settings and Project Context

- Audit every coder setting from UI/API/schema to effective daemon behavior.
  Implement the supported knobs; explicitly deprecate or disable unsupported
  ones with a migration and explanation. Do not leave working-looking no-ops.
- Separate persisted preference, requested change, and confirmed effective value.
  Check all HTTP statuses; surface failures and avoid misleading saved indicators.
- Apply model/provider/approval changes in a defined order with reconciliation or
  rollback after partial failure. A permission-mode failure must not silently run
  with broader permissions than the user selected.
- Keep writer and vision configuration scoped to the correct runtime/project.
  Empty values must clear old delegates consistently, including after restart.
- Verify real tool/vision capabilities. Treat unknown capability as unknown, not
  confirmed support. Test a minimal tool invocation and image workflow where
  appropriate; do not infer all capabilities from model naming conventions.
- Refresh model availability deliberately. Preserve custom providers and user
  settings during sync; write config atomically and protect concurrent edits.
- Replace sample-project global context with generic runtime instructions plus
  repository-specific context. Respect user-managed project instructions. Put
  generated metadata in a clearly managed location instead of overwriting files
  the user may edit. Report capabilities from verified runtime state.
- Make writer delegation a configurable strategy. Measure direct execution versus
  delegation on representative tasks; do not require every trivial edit to incur
  another model handoff. Keep verification of delegated changes independent.
- Expose context usage, pending tasks, retry/budget limits, and the active model
  clearly. Never interpret a model's self-report as proof that a tool ran.

Acceptance: the UI reflects actual configuration after reload, failure, and
restart. Two users/projects cannot overwrite each other's delegates. A new
repository receives no fabricated sample-project instructions. Every exposed
setting has a test proving its effect or an explicit unsupported state.

## Phase 4: Managed Previews and Development Processes

- Replace arbitrary raw iframe URLs with project-owned preview registrations.
  Track server command, cwd, runtime, port, owner, readiness, logs, and lifecycle.
- Route previews through authenticated, browser-reachable endpoints. Support
  remote devices, HTTPS deployments, WebSockets, and framework live reload/HMR.
- Isolate generated app origins from PeakUI's authenticated origin and cookies.
  Do not treat an iframe allowing scripts and same-origin as sufficient isolation.
- Keep registration restricted to approved runtime destinations/ports. Protect
  against arbitrary proxying, traversal, redirects to internal services, and
  DNS/address tricks. Do not expose database or host admin endpoints as previews.
- Preserve `.peakui-preview.json` compatibility through validated ingestion if
  useful. File content must not itself grant access to an arbitrary destination.
- Make preview polling single-instance, cancellable, and bounded. Detect missing
  servers, port collisions, failed readiness, crashes, and stale registrations.
- Provide start/stop/restart, live logs, actual viewport switching, reload, and
  open-in-new-tab. Do not force the agent's device suggestion over a user's choice
  on every poll.
- Capture browser console errors, failed requests, and screenshots tied to a run.
  Support selecting an element and sending its screenshot/DOM context to the
  agent through a scoped bridge. Validate message origins and payloads.

Acceptance: a test app works from a browser outside the Docker host, including
HMR, navigation, assets, and WebSockets. Preview content cannot access PeakUI's
session or another project. Desktop/mobile layouts remain usable with panes open.

## Phase 5: Reversible Work and Verification Evidence

- Expose Qwen rewind/checkpoint/worktree capabilities after verifying their exact
  semantics. Conversation rewind, file restore, Git reset, and external side
  effects are different operations and must not be conflated.
- Capture a task's starting file state, including relevant uncommitted/untracked
  work. Protect concurrent user edits with version checks and conflict handling.
- Provide changed-file lists, readable diffs, hunk/file review, checkpoints,
  selective restore, branch/worktree selection, staging, and conflict resolution.
- Keep concurrent agent tasks in separate worktrees where appropriate. Do not
  merge or publish changes automatically without the user's applicable intent.
- Make restore actions explicit and preserve a recovery snapshot before replacing
  modified files. Never use destructive Git commands as a blanket undo mechanism.
- Define verification results as structured records: task/run ID, command, cwd,
  exit status, timestamps, tested revision or content fingerprint, and artifacts.
- Mark results stale after relevant changes. Include uncommitted content in the
  fingerprint; a Git commit hash alone does not identify a dirty workspace.
- Add configurable project checks for build, lint/typecheck, tests, and browser
  workflows. Display passed, failed, skipped, running, and stale states accurately.
- Extend the browser harness for real user flows, multiple viewports, runtime
  errors, and deterministic artifact paths. A screenshot is supporting evidence,
  not an assertion that layout, interactions, or functionality passed.
- Bound model retries, tool calls, elapsed time, and output. Give stuck tasks a
  visible reason and controlled recovery path rather than endless continuation.

Acceptance: the user can inspect and selectively restore an agent's changes while
preserving unrelated work. Tests are linked to the exact content tested, and an
edit invalidates previous evidence. Failed checks remain visible and cannot be
presented as successful completion by an agent message.

## Phase 6: Complete the IDE Workbench

Build the actual usable workbench, preserving the existing visual conventions
where practical. Prioritize readable, organized working surfaces over decoration.
Use familiar controls and icons, keyboard accessibility, and responsive layouts.

### Editor and Navigation

- Evaluate Monaco or another established editor against requirements and bundle
  cost. Do not implement a code editor or language engine from scratch.
- Add project explorer, open-file tabs, dirty indicators, save/reload, create,
  rename, move, delete, text search, and file/symbol navigation.
- Add syntax support, diagnostics, go-to-definition, references, rename, formatting,
  and completion through verified language services. Reuse Qwen LSP facilities
  only if their contract is appropriate for interactive editing.
- Synchronize agent edits, external file changes, and editor buffers with version
  checks. Never silently overwrite unsaved human edits. Present conflicts clearly.
- Handle binary/large/generated files and symlinks explicitly. Bound search scope
  and filesystem watching to the authorized project.

### Interactive Terminals and Task Runner

- Use an established terminal frontend such as xterm.js with a server-side PTY.
  Verify whether the pinned runtime exposes a suitable PTY transport first.
- Support streaming output, stdin, resize, Ctrl-C, terminal tabs, persistent cwd
  and environment within a shell session, disconnect/reattach, and exit status.
- Authenticate and scope transport; validate origins; bound buffers and process
  counts. Do not attach arbitrary host processes or leak runtime control secrets.
- Add named project tasks for install/build/test/run with working directory,
  environment references, stop/restart, logs, and visible status.
- Coordinate terminal tasks and managed preview servers so process ownership and
  cancellation behavior remain predictable.

### Debugging

- Integrate proven debug adapters/protocols rather than writing a debugger engine.
- Provide breakpoints, continue/pause/step controls, call stack, scopes/variables,
  debug console, and per-project launch configurations.
- Initially prove a complete Node/TypeScript debugging workflow, including source
  maps. Keep additional supported languages explicit and test their adapters.
- Scope debug ports/transports to the owning runtime and session. Do not expose
  an unauthenticated inspector or allow arbitrary process attachment.

### Agent Collaboration and Workbench UX

- Show task progress, queued instructions, blockers, pending questions, current
  tools, changed files, verification results, and effective configuration together.
- Allow human takeover: inspect/edit files, run commands, stop tasks, review diffs,
  and return results to the agent without losing session identity.
- Support file/selection/diagnostic references and scoped screenshot attachments
  in prompts. Keep permission and user-question responses structured and reliable.
- Provide accessible keyboard navigation, focus handling, pane resize/toggle,
  loading/error/empty states, and durable layout preferences.
- Verify text fit, scrolling, editor sizing, terminal sizing, and non-overlapping
  panels at desktop, tablet, and phone widths. No inert buttons or mock controls.

Acceptance: using the workbench alone, a user can open a project, edit a file,
resolve a concurrent edit, run tests, interact with a long-running terminal,
debug a TypeScript breakpoint, inspect a diff, restore a change, and preview the
result remotely. No chat prompt is required for basic IDE operations.

## Phase 7: Operations, Migration, and Deployment

### Observability and Recovery

- Add readiness separate from shallow process health: database access, daemon
  reachability/version compatibility, workspace accessibility, and provider state.
  Report degraded dependencies without restarting healthy unrelated services.
- Add correlated, redacted logs and actionable error codes for session, task,
  tool, permission, preview, and runtime events. Record administrative changes.
- Track meaningful counters: reconnects, restore failures, duplicate suppression,
  queue depth, stalled tasks, save failures, resource pressure, and verification
  outcomes. Keep retention and output volume bounded.
- Expose useful diagnostics to the appropriate user/admin; never dump credentials,
  arbitrary transcripts, or raw environment variables into a support report.
- Document and test recovery after provider outage, disk exhaustion, process
  crashes, interrupted deploy, and expired authentication.

### Database and Volume Migration

- Remove destructive schema synchronization from normal production startup.
  Use reviewed, versioned migrations and a controlled migration deployment step.
- Inspect existing Prisma migration records and actual schema first. Reconcile
  historical drift using evidence. Do not mark migrations applied merely to make
  an error disappear, and do not edit already-applied migrations casually.
- Prefer additive schema changes and backward-compatible rollout. Explain any
  later cleanup/removal separately from the initial deployment.
- Back up PostgreSQL and coder project/app/state/home volumes consistently before
  migration. Include required encrypted secrets and metadata in the recovery plan.
  Store backups outside the repository and outside the volumes being replaced.
- Restore a backup into an isolated environment and verify history, file hashes,
  permissions, and runtime reattachment. Creating an archive alone is not a
  successful backup validation.
- Plan non-root ownership migration and shared-runtime separation explicitly.
  Retain the old data until migration verification and rollback windows complete.
- Pin runtime/tool dependencies adequately for reproducible builds. Preserve
  browser assets/toolchains and document project-specific dependency manifests.

### Platform Support

- Keep Linux deployment working, including access to host Ollama after removing
  host networking. Do not require exposing Ollama publicly as a workaround.
- Add coder support to the Windows compose topology where feasible and validate
  it on a suitable environment. Otherwise document the exact unsupported platform
  boundary and outstanding work; do not imply Windows parity from Linux tests.
- Validate both compose configurations syntactically without printing interpolated
  secrets. Preserve unrelated existing environment variable contracts.

### Deployment Procedure

1. Record production image identities, schema/migration state, service topology,
   storage layout, and rollback references. Keep secrets out of this record.
2. Build versioned images and run checks in staging. Deploy the same verified
   artifacts, rather than rebuilding different dependencies during promotion.
3. Verify a tested backup/restore path and check for active user jobs. Drain or
   checkpoint jobs according to the implemented interruption policy; do not
   silently kill ongoing work during deployment.
4. Apply reviewed migrations in a controlled, single-run step. Stop on unexpected
   schema/data discrepancies and preserve diagnostic evidence.
5. Deploy the applicable compose services with the new images and configuration.
   Use actual project/service names discovered from the environment, not guessed
   container names. Never run `docker compose down -v`.
6. Wait for bounded readiness checks. Verify authenticated workflows, provider
   tool calling, file operations, terminal, preview/HMR, history restore, and
   isolation. A login redirect or unauthenticated 401 is not a full health test.
7. Check logs and resource behavior. Confirm existing projects, credentials,
   histories, and settings remain accessible to their legitimate owners.
8. Publish the deployment evidence and rollback procedure. If a required check
   fails, execute the compatible rollback/recovery plan instead of claiming a
   successful deployment.

Do not assume rolling back an image rolls back its schema or written data. State
which versions remain schema-compatible and what a database restore would lose.

## Required Validation Matrix

Use unit tests for pure logic, integration tests for real boundaries, and browser
tests for user workflows. Mocks alone are insufficient for daemon compatibility.
Keep fault injection isolated from production. Record skipped checks explicitly.

| Scenario | Required evidence |
| --- | --- |
| User A requests user B's session/files/terminal/preview | Denied without metadata leakage; real auth boundary exercised |
| Path traversal, symlink escape, crafted workspace | Rejected without altering files outside the allowed root |
| Two concurrent projects/users change delegates | No configuration or credential crossover |
| Reopen old project after changing default workspace | Original workspace restored correctly |
| Rapid switching and delayed responses | No messages, permissions, files, or status land in the wrong session |
| Duplicate prompt submission / uncertain acknowledgement | One accepted operation or a clearly reconciled outcome |
| Two tabs consume one writer completion | One continuation, with retries after transient failure |
| SSE disconnect, replay gap, duplicate events, epoch reset | Correct ordered history and recovered pending interactions |
| Idle session and large transcript | No repeated full-history writes; bounded requests/rendering and measured baseline |
| Settings mutation returns 4xx/5xx | Accurate error and effective value, no false saved state |
| Tab closure during work | Server execution/supervision continues as designed |
| Staged runtime restart mid-task | Interrupted state, persisted history, explicit recovery, no blind replay |
| Cancel during shell/subagent activity | Correct process/turn cleanup and truthful final status |
| Delete an inactive session | Correct runtime cleanup, no resurrection or unrelated deletion |
| Concurrent human and agent edits | Conflict surfaced; neither side silently overwritten |
| Rewind with unrelated dirty/untracked files | Intended changes restored; unrelated work preserved |
| Remote HTTPS preview with HMR/WebSockets | Real browser workflow succeeds outside host-local access |
| Malicious preview / disallowed proxy target | Parent session, internal services, and other projects protected |
| Persistent PTY reconnect and Ctrl-C | Correct shell state, input/output, dimensions, and process behavior |
| Node/TypeScript debug session | Breakpoint, source map, stack, variables, step and continue verified |
| Verification followed by source edit | Old results become stale |
| Model/provider unavailable or incompatible | Actionable error, bounded retries, no fake tool success |
| Desktop/tablet/phone layouts | Browser screenshots and interaction checks; no overlapping controls |
| Upgrade from legacy schema/volumes | Existing files/history/ownership preserved in staging |
| Fresh installation | Migrations, runtime setup, initial project, and core workflow succeed |
| Backup restore and rollback rehearsal | Recoverable data and documented compatibility verified |

Run repository tests, production build, relevant lint/type checks, and bundle
checks from the actual package scripts. Adjust CI to exercise the new critical
integration/browser workflows and the intended branch/release process. Do not
claim that the existing main-only CI automatically protects another branch.

Prefer deterministic provider fixtures for lifecycle/fault tests plus a clearly
identified real-provider smoke test. Record daemon/protocol versions so a future
upgrade can rerun the same contract tests.

## Deliverables and Definition of Done

Deliver:

1. Working implementation for all phases, with scoped migrations and deployment
   configuration, preserving existing data and unrelated product behavior.
2. Meaningful tests covering the validation matrix and critical protocol contracts.
3. Updated `docs/coding-environment.md` describing actual behavior, ownership,
   configuration scope, supported platforms, and recovery guarantees.
4. `docs/coder-implementation-status.md` with checked requirements, decisions,
   evidence locations, and explicitly unresolved work.
5. `docs/coder-deployment-runbook.md` with setup, upgrade, backup/restore, runtime
   troubleshooting, and rollback instructions validated against this deployment.
6. `docs/coder-review-handoff.md` summarizing changes for the reviewing AI, including
   architecture/data flow, authorization boundaries, changed APIs/schema, tests,
   deployment identity, URLs, known limitations, and areas needing extra scrutiny.

The final user-facing report must state:

- What works now, grouped by reliability and IDE capabilities.
- Which tests ran, which passed/failed/skipped, and where evidence is stored.
- Which commit/worktree and image versions were deployed and where to try them.
- Whether backup restore and rollback were actually rehearsed.
- Any remaining limitations, incomplete requirements, and operational caveats.

The work is complete only when the implemented features function against the real
runtime, migrations preserve existing data, the required validation has evidence,
and the deployed installation passes authenticated smoke checks. An honest
partial handoff is preferable to labeling unfinished work complete.
