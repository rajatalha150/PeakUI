# PeakUI | Local AI Studio - Project Memory

## 🤖 AI Instructions
**CRITICAL:** Any AI working on this project MUST read this file first. 
**CRITICAL:** Whenever you make a new git commit, you MUST update this `memory.md` file to reflect the new state of the project, the latest features added, and the next steps.

## 📝 Project Overview
PeakUI is a Next.js (App Router) web application designed to act as a local-first Open Claw AI Studio command center. It connects to a user-configured Ollama host (default `127.0.0.1:11434`) for local models, while Open Claw can also target OpenAI-compatible providers through its provider settings. The legacy chat completion APIs remain as shared backend infrastructure, but the user-facing shell now opens directly into Open Claw. It is fully Dockerized (`docker-compose`) and secured behind a PostgreSQL-backed authentication layer.

## 🛠️ Tech Stack
- **Frontend:** Next.js 16 (App Router, React), `lucide-react` icons
- **Styling:** Vanilla CSS (`globals.css`) — dark mode, glassmorphism, CSS-variable themes, accent gradients
- **Backend:** Next.js API Routes
- **Database:** PostgreSQL 15 via Prisma ORM (`prisma.config.ts` adapter pattern)
- **Auth:** `jose` Edge-compatible JWTs + `bcryptjs`, `httpOnly` cookies
- **Deployment:** Docker + Docker Compose (`network_mode: host` for Ollama access)

## 🚀 Completed Features

### Network Hub Fast Status & Keepalive ✅
- Network Hub page load now uses a lightweight `level=quick` UWAF status path with in-process caching instead of running full Tor/DNS/WebRTC/fingerprint preflight on every refresh.
- Full stealth verification remains available from the Network Hub refresh button through `level=preflight&force=1`, while quick/deep status responses are cached separately to avoid repeated expensive browser launches.
- The Network Hub UI hydrates from session storage immediately, retries automatically when it receives a temporary checking response, and keeps quick status warm with a lightweight 60-second refresh while mounted.

### Open Claw-Only App Shell ✅
- The app now boots directly into the Open Claw workspace instead of restoring the normal chat surface.
- The normal chat sidebar/top-level surface has been removed from the reachable shell; Open Claw is now the single left-rail navigation model.
- Open Claw rail navigation now owns Workspace, Knowledge Base, and Settings, so Settings and RAG management stay inside the Open Claw shell.
- The Settings panel can render as an Open Claw main-panel view, and Logout moved into the Settings header.
- Main-chat-specific Settings controls are hidden from the UI; shared generation controls such as system prompt, temperature, context window, Ollama host, exclusive switching, RAG, and Open Claw tool settings remain available.
- Legacy `/api/chat/*` and shared completion/session helpers remain in place for backend compatibility and Open Claw streaming.

### Open Claw Header Cleanup ✅
- The crowded desktop Open Claw mode cluster was replaced with one featured `Workspace modes` dropdown in the shared top bar.
- The single menu now contains Internet, UWAF Direct/Stealth, RAG, Unrestricted, and Uncensored so the navbar stays clean without removing any runtime controls.
- Desktop dropdown state now closes on outside click, `Esc`, and viewport collapse; mobile keeps the existing overflow-menu pattern.

### Open Claw Host Shell Executor & Shell Audit ✅
- Open Claw shell execution now has an explicit target setting: `container` for the built-in app runtime or `host` for an optional host-side executor daemon.
- The optional host executor lives at `scripts/openclaw-host-executor.mjs`, listens on `127.0.0.1:4318` by default, requires `OPENCLAW_HOST_EXECUTOR_TOKEN`, and executes commands on the host with host `PATH`/CLI availability.
- Host execution is constrained by approved working-directory roots, allowlisted host environment variables, per-command timeout caps, output-size caps, and the existing shell approval model.
- Host executor root/cwd validation now resolves approved roots and requested working directories through real paths before execution, so symlinked cwd paths cannot bypass the configured root boundary.
- If Host is selected but the executor token is missing or the daemon is unreachable, Open Claw now falls back to the normal container shell and labels the actual target in both approval dialogs and command output. This prevents simple commands from failing only because host mode is not fully configured.
- Shell requests and results are now stored in PostgreSQL via `ShellCommandAudit`, including user/session/message, command, cwd, target, approval mode, status, timeout/output caps, allowed roots/env vars, stdout/stderr, exit code, and duration.
- Shell settings now include target, approval mode, additional auto-approve prefixes, host allowed roots, host allowed env vars, host timeout, host output cap, and host executor status.
- The Open Claw system prompt now tells the model whether the shell is currently container-backed or host-backed, so it can reason correctly about available commands and paths.
- Added `docs/openclaw-host-executor.md` and `npm run openclaw:host-executor` for operating the optional daemon.

### Open Claw Host Access Diagnostics ✅
- `/api/openclaw/filesystem` now supports a status `GET` that reports required permissions, mounted host roots, approved read/write roots, filesystem readiness, host shell settings, and host executor reachability.
- Filesystem `403` responses now include structured denial codes, `actionRequired` text, and current diagnostics for missing account permissions, disabled modes, missing approved roots, paths outside Docker mounts, and missing write approval tokens.
- Settings now includes Host Access presets for safe workspace-only access, home-read/workspace-write access, and mounted-root audit mode while keeping shell execution in `ask-first` and writes workspace-only by default.
- WorkSpaces feeds filesystem denial codes/action guidance back into the model-visible tool result so the agent stops retrying the same blocked path and can tell the user exactly what setting needs to change.

### Settings & Permission Consistency Audit ✅
- Effective WorkSpaces capability is now computed from account permissions plus personal settings, and that same result is reused by `/api/settings`, the Open Claw system prompt, the WorkSpaces client, and the shell/browser/UWAF/code routes.
- WorkSpaces now marks shell, filesystem, code, browser, and UWAF capabilities as `Blocked` when the account lacks permission, instead of showing them as enabled and then failing later with a backend denial.
- Added a dedicated `openclaw.code` permission so the managed Python/Node sandbox is governed independently from general Open Claw access.
- Fixed settings normalization for older or partially populated `UserSettings` rows so missing tool-mode fields now fall back to the intended defaults (`read-only` / `ask-first`) instead of silently collapsing to `deny`.
- Browser/UWAF/code/shell settings failures now surface permission-aware `403` responses and actionable UI error text rather than generic unauthorized behavior.

### Open Claw UI Fixes ✅
- Fixed the Open Claw model dropdown stacking/hit-area issue by giving the Open Claw header chrome its own higher stacking layer. The full dropdown is now clickable over the chat area instead of only the top exposed strip.

