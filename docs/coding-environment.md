# Coding Environment — Design & Delivery Plan (Qwen Code as the brain)

**Status:** SHIPPED + hardening rounds complete (verified against the live daemon)
**Owner:** Platform
**Scope:** A "Coding" surface launched from Settings. A dedicated dev container
runs the **Qwen Code** agent (the coding brain, pointed at our local Ollama
model). PeakUI provides the futuristic TUI/GUI hybrid UI — chat, session
sidebar, terminal, interactive preview browser, and project selection. We do
**not** build a coding-agent engine; Qwen Code already is one.

---

## 1. The key change from the previous plan

The previous plan reused PeakUI's own WorkSpaces agent loop as the coding brain.
That was wrong-headed: Qwen Code is a Claude-Code-parity agentic framework
(subagents, plan mode, LSP, MCP, file edits, terminal, git, session management)
that already talks to **local Ollama models** and ships a **daemon
(`qwen serve`) exposing an HTTP + SSE (ACP) API**.

So the brain is **Qwen Code**, running inside the coder container, pointed at
our local Ollama. PeakUI's job shrinks to three things:

1. **A container** with the dev toolchain + `qwen-code` CLI/daemon.
2. **A thin ACP client** (or reuse the official TypeScript SDK) in the app.
3. **The UI** — chat + session sidebar + terminal + preview browser + project
   selector — speaking to the daemon over ACP.

This removes ~70% of the prior build (no new agent loop, no new tool registry,
no reimplemented file/git/terminal tools — Qwen Code has them).

---

## 2. What we verified about Qwen Code

From the repo (README + `docs/developers/qwen-serve-protocol.md`):

- **Agentic out of the box**: Auto-Memory, Auto-Skills, SubAgents, Agent Teams,
  MCP, Plan Mode, LSP, hooks, git worktrees, computer use.
- **Multi-protocol**: OpenAI / Anthropic / Gemini / Qwen, **plus any local model
  via Ollama / vLLM**, switchable at runtime.
- **Daemon (`qwen serve`)**: binds `http://127.0.0.1:4170` by default, speaks
  ACP over HTTP + SSE, with bearer-token auth and `--allow-origin` for browser
  clients.
- **Session API** (this is what we drive):
  - `POST /session` — create a session bound to a workspace `cwd`.
  - `POST /session/:id/prompt` — send a prompt (streams SSE events).
  - `POST /session/:id/cancel`, `POST /session/:id/resume`, `DELETE /session/:id`.
  - `GET /session/:id/transcript` — full message history.
  - `GET /workspaces/:workspace/sessions` — **list sessions** (sidebar + switch).
- **File API**: `GET /file`, `GET /list`, `GET /glob`, `GET /stat`,
  `POST /file/write`, `POST /file/edit` — so the UI can also render the project
  tree and let the user inspect files.
- **Workspace API**: `GET /workspaces`, `GET /workspace/tools`,
  `GET /workspace/providers`, `GET /workspace/env`, `GET /workspace/preflight`.
- **Install**: `npm i -g @qwen-code/qwen-code@latest` (Node 22+), or the
  standalone installer script.
- **SDKs**: TypeScript / Python / Java clients for the ACP protocol.

---

## 3. Architecture

```
 ┌───────────────────────────────────────────────┐
 │                 peakui-app (Next.js)           │
 │  ┌──────────────────────────────────────────┐  │
 │  │  Coding UI (new):                        │  │
 │  │   chat  ·  session sidebar  ·  terminal  │  │
 │  │   preview browser  ·  project selector   │  │
 │  └───────────────────┬──────────────────────┘  │
 │                      │ ACP client (new)         │
 │        ┌─────────────▼──────────────┐           │
 │        │  coder-gateway (new route)  │           │
 │        │  proxy + auth + SSE relay   │           │
 │        └─────────────┬──────────────┘           │
 └──────────────────────┼──────────────────────────┘
                       │ Docker API (socket) / port
                       ▼
 ┌───────────────────────────────────────────────┐
 │              coder container                   │
 │  · qwen-code CLI + `qwen serve` daemon (ACP)  │
 │  · node, python, go, rust, git, compilers     │
 │  · /workspace (project dir, persistent)        │
 │  · points at Ollama (host) for the model      │
 └───────────────────────────────────────────────┘
```

### 3.1 The `coder` container

A new `docker-compose.yml` service:

- **Base image**: `node:22`-ish + the toolchain (`python3`, `go`, `rustup`,
  `git`, `curl`, `build-essential`, `jq`, …), plus `@qwen-code/qwen-code`
  installed globally.
- **Daemon**: runs `qwen serve` on `0.0.0.0:4170` (or loopback + Docker
  port-map), configured to talk to the host's **Ollama** (`host.docker.internal`
  or the host-network IP) so the brain uses our local models.
- **Persistent volume**: `coder_workspace:/workspace` (projects + qwen's
  `~/.qwen` config/state survive restarts).
- **Long-lived**: dev servers the agent starts stay up between turns.

### 3.2 `coder-gateway` (the only backend code)

A small set of app routes that proxy the browser UI to the coder daemon:

- Forward ACP requests (session create/prompt/transcript/files/workspaces) to
  the daemon, injecting the daemon bearer token server-side (never exposing it
  to the browser).
- Relay the daemon's **SSE** stream to the browser (or bridge to the app's own
  streaming format so the existing chat renderer works unchanged).
- Enforce the security envelope (§5): only the coder daemon's routes, no
  arbitrary host reachability.

The TypeScript SDK may cover most of this; the gateway exists mainly to keep the
daemon token server-side and to bridge SSE + auth cleanly.

### 3.3 The Coding UI

- **Chat** (center) — the Qwen Code conversation, streamed from the daemon.
  Reuses the existing markdown/drip/thinking renderers.
- **Session sidebar** (right) — list sessions (`GET /workspaces/:workspace/sessions`),
  switch, create, rename — like Hermes.
