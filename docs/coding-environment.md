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