### Reusable Popover Primitive & Dropdown Stacking Fixes ✅
- Added `src/app/components/Popover.tsx` — a production-grade popover primitive that portals to `<body>`, uses `position: fixed` computed from the anchor's `getBoundingClientRect()`, and escapes every ancestor stacking context. Handles viewport clamping with flip-above fallback, click-outside (with anchor + additional ignore refs), Esc, scroll/resize tracking, `ResizeObserver` on the anchor, ARIA `role`/`aria-label`, optional focus management, and configurable `zIndex` / `width` / `maxHeight` / `side` / `align` / `gap` / `margin` / `closeOnScroll` / `closeOnResize`. Exposes a pure `computePopoverPosition` for unit testing (11 tests in `Popover.test.ts`).
- Migrated every hand-rolled `position: absolute` dropdown in the app to use the primitive: `KnowledgeBaseTreePopover`, Open Claw composer (model picker, Workspace Modes menu, create menu, session tile menu), and legacy chat (model picker, chat tile menu). The KB folder popover button inside the Workspace Modes menu now sits at z-1500 above the menu (z-1400) so the inner popover floats over the outer menu correctly.
- New convention: dropdowns/popovers/menus that drop over OTHER content (not just sit next to their button) **must** be rendered via `<Popover>`, not as `position: absolute` children. Ancestors that trap z-index in this app include `.openclaw-main-panel` (`isolation: isolate`), `.main-content` (`overflow: hidden`), `.header` (`z-index: 18`), `.openclaw-main-chrome` (`z-index: 12`), and `.openclaw-mode-toolbar` (`position: relative`). z-index convention: 1000 for popovers, 1100 for previews, 1200 for in-content popovers that sit above modals, 1400+ for nested popovers, 1300+ for modals.

### Canvas & Artifacts (Phase 7) ✅
- Agent-generated code and docs now persist beyond the chat via a new `CanvasArtifact` DB model
- Files in markdown code blocks auto-save to Canvas when user clicks download
- Canvas panel in Open Claw workspace rail shows all persisted artifacts per session
- Canvas panel support remains in the shared assistant renderer path, but the primary UI now exposes artifacts through Open Claw
- Support for durable artifact versioning via `CanvasArtifactRevision` snapshots on create/edit/restore, plus download and delete
- API endpoints: `GET/POST /api/canvas/artifacts`, `GET/PUT/DELETE /api/canvas/artifacts/[id]`, `GET/POST /api/canvas/artifacts/[id]/revisions`
- Visual artifact cards with code syntax highlighting (via `react-syntax-highlighter`)
- Markdown file rendering with headers, bold, links, lists
- Image preview support including external URLs (`![alt](https://...)` syntax)
- Edit-in-place: click Edit on any artifact to modify content/name directly
- External image gallery with open-in-new-tab (globe icon) and download buttons
- Canvas only shows when session has artifacts (no empty state banner)
- Canvas artifact cards now avoid eager heavy rendering when collapsed: markdown/code fall back to cheap text previews and only mount full markdown/syntax-highlighting on expand
- Canvas artifact lists are now virtualized so large sessions stay responsive
- Canvas artifact lists now support cursor paging, search, and load-more behavior instead of the old fixed 100-item session cap
- Canvas bundles now collapse/expand and support bundle-level JSON export/delete actions
- Canvas history now exposes revision restore, lightweight revision compare, source/derived lineage links, and retryable error states for content/history/list loading

### Knowledge Base / RAG (v2) ✅
- **Server-side RAG integration:** When enabled, `buildKnowledgeBaseContext()` queries indexed documents during chat alongside web search
- **Hybrid search with RRF:** Reciprocal Rank Fusion combines semantic (cosine similarity) + keyword (BM25) results for better coverage
- **Per-user settings:** `ragEnabled` (Boolean) and `ragTopK` (Int with -1 for full access) stored in `UserSettings`
- **Chat pipeline:** RAG fires in both Ollama and OpenAI-compatible paths; results sent as `knowledge_sources` in stream response
- **Auto-query routing:** Uses `rag_query` from request body or extracts from latest user message
- **Source metadata:** Retrieved KB sources now carry file kind, extension, file size, and excerpt length metadata, and the injected KB context explicitly says the model is seeing snippets rather than full files
- **Stream phases:** UI shows "Searching knowledge base..." during lookup
- **KB browser:** The Knowledge Base dashboard now pages documents server-side, lets users choose the page size, supports multi-select/select-all, and can bulk delete selected entries