- **Terminal pane** (bottom, collapsible) — the agent's shell output, plus a
  manual command line (via `POST /session/:id/prompt` with a shell command, or
  Qwen Code's own terminal tool output).
- **Preview browser** (expandable) — an iframe pointed at a dev-server port the
  agent exposes; interactive (click/scroll/type). The AI can navigate it to
  demonstrate running apps.
- **Project selector** — pick the `cwd` for a new session from the mounted
  `/workspace` (or host-mounted project dir).

### 3.4 Aesthetic

Futuristic cyberpunk, TUI + GUI mix: terminal panes in monospace with a
CRT/scanline feel; GUI panels with neon accents (cyan/magenta/amber), glassmorphism,
and subtle animated grid backgrounds. It is a **skin** over existing components,
so text stays readable and accessibility is preserved.

---

## 4. Delivery plan (phased, each shippable)

### Phase 0 — Spike: `qwen serve` + local Ollama
- Stand up the coder container (or run qwen-code on the host first) with
  `qwen serve`, point it at the local Ollama model.
- Verify over curl: `POST /session`, `POST /session/:id/prompt`, read the SSE
  stream, `GET /session/:id/transcript`.
- **Exit:** a working daemon + one scripted prompt/response round-trip on our
  model. This de-risks the entire "brain" question before any UI.

### Phase 1 — Container + gateway
- Finalize the coder `Dockerfile` + compose service + volume + `qwen serve`
  entrypoint (env-driven model/endpoint).
- Implement `coder-gateway` routes: session create/list/prompt/transcript, file
  read/list, with server-side token injection + SSE relay.
- **Exit:** from a curl (or a hidden test page), the app can drive a full Qwen
  Code session in the container.

### Phase 2 — Coding UI shell
- "Coding" button under Settings → launches the surface.
- Chat (streamed) + session sidebar (list/switch/create) + terminal pane.
- **Exit:** the user can chat with the Qwen Code agent, watch it work, and
  switch sessions.

### Phase 3 — Preview browser + project selection
- Interactive preview iframe (port mapping from the agent's dev servers).
- Project/directory selector feeding `POST /session` `cwd`.
- **Exit:** the agent starts a dev server and the user sees + interacts with it.

### Phase 4 — Tool install + hardening + skin
- "Install a tool" from the UI/chat (delegated to Qwen Code's terminal tool, or
  a direct package-install route with confirmation).
- Security envelope, resource caps, cyberpunk skin, docs.
- **Exit:** feature complete.

---

## 5. Security envelope (non-negotiable)

- The coder container runs unprivileged with CPU/memory caps; no host FS access
  beyond the mounted project dir; no access to the DB/searxng/tor-proxy.
- The daemon bearer token lives server-side in the app; the browser never sees
  it. The gateway is the only path to the daemon.
- The preview browser is restricted to the coder container's dev-server ports;
  it cannot reach the host or other services.
- Destructive/install commands require confirmation (mirror the existing shell
  tool's guard).

---

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| qwen-code version churn (active project) | API drift | Pin a version; spike first (Phase 0) |
| Ollama-in-container networking | Model unreachable | host network or host-gateway; verify in spike |
| SSE relay complexity | Choppy chat | Bridge to app's streaming format early (Phase 1) |
| Daemon CORS/auth friction | Browser can't reach daemon | `--allow-origin` + server-side token in gateway |
| Fat toolchain image | Slow first build | Layered Dockerfile; cache |

---

## 7. Phase 0 results (verified)

Built `@qwen-code/qwen-code@0.23.4` from the official `QwenLM/qwen-code`
source (the npm registry name is flagged by a heuristic scanner — false
positive for this heavy agentic CLI — so we build from pinned Git source).

**Round-trip proven against local Ollama** (`qwen serve --port 4170`):

- `GET /health` → `{"status":"ok"}`
- `GET /capabilities` → full feature list (session_create/prompt/list/events,
  workspace_mcp/agents/memory, file routes, …), `workspaceCwd`, qwenCodeVersion.
- `POST /session {cwd}` → `sessionId` (UUID).
- `POST /session/:id/prompt {prompt:[{type:"text",text:"…"}]}` → `202 {promptId,lastEventId}`.
- `GET /session/:id/transcript` → `events[]` with `sessionUpdate` →
  `agent_message_chunk` → **the local model's answer** + `usage` (tokens).
- `GET /workspaces/%2F...%2Fsessions` → session list with `sessionId`,
  `displayName`, `createdAt`, `activeWorkState`, `isWaitingForPermission`,
  `isWaitingForUserQuestion`, `pendingInteractions` — everything the sidebar needs.

**Auth/config findings (encode in the container + settings UI):**

- Auth type is inferred from env: `OPENAI_API_KEY` + `OPENAI_MODEL`(or
  `QWEN_MODEL`) + `OPENAI_BASE_URL` → `openai` auth type. **Ollama is reached
  via the `openai` auth type pointed at `http://127.0.0.1:11434/v1`** with a
  dummy key. Anthropic/Gemini/Vertex/Qwen-OAuth are the other built-in types.
- The model id must be **Ollama's exact name** (e.g.
  `hf.co/Qwen/Qwen2.5-Coder-14B-Instruct-GGUF:latest`), not a short alias.
- User settings live at `~/.qwen/settings.json` (`modelProviders` +
  `providerProtocol` + `model.name`). Credentials come from env, not the file.
- `prompt` body is a **content-blocks array** (`[{type:"text",text:"…"}]`), not
  a bare string.

## 8. Delivery status

All phases (0–4) shipped. The sections below record what the post-delivery
audit and the subsequent hardening rounds found and fixed. The spike removed
the two big unknowns (Ollama auth + the prompt/transcript wire shape) early;
the container, gateway and UI followed, and were then repeatedly hardened
against real usage.

---

## 9. Post-delivery audit and fixes (verified)

An audit of the shipped Coding surface found that the container, gateway and UI
each had a class of bug that made the feature look broken. Findings and fixes:

### 9.1 "The tools aren't available" — actually a model-selection bug

Captured the literal wire payload the daemon sends to Ollama with a logging
proxy (`POST /v1/chat/completions`):

```
TOOL_COUNT=33
TOOL_NAMES=agent,artifact,ask_user_question,...,read_file,...,run_shell_command,
           ...,write_file,zoom_image
```

**All 33 tools are declared.** The daemon was never withholding them. The real
fault: `gemma4:latest` (the old `CODER_MODEL` default) *received* 33 tool
schemas and reported only 4 (`update_goal, web_fetch, write_file, zoom_image`),
then **hallucinated tool output** — asked to run `echo PEAKUI_TOOL_TEST` via the
shell it emitted the text `PEAKUI\_TOOL\_TEST` with no `tool_call` event in the
transcript at all. Switching to a capable model produced a genuine
`run_shell_command` call and a real result.

Fixes:
- `scripts/sync-coder-models.mjs` now reads each model's `capabilities` from
  Ollama, logs how many are tools-capable, warns when `CODER_MODEL` is not, and
  defaults to the first tools-capable model instead of `models[0]`.
- `.env` / `.env.example` set `CODER_MODEL=deepseek-v4.1-flash:cloud` and
  document how to verify tools capability (`capabilities` containing `tools`).
  The previous comment recommended `gemma4, ornith, nemotron-3.5-lightning,
  muse-glimmer`, which are not real public model names.
- The UI dropdown is driven by the daemon's `/workspace/models` (authoritative,
  routable models with real context windows) rather than raw `/api/tags`, and
  annotates entries that lack tool support with `⚠ no tools`.

### 9.2 `.env` never reached the container

`.env` had **zero** `CODER_*` keys, while `docker-compose.yml` reads five of
them. Compose silently substituted its own defaults, so the Coding surface
ignored the file entirely. Added `CODER_SERVER_TOKEN`, `CODER_MODEL`,
`CODER_OPENAI_BASE_URL`, `CODER_OPENAI_API_KEY`, `CODER_PORT`,
`CODER_DAEMON_URL` to `.env` (and uncommented them in `.env.example`).

### 9.3 The gateway was a hand-maintained whitelist

`src/app/api/coder/[...path]/route.ts` proxied 8 of the daemon's 39 routes.
Missing were the ones the UI actually needs:

| Missing route | Consequence |
|---|---|
| `GET /session/:id/status` | Polled every 1.2s → 404. Live status never worked. |
| `POST /session/:id/cancel` | No way to stop a running turn. |
| `POST /session/:id/approval-mode` | No approval control (daemon accepts `plan/default/auto-edit/auto/yolo`; the UI exposes only `auto`/`yolo`, default `yolo`). |
| `POST /session/:id/permission/:id` | Any tool needing approval stalled forever — the UI said "Needs approval" with no way to approve. |
| `workspace/settings`, `set-tool-enabled`, `workspace/tools` | No tool inspection or toggles. |
| `file/list/glob/stat/write/edit`, `stats`, `context`, `lsp`, `tasks`, `agents`, `supported-commands`, … | No file tree, stats, LSP, subagents, or slash commands. |

Replaced with a genuine pass-through that allow-lists the daemon's API
*prefixes* (so a crafted path cannot walk the gateway into an unrelated route)
and relays `GET /session/:id/events` as a raw SSE stream. `x-qwen-client-id` is
forwarded so a browser tab keeps a stable identity for permission votes.

### 9.4 Coding settings were not persisted at all

`src/lib/settings.ts` had no coder fields, so the model choice lived only in
transient daemon + React state and reset on every new session or reload. Added
`coderModel`, `coderBaseUrl`, `coderApiKey`, `coderApprovalMode`,
`coderContextLength`, `coderToolSearchThreshold`, `coderWorkspace`,
`coderToolsEnabled` to `AppSettings` / `DEFAULT_SETTINGS` / `normalizeAppSettings`
and to the `/api/settings` whitelist, plus a Prisma migration. The API key is
scrubbed from responses like the other provider keys.

### 9.5 Container: `procps` was genuinely required

The daemon snapshots the ACP child's process tree on shutdown via `/bin/ps`:

```
error="ACP child pid=45 process-tree snapshot failed: spawn /bin/ps ENOENT"
ACP process registry shutdown error → daemon shutdown incomplete
```

without which it cannot reap the child, leaving an orphaned ACP process holding
the workspace across restarts. `procps` is now installed and the reason is
documented in the Dockerfile.

### 9.6 The UI now renders status + activity on the chat surface

The previous UI parsed `agent_thought_chunk` and threw it away, never rendered
tool activity, never surfaced permission prompts, never wired "stop", and
rendered everything as raw `pre-wrap` text. It also polled the (404-ing) status
route every 1.2s and persisted only `{role, content, usage}` — so reopening a
session lost all tool history.

The rewritten `CodingView`:
- Subscribes to the daemon's SSE event stream for live updates (low-frequency
  status poll retained purely as a reconciliation safety net).
