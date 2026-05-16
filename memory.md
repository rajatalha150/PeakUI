# PeakUI | Local AI Studio - Project Memory

## 🤖 AI Instructions
**CRITICAL:** Any AI working on this project MUST read this file first. 
**CRITICAL:** Whenever you make a new git commit, you MUST update this `memory.md` file to reflect the new state of the project, the latest features added, and the next steps.

## 📝 Project Overview
PeakUI is a Next.js (App Router) web application designed to act as a local-first AI Studio command center. It connects to a user-configured Ollama host (default `127.0.0.1:11434`) for local models, and main chat can also target Hugging Face or a hybrid Ollama + Hugging Face catalog. It is fully Dockerized (`docker-compose`) and secured behind a PostgreSQL-backed authentication layer.

## 🛠️ Tech Stack
- **Frontend:** Next.js 16 (App Router, React), `lucide-react` icons
- **Styling:** Vanilla CSS (`globals.css`) — dark mode, glassmorphism, CSS-variable themes, accent gradients
- **Backend:** Next.js API Routes
- **Database:** PostgreSQL 15 via Prisma ORM (`prisma.config.ts` adapter pattern)
- **Auth:** `jose` Edge-compatible JWTs + `bcryptjs`, `httpOnly` cookies
- **Deployment:** Docker + Docker Compose (`network_mode: host` for Ollama access)

## 🚀 Completed Features

### Open Claw Header Cleanup ✅
- The crowded desktop Open Claw mode cluster was replaced with one featured `Workspace modes` dropdown in the shared top bar.
- The single menu now contains Internet, UWAF Direct/Stealth, RAG, Unrestricted, and Uncensored so the navbar stays clean without removing any runtime controls.
- Desktop dropdown state now closes on outside click, `Esc`, and viewport collapse; mobile keeps the existing overflow-menu pattern.

### Open Claw Host Shell Executor & Shell Audit ✅
- Open Claw shell execution now has an explicit target setting: `container` for the built-in app runtime or `host` for an optional host-side executor daemon.
- The optional host executor lives at `scripts/openclaw-host-executor.mjs`, listens on `127.0.0.1:4318` by default, requires `OPENCLAW_HOST_EXECUTOR_TOKEN`, and executes commands on the host with host `PATH`/CLI availability.
- Host execution is constrained by approved working-directory roots, allowlisted host environment variables, per-command timeout caps, output-size caps, and the existing shell approval model.
- If Host is selected but the executor token is missing or the daemon is unreachable, Open Claw now falls back to the normal container shell and labels the actual target in both approval dialogs and command output. This prevents simple commands from failing only because host mode is not fully configured.
- Shell requests and results are now stored in PostgreSQL via `ShellCommandAudit`, including user/session/message, command, cwd, target, approval mode, status, timeout/output caps, allowed roots/env vars, stdout/stderr, exit code, and duration.
- Shell settings now include target, approval mode, additional auto-approve prefixes, host allowed roots, host allowed env vars, host timeout, host output cap, and host executor status.
- The Open Claw system prompt now tells the model whether the shell is currently container-backed or host-backed, so it can reason correctly about available commands and paths.
- Added `docs/openclaw-host-executor.md` and `npm run openclaw:host-executor` for operating the optional daemon.

### Open Claw UI Fixes ✅
- Fixed the Open Claw model dropdown stacking/hit-area issue by giving the Open Claw header chrome its own higher stacking layer. The full dropdown is now clickable over the chat area instead of only the top exposed strip.

### Canvas & Artifacts (Phase 7) ✅
- Agent-generated code and docs now persist beyond the chat via a new `CanvasArtifact` DB model
- Files in markdown code blocks auto-save to Canvas when user clicks download
- Canvas panel in Open Claw workspace rail shows all persisted artifacts per session
- Canvas panel also in main chat (right side rail, only shown when artifacts exist)
- Support for artifact versioning (version field increments on edit), download, and delete
- API endpoints: `GET/POST /api/canvas/artifacts`, `GET/PUT/DELETE /api/canvas/artifacts/[id]`
- Visual artifact cards with code syntax highlighting (via `react-syntax-highlighter`)
- Markdown file rendering with headers, bold, links, lists
- Image preview support including external URLs (`![alt](https://...)` syntax)
- Edit-in-place: click Edit on any artifact to modify content/name directly
- External image gallery with open-in-new-tab (globe icon) and download buttons
- Canvas only shows when session has artifacts (no empty state banner)

### Knowledge Base / RAG (v2) ✅
- **Server-side RAG integration:** When enabled, `buildKnowledgeBaseContext()` queries indexed documents during chat alongside web search
- **Hybrid search with RRF:** Reciprocal Rank Fusion combines semantic (cosine similarity) + keyword (BM25) results for better coverage
- **Per-user settings:** `ragEnabled` (Boolean) and `ragTopK` (Int with -1 for full access) stored in `UserSettings`
- **Chat pipeline:** RAG fires in both Ollama and OpenAI-compatible paths; results sent as `knowledge_sources` in stream response
- **Auto-query routing:** Uses `rag_query` from request body or extracts from latest user message
- **Source metadata:** Retrieved KB sources now carry file kind, extension, file size, and excerpt length metadata, and the injected KB context explicitly says the model is seeing snippets rather than full files
- **Stream phases:** UI shows "Searching knowledge base..." during lookup
- **KB browser:** The Knowledge Base dashboard now pages documents server-side, lets users choose the page size, supports multi-select/select-all, and can bulk delete selected entries

### RAG Full Access & Indexing Fixes ✅
- **topK=-1 (full access) was broken:** Client pre-search hardcoded `topK: 4`; `/api/rag/search` `normalizeTopK()` converted -1 to 1 and capped at 12; semantic thresholds (0.3/0.2) dropped chunks in full access; `buildRagContextBlock` truncated to 10K chars regardless; client and server both injected RAG context causing double injection
- **All fixed:** Client now uses `userSettings?.ragTopK`; `normalizeTopK()` maps -1 to 10000 and caps normal at 200; semantic threshold is 0 for full access; context limit raised to 100K for full access; client-side context injection removed (server handles it); `rag_topk` sent in chat request body; KB system message inserted AFTER main system prompt; KB instruction strengthened to "IMPORTANT: You MUST use this context"
- **KB stale detection:** Increased processing timeout from 2 min to 10 min; moved `markStaleProcessingDocuments()` from GET handler to POST handler and health endpoint only
- **KB embedding retry:** 2 retries with 5s/15s exponential backoff before falling back to keyword mode
- **KB error recovery:** Errored documents with matching content hash can be re-uploaded to retry indexing
- **KB UI:** Document preview modal z-index raised from 80 to 1100

### Chat Mode System Fixes ✅
- **Uncensored/unrestricted modes had no tool access:** `openClawPrompt` (shell, browser, filesystem, internet definitions) was completely excluded from uncensored/unrestricted system prompts — AI couldn't use any tools in those modes
- **Fixed:** `openClawPrompt` and `chatInternetPrompt` now included in ALL mode branches (uncensored, unrestricted, normal)
- **Uncensored anti-tool language removed:** Removed "Skip deliberation — go straight to the answer" and "Start with the answer immediately" clauses that suppressed tool invocation
- **Dynamic tool-aware clause:** When tools are available, uncensored mode says "use tools proactively to get accurate, current information instead of guessing"; when no tools, it says "start with the answer immediately"
- **Reinforcement updated:** `UNCENSORED_REINFORCEMENT` now includes "When tools are available, use them proactively"
- `UNCENSORED_INSTRUCTIONS` renamed to `UNCENSORED_BASE_INSTRUCTIONS` (array, joined dynamically with tool clause)

### Date/Time Injection ✅
- **Current date/time + timezone injected into ALL system prompts** (all modes, all surfaces) so AI always knows the current date and acknowledges training data may be outdated
- Applied to both `chat-completion.ts` (all three mode branches) and `openclaw-prompt.ts` (after model name line)

### UWAF Browser Fix ✅
- Removed `--single-process` and `--no-zygote` Chromium flags that caused `browserContext.newPage: Target page, context or browser has been closed` crashes
- Added retry logic in `getPage()`: if `newPage()` fails, clear stale references, relaunch browser, and retry