### Knowledge Base Folder Browser & Per-Turn RAG Draft ✅
- **OneDrive-style folder browser** (`src/lib/kb-folders.ts` + `src/app/api/rag/folders/route.ts` + `KnowledgeBase.tsx`): users can now navigate uploaded documents by their original `sourcePath`, with breadcrumbs, a folder/file view toggle, sortable columns (name/size/createdAt/indexedAt/kind), kind filter, paginated files, and a delete-folder action that wipes every document under a prefix. The tree is polled every 8s during uploads to keep counts fresh. Pure path/tree utilities live in `kb-folders.ts` (30 unit tests in `kb-folders.test.ts`); the user-scoped `loadTreeSummary` in `kb-folders-server.ts` is what the chat completion path consumes, with a tiny LRU cache so a single turn doesn't re-fetch the tree multiple times.
- **RAG list `GET /api/rag` extensions:** new query params `folder`, `view` (`all`/`files`/`folders`), `sort`, `order`, `kind`. Backward-compat is preserved — when none of the new params are present, the response shape is exactly the legacy one. `DELETE /api/rag` accepts `{ folder: 'a/b' }` for subtree wipes.
- **Per-turn RAG draft persistence:** `ChatSession` gains `ragEnabled: Boolean`, `ragQuery: String?`, `ragSourcesJson: String?` (migration `20260608_add_chat_session_rag_draft/`). When a chat is closed and reopened, the user's RAG toggle, search text, and citation set re-hydrate as a pending draft. `ragEnabled` is the source of truth — when it flips false, the query and sources are dropped so a "RAG off" reopened chat doesn't leak stale citations. `chat-sessions-rag.test.ts` covers round-trip parse/serialize, invalid JSON, invalid source entries, and query trim/slice.
- **KB tree summary in chat completion:** `src/lib/chat-completion.ts` now injects a Knowledge Base tree summary as the first system message so the model knows the corpus shape even when a query returns 0 chunks. Limit 8000 chars when `ragTopK === -1` (unlimited mode), else 2500. When a search runs but returns no context, a "no matching chunks" hint is appended so the model doesn't appear unaware of the corpus. The tree fetch is wrapped in its own try/catch — a failed fetch never blocks the chat.

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
- Settings → Generation includes an **Exclusive Ollama Switching** toggle; when enabled, local-provider Open Claw unloads any other running Ollama models before starting the selected model so limited VRAM machines can dedicate resources to the active model
- Settings → Generation documents the native-Ollama lifecycle approach instead of exposing a configurable `keep_alive` control, and Open Claw/RAG embeddings no longer send request-level keep-alive overrides
- Chat now includes a per-session **Internet** toggle that performs backend-managed public web research before answering, merges fetched-page excerpts with search-result snippets, and no longer depends on local model tool support to start
- **Internet mode overhaul (v2):** Web search is now significantly more reliable and intelligent. The backend tries multiple search engines in priority order: Brave Search API (if `BRAVE_API_KEY` is configured), SearXNG (if `SEARXNG_URL` is configured), DuckDuckGo (with both HTML and Lite fallback parsers), and Bing as final fallback. Query intelligence generates multiple search queries from the user prompt for broader coverage. Page extraction now parses schema.org JSON-LD, Open Graph meta tags, and uses readability heuristics (link density scoring, nav/footer filtering) to extract article text while preserving structure. Fetched pages include retry logic (1 retry on timeout/5xx). Context limits were raised: up to 8 search results, 4 pages fetched, 3000 chars per excerpt, 12000 chars total context. The system prompt now strongly instructs the model to cite every factual claim with inline `[^N]` markers. Frontend source chips are now numbered `[1]`, `[2]`, etc., and inline citations in assistant text render as clickable superscript links that open the original source URL. This works in both Chat and Open Claw interfaces.
- Live audit confirmed that Gemma4 on the current 4 GB Quadro K2200 + Quadro M2000 setup can still spend minutes in Ollama backoff/OOM while loading; if the model does not fit, the new manual stop path helps recover, but app-side lifecycle steering is no longer involved
- Chat now treats `contextLength` as a requested maximum for local Ollama, starts the default local path without forcing `num_ctx` so Ollama can choose its own working context first, caps explicit requests to `PEAKUI_OLLAMA_CONTEXT_CAP` (`16384` by default), backs off further on memory-pressure errors, and fails model-start attempts after 60 seconds so terminal-working local models do not fail just because the UI slider was left too high
- Chat transport failures now preserve the provider URL, selected model, and low-level Node/Ollama socket details in the streamed error instead of collapsing app-to-Ollama failures into the generic browser-facing `fetch failed`
- Ollama HTTP errors are now separated from app transport errors, so runner crashes like `llama runner process has terminated` are reported as Ollama model-load/runtime failures instead of getting the generic fetch/restart hint
- Open Claw streaming views allow manual scrollback during generation; they only stay pinned to the bottom while the user is already near the latest message and show a floating down-arrow to jump back to the newest response
- Open Claw exposes distinct startup phases (`Searching knowledge base`, `Researching web`, `Unloading other models`, `Starting model`, `Connecting to model`, `Generating`) so pre-stream latency is visible instead of being collapsed into a misleading `Warming model...` state
- The Open Claw rail can collapse to a compact navigation surface, that state persists in browser storage, and the shared `useStickyScroll` hook drives Open Claw auto-scroll behavior
- Open Claw exposes a live Ollama health strip showing online/degraded/offline state, loaded-model visibility, and one-click recovery actions (Retry, Retry without web, Stop + retry) that reuse the last submitted draft instead of making the user rebuild it manually. The strip is compact and single-line: smaller badge, icon-only buttons with tooltips, and loaded models shown on hover instead of inline.
- Open Claw now owns the app chrome with a left drawer button, centered model picker, right overflow menu, and its rail as the single left-side navigation surface on desktop/mobile.
- Open Claw task threads support folders, reusable session tags, and rail search. Folder/tag assignment lives in each task row's overflow menu, while the rail can filter sessions by selected folder or tag.
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
- Open Claw now has its own RAG toggle in the workspace top bar; it uses the shared server-side RAG pipeline, honors saved `ragEnabled` / `ragTopK` defaults from Settings, injects source context before generation on the backend, and displays streamed source chips from `knowledge_sources`
- Open Claw now also has a per-session **Internet** toggle; when enabled it uses the same safe backend-managed public-web lookup path as Chat, merges those citations with any active RAG sources, and explains the mode inline in the workspace UI
- Open Claw Internet mode now also exposes a real reusable `web` tool to the model, so it can run follow-up searches or fetch a specific public page mid-task instead of being limited to the initial preloaded research pass. The prompt now explicitly lists the active toolset and tells the model when to reuse existing context versus request a fresh search.
- Open Claw now inherits the same metadata-rich Knowledge Base excerpts as chat, so retrieved sources are labeled as snippets rather than full-file content when they are injected into the task prompt. The KB prompt now also carries chunk-aware citations plus the retrieval contract that lets the model ask for broader lookup or direct file inspection when needed.
- Open Claw now includes an explicit **Verify** action for Ollama/OpenAI-compatible connections, plus a live connection-status summary and a quick local `Stop model` control in the workspace top bar
- Open Claw now behaves more like a workspace than a thin chat skin: it has persistent task modes (`Plan`, `Research`, `Execute`, `Review`), response-style controls, a clarify-first toggle, quick-start prompts, workspace notes, and success criteria that are stored in browser localStorage and injected into each request as a workspace brief
- Open Claw now supports multiple named project workspaces per user. Each workspace scaffolds `BOOT.md`, `TOOLS.md`, and a `skills/` library, can be selected from the Workspace controls modal, and injects its boot/tool/skill context into the Open Claw system prompt.
- Code sandbox runs now default into the selected named workspace when the model does not specify `workspacePath`, so file generation lands in a stable workspace root instead of an anonymous thread-only directory.
- Each named workspace can optionally auto-initialize a git repo and snapshot detected file changes as an automatic workspace backup.
- Open Claw now includes persistent autonomous scheduling infrastructure: a Node-side worker polls heartbeat configs, cron schedules, URL monitors, file monitors, and wake events, then creates server-side automation nudges surfaced in WorkSpaces and injected into later task requests.
- Autonomous file monitors now respect the same approved OpenClaw filesystem roots as manual file inspection, and URL monitors reuse the existing public-HTTP SSRF guardrails instead of becoming a private-network backdoor.
- Autonomous scheduling can now switch from `nudge` delivery to unattended background model execution. Heartbeats, cron schedules, monitors, and wake events can queue durable Ollama-backed runs that post back into WorkSpaces threads with optional workspace and memory context.
- Unattended execution is intentionally guarded: it is enabled from personal settings, rate-limited per user/hour, recorded in durable run history, and currently limited to local Ollama without interactive tool use.
- Open Claw now has durable session intelligence: each thread stores rolling context summaries, per-session continuation mode/step caps, analytics, branch ancestry, and branch child counts in `ChatSession`.
- Long WorkSpaces threads no longer rely on blind trimming. The backend compresses older turns into a summary while preserving recent raw turns, and the workspace UI surfaces context health plus summary state.
- Users can now branch a WorkSpaces thread from the latest state or any individual message, compare branches side by side, and inspect per-session metrics like tokens, time span, tools used, sources, images, and attachments.
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
- The Open Claw rail now collapses the full agent/task/persona/profile/shell/capability stack behind one `Workspace controls` launcher that opens a modal, so sessions get more vertical room without losing any controls.
- The Open Claw session rail now pages task threads 15 at a time with range labels plus Previous/Next controls instead of trying to show the whole history in one nested scroller.
- Knowledge Base navigation now stays inside Open Claw: opening it from the Open Claw rail swaps only the main panel and preserves the selected task thread.
- Open Claw now shares the same sticky-scroll behavior as chat, so long streams no longer yank the viewport while the user is reading older messages
- Open Claw chat scrolling is now steadier during generation because the sticky-scroll observer is throttled through `requestAnimationFrame`, and the rail now uses one primary scroll container for smoother wheel/trackpad behavior.
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
- **Session recovery + local-model polish** — Raw internal `<openclaw_tool>` bridge messages are now stripped/hidden before session persistence and reload, which prevents malformed tool turns from crashing reopened Open Claw sessions. The local Ollama path also skips redundant compatible-provider verification calls during routine model refresh/switch flows, relying on model discovery plus Ollama health instead.

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
- Images are handled vision-first and passed to Ollama through the native `images` array for vision-capable models, with MIME/name metadata preserved until the server normalizes model-facing bytes
- Uploaded images are now vision-first with OCR as optional supplemental context instead of OCR replacing the image payload
- Open Claw composer now supports per-image attachment modes: `Vision only`, `Vision + OCR`, and `OCR only`
- HEIC/HEIF, TIFF, BMP, AVIF, and related still-image uploads are converted to JPEG before reaching Ollama so local/cloud Ollama models do not reject them as `application/octet-stream`
- Audio/video uploads are now classified by MIME or extension instead of generic binary metadata, while remaining metadata-only until a transcription/frame-extraction pipeline is added
- Unsupported binary/audio/video/archive files can be attached as metadata-only, with a clear model-input status instead of pretending the bytes are text
- Assistant responses render a format-aware response download button plus fenced code block downloads for content that declares `filename="..."`; `base64 filename="..."` blocks download as decoded binary blobs
- Browser-side image previews now prefer blob/object URLs over base64-heavy `data:` URLs where possible, reducing DOM churn for pending uploads, Canvas previews, and inline assistant images

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
- **Legacy chat platform fields** — `UserSettings` still carries chat-platform fields for shared backend compatibility, but the visible normal-chat platform controls are hidden from the primary Open Claw shell
- **Background system prompt support** — `UserSettings.systemPrompt` still exists for backend compatibility, but the old shared System Prompt textbox is now hidden from the primary Settings UI and the stock image-markdown safety rule is injected server-side in the completion pipeline
- **Temperature and Context Window** are normalized through `/api/settings` and applied server-side in `/api/chat`
- **Temperature** slider (0–2) and **Context Window** slider (512–128k)
- **Ollama default toggles:** Generation settings now include `Use Ollama default temperature` and `Use Ollama default context`, which disable the custom sliders for local Ollama and omit `temperature` / `num_ctx` from local requests so the selected model can use its own native defaults.
- **RAG mode:** Semantic (embedding model) vs Keyword/BM25 (no model needed), now wired end-to-end
- **Embedding model selector** with **Test** button (`/api/rag/test-embed`) — deduplicates `:latest` aliases, shows installed/pull-required state, returns embedding dimensions, and now recommends more Ollama embedding models for different speed/quality tradeoffs
- Ollama connection status indicator (live model count) honors configured/typed host
- **Native Ollama lifecycle** for Chat, Open Claw, and embedding requests — the app no longer overrides `keep_alive` or sends background warmup prompts
- **Stop model button** in Open Claw — unloads the selected local model on demand so the next request starts from a fresh load
- **Exclusive Ollama Switching toggle** that persists per user and unloads other running Ollama models before a new local Open Claw request starts
- **Open Claw filesystem permissions** — persisted per user as `openClawFileAccessMode` plus `openClawAllowedPaths`, with read-only host-path approval controlled from Settings
- **Open Claw tool execution stack** — shell execution, filesystem read/write, managed Python/Node code sandboxing, and controlled public-web browser actions are now all wired end-to-end through Open Claw with per-tool approval modes and hidden tool-result continuation
- **Open Claw shell target settings** — `UserSettings` now persists `shellExecutionTarget`, host allowed roots/env vars, host timeout cap, and host output cap. The shell settings API also reports host executor status.
- **Open Claw write/code/browser settings** — persisted per user as `openClawFileWriteMode`, `openClawWritablePaths`, `openClawCodeExecutionMode`, and `openClawBrowserMode`, all configurable from Settings and enforced server-side
- **Managed Open Claw workspace** — Docker now mounts `${OPENCLAW_HOST_WORKSPACE_DIR:-/tmp/peakui-openclaw-workspace}` into the app container at `/mnt/openclaw/workspace`, and the runtime creates a host-style alias so shell/code prompts can reliably use `/tmp/peakui-openclaw-workspace`
- **Shell approval logic refinement** — destructive operations remain blocked, but repo/network/install/service commands such as `git clone`, `curl`, `wget`, `npm install`, and `docker compose up` now require explicit approval instead of being misclassified as inherently dangerous; the runtime image now includes `git`, `curl`, `wget`, `bash`, `tar`, and `unzip`
- Settings propagate immediately to active chat (temperature + context + system prompt injected into every API call)
- **Admin user creation moved into a modal** — the always-visible Create User form is now hidden behind an Add User action in Settings so account management stays compact while preserving the existing admin routes and permission-override controls