- Renders an inline **live status banner** on the chat surface ("thinking…",
  the running tool's title, "waiting for you") with an inline **Stop** button.
- Renders **permission / user-question prompts inline** with Allow /
  Always-allow / Deny, wired to the daemon's permission-vote route.
- Renders a **tool-activity feed** with per-row expand showing `rawInput` and
  output, status glyphs, and the daemon tool name.
- Renders **thinking** in a collapsible block.
- Persists tool activity and thinking into the message `meta` so reopened
  sessions restore what the agent did, not just its prose.
- Exposes a **Settings drawer** for workspace cwd and the tool-search budget,
  and header controls for model + approval mode.

### 9.7 Known remaining gaps

- **Workspace isolation mismatch.** The coder container uses its own
  `coder_workspace` volume at `/workspace`; the app mounts
  `WORKSPACE_TOOL_HOST_WORKSPACE_DIR` at `/mnt/workspace-tool/workspace`. The
  coding agent therefore edits a different tree than WorkSpaces. Reconciling
  these is a deliberate follow-up (it changes what the agent can see).
- **`coderContextLength` is read-only in the UI.** The daemon owns per-model
  context windows; overriding one requires the model-management route, which is
  not yet wired to a control. (Audited: no direct daemon settings key exists for
  a per-model context window — confirmed against `GET /workspace/settings`.)
- **`coderToolSearchThreshold` → `tools.toolSearch.threshold`.** Wired and
  verified against the live daemon: `POST /workspace/settings` with
  `{ scope: 'user', key: 'tools.toolSearch.threshold', value }` persists the
  budget. It is `requiresRestart: true`, so the write survives to ~/.qwen config
  but takes effect on the daemon's next restart — the UI hint states this
  instead of pretending it is live.
- **`coderToolsEnabled` has no single daemon key.** The daemon exposes
  per-tool toggles (`tools.toolSearch.enabled`, `tools.webSearch.enabled`,
  `tools.listDirectory.enabled`, `tools.todoWrite.enabled`, …), each
  `requiresRestart: true`. A master on/off is therefore not a faithful mapping;
  `coderToolsEnabled` remains persisted but unapplied until a per-tool policy is
  chosen.
- **`coderBaseUrl` / `coderApiKey` are persisted but unused by the pass-through.**
  The daemon derives its model providers from its own `~/.qwen` config, not from
  PeakUI settings; these two fields do not reach the daemon and are scrubbed on
  read (`coderApiKey` returns `''`).
- **§5 envelope vs. reality (runtime isolation).** The coder container now has
  `pids_limit`, `mem_limit`, `no-new-privileges`, and drops the host-dangerous
  capabilities (`NET_ADMIN`, `SYS_ADMIN`, `SYS_MODULE`, `SYS_RAWIO`, …), but it
  still runs **as root** and uses **host networking** so it can reach the host's
  Ollama at `127.0.0.1:11434`. Consequence: the container can still reach the
  DB (`:5432`), searxng (`:8080`) and tor-proxy (`:9050`) — the §5 "no access to
  DB/searxng/tor-proxy" egress rule is **not enforced**. Enforcing it (and going
  non-root) requires the Phase 7 bridge-network migration so Ollama stays
  reachable without the host network stack.
