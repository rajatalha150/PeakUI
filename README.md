# PeakUI

A premium AI Studio command center with WorkSpaces as the local-first agent shell. Run models on your own hardware with Ollama, connect OpenAI-compatible providers when needed, and keep Knowledge Base, settings, sessions, tools, and logout inside the WorkSpaces workspace rail.
> **Note:** The workspace previously labeled "Open Claw" is now displayed as **WorkSpaces** in the UI. This is a cosmetic, UI-only change. All internal code, API routes (/api/openclaw/*), database fields (openClaw* columns), CSS classes (.openclaw-*), and system prompts remain unchanged.

## 🚀 Features

- **WorkSpaces-First Shell:** The app now opens directly into WorkSpaces. The old normal-chat surface and its separate sidebar are no longer part of the primary UI; Workspace, Knowledge Base, Settings, and task sessions all live in the WorkSpaces rail.
- **Local-First With Optional OpenAI-Compatible Routing:** Keep WorkSpaces fully local with Ollama, or connect compatible remote providers such as Hugging Face router, TGI, vLLM, or SGLang-style endpoints through WorkSpaces provider settings.
- **Dynamic Model Selection:** WorkSpaces discovers installed Ollama models and configured OpenAI-compatible models, then presents them in a provider-aware glass dropdown with active-model highlighting.
- **Professional Themes:** Choose Aurora, Graphite, Midnight, Canvas, or Ledger from Settings → Appearance. Themes preview immediately and persist per user.
- **Deep Thinking Parser:** Natively supports reasoning models (DeepSeek-R1, Gemma-4). `<think>` tags are extracted and beautifully styled.
- **Abortable Streams:** Instantly halt AI generation via the Stop button.
- **Session-First Generation Flow:** Sessions are created before generation, streamed through the shared completion backend, and finalized after completion so WorkSpaces task history survives stream interruption.
- **Native Ollama Lifecycle + Model Stop Control:** WorkSpaces leaves model loading/unloading timing to Ollama by default and exposes a `Stop model` action so a wedged local runner can be unloaded and restarted cleanly.
- **Format-Aware Document Output:** Common document requests like resumes, cover letters, emails, memos, reports, summaries, proposals, outlines, and lists are steered toward presentation-ready plain text instead of raw markdown wrappers.
- **Presentation-Aware Rendering:** Assistant replies now render headings, lists, tables, quotes, and code blocks cleanly in chat, and the app normalizes wrapper fences, loose list markers, document headings, and simple tables before render.
- **WorkSpaces Workspace:** The primary app shell for local-first agent work. Provider/model/base URL preferences persist per user, Ollama is supported first, OpenAI-compatible providers can be connected with a stored API key, and the workspace can verify provider connectivity before you launch a task.
- **Agentic WorkSpaces Workspace Controls:** WorkSpaces now includes persistent task modes (`Plan`, `Research`, `Execute`, `Review`), response-style controls, workspace notes, success criteria, and quick-start prompts that are injected into every WorkSpaces request as a task brief.
- **Workspace Controls Modal:** The rail now keeps those agent/task/persona/profile/shell/capability controls behind one `Workspace controls` launcher so the task-thread list gets more vertical space without removing any controls.
- **WorkSpaces Session Management Parity:** WorkSpaces task threads now support folder assignment, reusable tags, pin/unpin, rename, copy-to-clipboard, single delete, bulk select/delete, and clear-all actions directly from the workspace rail.
- **Paged Session Rail:** The WorkSpaces rail now shows up to 15 task threads per page with range labels and Previous/Next paging so large histories stay manageable without a cramped nested scroller.
- **Recoverable Canvas Artifacts:** Canvas now stores durable revision snapshots, supports restore/compare history, searchable cursor paging, collapsible bundles with bundle export/delete, and source/derived lineage navigation.
- **WorkSpaces Tool Execution Stack:** WorkSpaces now ships approval-aware shell execution, approved filesystem read/write tools, a managed Python/Node code sandbox, and a unified live browser with Direct and Stealth modes.
- **Hardened Stealth Browser Stack:** UWAF stealth sessions now use broader desktop fingerprint pools, session-randomized locale/timezone/hardware/viewport traits, stricter browser-surface normalization, cached bot-fingerprint regression checks, DNS/proxy-bypass guardrails, `normal` vs `high` stealth profiles, and rotating stealth-safe search providers with provider health scoring.
- **Evidence-Driven Unified Browser:** The visible browser now validates searches and interactions instead of treating every page load as success. Browser results include redirect state, detected result counts, query-match checks, tab state, anti-bot/login detection, and recent JS/network failures so the model can distinguish evidence from failure.
- **Persistent AI Observer:** WorkSpaces stays active during long-running tasks — shell commands, code execution, web research, and browser actions all show live phase labels (`Running command...`, `Running code...`, `Searching web...`, etc.). Every tool execution is wrapped in error recovery so failures become model-visible messages instead of session crashes. Shell defaults to auto-approve for safe commands, and tool approvals auto-approve after a 4-second countdown when Auto-continue is enabled.
- **Auto-Continue Mode:** When Auto-continue is ON and a task objective is set, WorkSpaces automatically sends "continue" after each response so the agent keeps working without manual clicks — like running Claude Code hands-free.
- **Optional Host Shell Executor:** WorkSpaces can now keep its default in-container shell or switch to an optional host-side executor so shell commands use the host machine's own CLI environment, with per-user approvals, cwd-root restrictions, env allowlists, timeout/output caps, DB audit records, and automatic fallback to the container shell when Host is selected but unavailable.
- **Managed WorkSpaces Workspace:** Tool-capable WorkSpaces flows share a writable workspace mounted at `/mnt/openclaw/workspace` in the container and exposed through the host-style alias `/tmp/peakui-openclaw-workspace`.
- **Model-Driven Internet Research:** The Internet toggle now lets the AI model decide when and what to search, rather than running a keyword-based pre-search. When the model needs current information, it emits a web-research tool call, the backend executes the search, and the model continues with cited sources. No more unnecessary searches for simple questions — the model searches only when it actually needs to.
- **Multi-Provider Web Search:** Internet research supports five search backends with automatic fallback: Google Programmable Search Engine (requires `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_CX`), Brave Search API (`BRAVE_API_KEY`), self-hosted SearXNG (`SEARXNG_URL`), DuckDuckGo, and Bing. Configure one or more via environment variables and the system tries each in order.
- **Smooth Streaming UX:** Chat streaming now uses a character-drip approach that releases 3 characters per animation frame for a smooth ChatGPT-like typing feel. A blinking cursor appears during generation, and auto-scroll properly pins to bottom on Enter.
- **Scroll Stability Pass:** The chat viewport now throttles its sticky-scroll observer, keeps jump-to-latest behavior predictable during streaming, and the rail now uses one primary scroll container instead of a nested session-list scroller.
- **WorkSpaces Session Recovery Hardening:** Raw internal `<openclaw_tool>` bridge messages are now stripped and hidden before persistence/reload, which prevents malformed tool turns from crashing the WorkSpaces page on session reopen.
- **Exclusive Ollama Switching:** On smaller GPUs, Settings → Generation can unload other running Ollama models before starting the selected local WorkSpaces model so the active model gets the machine to itself.
- **Lean Local-Ollama Switching:** When WorkSpaces is on the local Ollama provider, the workspace now skips redundant remote-style verification round trips and relies on model discovery plus Ollama health checks for a lighter switch path.
- **Transparent Startup Phases:** WorkSpaces shows whether a request is `Searching knowledge base...`, `Searching web...`, `Running command...`, `Running code...`, `Reading filesystem...`, `Browsing page...`, `Unloading other models...`, `Starting model...`, `Connecting to model...`, or `Generating...` so startup delays and tool execution are easier to track.
- **WorkSpaces Rail + Shared Top Bar Chrome:** The WorkSpaces workspace rail is the single left-side navigation surface. It can collapse on desktop, opens as a drawer on mobile, and keeps the model picker plus Workspace modes menu in the top bar.
- **Ollama Health + Recovery UX:** WorkSpaces surfaces live Ollama runtime state, loaded-model visibility, offline/degraded detection, and one-click `Retry`, `Retry without web`, and `Stop + retry` recovery actions.
- **Task Organization Rail:** WorkSpaces task threads include folder grouping, session tags, built-in search, per-thread organization controls directly from the rail menu, and 15-session paging in the rail for longer histories.
- **Pinned WorkSpaces Task State:** WorkSpaces now keeps `Objective`, `Current status`, `Next step`, `Done criteria`, and an editable pinned checklist separate from the conversation transcript, with assistant checklists importable into that workspace panel.
- **PostgreSQL Castle Memory System:** Auto-saves your chat histories and accounts into a robust PostgreSQL database.
- **Zero-Config Auth Layer:** Ensures only authenticated users can access the studio. On a fresh deployment, the system prompts the first visitor to configure the primary Admin account.
- **RAG Knowledge Base:** Upload documents → auto-chunk with safe full-document mode for small files → index locally with Semantic embeddings or Keyword/BM25 → parse PDFs page-by-page with text-layer extraction plus OCR fallback for scanned or mixed documents using `poppler-utils` + `tesseract` in the runtime image → search retrieved excerpts with chunk/file metadata, filters, health summaries, and full-document drill-down → browse the indexed corpus with paginated lists, page-size controls, multi-select, and bulk delete → inject cited sources into WorkSpaces.
- **Vision-First Media Uploads:** WorkSpaces keeps uploaded images as native vision inputs by default, adds OCR only as supplemental context, and normalizes HEIC/HEIF, TIFF, BMP, AVIF, and other still-image formats to JPEG before sending them to Ollama models that reject unsupported image MIME types.
- **Folder Tree Uploads:** The Knowledge Base upload area can accept individual files or whole folders. Folder uploads preserve relative paths, keep the folder tree intact in the index, and queue the uploaded tree in batches so large project drops stay responsive.
- **Production-Ready Settings:** WorkSpaces provider selection, system prompt, temperature, context window, Ollama host, compatible-provider base URL, exclusive switching, RAG mode, tool permissions, and embedding model settings are saved per user, normalized server-side, and documented in [Settings and RAG Behavior](docs/settings-and-rag.md). Logout now lives in Settings.
- **RAG Model Recommendations:** Settings → RAG now surfaces a larger embedding-model shortlist that covers tiny/fast, balanced, multilingual, and higher-recall options instead of only the original three defaults.
- **Native-First Context Startup:** When the local context setting is still at the default, the first Ollama chat attempt now omits `num_ctx` and lets Ollama choose its own working default. If the request needs an explicit context, the backend caps it to the deployment limit and backs off further on memory pressure.
- **Performance Metrics:** Reports Tokens, Tokens/Sec, and Duration after every response.
- **Live TPS Estimator:** A hyper-efficient background polling loop tracks generation speed dynamically.
- **Graceful Error Handling:** Catches and translates Out-Of-Memory (500) errors directly into the chat UI.

## 💻 Tech Stack

- **Framework:** Next.js (App Router), React
- **Database ORM:** Prisma + PostgreSQL
- **Authentication:** `jose` Edge-compatible JWTs
- **RAG:** Ollama embeddings for Semantic mode, built-in BM25 for Keyword mode
- **Styling:** Vanilla CSS (`globals.css`), Glassmorphism UI, CSS-variable theme system
- **Deployment:** Docker & Docker Compose. The runtime image includes Chromium/noVNC tooling plus media helpers such as `poppler-utils`, `tesseract-ocr`, `imagemagick`, `imagemagick-heic`, `imagemagick-tiff`, `imagemagick-webp`, and `libheif-tools`.

## 🏃 Getting Started (Dockerized)

PeakUI is fully containerized for seamless deployment.

1. Ensure [Ollama](https://ollama.com/) is installed and running on your host machine (`ollama serve`) if you want local WorkSpaces models or Semantic RAG embeddings.
2. Pull required Ollama models:
   ```bash
   ollama pull phi3:mini          # WorkSpaces model (or any you prefer)
   ollama pull nomic-embed-text   # Required for Semantic RAG only; more recommended models are listed in Settings → RAG
   ```
3. If you want to use a remote OpenAI-compatible provider such as the Hugging Face router, create the provider token and enter it in Settings. Browser-only tokens are not persisted in `UserSettings`.
4. Spin up the Database and the Application:
   ```bash
   docker compose up -d --build
   ```
   This rebuilds the app container with the current source and restarts the stack.
5. Open [http://localhost:3000](http://localhost:3000)
6. On your first visit, you will be prompted to create the **Admin Account**.
7. After login, the app opens directly into WorkSpaces. Use the WorkSpaces rail or mobile drawer to switch task threads, open Knowledge Base, open Settings, choose `Plan`, `Research`, `Execute`, or `Review`, store workspace notes, and define success criteria that persist in the browser and stay attached to future WorkSpaces requests.
8. Configure WorkSpaces's provider/model/base URL from Settings. The first-time model selection is remembered per user, Ollama is the default local path, and compatible remote providers can be verified before starting a task.
9. On desktop, Internet, UWAF Direct/Stealth, RAG, Unrestricted, and Uncensored controls live inside the **Workspace modes** dropdown in the top bar; on mobile, those controls remain in the overflow menu.
10. If a local model gets wedged after a failed load or stalled run, use the **Stop model** button next to the shared model selector in the top bar so the next request starts from a clean reload.
11. WorkSpaces now includes a **Verify** button for provider connections so you can confirm the configured Ollama/OpenAI-compatible endpoint is reachable before starting a task.
12. If your GPU is tight on memory, enable **Exclusive Ollama Switching** in Settings → Generation so local-provider WorkSpaces unloads other running Ollama models before starting the selected one.
13. WorkSpaces includes an **Ollama health** strip that shows whether the service is online, degraded, or offline, how many models are installed/loaded, and which models are currently resident.
14. If a request fails, use `Retry`, `Retry without web`, or `Stop + retry` from the health strip instead of rebuilding the prompt manually.
15. Use the WorkSpaces rail to search prior task threads, group sessions into folders, and assign reusable color tags from each session's menu.
16. Turn on **Internet** from WorkSpaces's **Workspace modes** dropdown when you want cited public web context. The backend handles search and page fetching directly before the model starts, and the model can also call web tools mid-task when needed. The backend research phase is read-only: it does not control your browser, and it blocks localhost, private-network targets, credentialed URLs, and non-standard ports.
17. WorkSpaces shell, filesystem, code, and browser tools are configured from Settings. Use `ask-first` when you want approval before writes, code execution, public-web form submits, or network-capable shell commands like `git clone`, `curl`, `wget`, `npm install`, or `docker compose up`.
18. If you want WorkSpaces shell commands to run on the host instead of inside the container, start the optional host executor described in [WorkSpaces Host Executor](docs/openclaw-host-executor.md), set `OPENCLAW_HOST_EXECUTOR_TOKEN`, restart the app container, and switch `Shell Target` to `Host` in Settings.
19. If an WorkSpaces task needs a shared working directory, use `/tmp/peakui-openclaw-workspace` in host-style paths or `/mnt/openclaw/workspace` inside the container context.
20. If a request stalls before generation, the phase label now tells you whether the delay is Knowledge Base lookup, web research, exclusive model unload, or actual Ollama startup. If it stays on `Starting model...` or `Connecting to model...`, try **Stop model** or `ollama stop <model>`, restart Ollama, or free up GPU memory first.
21. If the app reports a model-memory error while the same model works in terminal, lower the context window in Settings. The default local path now lets Ollama choose its own context first, but explicit higher context requests are still capped to `4096` tokens by default and backed off further on memory pressure. Raise `PEAKUI_OLLAMA_CONTEXT_CAP` only on hardware that can actually carry larger KV caches.
22. If the browser reports a generation connection failure, the streamed error should now include the provider URL and socket cause. Test the same model locally with `ollama run <model> "hello"` when using Ollama, or confirm the remote compatible base URL and token when using a remote provider.

## 🗺️ Roadmap
- **Phase 2 (Pending):** Docker container orchestration directly from WorkSpaces.
- **RAG Next:** See [RAG-TODO.md](RAG-TODO.md) for the remaining backlog, which now focuses on larger-library indexing and scale polish after the retrieval, filtering, drill-down, OCR, archive, incremental reindexing, health UI, and regression test pass.
- **Phase 4:** Code Interpreter and VM orchestration. See the [Development Section Implementation Plan](docs/development-section-plan.md) for the Code Interpreter, Virtual Machines, Docker Containers, and the alternative gateway plan.