## 🔑 Key Files
| File | Purpose |
|---|---|
| `src/app/page.tsx` | Open Claw-first app shell, session management, and surface-aware Knowledge Base/Settings navigation |
| `src/app/components/KnowledgeBase.tsx` | RAG UI — upload, search, health summary, full-document preview, manage docs |
| `src/app/components/SettingsPanel.tsx` | Settings UI |
| `src/app/components/OpenClawWorkspace.tsx` | Primary Open Claw agent workspace surface with top bar, left workspace rail, session UI, task-mode preferences, inline Knowledge Base, and Settings shell views |
| `src/app/components/VirtualizedList.tsx` | Shared client-side windowed list renderer used for large Canvas artifact lists |
| `src/app/components/ObjectUrlImage.tsx` | Shared image preview helper that turns base64 payloads into object URLs for lighter browser rendering |
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
| `src/app/api/ollama/health/route.ts` | Authenticated Ollama runtime health endpoint used by Open Claw for online/degraded/offline state, loaded model visibility, and recovery UX |
| `src/app/api/ollama/stop/route.ts` | Authenticated local-model stop endpoint used by Open Claw when a selected Ollama model needs a clean restart |
| `src/app/api/web/context/route.ts` | Authenticated backend-managed public-web context endpoint used by Open Claw Internet mode |
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
| `src/lib/image-normalization.ts` | Shared still-image conversion helper that tries `sharp` first, then `heif-convert`/ImageMagick fallbacks for Ollama-compatible JPEG output |
| `src/lib/chat-completion.ts` | Shared streaming completion helper |
| `src/lib/chat-platforms.ts` | Shared chat-platform types, Hugging Face base URL normalization, provider-aware model ids, and router detection helpers |
| `src/lib/chat-sessions.ts` | Chat session normalization, creation, and finalization helpers |
| `src/lib/openclaw-agent.ts` | Open Claw task-mode definitions, quick prompts, and workspace-brief builder |
| `src/lib/ollama-health.ts` | Shared client/server type for Ollama health summaries returned by `/api/ollama/health` |
| `src/lib/openclaw-prompt.ts` | Open Claw task/workspace system prompt builder |
| `src/lib/openclaw-workspace.ts` | Managed Open Claw workspace mount/alias helpers shared by shell, filesystem, and code execution |
| `src/lib/file-shared.ts` | Shared upload limits, file kind detection, and extracted-file payload types |
| `src/lib/browser-file-utils.ts` | Browser-side file helpers such as base64→Blob conversion used by image previews/downloads |
| `src/lib/settings.ts` | Shared defaults, settings normalization, Ollama host normalization |
| `src/lib/stream-status.ts` | Shared stream-phase types and user-facing startup/generation status labels for Open Claw and shared completion flows |
| `src/lib/use-sticky-scroll.ts` | Shared sticky-scroll hook used by Open Claw to preserve manual scrollback during streaming |
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
| `src/lib/uwaf-browser.ts` | Unified Web Agent Framework browser engine — dual-mode (direct/stealth) Playwright-based browser with form interaction, research batch crawling, and binary download blocking |
| `src/lib/uwaf-sanitizer.ts` | Three-stage sanitize-first pipeline (HTML pruning → readability filtering → Markdown conversion via Turndown), table extraction, and binary URL blocking |
| `src/lib/uwaf-pool.ts` | Playwright browser pool manager — lazy Chromium init, context reuse with 30-min TTL, stealth profile/fingerprint generation, SOCKS5 proxy routing, WebRTC/DNS/fingerprint regression preflight, and Tor health checks |
| `src/lib/uwaf-fingerprint.ts` | Stealth fingerprint catalog plus `normal`/`high` stealth profile definitions and deterministic per-session fingerprint generation |
| `src/lib/uwaf-search-providers.ts` | Search-provider registry, provider scoring/cooldowns, and curated stealth entry-point metadata |
| `src/app/api/openclaw/uwaf-browser/route.ts` | Main UWAF browser execution route with auth, settings, approval validation |
| `src/app/api/openclaw/uwaf-browser/request/route.ts` | Approval token creation for submit/research_batch actions |
| `src/app/api/openclaw/uwaf-browser/status/route.ts` | Connection status endpoint (Direct IP, Tor reachability, Tor exit info) |
| `src/app/components/UwafNetworkPanel.tsx` | Network Hub Panel — Direct/Stealth mode toggle, IP display, Tor status indicator |
| `src/app/components/UwafBrowserPreview.tsx` | Legacy static browser preview component retained for compatibility; live noVNC browser is the active visual browsing surface |
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
| `UWAF-NETWORK-TODO.md` | Focused improvement backlog for UWAF, Tor/stealth browsing, live-browser transport, and network/browser reliability |
| `docker-compose.yml` | Orchestrates `app` (Next.js) + `db` (Postgres) + `tor-proxy` (Tor SOCKS5) with host networking plus Open Claw host mounts, including the managed writable workspace root mounted at `/mnt/openclaw/workspace`. Tor proxy maps host 9050→container 9150. |
| `Dockerfile` | Multi-stage Node 22 Alpine build, `ENV HOSTNAME 0.0.0.0` for LAN access, plus runtime tooling (`git`, `curl`, `wget`, `bash`, `tar`, `unzip`, `chromium`, `chromium-chromedriver`, `poppler-utils`, `tesseract-ocr`, `imagemagick`, HEIC/TIFF/WebP codecs) and workspace-alias bootstrapping |

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
- **Canvas/rendering next:** Continue the fresh `OPENCLAW-TODO.md` follow-up work: cached parsed assistant content, a real sanitized markdown renderer for Canvas, persisted preview metadata, artifact presentation types/bundles/lineage, richer table/chart rendering, presentation-mode exports, lazy-loaded heavy renderers, content-size thresholds, and render metrics.
- **UWAF/network next:** Use `UWAF-NETWORK-TODO.md` as the focused backlog for stealth/Tor hardening, browser/session recovery, live-browser transport resilience, structured telemetry, and network/browser infra testing.
- **Open Claw permissions next:** If broader host roots than `/home` and `/tmp` are needed for filesystem tools, add more Docker bind mounts first, then allow those paths in Settings. For true host-command access, run the host executor with narrow approved cwd roots and keep `ask-first` enabled until the workflow is proven.
- **Development Plan:** Implement the Development Worker foundation, Docker dashboard, Code Interpreter sandboxes, Docker control actions, and VM orchestration per `docs/development-section-plan.md`
- **Internet mode next:** Consider an optional Phase 2 browser extension/current-tab context flow, but keep the shipped Phase 1 path read-only and citation-first
- **Phase 2:** Docker Orchestration — spawn/manage containers from Open Claw via `dockerode`
- **Open Claw UX next:** Continue tightening Ollama health/status affordances around local model startup, loaded models, and recovery actions
- **Session intelligence next:** Add branch promotion/merge flows, session replay/timeline views, and broader continuation heuristics beyond safe unfinished tool-turn follow-up
- **RAG (v2 complete):** Server-side RAG now fires automatically alongside web search when enabled. Added hybrid search (RRF combining semantic + keyword), per-request topK control with full access mode (-1 = all chunks), and a UI toggle to enable/disable knowledge base per-chat
- **Phase 4:** Code Interpreter and VM orchestration