- **No coder WebSocket today.** The daemon ships an `/acp` WS transport but the
  app uses SSE exclusively; the gateway does not relay WS. If WS is ever enabled,
  an `Origin` allow-list must be enforced at the gateway (same-origin only),
  because WS has no equivalent of the SSE resume headers to scope it.
- The preview browser is still a plain iframe; the security envelope in §5
  (restricting it to the coder container's dev-server ports) is not enforced.

---

## 10. Hardening round — chat rendering, permission votes, isolation

The first audit fixed the *brain* and *plumbing*; a second round of real use
exposed three further classes of bug in the UI layer and the session lifecycle.

### 10.1 The chat dropped the first message and cross-wired turns

The chat was built by **incrementally appending** SSE frames under a shared
`live-` id. Because the SSE subscription opened *after* `send()` fired, the
first message's response was emitted before the listener attached — it
vanished. Turn boundaries also collided, so thinking and messages from
different turns merged, then were wiped when `idle` fired.

**Fix:** the chat is now a deterministic projection of the daemon's
**transcript endpoint** (`GET /session/:id/transcript`), polled on a 1.5s
cadence. The SSE stream only drives the live status line and permission
prompts; it no longer writes messages, so it cannot race, drop, or duplicate.
A `coder-transcript.ts` module folds raw events into ordered
messages + tool activity (`buildConversation`) and serialises the whole
session to text (`serializeConversation`), the same source that powers the
copy button. Optimistic user-message appends were removed — they were the
source of the literal `hello hello` duplicate.

### 10.2 Assistant replies rendered as raw text

The assistant bubble rendered `{msg.content}` in a monospace font with no
markdown. Switched to PeakUI's own `AssistantContent` (the Hermes markdown
renderer: headings, code blocks with copy, lists, tables, inline code,
bold/italic) and `ThinkingBlock` (the collapsible "Thought process" panel) for
thinking. The noisy per-message "accepted" badge was removed; only a
"sending…" / "failed" status remains, and only while meaningful.

### 10.3 Permission votes were malformed (ACP nests `outcome`)

The vote body was a **flat** `{ outcome: 'selected', optionId }`, but ACP's
`RequestPermissionResponse` nests `outcome` as a discriminated union. The
daemon 400'd every vote, which the UI collapsed into a misleading "That request
is no longer pending." message while the agent stayed blocked forever.

**Fix:** `src/lib/coder-permission-vote.ts` builds the nested shape
(`{ outcome: { outcome: 'selected', optionId } }` / `{ outcome: { outcome:
'cancelled' } }`). `answers` is a top-level sibling for `ask_user_question`.
Covered by `coder-permission-vote.test.ts`, which asserts the flat shape is
never emitted.

### 10.4 `ask_user_question` rendered as an empty card

The biggest UX gap. The agent's `ask_user_question` tool asks the user real
questions (e.g. "there are no deploy credentials — how should I deploy?"), but
the content lives in a `questions[]` array
(`{ answerKey, header, question, options: [{ label, description }] }`) that the
parser ignored. The card showed a generic "The agent has a question" with dead
`Submit/Cancel/Deny` buttons, and — because the user could not answer — the agent
silently fell back to "safe defaults" and proceeded anyway.

**Fix:** `CodingView` now parses `questions[]`, renders each question with its
header, full text, and clickable options (descriptions as tooltips), and sends
all answers at once via `answers: { answerKey → option label }` — matching the
daemon's own TUI (`AskUserQuestionDialog.tsx`, which uses `option.label` as the
answer value). A "Submit answers" button is disabled until every question has a
choice.

### 10.5 Session delete nuked the whole surface

`DELETE /api/chats` with `{ id, surface: 'coder' }` — exactly what the Coding
view sends — was ordered so that *any* present `surface` meant "delete every
session on that surface". One click deleted all coder sessions, then the
transcript poll re-persisted the still-open ones as zombies that "kept popping
back".

**Fix:** a specific `id` (or `ids`) now always wins over a `surface` that
rides along; only a *bare* `surface` (no id) triggers surface-wide deletion.
Covered by `src/app/api/chats/route.test.ts`, which fails against the old
ordering.

### 10.6 Daemon sessions were never closed (memory / state leak)

The daemon session is where the agent's conversation memory and working context
live. It was never torn down on delete / switch / new-session, so memory could
bleed across sessions and an abandoned tab kept the ACP child alive.

**Fix:** `closeDaemonSession()` calls `DELETE /api/coder/session/:id` on
delete, switch-to, new-session, and (via the handle being nulled first) any
stale poll in flight. The minted `clientId` is cleared alongside.

---

## 11. Hardening round — approval model, git identity, on-demand shell

### 11.1 Approval reduced to `auto` | `yolo`, default `yolo`

The daemon supports `plan / default / auto-edit / auto / yolo`, but the Coding
surface runs inside an isolated, disposable container, so gating ordinary tool
use reads as "it kept asking me for permissions". `CoderApprovalMode` is now
`'auto' | 'yolo'` with a `'yolo'` default; the legacy restrictive modes
normalise down to the default instead of leaking back in. **Verified:** under
`yolo` a shell tool ran with `isWaitingForPermission=false` and no prompt,
while `ask_user_question` (a *separate* tool, not an approval gate) still
pauses the agent when it genuinely needs an opinion/advice/clarity.

