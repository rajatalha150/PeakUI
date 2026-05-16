# PeakUI

A premium AI Studio command center with a local-first shell. Run models on your own hardware with Ollama, connect main chat to Hugging Face, or merge both catalogs in one hybrid picker.

## 🚀 Features

- **Local-First With Optional Hugging Face Routing:** Keep chat fully local with Ollama, switch to Hugging Face's hosted inference router, or merge both model sources in a single hybrid picker.
- **Dynamic Multi-Platform Model Selection:** Main chat discovers installed Ollama models and, when configured, Hugging Face router or HF-compatible endpoint models, then presents them in a provider-aware glass dropdown with active-model highlighting.
- **Hugging Face Router Compatibility:** The default HF path uses `https://router.huggingface.co/v1` for OpenAI-compatible chat completions and its `/v1/models` listing endpoint. Custom HF-compatible bases such as TGI, vLLM, or SGLang can also be used when they expose compatible chat/model routes.
- **Professional Themes:** Choose Aurora, Graphite, Midnight, Evergreen, or Burgundy from Settings → Appearance. Themes preview immediately and persist per user.
- **Deep Thinking Parser:** Natively supports reasoning models (DeepSeek-R1, Gemma-4). `<think>` tags are extracted and beautifully styled.
- **Abortable Streams:** Instantly halt AI generation via the Stop button.
- **Session-First Chat Flow:** Sessions are created before generation, streamed through `/api/chat/completions`, and finalized through `/api/chat/completed` so chat history survives stream interruption.
- **Native Ollama Lifecycle + Model Stop Control:** Chat and Open Claw now leave model loading/unloading timing to Ollama by default and expose a `Stop model` action so a wedged local runner can be unloaded and restarted cleanly.
- **Format-Aware Document Output:** Common document requests like resumes, cover letters, emails, memos, reports, summaries, proposals, outlines, and lists are steered toward presentation-ready plain text instead of raw markdown wrappers.
- **Presentation-Aware Rendering:** Assistant replies now render headings, lists, tables, quotes, and code blocks cleanly in chat, and the app normalizes wrapper fences, loose list markers, document headings, and simple tables before render.
- **Open Claw Workspace:** A separate Core AI section for local-first agent work. Provider/model/base URL preferences persist per user, Ollama is supported first, OpenAI-compatible providers can be connected with a stored API key, and the workspace can verify provider connectivity before you launch a task.
- **Agentic Open Claw Workspace Controls:** Open Claw now includes persistent task modes (`Plan`, `Research`, `Execute`, `Review`), response-style controls, workspace notes, success criteria, and quick-start prompts that are injected into every Open Claw request as a task brief.
- **Open Claw Session Management Parity:** Open Claw task threads now support folder assignment, reusable tags, pin/unpin, rename, copy-to-clipboard, single delete, bulk select/delete, and clear-all actions directly from the workspace rail.
- **Open Claw Tool Execution Stack:** Open Claw now ships approval-aware shell execution, approved filesystem read/write tools, a managed Python/Node code sandbox, and a unified live browser with Direct and Stealth modes.
- **Evidence-Driven Unified Browser:** The visible browser now validates searches and interactions instead of treating every page load as success. Browser results include redirect state, detected result counts, query-match checks, tab state, anti-bot/login detection, and recent JS/network failures so the model can distinguish evidence from failure.
- **Persistent AI Observer:** Open Claw stays active during long-running tasks — shell commands, code execution, web research, and browser actions all show live phase labels (`Running command...`, `Running code...`, `Searching web...`, etc.). Every tool execution is wrapped in error recovery so failures become model-visible messages instead of session crashes. Shell defaults to auto-approve for safe commands, and tool approvals auto-approve after a 4-second countdown when Auto-continue is enabled.
- **Auto-Continue Mode:** When Auto-continue is ON and a task objective is set, Open Claw automatically sends "continue" after each response so the agent keeps working without manual clicks — like running Claude Code hands-free.
- **Optional Host Shell Executor:** Open Claw can now keep its default in-container shell or switch to an optional host-side executor so shell commands use the host machine's own CLI environment, with per-user approvals, cwd-root restrictions, env allowlists, timeout/output caps, DB audit records, and automatic fallback to the container shell when Host is selected but unavailable.
- **Managed Open Claw Workspace:** Tool-capable Open Claw flows share a writable workspace mounted at `/mnt/openclaw/workspace` in the container and exposed through the host-style alias `/tmp/peakui-openclaw-workspace`.
- **Model-Driven Internet Research:** The Internet toggle now lets the AI model decide when and what to search, rather than running a keyword-based pre-search. When the model needs current information, it emits a web-research tool call, the backend executes the search, and the model continues with cited sources. No more unnecessary searches for simple questions — the model searches only when it actually needs to.
- **Multi-Provider Web Search:** Internet research supports five search backends with automatic fallback: Google Programmable Search Engine (requires `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_CX`), Brave Search API (`BRAVE_API_KEY`), self-hosted SearXNG (`SEARXNG_URL`), DuckDuckGo, and Bing. Configure one or more via environment variables and the system tries each in order.
- **Smooth Streaming UX:** Chat streaming now uses a character-drip approach that releases 3 characters per animation frame for a smooth ChatGPT-like typing feel. A blinking cursor appears during generation, and auto-scroll properly pins to bottom on Enter.
- **Exclusive Ollama Switching:** On smaller GPUs, Settings → Chat can unload other running Ollama models before starting the selected Chat/Open Claw model so the active model gets the machine to itself.
- **Transparent Startup Phases:** Chat and Open Claw now show whether a request is `Searching knowledge base...`, `Searching web...`, `Running command...`, `Running code...`, `Reading filesystem...`, `Browsing page...`, `Unloading other models...`, `Starting model...`, `Connecting to model...`, or `Generating...` so startup delays and tool execution are easier to track.
- **Collapsible Sidebars + Shared Top Bar Chrome:** The main app sidebar and Open Claw workspace rail can now be collapsed independently on desktop, while both surfaces share the same chat-style top bar with the model picker and overflow menu. Mobile still uses a slide-out navigation drawer, and Chat/Open Claw only auto-scroll while you stay near the latest message.
- **Ollama Health + Recovery UX:** Chat and Open Claw now surface live Ollama runtime state, loaded-model visibility, offline/degraded detection, and one-click `Retry`, `Retry without web`, and `Stop + retry` recovery actions.
- **Chat Organization Sidebar:** Main chat now includes folder grouping, session tags, built-in chat search, and per-chat organization controls directly from the sidebar menu.
- **Pinned Open Claw Task State:** Open Claw now keeps `Objective`, `Current status`, `Next step`, `Done criteria`, and an editable pinned checklist separate from the conversation transcript, with assistant checklists importable into that workspace panel.
- **PostgreSQL Castle Memory System:** Auto-saves your chat histories and accounts into a robust PostgreSQL database.
- **Zero-Config Auth Layer:** Ensures only authenticated users can access the studio. On a fresh deployment, the system prompts the first visitor to configure the primary Admin account.
- **RAG Knowledge Base:** Upload documents → auto-chunk with safe full-document mode for small files → index locally with Semantic embeddings or Keyword/BM25 → parse PDFs page-by-page with text-layer extraction plus OCR fallback for scanned or mixed documents using `poppler-utils` + `tesseract` in the runtime image → search retrieved excerpts with chunk/file metadata, filters, health summaries, and full-document drill-down → browse the indexed corpus with paginated lists, page-size controls, multi-select, and bulk delete → inject cited sources into chat.
- **Folder Tree Uploads:** The Knowledge Base upload area can accept individual files or whole folders. Folder uploads preserve relative paths, keep the folder tree intact in the index, and queue the uploaded tree in batches so large project drops stay responsive.
- **Production-Ready Settings:** Platform selection, system prompt, temperature, context window, Ollama host, Hugging Face base URL, exclusive switching, RAG mode, and embedding model settings are saved per user, normalized server-side, and documented in [Settings and RAG Behavior](docs/settings-and-rag.md).
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
- **Deployment:** Docker & Docker Compose