## 💻 Latest Commit Info
- **Current committed baseline:** `feat: add workspace session intelligence`
- **Previous committed baseline:** `feat: add unattended automation execution`

### Latest Changes (Session Intelligence)
- **Rolling context management:** WorkSpaces now computes rolling `contextSummary` state for long sessions, preserves recent raw turns, emits context-health states, and stores the compressed summary back into `ChatSession`.
- **Per-session continuation policy:** `ChatSession` now stores `autoContinueMode`, `autoContinueMaxSteps`, and `lastAutoContinueAt`, while Settings exposes defaults for new WorkSpaces threads and the workspace controls modal lets users adjust continuation behavior per thread.
- **Branching workflow:** added `POST /api/chats/[id]/branch` plus client-side actions to branch from the latest state or any individual message while preserving tags, folder placement, branch ancestry, and inherited session context.
- **Branch comparison UI:** WorkSpaces now includes a side-by-side branch comparison modal showing summaries, rolling context, continuation mode, child-branch counts, analytics, and latest assistant outcome for two selected branches.
- **Session analytics:** sessions now derive and persist message counts, tool-call counts by type, assistant token totals, average TPS, time span, sources, images, and attachments, and the rail now exposes compact analytics summaries for each thread.

### Latest Changes (Host Filesystem & Executor Access)
- **Filesystem denials are now actionable:** `/api/openclaw/filesystem` returns structured `code`, `actionRequired`, and diagnostics instead of a bare 403 for blocked paths.
- **Filesystem status endpoint:** `GET /api/openclaw/filesystem` reports account permission state, mounted host roots, approved read/write roots, readiness warnings, host shell settings, and host executor reachability.
- **Settings host-access presets:** Settings now provides Safe Workspace, Home Read + Workspace Write, and Mounted Host Audit presets that configure shell/filesystem fields together while keeping host shell and writes in `ask-first`.
- **Model-visible tool failures:** WorkSpaces includes filesystem denial codes and action guidance in the tool result so the agent can explain what setting is missing instead of retrying the same blocked path.
- **Host executor hardening:** the optional host executor now resolves approved roots and requested working directories through real paths before spawning commands, preventing symlinked cwd bypasses of the approved-root boundary.

### Latest Changes (Autonomous Scheduling)
- **Persistent worker foundation:** `src/instrumentation.ts` now starts an Open Claw automation worker that ticks every 30 seconds and processes due heartbeats, cron schedules, and monitors.
- **New automation models/routes:** Prisma now stores heartbeat configs, schedules, monitors, notifications, and event logs; new `GET/POST /api/openclaw/automation` and `POST /api/openclaw/automation/wake-event` routes manage the feature.
- **Heartbeat, cron, monitor, and wake-event delivery modes:** stale-thread check-ins, recurring cron prompts, URL/file monitor triggers, and manual wake events can now either create nudges or queue unattended background model runs.
- **Durable execution runs:** Prisma now stores `AutomationExecutionRun` records with queued/running/succeeded/failed/skipped status, result preview, and error details for unattended executions.
- **WorkSpaces automation controls:** the Workspace controls modal now exposes worker status, heartbeat settings, cron schedules, monitors, wake-event creation, an automation nudge inbox, and recent unattended run history.
- **Prompt-aware follow-up:** unresolved automation nudges are injected into Open Claw requests as background system context so the agent can react to them naturally on the next turn.
- **Security audit fixes:** file monitors now require approved filesystem roots and mounted host paths, while URL monitors reuse `assertPublicHttpUrl()` so automation cannot bypass existing filesystem or SSRF guardrails.
- **Execution guardrails:** unattended runs now have explicit settings for enable/disable, model selection, hourly run budget, workspace-context attachment, and memory-context attachment. Current unattended execution is limited to local Ollama and does not invoke interactive tools in the background.