### 11.2 Git identity for the agent's commits

The container runs as `root` and has `git`, but `git commit` failed with no
`user.name`/`user.email`. The Dockerfile now sets `GIT_AUTHOR_*` /
`GIT_COMMITTER_*` env vars (env-driven so operators can override the author per
deployment). **Verified:** a real `git init` + `add` + `commit` through the
shell endpoint produced a commit.

### 11.3 On-demand terminal pop-up

The daemon has `POST /session/:id/shell`, but it was (a) gated behind
`--enable-session-shell` (now passed in the Dockerfile CMD, permitted on trusted
loopback) and (b) blocked by a client-id handshake — the daemon **mints** its own
`clientId` on session create and rejects any caller-invented id.

**Fix:** the Dockerfile adds `--enable-session-shell`; `ensureDaemonSession`
captures the daemon-minted `clientId` and echoes it; a **Terminal** button opens
a pop-up with a command input + scrollable output running as root in the
container. **Verified:** `id -u` → `0` / `whoami` → `root` through the endpoint.

### 11.4 Client-id handshake (the shell unblocker)

`POST /session` returns `{ sessionId, clientId, … }` where `clientId` is the
daemon's *minted* identity (`client_<uuid>`). Every per-session call (shell,
permission votes) must echo that id via `x-qwen-client-id`; the bridge rejects
un-issued ids with "client id is not registered for session". The gateway
forwards `x-qwen-client-id`, and `CodingView` stores the minted id in a ref,
clearing it when the session is closed so a stale id cannot leak across
sessions.

---

## 12. Wire-contract reference (verified against the live daemon)

The shapes below are the ones the UI actually depends on, verified by
interrogating the running `qwen serve` and the pinned Qwen Code source. They are
the canonical answers to "what does the daemon really send?" — kept here so a
future reader does not have to re-derive them.

### 12.1 Session create

```
POST /session { cwd }
→ { sessionId, workspaceCwd, attached, clientId, createdAt, hasActivePrompt }
```

`clientId` is minted by the daemon and must be echoed on later per-session
calls.

### 12.2 Prompt / transcript events

`POST /session/:id/prompt { prompt: [{ type: 'text', text }] }` → `202`.
`GET /session/:id/transcript` → `{ events: [{ type: 'session_update', data: {
sessionUpdate, ... } }] }` with `sessionUpdate` values:

- `user_message_chunk` / `agent_message_chunk` / `agent_thought_chunk` — carry
  `content: { type: 'text', text }`; trailing empty `agent_message_chunk`
  frames carry only `_meta.usage`.
- `tool_call` / `tool_call_update` — carry `toolCallId`, `status`, `title`,
  `kind`, `rawInput`, `content`, `rawOutput`, `_meta.toolName`.

### 12.3 Permission vote

```
POST /session/:id/permission/:requestId
→ { outcome: { outcome: 'selected', optionId } }            // approve action
→ { outcome: { outcome: 'cancelled' } }                     // reject
→ { outcome: { outcome: 'selected', optionId }, answers: { answerKey: label } }
```

`answers` is only for `ask_user_question`; values are the chosen option
**labels**, keyed by each question's `answerKey` (a `"0"`, `"1"`, … index
string).

### 12.4 Pending interaction (status / SSE)

Permission ask: `{ requestId, kind: 'permission', action: { title, content,
input }, options: [{ optionId, name/kind }] }`.

Question ask: `{ requestId, kind: 'user_question', title, questions: [{
answerKey, header, question, options: [{ label, description }], multiSelect }],
options: […] }`.

### 12.5 Session shell

`POST /session/:id/shell { command }` (with `x-qwen-client-id`) →
`{ exitCode, output, aborted }`. Requires `--enable-session-shell` on the
daemon.

### 12.6 Event-stream resume (cursor + epoch)

`GET /session/:id/events` frames each bus event as `id: <decimal>\n` followed by
`data: <json>\n\n` (no `event:` line — the caller reads `type` / `sessionUpdate`
from the JSON). The daemon replays the ring buffer after the client's cursor on
reconnect, keyed by two request headers:

- `Last-Event-ID: <decimal>` — the last `id:` the client saw (the standard SSE
  resume cursor).
- `X-Qwen-Event-Epoch: <n>` — the session's event-bus epoch. The daemon returns
  the current epoch on the **`X-Qwen-Event-Epoch` response header**; the client
  echoes it back so a stale `Last-Event-ID` from a *replaced* bus (session
  recreated) is refused rather than replayed wrongly.

`EventSource` cannot set custom headers, so `CodingView` uses a fetch-based
client (`src/lib/coder-sse.ts`) that tracks the last `id` + the epoch header and
sends both on every reconnect. The gateway (`forwardableRequestHeaders`) forwards
the two resume headers and passes `X-Qwen-Event-Epoch` back on the response. The
transcript poll remains the reconciliation backstop regardless.

### 12.7 Reversible work (rewind)

The daemon keeps a per-session file-history service and exposes two reversible-
work routes, both under the existing `/session/:id/...` pass-through (so they are
session-ownership checked by `authorizeCoderRequest` like every other session
route):

- `GET /session/:id/rewind/snapshots` → `{ snapshots: [{ promptId, turnIndex,
  timestamp, diffStats: { filesChanged, insertions, deletions } }] }`. One entry
  per rewindable user turn; `promptId` is the opaque rewind target.
- `POST /session/:id/rewind` with `{ promptId, rewindFiles }` → `{ rewound,
  targetTurnIndex, filesChanged, filesFailed }`. `rewindFiles` defaults to true
  when omitted; when true the workspace files are restored to that snapshot and
  the changed/failed paths are returned. `rewound` is `filesFailed.length === 0`.

These shapes were read from the pinned daemon source and confirmed live
(snapshots return `{"snapshots":[]}` for a session with no rewindable turns; a
bogus id returns the `session_not_found` envelope). `src/lib/coder-rewind.ts`
owns the *pure* parsing/validation so a malformed daemon payload is rejected
before the UI renders it or echoes a `promptId` back as a target.