## 🏃 Getting Started (Dockerized)

PeakUI is fully containerized for seamless deployment.

1. Ensure [Ollama](https://ollama.com/) is installed and running on your host machine (`ollama serve`) if you want local chat, hybrid chat, RAG embeddings, or local Open Claw.
2. Pull required Ollama models:
   ```bash
   ollama pull phi3:mini          # Chat model (or any you prefer)
   ollama pull nomic-embed-text   # Required for Semantic RAG only; more recommended models are listed in Settings → RAG
   ```
3. If you want Hugging Face chat, create a Hugging Face token with Inference Providers access. The default router path expects that token in Settings and stores it only in the browser.
4. Spin up the Database and the Application:
   ```bash
   docker compose up -d --build
   ```
   This rebuilds the app container with the current source and restarts the stack.
5. Open [http://localhost:3000](http://localhost:3000)
6. On your first visit, you will be prompted to create the **Admin Account**.
7. In Settings → Chat, choose `Ollama`, `Hugging Face`, or `Hybrid` as the main chat platform. Hybrid merges discoverable models from both sources into one header picker.
8. If you use the default Hugging Face router, add your HF token in Settings → Chat. Model discovery uses the router's `/v1/models` endpoint, and chat uses the router's OpenAI-compatible `/v1/chat/completions` path.
9. Open Claw lives under **Core AI** in the sidebar. The first-time model selection is remembered per user, OpenAI-compatible providers can be configured from Settings, and Knowledge Base RAG can be toggled inside the workspace.
10. While Open Claw is active, it shares the same chat-style top bar as normal chat, including the model picker. On desktop, the Open Claw-specific Internet, UWAF, RAG, Unrestricted, and Uncensored controls now live inside a single featured **Workspace modes** dropdown so the header stays clean; on mobile, those controls remain in the overflow menu. The left rail still holds session and workspace controls below the top brand/nav block. Use the rail or drawer to switch task threads, return to the `Chat` surface, open `Knowledge Base (RAG)` without losing the selected Open Claw session, choose `Plan`, `Research`, `Execute`, or `Review`, store workspace notes, and define success criteria that persist in the browser and stay attached to future Open Claw requests.
11. If a local model gets wedged after a failed load or stalled run, use the **Stop model** button next to the shared model selector in the top bar so the next request starts from a clean reload.
12. Open Claw now includes a **Verify** button for provider connections so you can confirm the configured Ollama/OpenAI-compatible endpoint is reachable before starting a task.
13. If your GPU is tight on memory, enable **Exclusive Ollama Switching** in Settings → Chat so Chat and local-provider Open Claw unload other running Ollama models before starting the selected one.
14. Chat and the non-Open-Claw workspace views now include an **Ollama health** strip that shows whether the service is online, degraded, or offline, how many models are installed/loaded, and which models are currently resident.
15. If a request fails, use `Retry`, `Retry without web`, or `Stop + retry` from the health strip instead of rebuilding the prompt manually.
16. Use the main chat sidebar to search prior sessions, group chats into folders, and assign reusable color tags from each session's menu.
17. Turn on **Internet** in Chat or from Open Claw's **Workspace modes** dropdown when you want cited public web context. The backend now handles search and page fetching directly before the model starts, so Internet mode no longer depends on model tool support and does not burn a long pre-answer Ollama tool round. This phase is still read-only: it does not control your browser, and it blocks localhost, private-network targets, credentialed URLs, and non-standard ports.
18. Open Claw shell, filesystem, code, and browser tools are configured from Settings. Use `ask-first` when you want approval before writes, code execution, public-web form submits, or network-capable shell commands like `git clone`, `curl`, `wget`, `npm install`, or `docker compose up`.
19. If you want Open Claw shell commands to run on the host instead of inside the container, start the optional host executor described in [Open Claw Host Executor](docs/openclaw-host-executor.md), set `OPENCLAW_HOST_EXECUTOR_TOKEN`, restart the app container, and switch `Shell Target` to `Host` in Settings.
20. If an Open Claw task needs a shared working directory, use `/tmp/peakui-openclaw-workspace` in host-style paths or `/mnt/openclaw/workspace` inside the container context.
21. If a request stalls before generation, the phase label now tells you whether the delay is Knowledge Base lookup, web research, exclusive model unload, or actual Ollama startup. If it stays on `Starting model...` or `Connecting to model...`, try **Stop model** or `ollama stop <model>`, restart Ollama, or free up GPU memory first.
22. If the app reports a model-memory error while the same model works in terminal, lower the Chat context window in Settings. The default local path now lets Ollama choose its own context first, but explicit higher context requests are still capped to `4096` tokens by default and backed off further on memory pressure. Raise `PEAKUI_OLLAMA_CONTEXT_CAP` only on hardware that can actually carry larger KV caches.
23. If the browser reports a chat connection failure, the streamed error should now include the provider URL and socket cause. Test the same model locally with `ollama run <model> "hello"` when using Ollama, or confirm the remote HF-compatible base URL and token when using Hugging Face.

## 🗺️ Roadmap
- **Phase 2 (Pending):** Docker container orchestration directly from chat.
- **RAG Next:** See [RAG-TODO.md](RAG-TODO.md) for the remaining backlog, which now focuses on larger-library indexing and scale polish after the retrieval, filtering, drill-down, OCR, archive, incremental reindexing, health UI, and regression test pass.
- **Phase 4:** Code Interpreter and VM orchestration. See the [Development Section Implementation Plan](docs/development-section-plan.md) for the Code Interpreter, Virtual Machines, Docker Containers, and the alternative gateway plan.