### Latest Changes (Canvas Revision & Recovery Pass)
- **Durable Canvas revision history:** added `CanvasArtifactRevision` plus revision creation on artifact create, edit, and restore, so the version number now has actual recoverable snapshots behind it.
- **Canvas revision APIs:** added `GET/POST /api/canvas/artifacts/[id]/revisions` for history loading and restoring prior versions while preserving auth/permission checks.
- **Canvas search and pagination:** `/api/canvas/artifacts` now supports query filters, cursor paging, totals, and `nextCursor`, and the WorkSpaces rail uses load-more instead of the old `limit=100` cap.
- **Canvas bundle controls:** grouped bundles can now collapse/expand, export as grouped JSON, or delete all artifacts in the bundle.
- **Canvas lineage and compare UX:** artifact cards expose source/derived artifact links and a history panel with lightweight revision comparison and restore controls.
- **Canvas recovery fixes:** empty-content artifacts can be created/saved, content/history/list failures surface retryable UI states, and downloads/exports fetch full artifact content instead of exporting empty list-row previews.

### Latest Changes (UWAF Fingerprint Hardening & Search Rotation)
- **Stealth fingerprints are now real session profiles:** the old tiny static UA pool was replaced by a broader versioned desktop fingerprint catalog with deterministic per-session selection for locale, timezone, platform, hardware concurrency, device memory, viewport, screen size, and WebGL identity.
- **Two stealth profiles now exist:** `normal` balances compatibility and diversity, while `high` uses a more conservative fingerprint subset and stricter Chromium launch flags for more bot-sensitive `.onion`, hidden-service, or research-batch flows. Normal stealth remains the default for broad dark-web searches, and high profile can also be selected explicitly in unified-browser requests.
- **Browser-surface normalization is stronger:** stealth init scripts now normalize `navigator.userAgentData`, plugin/mime-type exposure, screen/window sizing, WebGL vendor/renderer, media-device behavior, `navigator.connection`, `doNotTrack`, and other automation-adjacent surfaces instead of only hiding webdriver/WebRTC.
- **Fingerprint regression checks added to preflight:** stealth preflight now caches detector-page checks against known fingerprint-test pages alongside Tor reachability, DNS leak verification, WebRTC constructor removal, media-capture denial, and UDP/proxy-bypass lockdown.
- **Stealth search is now onion-search-only by default:** Ahmia is no longer the only stealth search path, but stealth search also no longer falls back to generic clear-web engines. The runtime now rotates across the approved onion-search catalog (Ahmia, OnionWay, OnionLand, TorDex, Excavator, plus optional env-configured engines from that same catalog), retries via on-page forms, cools down degraded engines, and exposes provider-health snapshots through status telemetry.
- **Unified-browser parsing is more tolerant:** legacy `<unified_browser>` blocks and concatenated JSON payloads are now recovered into the first valid browser request instead of dropping the entire tool turn.
- **Curated stealth entry points added:** the provider layer now carries curated stealth entry-point metadata plus optional env-configured entries for operator-specific mirrors or onion-discovery sources.
- **Tor audit fixes completed:** stealth Chromium now disables QUIC and blocks non-proxy host resolution, approval/preflight/execution all use the same resolved stealth profile, `.onion` hostnames validate before navigation, and failed onion opens return precise Tor diagnostics without making successful onion opens do duplicate pre-navigation checks.

### Latest Changes (Media Upload Normalization)
- **HEIC/HEIF upload failure fixed:** Open Claw now preserves converted image payloads from `/api/files/extract` instead of dropping `nativeImageData`, so HEIC uploads no longer fall back to original unsupported bytes.
- **Image metadata survives chat serialization:** chat requests now send image objects with `data`, `mimeType`, and `name` instead of anonymous base64 strings, allowing the backend to normalize unsupported still-image formats before calling Ollama.
- **Server-side still-image conversion added:** `src/lib/image-normalization.ts` converts unsupported still images to JPEG using `sharp` first, then `heif-convert` or ImageMagick fallbacks when codec support is external.
- **Docker media codecs added:** the runtime image now installs ImageMagick HEIC/TIFF/WebP support plus `libheif-tools`, and the exact `IMG_8731.HEIC` sample was verified to convert to JPEG inside the rebuilt container.
- **Media detection broadened:** HEIC/HEIF/TIFF/BMP/AVIF images and common audio/video extensions are classified correctly even when browsers report `application/octet-stream`; audio/video remain metadata-only pending dedicated transcription/frame extraction.

### Latest Changes (Chat Image Rendering Fix)
- **Markdown images now render inline in plain responses:** assistant messages that only contain image markdown no longer bypass the structured renderer, so `![alt](url)` is treated as a real image instead of text.
- **External images have a fallback path:** when a remote image fails to load, the renderer now falls back to a clickable source link rather than showing a broken silent placeholder.
- **Streaming state is less brittle:** failed image loads reset when the image URL changes, which avoids sticky error state during partial-stream updates.

### Latest Changes (Settings UX & UWAF Mode Switching)
- **UWAF mode switching is now runtime-smooth:** the backend no longer blocks explicit `direct` or `stealth` requests just because the saved UWAF mode setting differs, so switching browser modes inside the same Open Claw chat works without the old configuration-mismatch failure.
- **Live browser state now resets on mode flips:** changing between Direct and Stealth closes stale live-browser surfaces, clears stale page labels/takeover state, and remounts the live browser view/modal under a fresh mode-specific key so users do not inherit broken socket/session state.
- **Create User moved behind an Add User modal:** the always-exposed admin user-creation form in Settings is now hidden until requested, while the existing `/api/admin/users` create/update/delete routes and permission override controls continue to work.
- **Shared System Prompt field removed from primary Settings:** the old visible textbox is no longer shown in the Open Claw-first settings flow; the stock image-markdown rule now runs in the background as a server-side instruction instead of pretending to be a user-editable prompt.
- **Context behavior clarified in code/docs:** Open Claw requests still use the active thread only, then add hidden workspace/task/memory/RAG context and trim to the selected context window; the app does not dump all chats into each request.

### Latest Changes (UWAF Network Panel Fix)
- **Build-breaking JSX was corrected:** the incoming UWAF network panel update had a malformed fragment/closing-tag structure that prevented the Next build from completing.
- **Panel behavior preserved:** the rewritten `UwafNetworkPanel` keeps the compact network hub UI, refresh control, mode toggle, status display, and collapse behavior intact while restoring valid JSX.
- **Redeploy verified:** the app rebuild now completes successfully on the updated `UwafNetworkPanel` implementation, so the latest remote commit can be deployed cleanly.

### Latest Changes (Canvas Rendering Pass)
- **Shared assistant parsing is cached:** normalized assistant content, generated files, and inline-image extraction now go through a shared cache instead of being recomputed in every render path.
- **Canvas rendering is AST-based and lazy:** Canvas markdown now uses `react-markdown` with GFM and sanitization, and heavy syntax/markdown renderers are code-split so collapsed cards stay cheap.
- **Artifact metadata is persisted server-side:** Canvas artifacts now store preview kind, summary, dimensions, content hash, presentation type, bundle metadata, export targets, and lineage fields.
- **Large artifact rendering is demand-driven:** collapsed previews stay lightweight, large content requires an explicit full-preview action, and image previews use bounded thumbnail decoding when possible.
- **Presentation/export support expanded:** Canvas artifacts now distinguish reports, code, tables, charts, diagrams, slides, memo/dev-handoff exports, with table/chart rendering for CSV/TSV/JSON artifacts.
- **Message rendering is more isolated:** Open Claw message rows are memoized and the shared assistant renderer uses the cached parsing path to reduce rerenders during streaming.
- **Render telemetry added:** the client now records optional assistant/artifact/image decode timings for dev/admin troubleshooting.
- **Docs updated:** `OPENCLAW-TODO.md` now marks the canvas/rendering/presentation backlog items complete.