**Not exposed:** `POST /session/:id/worktree-reset` (it supersedes the session id
with a replacement, which breaks the persistent `ChatSession`↔daemon-session
binding) and per-file diff *content* (the file-history service is daemon-internal
with no HTTP route — only the aggregate `diffStats` and the rewind result's
`filesChanged`/`filesFailed` lists are available).

### 12.8 Workspace files (project explorer)

Workspace-scoped file routes, all keyed by an absolute `path` that the daemon
resolves against its registered/trusted workspaces (final authority on
containment). The gateway rejects a relative/traversal `path` before forwarding
(defense in depth — see §9.7):

- `GET /list?path=<dir>` → `{ kind:"list", path, entries[{name, kind:"file"|"directory",
  ignored}], truncated, matchedIgnore }`.
- `GET /file?path=<file>&maxBytes=…` → `{ kind:"file", path, content, encoding, bom,
  lineEnding, sizeBytes, returnedBytes, truncated, hash, matchedIgnore,
  originalLineCount, nextCursor, hasMore }`. `hash` is present when the file was
  read in full (not truncated) — it is the compare-and-swap precondition for a
  replace write.
- `POST /file/write` `{ path, content, mode:"create"|"replace", expectedHash?,
  bom?, encoding?, lineEnding? }` → 200/201 `{ kind:"file_write", path, mode,
  created, sizeBytes, hash, encoding, bom, lineEnding, matchedIgnore }`.
  `mode:"replace"` requires `expectedHash`, so a stale editor buffer cannot
  clobber a concurrent agent edit.

`src/lib/coder-files.ts` owns the pure parsing/validation; `CodingView`'s Files
panel drives list → open → edit → save through these routes. Opened files stay
resident as tabs, each with its own buffer, dirty flag, hash, and save state —
re-opening a path re-activates its buffer (preserving unsaved edits) rather than
re-reading, and each tab's save is compare-and-swap on that tab's own hash. The
shapes were read from the pinned daemon source and confirmed live (list + read
returned the documented shape).

### 12.9 Workspace text search

The daemon has **no HTTP grep route** — its ripgrep-based search is an agent
tool, not a client endpoint. The workbench search therefore composes two client
routes: `GET /glob?pattern=…` to enumerate candidate files, then `GET /file` per
candidate to grep its content in memory. It is deliberately bounded because it is
a convenience, not the agent's search:

- `GET /glob?pattern=<glob>&workspace=<cwd>` → `{ matches[], count, truncated }`.
- Candidates are capped at 200 and each read is capped at 256 KiB
  (`maxBytes=262144`), so a pathological glob cannot flood the gateway.
- Matching is a case-insensitive substring scan over each file's lines, returning
  1-based line numbers and trimmed snippets, bounded to 50 hits per file.

`src/lib/coder-search.ts` owns the pure logic — `parseGlobResult` (untrusted-input
boundary: glob matches become `/file` paths), `searchLines` (never fabricates a
match), and `absoluteWorkspacePath` (joins a match to its workspace root, skips
the `.` root entry). `CodingView`'s Search panel drives glob → read → grep.

### 12.10 Verification records (evidence + staleness)

Each completed task run is captured as a structured verification record — run id,
command, cwd, exit code, start/finish timestamps, output, and the workspace
fingerprint it was measured against. The daemon exposes per-file content hashes
but **no workspace tree hash**, so the fingerprint is a conservative *workspace
mutation counter*:

- Advanced by every human save (explorer) and every agent tool call that is not a
  known read-only tool (`read_file` / `list_directory` / `glob` / `grep` /
  `web_search` / …). `isMutatingTool` is **default-deny** — an unknown or absent
  tool name counts as mutating — so stale-marking can only over-approximate and
  never leave an edit's prior evidence looking fresh.
- A record is stale iff the counter has moved past the value captured at run
  start (`isVerificationStale`).

`src/lib/coder-verification.ts` owns the pure logic; `CodingView`'s Tasks panel
renders a **Verification runs** list with `passed` / `failed` / `error` / `stale`
status. Failed runs stay visible and are never restyled as success. Records are
in-session only (reset on session switch) — a DB-backed ledger is a documented
gap, as is a true content-level fingerprint.

### 12.11 Verified absence of PTY / debug transports

The spec gates the persistent terminal and the debugger on *verifying* whether
the pinned runtime exposes a suitable transport first. It does **not**, on the
HTTP surface:

- **No PTY transport.** The only shell route is `POST /session/:id/shell`
  (on-demand, request → completed output). There is no `pty`, `terminal`,
  `stream`, `resize`, or `tty` route. A persistent PTY therefore needs a
  server-side PTY broker (spawn `node-pty` in the app container and multiplex
  stdin/stdout/resize over a WebSocket/SSE) — which the gateway architecture
  deliberately avoids ("the only backend code", §3.2). On-demand shell remains
  the only terminal.
- **No debug-adapter surface.** No `debug` / `dap` / `breakpoint` / `inspector`
  route; the `debug`/`debugger` strings in the pinned source are logging flags,
  not a debug server. A Node/TS debugger needs a separate DAP server with the
  inspector port scoped to the owning session.
- **LSP exists** (`/session/:id/lsp`) but its contract for interactive editing
  (diagnostics, definition, rename over HTTP) is not yet verified.

These are *hard* gaps, not merely unbuilt features: closing them is an
architecture decision (a PTY/DAP broker in the app server), not a thin UI slice.

### 12.12 App-level routes (preview re-validation + readiness)

Two routes sit on the app side rather than the daemon pass-through:

- **`POST /api/coder/preview`** re-validates a preview URL at the API boundary
  before it is framed — `parsePreviewUrl` (loopback-only, reserved ports refused)
  is the same validator the client runs, now enforced server-side so a tampered
  or bypassed client check cannot frame an SSRF target. Returns
  `{ ok: true, target }` or `{ error, code: 'invalid_preview_url' }` (400). This
  is defense in depth, not a replacement for the authenticated proxy (still
  deferred — see §4).
- **`GET /api/coder/readiness`** probes the two things the Coding UI depends on
  beyond the app process: the database (`SELECT 1`) and the daemon (`/health`,
  4s timeout). It returns 200 with per-check status, or 503 when either is down.
  Separate from `/api/health` (chat/Ollama) and the daemon's self-reported
  `/health` pass-through.

---

## 13. Test coverage map