### Interactive Live Browser Rewrite ✅
- Replaced the screenshot/frame-based “live browser” transport with a real interactive remote display session: headed Chromium now runs per UWAF session under `Xvfb`, `x11vnc` exposes that display, and the app bridges VNC over authenticated WebSocket paths
- Added `src/lib/live-browser-server.ts` as the new control + VNC bridge layer; `src/lib/screencast-server.ts` is now only a compatibility re-export
- Reworked `src/lib/uwaf-pool.ts` from a single shared headless browser into per-session headed browser runtimes so the AI and the user act on the same visible page instead of separate hidden contexts
- Swapped the sidebar and modal UI from `<img>` frame rendering to embedded noVNC sessions via `@novnc/novnc`, keeping the existing Take Over / Resume AI control flow through a separate control socket
- Hardened shared-session behavior so manual user navigation no longer leaves AI-side form/link metadata stale: UWAF browser actions now refresh page structure from the current live page before acting
- Validated the new transport end-to-end in Docker: authenticated `/ws/live-browser/control` returns `ready`, authenticated `/ws/live-browser/vnc` returns a real `RFB 003.008` handshake, and UWAF `open` still returns page content + screenshot normally

### Live Browser AI Routing & Human Assist ✅
- Open Claw now prefers the shared `unified_browser` tool for visible web searches and page visits when UWAF is available, instead of silently using the backend-only web research path
- Added a `search` action to `unified_browser` so the agent can begin visible DuckDuckGo searches in the same headed browser session the user is watching
- The UWAF pool now tracks the active Playwright page and brings it to the front before/after actions, so popups, search results, and manually focused tabs no longer leave the user looking at a stale `about:blank` page
- Added a client-side `wait_for_user` tool action: when the model hits CAPTCHA, "I am human" checks, MFA, login, or bot verification, Open Claw opens the live browser, switches to user takeover, waits for Resume AI, then re-observes the page and returns the updated page state to the model
- The Open Claw prompt explicitly tells the model that the live browser is shared with the user and that the user can help with verification/auth flows when requested

### Unified Browser Reliability Pass ✅
- Reworked the UWAF browser contract to be evidence-driven instead of optimistic: `search` now validates that the final page actually reflects the requested query and contains detectable result blocks before it is treated as a successful search
- Search failures now surface explicit semantic failure codes like homepage bounce, zero-result search failure, anti-bot detection, login-required, timeout, selector-not-found, and no-effect instead of falling through as if the browser verified the claim
- Added richer browser primitives for the model: `type`, `press`, `wait_for_selector`, `scroll`, `back`, `forward`, `new_tab`, `list_tabs`, `switch_tab`, `close_tab`, `select`, and `hover`
- Browser results now include redirect state, HTTP status when available, query-match flags, result counts, active tab list, selector/wait outcomes, anti-bot/login detection, and recent JS/network failures captured from the live page
- Updated the Open Claw unified-browser prompt so the model must treat those fields as authoritative evidence and explicitly report browser failure instead of converting prior/background knowledge into claimed live observations
- Updated the UI-side tool result formatting so exact browser failure reasons and diagnostics are fed back into the model rather than collapsing everything into a generic browser error

### Open Claw Session Management Parity ✅
- Open Claw task threads now support the same core organization controls as normal chat: folder assignment/filtering, reusable tags, pin/unpin, rename, copy-to-clipboard, and per-thread delete directly from the workspace rail
- Added bulk task-thread management in the Open Claw rail: users can enter select mode, delete selected task threads, or clear all Open Claw sessions at once
- Extended the shared chat-session backend so `/api/chats` delete now supports bulk deletion by explicit `ids` as well as by `surface`, allowing Open Claw clear-all without touching normal chat sessions
- Reused the existing folder/tag/session relations in `ChatSession`, `Folder`, `Tag`, and `ChatSessionTag` instead of creating a separate Open Claw-only organization system

### Build Recovery ✅
- Fixed the repo’s pre-existing Prisma/typecheck blockers so `npm run build` works again after the live-browser rewrite
- Regenerated Prisma client types locally and corrected stale test/type assumptions in the RAG files that were preventing redeploy

### Core Chat
- **Inline image rendering:** AI-generated markdown images (`![alt](url)`) now render inline directly in chat messages via `AssistantContent` component
- **AI image awareness:** `IMAGE_INSTRUCTIONS` injected into system prompt guides models to use markdown image syntax for picture requests
- Ollama model auto-detection via `/api/tags`, session-first chat via `/api/chats/new`, streaming generation via `/api/chat/completions` (and `/api/chat` alias), and assistant finalization via `/api/chat/completed`
- Main chat now supports provider-aware platform selection: `ollama`, `huggingface`, or `hybrid`, persisted through `UserSettings.chatPlatform`, `chatModel`, `chatModelProvider`, and `huggingFaceBaseUrl`
- Hugging Face chat uses the official OpenAI-compatible router flow by default: `https://router.huggingface.co/v1/chat/completions` for inference and authenticated `GET /v1/models` for discovery, with browser-only HF token storage
- Custom HF-compatible endpoints such as TGI, vLLM, or SGLang can also back main chat when they expose OpenAI-style chat completions plus `/models` or `/info`
- Hybrid mode merges Ollama and Hugging Face models into one chat picker, and saved default-model selection is now provider-aware so duplicate model names across platforms stay deterministic
- Ollama host setting is honored by chat, model listing, embedding tests, document upload, and RAG search
- The chat header model selector is now a themed custom glass dropdown with active-model highlighting, hover states, loading state, and long-list scrolling
- Selecting a chat model from the header persists `chatModel` immediately, while local model lifecycle now stays fully native to Ollama instead of using app-side warmup requests
- Chat now exposes a `Stop model` action next to the model selector so a wedged local runner can be unloaded and restarted cleanly on the next request
- Settings → Chat now includes an **Exclusive Ollama Switching** toggle; when enabled, Chat and local-provider Open Claw unload any other running Ollama models before starting the selected model so limited VRAM machines can dedicate resources to the active model
- Settings → Chat now documents the native-Ollama lifecycle approach instead of exposing a configurable `keep_alive` control, and Chat/Open Claw/RAG embeddings no longer send request-level keep-alive overrides
- Chat now includes a per-session **Internet** toggle that performs backend-managed public web research before answering, merges fetched-page excerpts with search-result snippets, and no longer depends on local model tool support to start
- **Internet mode overhaul (v2):** Web search is now significantly more reliable and intelligent. The backend tries multiple search engines in priority order: Brave Search API (if `BRAVE_API_KEY` is configured), SearXNG (if `SEARXNG_URL` is configured), DuckDuckGo (with both HTML and Lite fallback parsers), and Bing as final fallback. Query intelligence generates multiple search queries from the user prompt for broader coverage. Page extraction now parses schema.org JSON-LD, Open Graph meta tags, and uses readability heuristics (link density scoring, nav/footer filtering) to extract article text while preserving structure. Fetched pages include retry logic (1 retry on timeout/5xx). Context limits were raised: up to 8 search results, 4 pages fetched, 3000 chars per excerpt, 12000 chars total context. The system prompt now strongly instructs the model to cite every factual claim with inline `[^N]` markers. Frontend source chips are now numbered `[1]`, `[2]`, etc., and inline citations in assistant text render as clickable superscript links that open the original source URL. This works in both Chat and Open Claw interfaces.
- Live audit confirmed that Gemma4 on the current 4 GB Quadro K2200 + Quadro M2000 setup can still spend minutes in Ollama backoff/OOM while loading; if the model does not fit, the new manual stop path helps recover, but app-side lifecycle steering is no longer involved
- Chat now treats `contextLength` as a requested maximum for local Ollama, starts the default local path without forcing `num_ctx` so Ollama can choose its own working context first, caps explicit requests to `PEAKUI_OLLAMA_CONTEXT_CAP` (`16384` by default), backs off further on memory-pressure errors, and fails model-start attempts after 60 seconds so terminal-working local models do not fail just because the UI slider was left too high
- Chat transport failures now preserve the provider URL, selected model, and low-level Node/Ollama socket details in the streamed error instead of collapsing app-to-Ollama failures into the generic browser-facing `fetch failed`
- Ollama HTTP errors are now separated from app transport errors, so runner crashes like `llama runner process has terminated` are reported as Ollama model-load/runtime failures instead of getting the generic fetch/restart hint
- Chat and Open Claw streaming views now allow manual scrollback during generation; they only stay pinned to the bottom while the user is already near the latest message and show a floating down-arrow to jump back to the newest response
- Chat and Open Claw now expose distinct startup phases (`Searching knowledge base`, `Researching web`, `Unloading other models`, `Starting model`, `Connecting to model`, `Generating`) so pre-stream latency is visible instead of being collapsed into a misleading `Warming model...` state
- The main app sidebar can now collapse to an icon rail, that state persists in browser storage, and the shared `useStickyScroll` hook now drives chat auto-scroll behavior instead of duplicated per-surface logic
- Chat now also exposes a live Ollama health strip outside Open Claw, showing online/degraded/offline state, loaded-model visibility, and one-click recovery actions (Retry, Retry without web, Stop + retry) that reuse the last submitted draft instead of making the user rebuild it manually. The strip is now compact and single-line: smaller badge, icon-only buttons with tooltips, and loaded models shown on hover instead of inline.
- Chat and Open Claw now share the same chat-style top bar with a left drawer button, centered model picker, and right overflow menu. The normal chat sidebar and Open Claw rail both open as slide-out drawers on mobile, while preserving the selected surface/session context.
- Open Claw now owns the left column while active: the main app sidebar is hidden, the Open Claw workspace rail becomes the only session/navigation rail, and opening Knowledge Base from that rail keeps the selected Open Claw shell visible instead of restoring the normal sidebar.
- Main chat now supports folders, reusable session tags, and sidebar search. Folder/tag assignment lives in each chat row's overflow menu, while the sidebar can filter sessions by selected folder or tag without leaving the main chat surface.
- The active top-level surface (`chat`, `openclaw`, etc.), the current Open Claw panel (`workspace` vs `knowledge-base`), and the currently selected normal-chat session now persist across browser refreshes in session storage, so reloads restore the current workspace instead of always jumping back to the latest default chat thread.
- Ollama model discovery still uses `/api/tags`, while chat-organization tags now live on a separate `/api/chat-tags` route so model selection, Settings, and Open Claw provider checks do not regress.
- Abortable streams — Stop button replaces Send during generation
- The client creates the session before the first token, passes `chat_id` and `session_id` into generation, and buffers partial NDJSON/status frames so stream boundaries do not break parsing
- Session persistence now starts in parallel with generation instead of blocking the model request, which shaves off visible start latency while still finalizing the saved conversation afterward
- Format-aware presentation routing now steers resumes, cover letters, emails, memos, reports, summaries, proposals, outlines, lists, tables, JSON, YAML, CSV, and code requests into a more appropriate output contract
- Assistant replies now render markdown-like structure in chat, including headings, lists, tables, blockquotes, and code blocks, and the UI now normalizes wrapper fences, loose list markers, document headings, and simple tables before render
- Resume/CV synthesis requests now get a dedicated plain-text ATS prompt so the model stops wrapping resume answers in markdown fences unless the user explicitly asks for a downloadable file
- Out-of-memory (500) errors caught and surfaced inline in chat
- Performance metrics: Tokens, Tokens/sec, Duration after each response
- Live TPS estimator (500ms interval, non-blocking)