### Latest Changes (UWAF Network Hardening Pass)
- **Stealth preflight is now stricter:** stealth browsing now verifies Tor reachability, Tor exit alignment, browser-based DNS leak behavior, and runtime WebRTC/UDP exposure before allowing a session to proceed.
- **Diagnostics are explicit:** UWAF status output now surfaces DNS leak verification, resolver IPs, WebRTC exposure, UDP leak protection, runtime protection verification, and Tor-preflight warnings instead of collapsing everything into a generic reachability check.
- **Structured action telemetry added:** browser actions now log session id, mode, target, timing, semantic result fields, and failure details, and the runtime keeps counters for anti-bot hits, login walls, search failures, proxy failures, and session crashes.
- **Network backlog advanced:** `UWAF-NETWORK-TODO.md` now reflects the completed preflight, leak-check, and telemetry work, leaving the remaining onion/fallback/isolation/failure-injection follow-ups visible for the next pass.

### Latest Changes (UWAF / Network Hardening Backlog)
- **Dedicated UWAF/network TODO added:** introduced `UWAF-NETWORK-TODO.md` to track browser/network infrastructure work separately from the broader Open Claw product backlog.
- **Stealth/Tor hardening priorities clarified:** the new backlog breaks out Tor circuit rotation, leak checks, fingerprint hardening, multi-provider stealth search, and strict fail-closed validation as first-class tasks.
- **Browser/live transport reliability work scoped:** session cleanup, crash recovery, reconnect handling, stale-session detection, control/VNC telemetry, and takeover/resume robustness now have an explicit roadmap.
- **Infra/observability/test follow-ups captured:** the backlog also covers structured browser telemetry, trace bundles, admin diagnostics, chaos testing, and deployment/runtime hardening for the live browser stack.

### Latest Changes (Open Claw Image Handling & Canvas Rendering)
- **Vision-first image attachments:** shared file extraction now keeps uploaded images as native image input by default and exposes OCR text as optional supplemental metadata instead of downgrading the image into extracted text.
- **Per-image attachment modes in Open Claw:** pending image chips now let the user choose `Vision only`, `Vision + OCR`, or `OCR only`, and the composer respects those modes when building prompt context versus sending actual image bytes.
- **Cheaper browser image previews:** pending uploads, inline assistant images, and Canvas image previews now prefer object URLs/blob downloads instead of pushing large `data:` URLs through the DOM.
- **Canvas rendering is lazier:** collapsed markdown/code artifacts render lightweight text previews and only mount full markdown/syntax-highlighting when expanded.
- **Canvas virtualization added:** large artifact lists now use a shared virtualized list helper to reduce mount/render cost in long sessions.
- **Open Claw chat virtualization rolled back:** chat-thread virtualization was removed from the live streaming message list after it caused assistant responses to appear/disappear during streaming. Canvas virtualization remains in place because it is safe there.

### Latest Changes (Open Claw Workspace Rail Polish)
- **Workspace controls moved behind one launcher:** the left rail now opens agent mode, response style, task state, workspace brief, persona, user profile, shell execution, and workspace-capability details inside a modal instead of stacking those cards under the session list.
- **Session list capped to 15 per page:** the rail now pages task threads with range labels and Previous/Next controls so long histories stay manageable without shrinking the visible list area.
- **Scroll behavior cleaned up:** the session list no longer owns a second nested scroll container, the rail uses one main scroll region, and the chat sticky-scroll observer is throttled to reduce jumpiness while streaming.
- **Session reload crash path closed:** malformed raw `<openclaw_tool>` bridge messages are stripped and hidden before persistence/reload so Open Claw session restores no longer render those internal tool turns as normal assistant content.
- **Local-model switching trimmed:** Open Claw skips redundant compatible-provider verification calls when the active provider is local Ollama, using model discovery plus Ollama health for a lighter refresh path.

### Latest Changes (Open Claw RAG Streaming Stability)
- **Fixed the RAG source-chip crash path:** Open Claw now snapshots queued streamed source updates before React state callbacks run, preventing the `Cannot read properties of null (reading 'id')` crash that appeared when `knowledge_sources` arrived during streaming.
- **Hardened Open Claw message/session state:** loaded sessions, streamed messages, source metadata, task checklist items, canvas artifacts, and session lists now normalize or drop malformed/null entries before render/update paths touch `.id`.
- **Added client-side error reporting:** a new `/api/client-errors` endpoint records browser-side crashes in Docker logs as `[client-error]`, with rate limiting, secret redaction, URL/user-agent context, global `window.error` / `unhandledrejection` capture, and React render-boundary reporting.
- **Added local assistant render fallback:** assistant message rendering is wrapped in a `MessageRenderBoundary` so a bad markdown/source payload degrades to a plain-text fallback instead of taking down the whole Open Claw page.
- **Hardened legacy chat streaming too:** the old chat streamer now snapshots queued content/thinking/source updates and filters malformed sessions in shared state paths so the same null-closure pattern cannot recur there.

### Latest Changes (Open Claw RAG Audit)
- **Open Claw now uses the shared backend RAG pipeline again:** the stale client-side `/api/rag/search` prefetch and manual system-message injection were removed from the active Open Claw send loop, so Open Claw and the shared completion backend now use the same retrieval contract.
- **Server-streamed knowledge base sources now reach Open Claw correctly:** the Open Claw stream parser now consumes `knowledge_sources` frames, merges them into the visible source chips, and keeps tool/web sources additive instead of replacing KB evidence.
- **Saved RAG settings now apply to the Open Claw-first shell:** Open Claw settings loading now reads `ragEnabled` and `ragTopK`, seeds the workspace toggle from saved settings when there is no session override, and sends the configured topK through the shared completion request.
- **Explicit RAG-off requests now stay off:** the shared chat completion backend no longer re-enables RAG from saved settings when a request sends `rag_enabled: false`, which fixes Open Claw tool rounds and any other callers that intentionally disable retrieval for follow-up turns.

### Latest Changes (Live Browser Settings Fix)
- **Live Browser toggle now applies immediately after Settings save:** Settings changes bump an Open Claw settings revision, and the workspace reloads its internal settings without requiring a page refresh.
- **Disabling Live Browser closes visual browser surfaces:** the embedded live browser and modal close when `openClawUwafLiveBrowser` is false, and `wait_for_user` returns a clear unavailable-tool result instead of opening takeover mode.
- **Static UWAF page screenshots removed:** the Settings screenshot toggle was removed, screenshot capture is forced off in settings normalization/API/runtime, and the prompt no longer tells the model to expect browser screenshots.
- **Settings route cleanup:** hidden legacy chat-model discovery is no longer called from the Open Claw Settings flow.