| File | What it locks down |
|---|---|
| `src/lib/coder-transcript.test.ts` | message ordering, turn boundaries, first-message-not-dropped, usage carry-over, full serialisation (no truncation) |
| `src/lib/coder-permission-vote.test.ts` | nested `outcome`, no flat shape, `answers` as sibling keyed by `answerKey` |
| `src/lib/coder-gateway.test.ts` | daemon URL/token resolution, header injection, 502-on-outage, SSE identity + resume headers |
| `src/lib/coder-sse.test.ts` | SSE frame parsing (id/data, chunk splits, heartbeats, multi-line data) |
| `src/lib/coder-authorization.test.ts` | privileged-path deny, session-path extraction, workspace/file-path canonicalisation, owner check |
| `src/lib/coder-preview.test.ts` | preview-URL loopback/reserved-port validation |
| `src/lib/coder-rewind.test.ts` | rewind snapshot-list + result parsing, malformed-payload rejection |
| `src/lib/coder-files.test.ts` | directory-listing / file-content / write-result parsing, malformed-payload rejection |
| `src/lib/coder-tasks.test.ts` | lockfile→package-manager detection, default task commands, shell-result parsing |
| `src/lib/coder-search.test.ts` | glob-response parsing, bounded case-insensitive line search, workspace-relative→absolute path join |
| `src/lib/coder-verification.test.ts` | mutating-vs-read-only tool classification (default-deny), staleness from the mutation counter, record construction |
| `src/lib/settings-coder.test.ts` | `auto`/`yolo` enum, `yolo` default, legacy modes normalised, context/tool-search sentinels |
| `src/app/api/coder/[...path]/route.test.ts` | 204/205/304 null-body relay, route passthrough (status/approval-mode/workspace/rewind), unowned-session deny |
| `src/app/api/coder/preview/route.test.ts` | server-side preview-URL re-validation (loopback/reserved-port), SSRF rejection, malformed body, 403 unauth |
| `src/app/api/coder/readiness/route.test.ts` | db/daemon probe → 200 when both up, 503 when either down, 403 unauth |
| `src/app/api/chats/route.test.ts` | id-wins-over-surface on DELETE, surface-wide only when bare |

---

## 14. Operational runbook

**Bring the stack up (fresh):**

```sh
docker compose up -d --build --force-recreate app coder
```

The coder container syncs Ollama's model list into `~/.qwen/settings.json` at
startup (`sync-coder-models.mjs`), picks a tools-capable default, then starts
`qwen serve --enable-session-shell` on loopback `127.0.0.1:4170`.

**Verify health:**

```sh
curl -s http://127.0.0.1:4170/health        # {"status":"ok"}
curl -s http://127.0.0.1:4170/capabilities  # session_shell_command: true
```

**Model selection** is driven by `CODER_MODEL` in `.env`; the daemon's
`/workspace/models` is the authoritative list for the dropdown, and
tools-capable models are what drive the agent.

**Sessions** can be renamed inline in the sidebar (click the title or its
pencil icon); the rename is a `PATCH /api/chats {id, title}` and survives the
auto-title derivation.

**Session lifecycle** — a persistent `ChatSession` (surface `'coder'`) maps 1:1 to
a daemon session keyed by the **same UUID**. `POST /session {sessionId, cwd}`
creates it with a caller-supplied id; `POST /session/:id/load` reattaches on
reopen. Switching sessions **disconnects** the local handle (leaving the daemon
session running so in-flight work survives); only `delete` tears the daemon
session down. See §16.

**Approval** is `yolo` by default (no tool prompts); the only thing that pauses
the agent is `ask_user_question`, which is rendered inline with real options.

---

## 15. The container is fully self-contained (always packaged)

A "system update" in the field can reset the coder container to a bare image,
which silently removed Chrome, fonts, and ~20 runtime libs — the agent then
reported "missing tools" for things that had merely not been baked into the
image. This section records what is now provisioned at **build time** so a
fresh VM needs zero runtime surgery.

Everything below is baked by `Dockerfile.coder`:

- **Dev toolchain**: git, curl, build-essential, python3(+venv/pip), go, jq,
  ripgrep, unzip, openssh-client, sqlite3, `procps` (required for clean ACP
  shutdown).
- **Browser verification (real Chrome)**: the font stack (`fontconfig`,
  `fonts-dejavu-core`, `fonts-liberation`) and Chrome's ~20 shared libs
  (`libnss3`, `libgbm1`, `libatk*`, `libasound2`, `libpango`, `libcairo2`, …)
  are apt-installed so `ldd <chrome>` reports 0 missing and Chrome launches.
  **Without fonts, Skia aborts the renderer** (`Fontconfig error … FATAL: Not
  implemented`) which puppeteer masks as "Navigating frame was detached" — a
  classic false "site is broken" signal.
- **Puppeteer + jsdom + both Chrome builds** (`chrome-headless-shell` and full
  `chrome`) are installed under `/opt/qwen-code/browser` (source:
  `scripts/coder-browser/`) via `npx puppeteer browsers install …` at build
  time, and `PUPPETEER_CACHE_DIR=/root/.cache/puppeteer` is pinned.
- **Committed browser harness**: `scripts/coder-browser/verify-site.mjs`
  (deployed to `/opt/qwen-code/browser/verify-site.mjs`) serves a site dir and
  reports title/h1/landmarks/errors + light/dark screenshots. It replaces the
  hand-written `/tmp` harness the agent used to recreate every session.
- **Workspace context**: `scripts/coder-workspace/QWEN.md` (deployed + seeded
  idempotently into `~/.qwen/QWEN.md` and `/workspace/QWEN.md` at boot) tells the
  agent to *discover* the project layout rather than assume one: read each
  project's own manifest/README, run its own verify commands, and delegate file
  authoring to the `peakui-writer` subagent when configured.
- **Git identity**: `git config --global` + `GIT_AUTHOR_*`/`GIT_COMMITTER_*`
  env vars.

**Browser verify on a fresh VM:**

```sh
docker compose up -d --build coder
docker exec peakui-coder-1 sh -c \
  'cd /opt/qwen-code/browser && node verify-site.mjs /workspace/<site-dir>'
```

Expected: a JSON report with no `errors`, `ldd` clean, and both Chrome builds
present under `/opt/puppeteer-cache`.

**Known non-issues** (do not "fix" on sight):