### Open Claw Workspace
- Dedicated Core AI section added before Development in the sidebar, with a separate `openclaw` session surface so task threads stay isolated from normal chat sessions
- Per-user Open Claw settings now persist `openClawProvider`, `openClawModel`, and `openClawBaseUrl` in `UserSettings`, with server-side normalization and settings-panel controls; model selection is surfaced in the shared top bar rather than inside the rail
- Local Ollama is the first-class path; Open Claw model discovery uses `/api/openclaw/models`, while OpenAI-compatible providers can be connected with a stored browser API key and provider-specific base URL
- The workspace uses a session-first streaming flow, a task-oriented system prompt, structured assistant rendering, `<think>` blocks, and a PC-work explanation card so the user can use Open Claw as a dedicated agent workspace
- Open Claw now has its own RAG toggle in the workspace top bar; it searches the same Knowledge Base as normal chat, injects source context before generation, and displays source chips on assistant responses
- Open Claw now also has a per-session **Internet** toggle; when enabled it uses the same safe backend-managed public-web lookup path as Chat, merges those citations with any active RAG sources, and explains the mode inline in the workspace UI
- Open Claw Internet mode now also exposes a real reusable `web` tool to the model, so it can run follow-up searches or fetch a specific public page mid-task instead of being limited to the initial preloaded research pass. The prompt now explicitly lists the active toolset and tells the model when to reuse existing context versus request a fresh search.
- Open Claw now inherits the same metadata-rich Knowledge Base excerpts as chat, so retrieved sources are labeled as snippets rather than full-file content when they are injected into the task prompt. The KB prompt now also carries chunk-aware citations plus the retrieval contract that lets the model ask for broader lookup or direct file inspection when needed.
- Open Claw now includes an explicit **Verify** action for Ollama/OpenAI-compatible connections, plus a live connection-status summary and a quick local `Stop model` control in the workspace top bar
- Open Claw now behaves more like a workspace than a thin chat skin: it has persistent task modes (`Plan`, `Research`, `Execute`, `Review`), response-style controls, a clarify-first toggle, quick-start prompts, workspace notes, and success criteria that are stored in browser localStorage and injected into each request as a workspace brief
- **Identity & Persona System** — Agent persona config (name, tone, expertise, boundaries, operating instructions) and user profile (name, role, preferences, context) are persisted per-user in `UserSettings` and injected into every Open Claw system prompt
- **Persona templates** — Pre-built personas: Developer, Researcher, Writer, Analyst, Product Manager, System Admin, plus a fully customizable Custom persona
- Persona and user profile are editable in collapsible panels in the Open Claw left workspace rail, with template picker and live summary in the workspace top bar
- Open Claw now also has persistent per-thread task state in browser localStorage (`Objective`, `Current status`, `Next step`, `Done criteria`, and an editable pinned checklist), and that task state is injected into each request as a separate system brief
- Assistant checklist output in Open Claw can now be imported into the pinned task checklist and edited independently of the conversation transcript
- Open Claw’s own control surface now lives in a collapsible left workspace rail that replaces the app sidebar while the task workspace is active; session controls, agent preferences, and quick prompts now live in that rail, while model selection sits in the shared top bar
- On mobile, the Open Claw control surface keeps the same chat-style top bar as normal chat and the rail collapses into a drawer so the active task thread stays visible while still fitting a narrow viewport
- The left workspace rail now keeps the task-oriented cards like `Agent mode`, while model selection stays in the shared top bar, `Settings` is exposed as a normal rail nav item, and the old rail-local provider settings card was removed.
- The Open Claw sidebar now hides the filesystem, writes, code sandbox, browser control, and workspace-capabilities explanations behind a single dropdown so the rail stays compact while the detailed permission/status text remains available on demand.
- The Open Claw rail now also collapses `Response style`, `Task state`, and `Workspace brief` into dropdown disclosures, so the rail shows compact summaries until the user expands the section they need.
- Knowledge Base navigation is now surface-aware: opening it from the main app sidebar keeps the normal sidebar, while opening it from the Open Claw rail swaps only the Open Claw main panel and preserves the selected task thread.
- Open Claw now shares the same sticky-scroll behavior as chat, so long streams no longer yank the viewport while the user is reading older messages
- Open Claw now also shows the same richer Ollama health/recovery UX as chat when using the local-provider path
- Prisma schema now includes `ChatSession.surface` so Open Claw sessions can be stored separately without disturbing the existing chat history flow
- Open Claw generation now starts without waiting for session persistence, and initial workspace loading/provider switching run more in parallel so the local agent UI stays responsive
- Open Claw now persists its selected task thread across refreshes and session-surface remounts, and right-rail session navigation is hardened so switching, creating, or deleting threads during an active run is blocked cleanly. Starting a new thread or changing sessions also clears stale composer attachments/images, and stopping a run now prunes interrupted placeholder messages instead of leaving broken trailing assistant entries.
- Open Claw session persistence now preserves hidden tool-handoff turns correctly, and older leaked `Shell command result:` / `Filesystem tool result:` / `Web research tool result:` messages are auto-recognized and kept hidden when sessions reload.
- Open Claw Internet mode no longer auto-preloads web context for obviously machine-local, repo-local, or filesystem-local prompts just because Internet is enabled; the model is now told to prefer shell/filesystem for current-system facts and only use the web tool when external research is actually needed.
- Intermediate tool-request assistant turns in Open Claw are now tagged separately so they do not render like final answers with source chips and response-download chrome, and the shared assistant renderer now carries inline citation sources and presentation-aware download types more consistently across chat surfaces.
- Open Claw’s top chrome now mirrors the normal chat shell: the model picker lives in the shared top bar, the separate health strip moved into the upper toolbar as a compact runtime block with retry actions, the redundant `Open Claw · Local · ...` summary line was removed, and the collapsed left workspace rail now uses compact stat tiles plus a small runtime footer instead of stacked summary pills.
- **Multi-Layer Memory System (Phase 1 repaired)** — Daily memory logs now update existing session entries instead of duplicating them, `memory/session-summaries.md` upserts summaries by session id instead of endlessly prepending duplicates, and Open Claw long-term memory now falls back to the root `memory.md` project memory file when no dedicated `MEMORY.md` exists.
- **Shell Execution (Phase 2 repaired)** — Open Claw now advertises the shell tool in its system prompt only when shell execution is enabled, tells the model the exact `<openclaw_tool name="shell">...</openclaw_tool>` request format, and completes the full request/approval/execute/result loop inside the workspace instead of exposing a dead-end settings surface. `ask-first` mode now issues signed approval tokens that the execute route validates, `auto-approve` only runs allowlisted commands without shell operators, client-side `process.cwd()` misuse was removed, and shell output is attached to the assistant message that requested it instead of being replayed under every assistant response.
- **Host shell execution added** — Shell commands can now target the app container or an optional host executor. Host execution uses `OPENCLAW_HOST_EXECUTOR_TOKEN`, approved cwd roots, env allowlists, timeout/output caps, and `ShellCommandAudit` DB records. If Host is selected but the executor is unavailable, Open Claw falls back to the container shell and labels the actual execution target so ordinary commands do not fail with a missing-token blocker.
- **Filesystem Access (Phase 2 added, follow-up repaired)** — Open Claw now has a dedicated read-only filesystem tool with the `<openclaw_tool name="filesystem">...</openclaw_tool>` protocol for `list`, `read`, and `stat` actions. Users can control filesystem mode (`deny` or `read-only`) plus newline-separated approved host paths from Settings, the workspace shows whether any paths are currently granted, and the tool loop now feeds actual file/listing results back into the model just like shell output. The default host mount now covers the host `/home` tree plus `/tmp` in read-only mode, not just one specific user directory. Open Claw’s prompt now explicitly tells the model to prefer the filesystem tool for host paths like `/home` and `/tmp`, the workspace auto-translates simple shell inspection commands such as `ls /home` into filesystem requests when that is clearly the host-safe interpretation, and the tool loop now blocks repeated identical tool requests so the model cannot spin on the same shell/filesystem action after already receiving a result. Tool-result handoff messages for shell/filesystem continuation now re-enter the model as hidden `user` turns instead of hidden `system` turns, which prevents multi-step Open Claw reviews from stopping after the first tool call.
- **Shell UI polish** — The Shell Execution Configure panel and approval modal now use the real theme tokens and an opaque blurred backdrop, so opening shell configuration no longer shows the Open Claw workspace rail bleeding through transparent surfaces.

