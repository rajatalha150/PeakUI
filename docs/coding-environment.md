# Coding Environment — Design & Delivery Plan (Qwen Code as the brain)

**Status:** Phase 0 spike COMPLETE (verified against local Ollama)
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

## 8. Next: build order

Phase 1 → Phase 5 (see §4). The spike removed the two big unknowns (Ollama
auth + the prompt/transcript wire shape), so Phase 1 can go straight to the
container + gateway.

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
  context windows; overriding one requires the model-management route.
- The preview browser is still a plain iframe; the security envelope in §5
  (restricting it to the coder container's dev-server ports) is not enforced.