- The harness toggles `data-theme="dark"` for the dark screenshot; a site that
  uses `prefers-color-scheme` instead simply shows the light palette in the dark
  shot — that is a site convention, not a harness bug.
- `visionModel` defaults to empty (auto-pick a same-provider vision model); set
  it in the Coding Settings drawer to pin an explicit image-transcription model.

---

## 16. New-tab opening, refresh persistence, and agent reattachment

Three UX behaviours were broken: Coding replaced the main interface in the same
tab, a refresh bounced back to PeakUI, and closing the tab meant the agent's
in-flight work could not be rejoined. All three are fixed.

### 16.1 Dedicated `/coder` route (new tab + stable refresh)

Coding no longer lives behind an in-page view toggle in `src/app/page.tsx`. It
now has its own route, `src/app/coder/page.tsx`, and the nav opens it with
`window.open('/coder', '_blank')`. Because the URL is stable:

- the nav opens it in a **new tab** (the main interface stays put);
- a **refresh** re-renders `/coder` (no more falling back to the main page);
- browser **back** exits to the main PeakUI interface.

### 16.2 Daemon session keyed by the persistent session id

The critical primitive is that the daemon accepts a **caller-supplied UUID** as
the session id (`session_id_override`), and `POST /session/:id/load` reattaches
to an existing session (returning a fresh minted `clientId` plus the full
state). So each persistent `ChatSession` (surface `'coder'`) uses its own UUID
as the daemon session key:

- first send → `POST /session {sessionId: <chatId>, cwd}` creates the daemon
  session;
- reopen → `POST /session/:id/load` reattaches to the **same** agent session,
  restoring conversation memory and any in-flight turn.

`ensureDaemonSession()` handles the two retry cases: `workspace_mismatch`
(register the cwd then retry) and `session_id_conflict` (reattach via `/load`).

### 16.3 Disconnect vs. close

- `disconnectDaemonSession()` drops the local handle **without** deleting the
  server session — used on session switch / new-session / reopen, so the agent
  keeps running and nothing is lost or delayed.
- `closeDaemonSession()` still deletes the server session — used only on
  explicit delete and workspace-cwd change (which must rebind the session).

### 16.4 Active-session restore

The active session id is persisted to `localStorage`
(`peakui-coder-active-session`) and restored on mount, and an eager reattach
effect (`ensureDaemonSession` once settings load) reopens the daemon session
immediately — so a reopened tab resumes streaming/status right away, not only
on the next send.

### 16.5 Known boundary

Reattachment survives **tab** close/refresh. It does not survive a full coder
**container** restart: the daemon reaps its live sessions, so an in-flight turn
is lost (persistent transcript/history in the DB still survives). Making
in-flight work survive container restarts would require daemon-session
persistence — a separate, larger effort.

---

## 17. Multi-model orchestration (main / vision / writer)

The Coding brain can split work across three specialised models, configured in
the Settings drawer as a triangle — **Main** on top, **Vision** (bottom-left)
and **Writer** (bottom-right) below.

The daemon (Qwen Code) natively supports both delegation mechanisms, so this is
thin wiring over existing capability, not a new orchestrator:

- **Main** (`coderModel`) — the planner/executor. It receives the user request
  and drives everything.
- **Vision** (`coderVisionModel`) — the daemon's *vision bridge*. When a
  text-only main model receives an image, the daemon transcribes it through
  this model and feeds the text back to the main model. Applied live via the
  daemon's `visionModel` setting (`POST /workspace/settings`, user scope,
  `requiresRestart: false`). Empty = auto-pick a same-provider vision model.
- **Writer** (`coderWriterModel`) — a dedicated subagent pinned to a different
  model, materialized at `~/.qwen/agents/peakui-writer.md` (user scope) via the
  daemon's `POST /workspace/agents`. The main model delegates code/file writing
  to it (`agent` tool with `subagent_type: "peakui-writer"`), then reviews and
  fixes the result. The subagent's toolset is restricted to read/write/edit/
  search/shell. Empty = no delegation (the main model writes directly).

### 17.1 Settings + persistence

Two new `UserSettings` columns (`coderVisionModel`, `coderWriterModel`),
normalized via `normalizeCoderDelegateModel` and exposed through
`/api/settings`. Model-selector syntax is `authType:model-id`
(`src/lib/coder-orchestration.ts` → `toDaemonModelSelector`), which correctly
distinguishes Ollama `name:tag` ids (e.g. `deepseek-v4.1-flash:cloud`) from an
explicit `openai:model` selector.

**Scope note (deferred).** Vision and writer are applied at the daemon's *user*
scope (`visionModel` via `POST /workspace/settings` `{ scope: 'user' }`; the
writer via `POST /workspace/agents` `{ scope: 'global' }`), so they are
daemon-global — the last writer to save wins across all workspaces. The daemon
does offer `scope: 'workspace'` (settings) and `scope: 'workspace'`/`'project'`
(agents), which would scope each to its runtime, but that requires the workspace
to be **trusted** (untrusted workspaces are 403'd) and per-workspace writer-agent
materialization, plus a re-derivation of the `agent`-tool `subagent_type`
resolution. Deliberately left global until that trust/agent-resolution work
lands.

### 17.2 Triangle UI

`CodingView` renders the three dropdowns in the Settings drawer, populated from
the daemon's authoritative `/workspace/models` and annotated with capability
hints (`⚠ no vision` for the vision slot, `⚠ no tools` for main/writer).

---

## 18. Responsive layout (phone + resize)

- **Retractable sessions sidebar**: a header toggle collapses/shows it. On a
  phone/narrow viewport (`max-width: 720px`) it overlays the chat as a dismissible
  drawer (auto-closes on session select); on desktop it sits inline and collapses
  to nothing when hidden.
- **Resizable tool-activity pane**: a drag handle above it adjusts its height
  (pointer events, so both mouse and touch work). Range clamped 80–560px.

---

## 19. GitHub projects

The Coding Settings drawer now owns GitHub App connection/revocation and the
Projects surface owns repository import and project selection. Imports clone a
GitHub-App-authorized repository into a server-generated directory under the
coder volume, then create a fresh session bound to that project. The browser
never supplies a clone URL or target path, and clone credentials are
short-lived, repository-scoped installation tokens. Deployment configuration,
permission requirements, and the deferred push/PR/webhook work are documented
in [GitHub Coder Integration](github-coder-integration.md).