### Thinking Models
- Full `<think>...</think>` tag parser
- **Collapsible `ThinkingBlock` component:** auto-expands while streaming (live word count + blinking cursor), auto-collapses 0.8s after model finishes, click-to-expand anytime. Works with Gemma4, DeepSeek-R1, QwQ, and all reasoning models.

### Auth & Users
- First-visit Admin setup flow — no sign-up, admin-only user management
- JWT session via `httpOnly` cookie; secure flag dynamically checks `X-Forwarded-Proto` to support HTTP LAN access
- Middleware (`src/middleware.ts`) protects non-API routes, redirects unauthenticated users to `/login`; API routes perform their own auth checks to avoid buffering large upload bodies in middleware
- Logout endpoint clears session cookie

### Chat History ("Castle Memory System")
- All sessions stored in PostgreSQL (`ChatSession` model)
- Sidebar shows recent chats, "New Chat" button, session switching
- Sidebar now also supports folder grouping, chat-title/content search, reusable tag filters, and per-chat folder/tag assignment from the overflow menu
- Session rows are upserted before generation and finalized after completion, so the history model is no longer coupled to token-by-token transcript writes
- "New Chat" now always returns to Chat, clears active session state, clears KB context and pending attachments, and aborts any active stream

### RAG Knowledge Base
- Upload text, code, data, PDF, DOCX, PPTX, XLSX, ODT/ODP/ODS, and RTF files or whole folder trees → shared extraction pipeline with page-aware PDF text extraction plus OCR fallback; the runtime image now includes `poppler-utils` and `tesseract-ocr` so scanned PDFs can actually be indexed → sentence-aware chunking (~600 chars, overlap) with a safe whole-document path for small files → Semantic embedding index or Keyword/BM25 index depending on user setting
- Knowledge Base upload requests now create a `queued` document and return `202 Accepted`; extraction, chunking, embedding, and chunk inserts run after the response through an in-process queue so reverse proxies do not hit `/api/rag` gateway timeouts
- RAG background indexing logs start/finish/failure, heartbeats active `processing` documents, marks failed documents with `errorMessage`, clears partial chunks on failure, and marks stale/lost processing documents as failed after the processing window expires
- Semantic RAG embedding uploads use a 45s per-batch timeout so stalled Ollama embedding requests surface as visible document errors instead of leaving rows stuck in `processing`
- If semantic embeddings time out during upload, the document is automatically indexed as Keyword/BM25 fallback and remains searchable; semantic search also falls back to keyword results if query embedding is unavailable
- `/api/rag/test-embed` probes `/api/tags` and `/api/ps`, uses a 30s embedding timeout, and returns diagnostics that distinguish app/network issues from stuck Ollama runner/GPU memory failures
- Semantic search uses the user's configured embedding model and Ollama host; query/search model now matches upload model metadata
- Embedding model names are normalized for `:latest` aliases, tests/uploads allow cold-load-safe timeouts, and document embeddings are batched during upload
- Keyword/BM25 mode is fully implemented and does not require an embedding model or Ollama embedding calls
- Document records now store `ragMode`, `embeddingModel`, `ollamaHost`, `indexedAt`, `errorMessage`, `kind`, `sourcePath`, and `contentHash`; chunk embeddings are nullable for keyword-only indexes and chunk rows now track `chunkIndex`
- Retrieval now surfaces file kind, extension, file size, excerpt length, source path, and chunk number in both the KB UI and injected prompt context
- Folder uploads preserve relative paths, keep the uploaded tree intact in the index, and queue large drops in batches so the UI stays responsive during huge project imports
- Query directives like `file:`, `folder:`, `type:`, and `ext:` now narrow retrieval, and the KB panel supports the same filters plus full-document preview/drill-down
- The KB search prompt explicitly tells models that context is usually excerpt-based, but small files can become full-document context when safe, and that they can request a broader lookup or direct file inspection instead of guessing
- The KB dashboard now has a RAG health panel that shows what indexed successfully, what is still pending, what failed, and why
- The KB dashboard now pages the document list, exposes page-size controls, and supports multi-select/select-all plus bulk delete for large libraries
- Office OpenXML file-kind detection now prioritizes document extensions before generic XML heuristics, so `pptx`/`xlsx`/`docx` stay in the document bucket instead of being misread as generic data files
- OCR fallback, archive unpacking, and richer Office/data/code parsing are handled in the extraction pipeline so more file types become searchable
- Search results and chat citations now include chunk-aware metadata instead of only filename + score
- RAG search and upload flows now use incremental reindexing by content hash instead of requiring delete/reupload loops for changed files
- Context injected into chat as user/assistant primer pair (compatible with all Ollama models)
- RAG primer now asks models to cite source filenames and avoid guessing when context is insufficient
- Assistant messages can persist and display source chips with filename, match %, and search mode
- RAG toggle in chat header for automatic per-message retrieval
- "Send to Chat" button from KB search results for one-shot context injection
- Collapsible search results with match % badge
- Knowledge Base uploads bypass middleware body cloning, enforce a clear 25 MB file limit, and return readable 400/413 errors instead of generic 500s when multipart parsing fails or files are too large

### File Attachments & Downloads
- Chat attachments use `/api/files/extract` and shared file metadata; text-like files are sent as extracted text plus original filename/MIME/size metadata
- Images are preserved as original base64 bytes and passed to Ollama through the native `images` array for vision-capable models
- Unsupported binary/audio/video/archive files can be attached as metadata-only, with a clear model-input status instead of pretending the bytes are text
- Assistant responses render a format-aware response download button plus fenced code block downloads for content that declares `filename="..."`; `base64 filename="..."` blocks download as decoded binary blobs

### Appearance & Themes
- Settings → Appearance now includes five professional palettes: Aurora, Graphite, Midnight, Canvas, and Ledger
- Theme selection previews immediately, is normalized server-side, and persists per user in `UserSettings.theme`
- Shared theme tokens in `globals.css` now drive the shell, sidebars, input surfaces, chat accents, model dropdown, RAG controls, KB upload states, and focus rings
- Canvas and Ledger replace the older Evergreen/Burgundy presentation with two broadly appealing professional light themes: one warm editorial paper palette and one cooler ink-and-ledger palette.
- Toggle surfaces now include compact `?` help badges next to Stop Model, chat Internet/RAG, Open Claw Internet/RAG, and the Exclusive Ollama Switching control so users can see what each control changes without leaving the current view
- `globals.css` now also owns the shared collapsed-sidebar, Open Claw rail, sticky-scroll, and scroll-container shell classes instead of leaving those layouts entirely inline