### Latest Changes (Open Claw-Only Shell)
- **Open Claw is now the default and only primary UI shell:** page load, stored tab normalization, new-thread actions, and settings navigation all route to Open Claw instead of the old normal chat surface.
- **Normal chat sidebar removed from the reachable app flow:** Open Claw's rail is the single left navigation surface for Workspace, Knowledge Base, Settings, task threads, folders, tags, and search.
- **Settings moved into Open Claw:** Settings now render as an Open Claw panel, and Logout lives in the Settings header.
- **Generation settings cleaned up:** legacy main-chat platform controls are hidden, while shared system prompt, temperature, context window, Ollama host, exclusive switching, RAG, theme, user management, and Open Claw tool/provider settings remain.
- **Docs updated:** README, features docs, settings/RAG docs, and project memory now describe Open Claw as the primary shell while noting that legacy chat APIs remain as shared backend infrastructure.

### Latest Hotfixes (post v0.10.0)
- **Live browser AI routing fix:** `unified_browser` now supports visible `search`; Open Claw prefers UWAF for visible browsing when available; active page tracking keeps the visible noVNC browser aligned with AI actions; `wait_for_user` lets the model pause for human CAPTCHA/login/MFA help and resume with a fresh page observation
- **Uncensored/unrestricted tool access fix:** `openClawPrompt` and `chatInternetPrompt` now included in all mode branches; anti-tool language removed from `UNCENSORED_BASE_INSTRUCTIONS`; dynamic tool-aware clause added; `UNCENSORED_REINFORCEMENT` updated to encourage tool use
- **RAG full access fix:** `normalizeTopK()` maps -1 to 10000; semantic threshold lowered to 0 for full access; context limit raised from 10K to 100K; client-side context injection removed; KB system message positioned after main prompt; KB instruction strengthened
- **RAG indexing fixes:** Stale timeout increased to 10 min; stale detection moved from GET to POST/health; embedding retry with backoff; error document re-upload recovery; extraction cap at 2M chars
- **Date/time injection:** Current date+time+timezone injected in all system prompts and OpenClaw prompt
- **UWAF browser fix:** Removed `--single-process`/`--no-zygote` Chromium flags; added `newPage()` retry logic

### Latest Changes (v0.10.0) 🕸️
- **UWAF (Unified Web Agent Framework):** Dual-mode browser engine supporting Direct (Clear Web) and Stealth (Tor-routed) research modes, fully integrated into Open Claw as the `unified_browser` tool
- **Playwright browser engine:** `uwaf-browser.ts` uses Playwright-core with system Chromium for full page rendering, JavaScript execution, and form interaction — runs headless inside the Docker container with `--no-sandbox --disable-setuid-sandbox` flags
- **Tor proxy sidecar:** `peterdavehello/tor-socks-proxy` Docker service providing SOCKS5 on host port 9050 (container port 9150). App connects via `TOR_PROXY_URL=socks5://localhost:9050`. Tor reachability is checked before every stealth request, and stealth mode fails closed (no fallback to direct).
- **Sanitize-first pipeline:** `uwaf-sanitizer.ts` implements three stages: (1) HTML pruning strips script/style/iframe/nav/footer/aside/ad elements and tracking pixels; (2) readability filter scores paragraphs by word count, comma count, and link density using sliding-window best-block detection; (3) Markdown conversion via Turndown with GFM table support. Stealth mode applies stricter stripping of inline styles, data attributes, and tracking URL parameters.
- **Browser pool:** `uwaf-pool.ts` manages Playwright browser instances with lazy initialization, context reuse (30-minute TTL with auto-cleanup), and stealth configuration (randomized User-Agent from a pool of 5 realistic UAs, SOCKS5 proxy via Tor, WebRTC disabled, webdriver hidden). Direct mode uses standard Chromium with no proxy.
- **Tool actions:** `unified_browser` supports open, click, extract, extract_table, research_batch, fill, and submit. `research_batch` crawls a starting URL and follows links up to depth 3 (max 10 pages), returning aggregated Markdown content. `extract_table` pulls all `<table>` elements as structured Markdown or CSV. `fill` and `submit` allow form interaction with approval-gated submission.
- **Live visual browsing:** Static screenshot capture is disabled; the live noVNC browser is the visual page surface for watching and taking over UWAF sessions
- **Network Hub Panel:** `UwafNetworkPanel.tsx` shows the current Direct IP, Tor connection status (online/offline), Tor exit node country, and a mode selector to switch between Direct and Stealth modes
- **Source chips:** Clear Web sources render as blue chips with `[Source: Clear Web]`, Dark Web sources as purple chips with `[Source: Dark Web]`. `.onion` URLs are automatically labeled as Dark Web.
- **Approval flow:** `submit` and `research_batch` actions always require approval tokens (not mode-dependent). The approval request endpoint at `/api/openclaw/uwaf-browser/request` creates signed tokens that are validated by `/api/openclaw/uwaf-browser` before executing.
- **Session management:** In-memory browser sessions (Map-based, 60-minute TTL) track current page state (URL, title, links, forms), filled form values, and screenshot history. Context reuse means the same Playwright BrowserContext is shared across actions within a session.
- **New settings:** `openClawUwafBrowserMode` (deny/direct/stealth), `openClawUwafDefaultMode` (direct/stealth), and `openClawUwafLiveBrowser` — all stored in `UserSettings` and configurable from the Settings panel. The legacy `openClawUwafScreenshots` field remains in the schema but is forced off.
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
  - `src/lib/uwaf-telemetry.ts` — Structured UWAF action/session telemetry helpers and in-memory metrics counters
  - `src/app/api/settings/route.ts` — Added UWAF settings fields to body whitelist and save logic
  - `src/app/components/OpenClawWorkspace.tsx` — Added UWAF mode toggle (Shield icon), unified_browser tool dispatch, Network Panel, Browser Preview, UwafBrowserToolResultEntry, describeUwafBrowserRequest, approval/reject handling for unified_browser kind, and OpenClawSettings UWAF fields
  - `src/app/components/SourceChips.tsx` — Added isOnionUrl(), getNetworkModeLabel(), getNetworkModeStyle() for Clear Web/Dark Web chip rendering
  - `src/app/components/SettingsPanel.tsx` — Added UWAF Browser settings section (mode radio cards, default mode selector, live-browser toggle, Tor proxy info)
  - `src/app/components/ShellCommandModal.tsx` — Added 'unified_browser' toolKind with Shield icon
  - New: `src/lib/uwaf-browser.ts` — Unified browser engine with Playwright, dual-mode browsing, session management, binary blocking, .onion validation
  - New: `src/lib/uwaf-sanitizer.ts` — Three-stage sanitize pipeline (prune → readability → Markdown), table extraction, metadata extraction, binary URL blocking
  - New: `src/lib/uwaf-pool.ts` — Playwright browser pool manager with lazy init, context reuse, stealth configuration, Tor health checks, IP detection
  - New: `src/app/api/openclaw/uwaf-browser/route.ts` — Main UWAF browser execution route with auth, settings, approval validation
  - New: `src/app/api/openclaw/uwaf-browser/request/route.ts` — Approval token creation for submit/research_batch
  - New: `src/app/api/openclaw/uwaf-browser/status/route.ts` — Connection status (Direct IP, Tor reachability, Tor exit info)
  - New: `src/app/components/UwafNetworkPanel.tsx` — Network Hub Panel with mode toggle, IP display, Tor status
  - New: `src/app/components/UwafBrowserPreview.tsx` — Legacy browser preview component; live browser is now the visual surface

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