### Settings Panel (`/api/settings`)
- Per-user settings stored in `UserSettings` Prisma model
- **Appearance theme** — persisted per user and applied immediately across the studio
- **Default chat model** — remembered across sessions, pre-selected on load
- **Chat platform selection** — main chat can be switched between Ollama, Hugging Face, and Hybrid, with Hugging Face base URL persisted server-side and HF token stored only in browser localStorage
- **System prompt** — prepended to every conversation
- **System prompt, Temperature, and Context Window** are normalized through `/api/settings` and applied server-side in `/api/chat`
- **Temperature** slider (0–2) and **Context Window** slider (512–128k)
- **RAG mode:** Semantic (embedding model) vs Keyword/BM25 (no model needed), now wired end-to-end
- **Embedding model selector** with **Test** button (`/api/rag/test-embed`) — deduplicates `:latest` aliases, shows installed/pull-required state, returns embedding dimensions, and now recommends more Ollama embedding models for different speed/quality tradeoffs
- Ollama connection status indicator (live model count) honors configured/typed host
- **Native Ollama lifecycle** for Chat, Open Claw, and embedding requests — the app no longer overrides `keep_alive` or sends background warmup prompts
- **Stop model button** in Chat and Open Claw — unloads the selected local model on demand so the next request starts from a fresh load
- **Exclusive Ollama Switching toggle** that persists per user and unloads other running Ollama models before a new local Chat/Open Claw request starts
- **Open Claw filesystem permissions** — persisted per user as `openClawFileAccessMode` plus `openClawAllowedPaths`, with read-only host-path approval controlled from Settings
- **Open Claw tool execution stack** — shell execution, filesystem read/write, managed Python/Node code sandboxing, and controlled public-web browser actions are now all wired end-to-end through Open Claw with per-tool approval modes and hidden tool-result continuation
- **Open Claw shell target settings** — `UserSettings` now persists `shellExecutionTarget`, host allowed roots/env vars, host timeout cap, and host output cap. The shell settings API also reports host executor status.
- **Open Claw write/code/browser settings** — persisted per user as `openClawFileWriteMode`, `openClawWritablePaths`, `openClawCodeExecutionMode`, and `openClawBrowserMode`, all configurable from Settings and enforced server-side
- **Managed Open Claw workspace** — Docker now mounts `${OPENCLAW_HOST_WORKSPACE_DIR:-/tmp/peakui-openclaw-workspace}` into the app container at `/mnt/openclaw/workspace`, and the runtime creates a host-style alias so shell/code prompts can reliably use `/tmp/peakui-openclaw-workspace`
- **Shell approval logic refinement** — destructive operations remain blocked, but repo/network/install/service commands such as `git clone`, `curl`, `wget`, `npm install`, and `docker compose up` now require explicit approval instead of being misclassified as inherently dangerous; the runtime image now includes `git`, `curl`, `wget`, `bash`, `tar`, and `unzip`
- Settings propagate immediately to active chat (temperature + context + system prompt injected into every API call)

## 🔑 Key Files
| File | Purpose |
|---|---|
| `src/app/page.tsx` | Main dashboard, chat, session management, and surface-aware Knowledge Base/Open Claw navigation |
| `src/app/components/KnowledgeBase.tsx` | RAG UI — upload, search, health summary, full-document preview, manage docs |
| `src/app/components/SettingsPanel.tsx` | Settings UI |
| `src/app/components/OpenClawWorkspace.tsx` | Open Claw agent workspace surface with shared chat-like top bar, left workspace rail, session UI, task-mode preferences, and inline Knowledge Base shell |
| `src/app/api/chat/route.ts` | Alias to the shared chat completion pipeline |
| `src/app/api/chat/models/route.ts` | Provider-aware main-chat model discovery for Ollama, Hugging Face, and hybrid mode |
| `src/app/api/chat/completions/route.ts` | Streaming completion endpoint |
| `src/app/api/chat/completed/route.ts` | Chat finalization endpoint |
| `src/app/api/chat-tags/route.ts` | Authenticated chat-tag list/create endpoint used by the main sidebar organization UI |
| `src/app/api/chats/new/route.ts` | Chat session creation endpoint |
| `src/app/api/folders/route.ts` | Authenticated folder list/create endpoint for chat organization |
| `src/app/api/folders/[id]/route.ts` | Folder update/delete endpoint that preserves sessions while clearing folder membership |
| `src/app/api/openclaw/models/route.ts` | Provider-aware Open Claw model discovery endpoint |
| `src/app/api/openclaw/verify/route.ts` | Provider verification endpoint for Open Claw Ollama/OpenAI-compatible connectivity checks |
| `src/app/api/ollama/health/route.ts` | Authenticated Ollama runtime health endpoint used by Chat and Open Claw for online/degraded/offline state, loaded model visibility, and recovery UX |
| `src/app/api/ollama/stop/route.ts` | Authenticated local-model stop endpoint used by Chat and Open Claw when a selected Ollama model needs a clean restart |
| `src/app/api/web/context/route.ts` | Authenticated backend-managed public-web context endpoint shared with Chat/Open Claw Internet mode |
| `src/app/components/SourceChips.tsx` | Shared assistant citation/source chip renderer for Knowledge Base and web results |
| `src/app/api/files/extract/route.ts` | Shared authenticated attachment extraction endpoint |
| `src/app/api/rag/route.ts` | Document upload queue + background indexing |
| `src/app/api/rag/search/route.ts` | Cosine similarity search |
| `src/app/api/rag/test-embed/route.ts` | Embedding model availability test |
| `src/app/api/search/route.ts` | Authenticated saved-chat search endpoint for main-sidebar title/content lookup |
| `src/app/api/sessions/[id]/tags/route.ts` | Session-tag attach/remove endpoint for chat organization |
| `src/app/api/settings/route.ts` | User settings CRUD |
| `src/app/api/auth/login/route.ts` | Login + first-time admin setup |
| `src/lib/rag.ts` | Shared chunking, embeddings, cosine scoring, BM25 keyword search |
| `src/lib/file-extraction.ts` | Shared file extraction for chat attachments and RAG |
| `src/lib/chat-completion.ts` | Shared streaming completion helper |
| `src/lib/chat-platforms.ts` | Shared chat-platform types, Hugging Face base URL normalization, provider-aware model ids, and router detection helpers |
| `src/lib/chat-sessions.ts` | Chat session normalization, creation, and finalization helpers |
| `src/lib/openclaw-agent.ts` | Open Claw task-mode definitions, quick prompts, and workspace-brief builder |
| `src/lib/ollama-health.ts` | Shared client/server type for Ollama health summaries returned by `/api/ollama/health` |
| `src/lib/openclaw-prompt.ts` | Open Claw task/workspace system prompt builder |
| `src/lib/openclaw-workspace.ts` | Managed Open Claw workspace mount/alias helpers shared by shell, filesystem, and code execution |
| `src/lib/file-shared.ts` | Shared upload limits, file kind detection, and extracted-file payload types |
| `src/lib/settings.ts` | Shared defaults, settings normalization, Ollama host normalization |
| `src/lib/stream-status.ts` | Shared stream-phase types and user-facing startup/generation status labels for Chat and Open Claw |
| `src/lib/use-sticky-scroll.ts` | Shared sticky-scroll hook used by Chat and Open Claw to preserve manual scrollback during streaming |
| `src/lib/ollama-control.ts` | Shared Ollama runtime controls for listing loaded models, stopping a selected local model, and unloading non-selected ones before local model switches |
| `src/lib/embedding-models.ts` | Recommended embedding model definitions and Ollama model-name normalization |
| `src/lib/message-sources.ts` | Shared citation/source metadata types for Knowledge Base and web context |
| `src/lib/theme-options.ts` | Theme definitions, validation, and client-side theme application |
| `src/lib/web-context.ts` | Safe public-web search/fetch/extraction pipeline with SSRF protections, DuckDuckGo-first search, and Internet-mode fallback context building |
| `src/lib/request-auth.ts` | Cookie/JWT user lookup for route handlers |
| `src/lib/shell-execution.ts` | Shell command parsing, safety validation, allowed command checking, and command execution with output capture |
| `src/lib/openclaw-host-executor.ts` | App-side client for the optional host executor daemon, including health checks and command dispatch |
| `src/lib/shell-audit.ts` | Shell command audit helpers for persisting request/result lifecycle updates |
| `scripts/openclaw-host-executor.mjs` | Optional host-side shell executor daemon for running approved commands outside Docker with token auth and guardrails |
| `docs/openclaw-host-executor.md` | Operator docs for configuring and running the optional Open Claw host executor |
| `src/lib/openclaw-code-execution.ts` | Managed Open Claw Python/Node sandbox with workspace guardrails, runtime shims, and artifact capture |
| `src/lib/openclaw-browser.ts` | Controlled public-web browser session logic with SSRF protections, link/form extraction, and approval-gated submits |
| `src/lib/uwaf-browser.ts` | Unified Web Agent Framework browser engine — dual-mode (direct/stealth) Playwright-based browser with screenshots, form interaction, research batch crawling, and binary download blocking |
| `src/lib/uwaf-sanitizer.ts` | Three-stage sanitize-first pipeline (HTML pruning → readability filtering → Markdown conversion via Turndown), table extraction, and binary URL blocking |
| `src/lib/uwaf-pool.ts` | Playwright browser pool manager — lazy Chromium init, context reuse with 30-min TTL, stealth mode config (randomized UA, SOCKS5 proxy, WebRTC disabled), Tor health checks, IP detection |
| `src/app/api/openclaw/uwaf-browser/route.ts` | Main UWAF browser execution route with auth, settings, approval validation |
| `src/app/api/openclaw/uwaf-browser/request/route.ts` | Approval token creation for submit/research_batch actions |
| `src/app/api/openclaw/uwaf-browser/status/route.ts` | Connection status endpoint (Direct IP, Tor reachability, Tor exit info) |
| `src/app/components/UwafNetworkPanel.tsx` | Network Hub Panel — Direct/Stealth mode toggle, IP display, Tor status indicator |
| `src/app/components/UwafBrowserPreview.tsx` | Browser preview panel — screenshot rendering, URL/title display, mode badge |
| `src/lib/openclaw-tool-approvals.ts` | Shared approval-token helpers for filesystem writes, code execution, and browser submits |
| `src/middleware.ts` | Route protection |
| `src/lib/memory.ts` | Multi-layer memory system: daily logs, session summaries, long-term memory loading, and memory context building |
| `src/app/api/openclaw/memory/route.ts` | Memory context endpoint that returns recent daily logs + long-term memory for Open Claw injection |
| `src/app/api/openclaw/session-summary/route.ts` | Session summary generation endpoint that creates TL;DRs and appends to daily memory logs |
| `src/app/api/openclaw/shell/request/route.ts` | Shell command request endpoint that validates commands, resolves container/host target, audits requests, and returns approval requirements |
| `src/app/api/openclaw/shell/execute/route.ts` | Shell command execution endpoint that runs approved commands in the resolved target and persists audit output |
| `src/app/api/openclaw/shell/settings/route.ts` | Shell execution settings endpoint for target, approval mode, host limits, and host executor health |
| `src/app/api/openclaw/filesystem/route.ts` | Read-only Open Claw filesystem endpoint that enforces approved host paths before listing, reading, or stat-ing files |
| `src/app/api/openclaw/filesystem/request/route.ts` | Filesystem approval endpoint for Open Claw write actions |
| `src/app/api/openclaw/code/route.ts` | Managed Open Claw code sandbox execution endpoint for Python/Node runs |
| `src/app/api/openclaw/code/request/route.ts` | Code execution approval endpoint for Open Claw sandbox runs |
| `src/app/api/openclaw/browser/route.ts` | Controlled browser session endpoint for Open Claw page open/click/fill/submit/extract actions |
| `src/app/api/openclaw/browser/request/route.ts` | Browser approval endpoint for submit-capable Open Claw actions |
| `src/app/components/ShellCommandModal.tsx` | Command approval modal with danger warnings and approve/reject actions |
| `src/app/components/ShellOutput.tsx` | Collapsible command output display with target label, ANSI stripping, copy button, and exit code badge |
| `src/app/components/ShellSettingsPanel.tsx` | Settings panel for shell target, approval mode, allowed commands, and host executor guardrails |
| `src/lib/openclaw-filesystem.ts` | Server-side read-only host filesystem guardrail logic, including mounted-root checks, approved-path checks, and file/directory operations |
| `prisma/schema.prisma` | DB schema: User, UserSettings (including theme, persona, shell target/approval settings, host executor guardrails, filesystem/code/browser modes), ShellCommandAudit, ChatSession (with summary), Folder, Tag, ChatSessionTag, Document, DocumentChunk |
| `docs/development-section-plan.md` | Research-backed plan for Development section: Code Interpreter, Virtual Machines, Docker Containers, and an alternative gateway architecture |
| `docs/settings-and-rag.md` | Production behavior for system prompt, temperature, context window, RAG mode, and embedding models |
| `OPENCLAW-TODO.md` | Comprehensive gap analysis of missing agent infrastructure (10 categories, ~50 items) vs the full Open Claw agent platform |
| `docker-compose.yml` | Orchestrates `app` (Next.js) + `db` (Postgres) + `tor-proxy` (Tor SOCKS5) with host networking plus Open Claw host mounts, including the managed writable workspace root mounted at `/mnt/openclaw/workspace`. Tor proxy maps host 9050→container 9150. |
| `Dockerfile` | Multi-stage Node 22 Alpine build, `ENV HOSTNAME 0.0.0.0` for LAN access, plus runtime tooling (`git`, `curl`, `wget`, `bash`, `tar`, `unzip`, `chromium`, `chromium-chromedriver`, `poppler-utils`, `tesseract-ocr`) and workspace-alias bootstrapping |

## 🌐 Deployment Notes
- Runs on port `3000`, accessible via `localhost:3000` or LAN IP
- **IMPORTANT:** Never use `prisma db push --force-reset` on production — it wipes all data!
- Use `prisma migrate dev` for safe schema changes or just `prisma db push` (without --force-reset)
- `network_mode: host` allows the container to reach Ollama at `127.0.0.1:11434` and the Tor proxy at `localhost:9050`
- Tor proxy (`peterdavehello/tor-socks-proxy`) provides SOCKS5 on host port 9050 (container port 9150) for UWAF stealth mode
- Optional host shell execution requires running `npm run openclaw:host-executor` on the host with `OPENCLAW_HOST_EXECUTOR_TOKEN` set, and the app container must receive the same token through Compose. Without it, Host target falls back to the container shell.
- Behind Nginx Proxy Manager: add `proxy_buffering off; proxy_read_timeout 300s; proxy_http_version 1.1; proxy_set_header Connection '';` to the Advanced tab to support streaming

## ⏭️ Next Steps / Roadmap
- **Open Claw Agent Infrastructure:** Phases 1-2 (multi-layer memory, tool execution, canvas artifacts) complete. Next priorities are heartbeats/autonomous scheduling, then sub-agent delegation and multi-agent teams.
- **Open Claw permissions next:** If broader host roots than `/home` and `/tmp` are needed for filesystem tools, add more Docker bind mounts first, then allow those paths in Settings. For true host-command access, run the host executor with narrow approved cwd roots and keep `ask-first` enabled until the workflow is proven.
- **Development Plan:** Implement the Development Worker foundation, Docker dashboard, Code Interpreter sandboxes, Docker control actions, and VM orchestration per `docs/development-section-plan.md`
- **Internet mode next:** Consider an optional Phase 2 browser extension/current-tab context flow, but keep the shipped Phase 1 path read-only and citation-first
- **Phase 2:** Docker Orchestration — spawn/manage containers from chat via `dockerode`
- **Chat UX next:** Add richer health checks/status chips around Ollama service state so users can see when the host daemon is wedged before starting a generation
- **RAG (v2 complete):** Server-side RAG now fires automatically alongside web search when enabled. Added hybrid search (RRF combining semantic + keyword), per-request topK control with full access mode (-1 = all chunks), and a UI toggle to enable/disable knowledge base per-chat
- **Phase 4:** Code Interpreter and VM orchestration


## 💻 Latest Commit Info
- **Current committed baseline:** `fix: make live browser follow ai browsing`
- **Previous committed baseline:** `feat: add UWAF dual-mode browser (Clear Web + Dark Web/Tor) with Playwright, Tor proxy, sanitize pipeline, and UI`

### Latest Hotfixes (post v0.10.0)
- **Live browser AI routing fix:** `unified_browser` now supports visible `search`; Open Claw prefers UWAF for visible browsing when available; active page tracking keeps the visible noVNC browser aligned with AI actions; `wait_for_user` lets the model pause for human CAPTCHA/login/MFA help and resume with a fresh page observation
- **Uncensored/unrestricted tool access fix:** `openClawPrompt` and `chatInternetPrompt` now included in all mode branches; anti-tool language removed from `UNCENSORED_BASE_INSTRUCTIONS`; dynamic tool-aware clause added; `UNCENSORED_REINFORCEMENT` updated to encourage tool use
- **RAG full access fix:** `normalizeTopK()` maps -1 to 10000; semantic threshold lowered to 0 for full access; context limit raised from 10K to 100K; client-side context injection removed; KB system message positioned after main prompt; KB instruction strengthened
- **RAG indexing fixes:** Stale timeout increased to 10 min; stale detection moved from GET to POST/health; embedding retry with backoff; error document re-upload recovery; extraction cap at 2M chars
- **Date/time injection:** Current date+time+timezone injected in all system prompts and OpenClaw prompt
- **UWAF browser fix:** Removed `--single-process`/`--no-zygote` Chromium flags; added `newPage()` retry logic

### Latest Changes (v0.10.0) 🕸️
- **UWAF (Unified Web Agent Framework):** Dual-mode browser engine supporting Direct (Clear Web) and Stealth (Tor-routed) research modes, fully integrated into Open Claw as the `unified_browser` tool
- **Playwright browser engine:** `uwaf-browser.ts` uses Playwright-core with system Chromium for full page rendering, JavaScript execution, screenshots, and form interaction — runs headless inside the Docker container with `--no-sandbox --disable-setuid-sandbox` flags
- **Tor proxy sidecar:** `peterdavehello/tor-socks-proxy` Docker service providing SOCKS5 on host port 9050 (container port 9150). App connects via `TOR_PROXY_URL=socks5://localhost:9050`. Tor reachability is checked before every stealth request, and stealth mode fails closed (no fallback to direct).
- **Sanitize-first pipeline:** `uwaf-sanitizer.ts` implements three stages: (1) HTML pruning strips script/style/iframe/nav/footer/aside/ad elements and tracking pixels; (2) readability filter scores paragraphs by word count, comma count, and link density using sliding-window best-block detection; (3) Markdown conversion via Turndown with GFM table support. Stealth mode applies stricter stripping of inline styles, data attributes, and tracking URL parameters.
- **Browser pool:** `uwaf-pool.ts` manages Playwright browser instances with lazy initialization, context reuse (30-minute TTL with auto-cleanup), and stealth configuration (randomized User-Agent from a pool of 5 realistic UAs, SOCKS5 proxy via Tor, WebRTC disabled, webdriver hidden). Direct mode uses standard Chromium with no proxy.
- **Tool actions:** `unified_browser` supports open, click, extract, extract_table, research_batch, fill, and submit. `research_batch` crawls a starting URL and follows links up to depth 3 (max 10 pages), returning aggregated Markdown content. `extract_table` pulls all `<table>` elements as structured Markdown or CSV. `fill` and `submit` allow form interaction with approval-gated submission.
- **Screenshots:** JPEG base64 thumbnails (quality 60, max 800px width) captured automatically during browsing, rendered in the Browser Preview panel in the Open Claw workspace
- **Network Hub Panel:** `UwafNetworkPanel.tsx` shows the current Direct IP, Tor connection status (online/offline), Tor exit node country, and a mode selector to switch between Direct and Stealth modes
- **Source chips:** Clear Web sources render as blue chips with `[Source: Clear Web]`, Dark Web sources as purple chips with `[Source: Dark Web]`. `.onion` URLs are automatically labeled as Dark Web.
- **Approval flow:** `submit` and `research_batch` actions always require approval tokens (not mode-dependent). The approval request endpoint at `/api/openclaw/uwaf-browser/request` creates signed tokens that are validated by `/api/openclaw/uwaf-browser` before executing.
- **Session management:** In-memory browser sessions (Map-based, 60-minute TTL) track current page state (URL, title, links, forms), filled form values, and screenshot history. Context reuse means the same Playwright BrowserContext is shared across actions within a session.
- **New settings:** `openClawUwafBrowserMode` (deny/direct/stealth), `openClawUwafScreenshots` (boolean), `openClawUwafDefaultMode` (direct/stealth) — all stored in `UserSettings` and configurable from the Settings panel
- **New API routes:** `/api/openclaw/uwaf-browser` (main execution), `/api/openclaw/uwaf-browser/request` (approval tokens), `/api/openclaw/uwaf-browser/status` (connection status including Direct IP, Tor reachability, and Tor exit info)
- **Security:** SSRF protections reuse `assertPublicHttpUrl()` from `openclaw-browser.ts`. `.onion` URLs are only accessible in stealth mode (blocked in direct mode). Binary download blocking checks Content-Type, Content-Disposition, and URL path for executable extensions (.exe, .sh, .bin, etc.). Stealth mode verifies Tor proxy reachability before every request and fails closed if the proxy is down.
- **Docker:** Added `chromium` and `chromium-chromedriver` Alpine packages, `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser` env var, `shm_size: 256m` for Chromium shared memory, and `TOR_PROXY_URL` env var. App uses `network_mode: host` so it can reach Tor at `localhost:9050`.
- **Dependencies:** Added `playwright-core`, `turndown`, `@types/turndown`
- **Type system updates:** `PendingToolApproval` type now includes a `unified_browser` kind with `OpenClawUwafBrowserToolRequest`. `ToolApprovalResolution` includes `UwafBrowserToolResultEntry`. `OpenClawSettings` includes UWAF fields. `toolRequest` type includes `'unified_browser'`. `ShellCommandModal` renders a Shield icon for `unified_browser` approvals.
- **Changed files:**
  - `docker-compose.yml` — Added tor-proxy service (peterdavehello/tor-socks-proxy, host port 9050→container port 9150), shm_size, TOR_PROXY_URL env var, depends_on tor-proxy
  - `Dockerfile` — Added chromium/chromium-chromedriver to apk, PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, changed npm ci to npm install
  - `package.json` — Added playwright-core, turndown, @types/turndown
  - `prisma/schema.prisma` — Added openClawUwafBrowserMode, openClawUwafScreenshots, openClawUwafDefaultMode to UserSettings
  - `src/lib/settings.ts` — Added UWAF settings types (OpenClawUwafBrowserMode, OpenClawUwafDefaultMode), defaults, and normalizers
  - `src/lib/openclaw-tools.ts` — Added OpenClawUwafBrowserToolRequest, unified_browser to OpenClawToolRequest union, parser, and tool example
  - `src/lib/openclaw-prompt.ts` — Added UWAF browser prompt section with dual-mode instructions and action documentation
  - `src/lib/openclaw-tool-approvals.ts` — Added 'unified_browser' to OpenClawApprovalTool type
  - `src/lib/openclaw-workspace.ts` — Added getUwafClearWebDir(), getUwafDarkWebDir(), ensureUwafDirectories()
  - `src/lib/message-sources.ts` — Added networkMode field to MessageSource interface
  - `src/lib/chat-completion.ts` — Added uwafBrowserMode to buildOpenClawSystemPrompt context
  - `src/lib/openclaw-browser.ts` — Exported assertPublicHttpUrl for UWAF SSRF reuse
  - `src/lib/chat-sessions.ts` — Added 'unified_browser' to toolRequest type and normalizeToolRequest
  - `src/app/api/settings/route.ts` — Added UWAF settings fields to body whitelist and save logic
  - `src/app/components/OpenClawWorkspace.tsx` — Added UWAF mode toggle (Shield icon), unified_browser tool dispatch, Network Panel, Browser Preview, UwafBrowserToolResultEntry, describeUwafBrowserRequest, approval/reject handling for unified_browser kind, and OpenClawSettings UWAF fields
  - `src/app/components/SourceChips.tsx` — Added isOnionUrl(), getNetworkModeLabel(), getNetworkModeStyle() for Clear Web/Dark Web chip rendering
  - `src/app/components/SettingsPanel.tsx` — Added UWAF Browser settings section (mode radio cards, default mode selector, screenshots toggle, Tor proxy info)
  - `src/app/components/ShellCommandModal.tsx` — Added 'unified_browser' toolKind with Shield icon
  - New: `src/lib/uwaf-browser.ts` — Unified browser engine with Playwright, dual-mode, screenshots, session management, binary blocking, .onion validation
  - New: `src/lib/uwaf-sanitizer.ts` — Three-stage sanitize pipeline (prune → readability → Markdown), table extraction, metadata extraction, binary URL blocking
  - New: `src/lib/uwaf-pool.ts` — Playwright browser pool manager with lazy init, context reuse, stealth configuration, Tor health checks, IP detection
  - New: `src/app/api/openclaw/uwaf-browser/route.ts` — Main UWAF browser execution route with auth, settings, approval validation
  - New: `src/app/api/openclaw/uwaf-browser/request/route.ts` — Approval token creation for submit/research_batch
  - New: `src/app/api/openclaw/uwaf-browser/status/route.ts` — Connection status (Direct IP, Tor reachability, Tor exit info)
  - New: `src/app/components/UwafNetworkPanel.tsx` — Network Hub Panel with mode toggle, IP display, Tor status
  - New: `src/app/components/UwafBrowserPreview.tsx` — Browser preview with screenshot rendering, URL/title/mode badge

### Latest Changes (v0.9.0) 🛠️
- **Optional host shell executor:** Added `scripts/openclaw-host-executor.mjs` plus `npm run openclaw:host-executor` so Open Claw can run approved shell commands on the host when configured with `OPENCLAW_HOST_EXECUTOR_TOKEN`.
- **Shell target selection:** Settings now supports `container` vs `host` shell targets. Host mode uses the optional daemon; container mode stays as the default built-in shell path.
- **Host guardrails:** Host shell commands enforce approved cwd roots, allowed environment variable names, timeout caps, and output caps.
- **Fallback behavior:** When Host is selected but the executor token/daemon is unavailable, Open Claw falls back to the container shell and labels the actual target instead of failing simple shell commands with a host-token blocker.
- **Shell audit DB model:** Added `ShellCommandAudit` for command, target, approval mode, status, stdout/stderr, exit code, duration, session/message IDs, roots/env config, and lifecycle timestamps.
- **Open Claw shell UI:** Shell settings panel now exposes target, host roots/env/caps, and host executor status. Shell output now labels whether the command ran in `container` or `host`.
- **Prompt awareness:** Open Claw system prompt now tells the model whether shell is container-backed or host-backed.
- **Dropdown layering fix:** Open Claw model dropdown now sits above the chat stack so the full menu is clickable.
- **Docs:** Added `docs/openclaw-host-executor.md` and updated README, feature docs, roadmap, todo, and project memory.

### Latest Changes (v0.8.0) 📚
- **Server-side RAG integration:** Knowledge base now fires automatically during chat alongside web search when enabled, no longer requires manual client-side search
- **Hybrid search (RRF):** Combines semantic + keyword search results using Reciprocal Rank Fusion for better coverage
- **Per-request topK control:** Configurable number of chunks (1-200) plus "Full Access" mode that retrieves all matching chunks
- **RAG settings in DB:** `ragEnabled` (Boolean) and `ragTopK` (Int) stored per-user in `UserSettings` with proper save/read pipeline
- **UI enhancements:** Enable toggle, topK slider with number input, Full Access toggle in Settings → Knowledge Base
- **Settings API fix:** Changed property existence check from `!== undefined` to `hasOwnProperty` for `ragEnabled`/`ragTopK`
- **Stream status:** Added `knowledge-base` status for UI phase display during RAG lookup
- **Changed files:**
  - `src/lib/rag.ts` — Added `buildKnowledgeBaseContext()` with RRF, `buildRagContextBlock()`, `fuseRRF()`, context block builder
  - `src/lib/chat-completion.ts` — RAG fires alongside web search in both Ollama and OpenAI-compatible paths; sends `knowledge_sources` in stream
  - `src/lib/settings.ts` — Added `ragEnabled`/`ragTopK` to `AppSettings`, `DEFAULT_SETTINGS`, `normalizeAppSettings()`, `normalizeRagTopK()` (-1 support)
  - `prisma/schema.prisma` — Added `ragEnabled` (Boolean) and `ragTopK` (Int) to `UserSettings`
  - `src/lib/stream-status.ts` — Added `knowledge-base` status
  - `src/app/api/settings/route.ts` — Added `ragEnabled`/`ragTopK` to body interface, whitelist, and DB write
  - `src/app/components/SettingsPanel.tsx` — Added enable toggle, topK slider with number input, Full Access toggle
  - `src/app/page.tsx` — Passes `rag_enabled`/`rag_query` in requests; handles `knowledge_sources` from stream
  - `src/app/api/rag/route.ts` — Added stale-document cleanup and improved error messaging

### ⚠️ DATABASE RESET NOTE
The database was wiped during development (accidental `--force-reset`). All users, chats, documents, and settings prior to the current commit are lost. Fresh database starting from this commit.

### Latest Changes (v1.0.0) 🔐
- **Bulletproofed auth flow:** JWTs now use issuer/audience/subject/type/tokenVersion claims, stronger cookie settings, DB-backed token invalidation, inactive-account enforcement, `lastLoginAt`, and serializable first-admin bootstrap protection.
- **Runtime JWT secret generation:** Compose no longer ships a hardcoded auth secret. The app container now persists a generated secret in `/var/lib/peakui/jwt-secret` unless `JWT_SECRET` is explicitly provided.
- **Expanded user model:** Added `isActive`, `tokenVersion`, `permissionOverrides`, `lastLoginAt`, `updatedAt`, and a new `MANAGER` role.
- **Permission framework:** New `src/lib/permissions.ts` defines role defaults plus allow/deny overrides. New request-auth helpers resolve the current DB user and effective permissions on every authenticated route.
- **Admin user management APIs:** Added `GET/POST /api/admin/users` and `PATCH/DELETE /api/admin/users/[id]` with last-admin safeguards, password reset support, role changes, activation toggles, and override persistence.
- **Settings UI:** Added an admin-only User Management section in Settings for creating users, managing roles, editing permission overrides, resetting passwords, disabling accounts, and deleting users.
- **Bootstrap preserved:** First deployment still uses the existing login/setup screen to create the initial admin. That screen now also enforces password confirmation and the stronger password policy.
- **Permission enforcement added:** Knowledge base, canvas, OpenClaw, shell, filesystem, browser, UWAF browser, and live-browser websocket access now check effective permissions server-side.
- **Next.js auth gate cleanup:** Replaced deprecated `src/middleware.ts` with `src/proxy.ts`.
- **Changed files:**
  - `prisma/schema.prisma` — Expanded `User` model and added `MANAGER` role
  - `src/lib/auth.ts` — Stronger JWT claims, cookie helpers, secure secret handling
  - `src/lib/auth-validation.ts` (new) — Username/password validation and password policy helpers
  - `src/lib/permissions.ts` (new) — Role defaults, permission metadata, overrides parsing/serialization
  - `src/lib/request-auth.ts` — DB-backed auth resolution, inactive-user rejection, tokenVersion checks, permission-aware helpers
  - `src/proxy.ts` (new) — Replacement for deprecated middleware auth gate
  - `src/app/api/auth/login/route.ts` — Hardened bootstrap/login flow
  - `src/app/api/auth/check/route.ts` — Now returns auth/session state when available
  - `src/app/api/auth/logout/route.ts` — Consistent cookie clearing
  - `src/app/api/auth/session/route.ts` (new) — Current authenticated user/session info
  - `src/app/api/admin/users/route.ts` (new) — Admin list/create users
  - `src/app/api/admin/users/[id]/route.ts` (new) — Admin update/delete users
  - `src/app/components/SettingsPanel.tsx` — Admin-only user management UI
  - `src/app/login/page.tsx` — Bootstrap password confirmation/policy
  - `src/lib/live-browser-server.ts` — DB-backed permission check for live UWAF connections
  - `src/app/api/rag/*`, `src/app/api/canvas/artifacts*`, `src/app/api/openclaw/*` — Permission enforcement on protected feature routes
  - `src/lib/openclaw-tool-approvals.ts`, `src/lib/shell-execution.ts` — Reuse hardened JWT secret source
  - `Dockerfile`, `docker-compose.yml` — Persisted runtime JWT secret volume and startup generation
- **Summary:** 
  - Added `CanvasPanel` component with visual artifact cards, syntax highlighting (via `react-syntax-highlighter`), markdown rendering, image previews, and edit-in-place functionality
  - Added `CanvasPreview` standalone component for individual artifact previews
  - Added external URL image support in `extractInlineImages()` - now parses `![alt](https://...)` markdown syntax
  - Updated `ImageGallery` to render external images with globe icon (open in new tab) and download button
  - Added `Globe` icon import for external image controls
  - Fixed various TypeScript strict null checks
- **Changed files:**
  - `src/app/components/CanvasPanel.tsx` (new) — Full artifact panel with code/markdown/image rendering, edit, download, copy
  - `src/app/components/CanvasPreview.tsx` (new) — Standalone artifact preview component
  - `src/app/components/ChatMessageContent.tsx` — Added external image parsing and ImageGallery updates
  - `src/app/components/OpenClawWorkspace.tsx` — Integrated CanvasPanel, updated artifact state types
  - `package.json` — Added `react-syntax-highlighter` dependency
- **Previous commit:** `5b35ff8` — `fix: sandbox improvements and graphite theme`
  - Added Python3 to container for code sandbox
  - Added AbortSignal support for clean interruption
  - Added timeout/cwd support to shell execution
  - Redesigned Graphite theme to clean grey/white with green accent like ChatGPT
