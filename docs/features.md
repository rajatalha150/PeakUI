# PeakUI Features

## WorkSpaces-First App Shell

PeakUI opens directly into WorkSpaces. Workspace, Knowledge Base, Settings, task sessions, and logout all live inside the WorkSpaces shell.

### Model Platforms

- **Primary provider selection**: WorkSpaces can run on local `Ollama` or an OpenAI-compatible provider.
- **Ollama Cloud API**: Settings can switch Ollama from the default local endpoint (`http://127.0.0.1:11434`) to `https://ollama.com/api` with an API key. When enabled, chat, model discovery, RAG embeddings, health checks, model stops, session summaries, vision capability probes, and embedding-model tests all route to the cloud endpoint with an `Authorization: Bearer <key>` header. The key is stored server-side and redacted (returned as an empty string) from browser responses. The `/api/settings` response always redacts the key on both GET and POST so the UI cannot accidentally send an empty key back on a later save.
- **Local-only endpoints**: Ollama Cloud does not expose the local `/api/ps` running-models endpoint. PeakUI skips `/api/ps` probes, running-model diagnostics, and exclusive-model unloading when cloud mode is active so cloud users never see 401s from that route.
- **Cloud status display**: When cloud mode is enabled, Settings shows the cloud base URL (`ollama.com`) instead of the local host URL.
- **Provider-aware defaults**: Saved WorkSpaces model settings keep both the model id and provider so duplicate names across platforms stay deterministic.
- **Hugging Face router support**: The default HF-compatible path can use `https://router.huggingface.co/v1` with OpenAI-compatible chat completions and router-native `/v1/models` discovery.
- **HF-compatible endpoints**: Custom TGI, vLLM, or SGLang-style OpenAI-compatible bases can be used when they expose model discovery or info routes.

### Model-Capacity Adaptation

PeakUI detects each model's capacity (parameter size + native context window) and adapts the system prompt and context window to it, so small local models stop getting cut off mid-sentence and large/cloud models keep the full tool manifest.

- **Capacity detection**: `getModelCapacityProfile` in `src/lib/model-context.ts` queries Ollama `/api/show` (cached 5 min per model, handles both the old `details.parameter_size` + `model_info` shape and the new `general.parameter_count` + `general.context_length` shape) and falls back to name-based heuristics on any failure. Non-Ollama providers get the cloud profile immediately without a fetch.
- **Graduated prompt tiers**: `minimal` (≤4B) / `compact` (≤9B) / `standard` (≤30B) / `full` (>30B, cloud). `minimal` drops the verbose core-protocol rules, recovery behavior, single-shot mode, and all document examples so the manifest fits a 2048-token window next to the conversation. Document-generation examples are query-gated in every tier: the relevant tutorial is only emitted when the latest user query signals document intent, so an idle `full` prompt stays compact.
- **Adaptive context window**: when `/api/show` reports a native window, the default `num_ctx` is raised when the model comfortably allows it (≤9B → 8192 when native ≥ 8192; ≤4B → 4096 when native ≥ 4096) and both the default and the hard cap are clamped to the native window. The existing OOM backoff loop still steps down automatically if a raise is too aggressive for the GPU.
- **Manual override**: Settings → Generation → **Prompt Detail Level** (`workspaceToolPromptTier`) defaults to `auto` (detected from capacity) and can be pinned to `minimal` / `compact` / `standard` / `full`.
- **Always-on compact tool manifest**: Regardless of tier, every prompt includes a `TOOL MANIFEST` block listing each active tool's exact `name` plus a one-line JSON signature (e.g. `browser {"action":"open","url":"..."}`, `pdf_document {"title":"..."}`). This keeps small local models from hallucinating tool names/fields when their verbose tutorials are trimmed to fit the context window.
- **Always-on tool-selection routing**: Every prompt (all tiers) also includes a `TOOL SELECTION` block that pins the intent→tool mapping so the model picks the right tool instead of improvising with shell. Current/external information (stock prices, market data, quotes, news, "analyze TICKER", lookups, statistics) routes to the `web` tool — with an explicit rule never to scrape a page with shell+curl/wget, since finance and news sites are JavaScript-rendered and return nothing useful. Local-machine facts route to `filesystem`/`shell`; step-by-step navigation, JS-heavy pages, forms, and login route to `browser`/`unified_browser`; running code or transforming data routes to the `code` sandbox. The `internet` intent keywords were also expanded (stock, ticker, price, quote, market, analyze, earnings, financial, weather, statistics) so queries like "analyze pltr" trigger the full web-research instructions instead of a one-line note.
- **Both prompt callers honor the tier**: interactive WorkSpaces chats and unattended automation runs both fetch the profile and pass the tier, so background runs no longer send a 17KB full prompt to an 8B model.
- **Device-fit classification**: `classifyModelFit` in `src/lib/model-context.ts` classifies a model as `fits` / `tight` / `oversized` / `unknown` against the free GPU VRAM (with ~1 GB headroom for the KV cache). The model picker annotates each model with its size and a `may not fit GPU` / `tight on GPU` flag, so users stop selecting models that are too large for their hardware — the root cause of "models take forever to load" on small GPUs.

### Multi-Format Tool-Call Parsing

PeakUI's tool-call parser accepts the custom `<workspace_tool>` wrapper **and** the native tool-call syntax of the most common local model families, normalizing them all to the same request shape so per-tool validation runs identically:

- Qwen / Hermes `<tool_call>{"name","arguments"}`
- Anthropic `<invoke name><parameter>`
- Llama-3 `<|python_tag|>NAME.call(k=v)`
- Mistral `[TOOL_CALLS] [...]` / `name{json}` / `name[ARGS]{json}`
- Gemma 4 `<|tool_call>call:NAME{json}`
- GLM 4.5-4.7 `<tool_call>NAME<arg_key>/<arg_value>`
- Qwen3.5 XML `<function=name><parameter=k>v</parameter>`

Missing closing tags are tolerated (models truncate mid-stream), unknown tool names are rejected, and every format is stripped from the visible transcript. See [Tool-Call Formats](tool-call-formats.md) for the full reference.

### Organization

- **Folders**: Group WorkSpaces task threads into named color-coded folders from the workspace rail.
- **Tags**: Apply reusable tags to task threads for cross-folder filtering.
- **Search**: Search task-thread titles and saved message content from the rail.
- **Session actions**: Rename, pin, copy, delete, move to folder, and toggle tags from each WorkSpaces task thread menu.
- **Lean session list + lazy transcripts**: The session rail loads from `GET /api/chats`, which returns lean rows containing identity, metadata, tags, branch info, `summary`, `contextSummary`, `analytics`, and `ragSources` — but **not** the `messages` transcript. The active session's transcript is fetched on demand from `GET /api/chats/[id]` when a thread is opened or switched to, and cached on the in-memory row so re-selecting, copy-to-clipboard, and branch-compare don't refetch. This keeps the sidebar load constant-time regardless of how many threads or how large each transcript is. The init path fans settings/folders/tags/sessions out in parallel with per-call retry and 10s fail-fast timeouts.

### File & Media Attachments

- **Attach files and images**: Click the paperclip button or drag-and-drop files onto the message input
- **Supported formats**: Common still images are treated as vision inputs, including PNG, JPG/JPEG, GIF, WebP, BMP, TIFF, AVIF, HEIC, and HEIF. Documents are extracted to text when possible, and in WorkSpaces, PDFs are additionally rasterized to page images for vision-capable models (see below).
- **Vision-model compatibility**: HEIC/HEIF, TIFF, BMP, AVIF, and other unsupported still-image uploads are normalized to JPEG before the Ollama `images` payload is sent, using `sharp` first and system converters (`heif-convert` / ImageMagick) as fallback.
- **Audio/video detection**: Audio and video uploads are classified by MIME or extension instead of generic binary metadata. They remain metadata-only until a transcription/frame-extraction pipeline is added.
- **Upload limit**: 100 MB per file
- **Processing**: Documents are automatically extracted using text, RTF, or Office parsers depending on format. Images can include OCR text as supplemental context without replacing the native image payload.
- **Preview**: Pending attachments show as chips above the input with thumbnail (images) or filename (documents) and an X to remove
- **Images in responses**: AI-generated images embedded as base64 in responses display inline with click-to-expand and download

### Code Blocks

- **Copy button**: Every code block has a "Copy" button that copies code to clipboard
- **Language detection**: Code blocks display the detected language in the header
- **Syntax highlighting**: Handled via CSS styles on code elements

### Message Actions

- **Copy message to clipboard**: Each user and assistant message has a copy button to copy its full text to the clipboard

### Download Actions

- **Response download**: Download the full assistant response as a text file
- **Generated files**: Files generated by the AI (embedded as base64) appear as download buttons
- **Server artifacts**: Server-generated artifacts such as PDFs appear as secure download buttons when the assistant links `/api/canvas/artifacts/<id>/download`
- **Images**: Generated images can be downloaded directly from the inline gallery

## WorkSpaces

WorkSpaces is the primary workspace for agentic tasks with persistent task modes and workspace controls. On desktop, it uses a chat-style top bar with the model picker and Workspace modes menu, while the left rail keeps session/workspace navigation below the brand/nav block. On mobile, the same shell collapses the rail into a drawer instead of showing a separate app sidebar.

### File Attachments

WorkSpaces uses the shared file and image attachment system:
- Paperclip button in the composer for file selection
- Images sent as normalized image bytes to vision models, with MIME/name metadata preserved through the chat API
- Per-image attachment modes: `Vision only`, `Vision + OCR`, and `OCR only`
- Documents extracted to text and prepended to the message
- **PDF vision pages**: Uploaded PDFs are rasterized to JPEG page images (up to the first 10 pages at 150 DPI via poppler). When the selected model is vision-capable, those page images are attached as native image input so the model can read the original layout, tables, stamps, and signatures — not just the flattened text. Text-only models still receive the extracted text. The full text layer is always included as a supplement.
- **Vision auto-detection**: The selected model's vision capability is resolved via Ollama `/api/show` capabilities (with a model-name heuristic fallback, also used for OpenAI-compatible providers). Page images are only sent to vision-capable models to avoid bloating or confusing text-only models.
- **Storage**: Rendered page images stay in the live session so the active task keeps "seeing" the document, but are stripped before persisting to the database to avoid bloating session storage; reloaded threads fall back to the extracted text.
- Attachment preview with remove capability

### Canvas Panel

WorkSpaces includes a collapsible Canvas panel that:
- Displays generated artifacts as compact single-row items so generated files do not consume the full side rail
- Provides Copy, Download, Preview, and Delete controls on each artifact row
- Opens artifact previews in a modal for PDFs, images, markdown, code, tables, generated Word documents, Excel workbooks, slide decks, ZIP bundles, calendar events, Mermaid diagrams, and other Canvas files
- Keeps the artifact list in a bounded scroll area so long Canvas sessions remain navigable
- Enables single artifact downloads plus bundle-level JSON export/delete actions
- Persists artifacts via the CanvasArtifact model and stores durable CanvasArtifactRevision snapshots on create, edit, and restore
- Supports revision history, restore, lightweight revision comparison, lineage links, search, and cursor paging so large Canvas sessions are recoverable and navigable
- **Source-editable binary artifacts**: PDF, Word, Excel, PowerPoint, and Mermaid artifacts expose their underlying JSON or `.mmd` source as a sibling `kind: 'data'` artifact. Clicking **Edit** on one of these artifacts opens the source JSON in the editor, and saving it re-renders the binary through the existing render endpoint. The previous binary is preserved as a revision and the source artifact remains the single point of truth for future re-renders.
- **Server-side preview endpoint** (`/api/canvas/artifacts/<id>/preview`): binary artifacts are parsed server-side and returned as a normalized JSON shape so the Canvas modal can render real Excel tables (per-sheet, per-column), Word documents (per-section, paragraphs + tables), email drafts (parsed `.eml` headers + body), and slide decks (slide titles + bullet previews) inline. This replaces the previous "Browser-native inline preview is limited" fallback for binary types.
- **Mermaid client-side rendering**: when the preview endpoint returns `{ kind: 'mermaid', source }`, the modal lazy-loads Mermaid from the CDN and renders the `.mmd` source as a live SVG. The same flow is used as the inline fallback when the server-side renderer is unavailable.
- **Download correctness**: PDF, Excel, Word, PowerPoint, ZIP, ICS, email, and Mermaid downloads go through `/api/canvas/artifacts/<id>/download` (which decodes base64 correctly) instead of the previous inline Blob path that produced corrupt files for binary types.

### Task Modes

- **Plan**: For planning and outlining tasks
- **Research**: For investigation and information gathering
- **Execute**: For taking actions and generating output
- **Review**: For evaluating and refining results

### Response Styles

- **Concise**: Brief, to-the-point responses
- **Structured**: Well-organized with headers and sections
- **Deep**: Comprehensive, detailed responses

### Workspace Controls

- **Clarify first**: Agent asks clarifying questions before proceeding
- **Workspace notes**: Persistent notes attached to all requests
- **Success criteria**: Define what "done" looks like for each task
- **Pinned checklist**: Editable checklist that persists across messages
- **Workspace controls launcher**: The rail now exposes one `Workspace controls` button that opens a modal for agent mode, response style, task state, workspace brief, persona, user profile, shell configuration, and workspace-capability details, freeing more vertical space for sessions.
- **Multi-workspace selector**: The same controls modal now lets users create and switch between named project workspaces without leaving the active WorkSpaces thread.
- **Scaffolded workspace files**: Each workspace gets its own `BOOT.md`, `TOOLS.md`, and `skills/` directory so local conventions and reusable prompts live with the workspace itself.
- **Prompt-backed startup context**: The selected workspace's `BOOT.md`, `TOOLS.md`, and skill-template summaries are injected into the WorkSpaces system prompt for that turn.
- **Capability inventory**: Native and future tool capabilities are described through a shared inventory so the AI can choose the right app tool for day-to-day tasks. MCP is documented as a future curated extension path for helping the AI learn new approved skills. See [WorkSpaces Capability Inventory](capability-inventory.md).

### Session Intelligence

- **Per-session continuation modes**: Each WorkSpaces thread now carries its own `manual`, `ask`, or `safe` continuation mode plus a max-step cap, and the composer shows continuation state inline.
- **Safe auto-continue**: `safe` mode only auto-follows unfinished tool-driven turns instead of blindly looping on every assistant response.
- **Rolling context summaries**: Long sessions now preserve older turns as a compressed summary while keeping recent raw turns intact inside the active context window.
- **Context health feedback**: WorkSpaces surfaces whether a thread is still `Fresh`, getting `Near limit`, already `Summarized`, or fully `Trimmed`.
- **Branch from any message**: Users can fork a WorkSpaces thread from the latest state or from an individual message without losing tags, folder placement, or branch ancestry.
- **Branch comparison**: Branch families can be compared side-by-side, including summaries, rolling context, analytics, continuation mode, child-branch count, and latest outcome.
- **Session analytics**: Each thread now tracks time span, message counts, assistant tokens, average TPS, sources, attachments, images, and tool-call counts by type.

### Workspace Files Panel

A right-rail GUI over the active workspace's on-disk state. The panel shares the same sandbox and permission gate as the model's filesystem / shell / code tools, so anything the model writes or uploads appears in the panel live, and anything the user does in the panel becomes visible to the model on the next turn. See [Workspace Files Panel](workspace-files-panel.md) for the full reference.

- **Virtualized tree**: Lazy-loaded directory tree (`WorkspaceFileTree`) with memoized rows, Explorer-style navigation, breadcrumb + `← Back`, and a "← back to root" hint when a folder is empty.
- **Type-dispatched preview** (`WorkspaceFilePreview`): markdown, code (Prism via `LazySyntaxHighlighter`), JSON (pretty-printed), CSV, images (base64 data URL + zoom toggle), PDF (iframe), and binaries (download-only). Opens in a full-size modal (`min(1100px, 96vw)` × `88vh`) with a blurred backdrop, click-outside + Escape to close.
- **In-place editor** (`WorkspaceFileEditor`): Line-numbered editor with a dirty dot, `Cmd/Ctrl+S` to save, and an Edit/Preview toggle. Writes are `If-Match: <etag>` so concurrent edits surface a 412 banner with three actions — **Reload** (discard edits, re-fetch), **Overwrite** (force-save without `If-Match`), **Save as copy** (writes `<name>.edited.ext`).
- **Upload + delete**: Drag-and-drop or click-to-pick upload (`WorkspaceFileUpload`, 50 MB / file, 100 files / request). Single-file download streams through `GET /files/download` with RFC 5987 UTF-8 filenames. Deletes land on `DELETE /files`; recursive when the path is a directory. `WorkspaceConfirmDialog` is shared by every confirm flow with Esc/Enter keybindings and a destructive red variant.
- **Multi-select + bulk ops**: `Cmd/Ctrl+click` toggles, `Shift+click` ranges, plain click toggles-to-deselect, and `Cmd/Ctrl+A` (when focus is in the panel) selects every visible row. Selection toolbar: **Copy paths**, **Download zip** (500 MB / 500 files), **Delete**, **Clear**. Bulk delete auto-uses the recursive flag when any selected entry is a directory.
- **Rename + move**: Right-click for the context menu, **F2** for in-place rename (Enter commits, Esc/blur cancels), **Move to…** opens `WorkspaceMoveDialog` which reuses the tree in a directories-only mode (`selectableKinds={['directory']}`) to pick the destination. Both actions route through `PATCH /files action: 'rename' | 'move'`.
- **Right-click context menu**: Open / Rename / Copy path / Download / Move to / Delete. Open and Download are hidden for directories; Delete renders in red.
- **Live SSE updates**: `GET /events` streams every successful mutation through the existing in-process pub/sub. The panel debounces (150 ms) and refetches the affected directories (and the active file, so the editor's ETag stays fresh). The client reconnects with jittered exponential backoff (500 ms → 5 s, reset on each successful read).
- **AI awareness**: A `WORKSPACE FILES GUI PANEL` block in the chat system prompt + default `BOOT.md` / `TOOLS.md` sections teach the model that the panel is a live view of the same on-disk state and that paths in the panel are workspace-relative.

### Autonomous Scheduling

- **Persistent automation worker**: A Node-side worker starts from `src/instrumentation.ts` and polls automation state every 30 seconds instead of relying on browser-local timers.
- **Heartbeat check-ins**: Configurable stale-thread review creates proactive server-side nudges when WorkSpaces threads have gone quiet for too long.
- **Cron schedules**: Users can store recurring prompts with cron expressions + timezone and receive scheduled nudges when they fire.
- **Background monitors**: URL and file monitors run outside active chat sessions and trigger nudges on change, content match, or disappearance.
- **Wake events**: Authenticated `POST /api/workspace-tool/automation/wake-event` lets external triggers raise a WorkSpaces automation nudge immediately.
- **Unattended model execution**: Heartbeats, schedules, monitors, and wake events can now switch from `nudge` delivery to durable background model execution. Queued runs are processed by the same Node-side automation worker and post their result back into a WorkSpaces thread.
- **Execution guardrails**: Personal settings now control whether unattended execution is enabled, which Ollama model it uses, the hourly execution budget, and whether workspace/memory context is attached automatically.
- **Execution history**: The automation modal now shows recent unattended runs, including queued/running/succeeded/failed state plus result preview or error output.
- **Nudge inbox**: Automation nudges show inside WorkSpaces, can jump to the linked thread, and are also injected into WorkSpaces request context on the backend.
- **Guardrails**: File monitors require the same approved WorkSpaces filesystem roots as manual file inspection, and URL monitors reuse the public-HTTP SSRF checks from the browser stack.
- **Current boundary**: Unattended execution currently supports local Ollama only and deliberately does not invoke interactive tools such as shell, filesystem, browser, or code while running in the background.

### Tool Execution

- **Effective capability model**: Tool availability is now the intersection of account permission, personal settings, and runtime availability. WorkSpaces no longer advertises shell/filesystem/code/browser/UWAF capabilities that the backend will reject.
- **Shell execution**: Run shell commands from WorkSpaces and stream output back into the task
- **Shell target selection**: Run commands in the default app container or through the optional host executor when host-installed CLIs are needed
- **Shell approval modes**: Configure `auto-approve`, `ask-first`, or `deny`
- **Approval-aware shell policy**: Simple inspection commands can auto-run, while repo/network/install/service commands like `git clone`, `curl`, `wget`, `npm install`, and `docker compose up` require explicit approval
- **Host shell executor**: Optional daemon runs outside Docker on `127.0.0.1`, requires `WORKSPACE_TOOL_HOST_EXECUTOR_TOKEN`, and enforces approved cwd roots, env allowlists, timeout caps, output caps, and DB audit records
- **Host fallback behavior**: If Host is selected but the executor is not configured or reachable, WorkSpaces falls back to the container shell and labels the actual target in the approval/output UI
- **Filesystem read**: List, read, and stat files inside approved host paths
- **Filesystem read/write tools**: Local file tools are implemented as `list`, `read`, `stat`, `write`, `append`, and `mkdir` actions against approved roots, with approval gates for write/append/mkdir and read-only defaults.
- **Code execution sandbox**: Run short Python or Node scripts in a managed workspace-scoped sandbox with timeouts, output limits, and generated-file reporting. This now has its own `workspace-tool.code` account permission instead of piggybacking only on general WorkSpaces access.
- **PDF document generation**: The `pdf_document` tool creates polished downloadable server-side PDF Canvas artifacts for reports, summaries, letters, checklists, invoices, form-style output, or sample document requests. A title alone (optionally with a description) is enough to generate a valid PDF — the full structure (sections, fields, tables, callouts) is a strong recommendation, not a requirement. When the model does provide the full structure, the renderer styles it per-template (report / memo / letter / invoice / checklist / form each get their own accent palette) with accent-colored headers, zebra-striped tables, tone-labeled callouts, and tinted field grids, so structured documents render as polished professional PDFs. WorkSpaces should use this tool instead of shell/filesystem/code sandbox when the user asks for a PDF file. See [PDF Document Workflow](pdf-document-workflow.md).
- **Excel workbook generation**: The `workbook_document` tool creates real downloadable XLSX Canvas artifacts for spreadsheets, budgets, invoices, timesheets, ledgers, trackers, inventories, schedules, and multi-sheet analysis. A title alone (optionally with a description) is enough to generate a valid XLSX — the full structure (sheets, typed columns, totals) is a strong recommendation, not a requirement, and a Notes sheet is synthesized when no sheet has rows. WorkSpaces should use this tool instead of markdown tables or code sandbox when the user asks for an Excel file. See [Excel Workbook Workflow](workbook-document-workflow.md).
- **Word document generation**: The `word_document` tool creates real downloadable DOCX Canvas artifacts for proposals, contracts, resumes, letters, memos, reports, policies, checklists, meeting notes/minutes, and form-style business documents. A title alone (optionally with a description) is enough to generate a valid DOCX — the full structure (content, sections, fields, tables, callouts) is a strong recommendation, not a requirement. WorkSpaces should use this tool instead of markdown or code sandbox when the user asks for a Word file. See [Word Document Workflow](word-document-workflow.md).
- **CSV export generation**: The `csv_document` tool creates downloadable CSV Canvas artifacts from headers and rows. A title alone (optionally with a description) is enough to generate a valid CSV — the full structure (headers, rows, raw content) is a strong recommendation, not a requirement, and the description becomes the body when no data is supplied. Use it for structured data exports, report extracts, quick datasets, or spreadsheet interchange instead of pasting markdown tables or writing temporary files through the code sandbox.
- **Email draft generation**: The `email_document` tool creates downloadable `.eml` Canvas artifacts with a styled HTML body, optional plain-text version, and optional attachments. A title alone (optionally with a description) is enough to generate a valid draft — the full structure (to, from, subject, body) is a strong recommendation, not a requirement, and the subject/body are derived from the title/description when missing. Use it for formal emails, outreach templates, or replies instead of generating raw files manually.
- **Web fetch and summarize**: The `fetch_summarize` tool fetches a public URL and returns a concise summary with title, bullet takeaways, and a representative quote. It uses the same public-HTTP and SSRF guardrails as the browser stack.
- **Markdown document generation**: The `markdown_document` tool creates downloadable `.md` Canvas artifacts from a markdown body. A title alone (optionally with a description) is enough to generate a valid `.md` file — the full structure is a strong recommendation, not a requirement, and the description becomes the body (or a title heading is used) when no content is supplied. Use it when the user asks for a Markdown file, `.md` export, or markdown version of any content. It returns a clickable `/api/canvas/artifacts/<id>/download` link and stores the file as a Canvas artifact instead of writing it to a workspace path.
- **PowerPoint slide deck generation**: The `slides_document` tool creates real downloadable `.pptx` Canvas artifacts via `pptxgenjs`. Layouts include `title`, `section`, `content`, `bullets`, `two-column`, `quote`, and `closing`. Each slide supports title, subtitle, body, bullets, two columns of heading + bullets, and notes. See [Slides Document Workflow](slides-document-workflow.md).
- **ZIP archive bundle generation**: The `archive_document` tool bundles multiple artifacts/files into a single `.zip` Canvas artifact via `archiver`. Each entry can carry raw text content or a base64-encoded binary payload and is rendered with the right MIME type on extract. See [Archive Document Workflow](archive-document-workflow.md).
- **ICS calendar event generation**: The `calendar_document` tool produces a downloadable `.ics` Canvas artifact via the `ics` package. Each event supports `uid`, `title`, `description`, `location`, `start`, `end`, `allDay`, `organizer`, `attendees`, and `url`, and the artifact opens in macOS Calendar, Outlook, and Google Calendar. See [Calendar Document Workflow](calendar-document-workflow.md).
- **Mermaid diagram generation**: The `mermaid_document` tool renders a Mermaid diagram to `.svg` (default) or `.png` via `@mermaid-js/mermaid-cli` using the system Chromium bundled in the container. The artifact also carries the `.mmd` source so it remains re-editable and re-renderable. See [Mermaid Document Workflow](mermaid-document-workflow.md).
- **Tax PDF generation**: The `tax_return` tool creates downloadable tax review PDFs from enabled Knowledge Base folders and can best-effort fill uploaded AcroForm PDF templates. It reuses the same generic PDF artifact pipeline. See [Tax PDF Workflow](tax-pdf-workflow.md).
- **Browser control**: Open public pages, inspect links/forms, stage fills, submit with approval, and extract content
- **UWAF browser (Unified Web Agent Framework)**: Dual-mode browser engine supporting Direct (Clear Web) and Stealth (Tor-routed Dark Web) research modes
  - **Direct mode**: Standard Playwright Chromium browsing for public web research, table extraction, and form interaction
  - **Stealth mode**: Tor-routed browsing via SOCKS5 proxy for anonymous research and `.onion` access, with broader versioned desktop fingerprints, randomized locale/timezone/hardware/viewport traits per session, WebRTC lock-down, browser-surface normalization, and strict content sanitization
  - **Stealth profiles**: `normal` balances compatibility and diversity; `high` uses a more conservative fingerprint set and stricter launch flags for higher-friction targets. Normal stealth remains the default for ordinary dark-web research; high stealth is used for `.onion`, hidden-service, research-batch, or explicitly requested high-stealth flows.
  - **Fingerprint regression checks**: Stealth preflight now caches detector-page checks against known fingerprint pages in addition to DNS/WebRTC/Tor verification
  - **Leak-prevention preflight**: Stealth startup verifies Tor exit alignment, DNS resolver behavior, WebRTC constructor removal, and media-capture denial before allowing navigation
  - **Approved onion-search rotation**: Stealth search now stays inside the approved onion-search-engine catalog by default, rotating across Ahmia, OnionWay, OnionLand, TorDex, Excavator, and any explicitly configured engines from the same catalog instead of silently falling back to general clear-web engines
  - **Operator overrides**: additional approved engines from the same catalog can be enabled with env-backed `UWAF_STEALTH_PROVIDER_*_{HOME_URL,QUERY_URL}` configuration instead of code edits
  - **Provider health scoring**: Search providers accumulate uptime, latency, anti-bot, and usefulness scores, then cool down automatically after repeated degraded outcomes
  - **Validated search semantics**: `search` now verifies that the resulting page actually reflects the requested query and contains usable result blocks; homepage bounces, zero-result pages, and anti-bot/login gates are surfaced as explicit failures instead of being treated as evidence
  - **Parser hardening**: malformed legacy `<unified_browser>` blocks and concatenated JSON payloads are now recovered into the first valid request instead of dropping the whole browser turn
  - **Richer browser primitives**: Added `type`, `press`, `wait_for_selector`, `scroll`, `back`, `forward`, `new_tab`, `list_tabs`, `switch_tab`, `close_tab`, `select`, and `hover` so the model can operate on real browser state instead of relying on only open/click/fill
  - **Action diagnostics**: Browser results now include redirect state, HTTP status when available, query-match checks, result counts, tab state, selector match/wait timeout flags, anti-bot/login detection, and recent JS/network failures
  - **Research batch**: Crawl a starting URL and follow links up to depth 3 (max 10 pages), returning aggregated Markdown content
  - **Table extraction**: Pull all `<table>` elements as structured Markdown or CSV
  - **Live browser instead of screenshots**: Static screenshot capture is disabled; the live noVNC browser is the visual browsing surface
  - **Network Hub Panel**: Shows Direct IP, Tor connection status, Tor exit node country, preferred stealth search provider, and current stealth profile
  - **Truthfulness guardrails**: The WorkSpaces prompt now instructs the model to treat browser evidence fields as authoritative and to report browser failure explicitly instead of converting prior knowledge into claimed live observations
  - **Source labeling**: Clear Web sources shown as blue chips, Dark Web sources as purple chips
  - **Security**: Binary download blocking (.exe, .sh, .bin, etc.), .onion URLs only in stealth mode, host DNS fallback blocked for stealth Chromium sessions, and stealth fails closed if Tor proxy verification fails
- **Tool-call format enforcement**: The WorkSpaces system prompt now instructs the model to emit exactly one complete `<workspace_tool>` XML wrapper and nothing else when a tool is required. The parser also recovers bare search, browser, and document-generation intents from prose, but correct wrapper emission remains the preferred path.
- **User-configurable tool-step cap**: Settings exposes a "Tool-Step Cap Per Turn" slider (default 100, max 250) that controls how many real tool calls WorkSpaces can run in a single assistant turn before pausing for a "continue". Recovery nudges and duplicate warnings do not count toward the cap.
- **Filesystem path safety**: The filesystem tool now rejects bare relative paths and surfaces a clear error telling the model to use an absolute host path under an approved writable root (e.g. `~/.peakui/workspace/projects/...`). The system prompt reinforces this rule so project scaffolding always lands in the managed workspace.
- **Tool-first responses and single-shot execution**: The system prompt now instructs the model to lead with the `<workspace_tool>` wrapper when a tool is intended, and to avoid prose-before-wrapper. For clear, well-scoped tasks it prefers a single code-sandbox script over chained tool calls, and it must not pivot to fake alternative stacks that cannot produce the requested artifact.
- **Workspace-scoped deliverables**: The system prompt now binds all created files, projects, and archives to the currently selected workspace. ZIPs and project folders are created under the user's visible workspace directory so they appear in the file tree and can be downloaded.
- **Silent narration recovery**: If the model describes a tool action in prose without the wrapper, WorkSpaces silently synthesizes the intended tool request instead of injecting noisy "auto-recovered" messages into the chat.
- **PDF numeric hardening**: PDF document generation now sanitizes incoming numeric values (NaN, Infinity, and out-of-range scientific notation) before rendering, preventing the canvas backend from throwing `unsupported number` errors.
- **Managed workspace**: WorkSpaces tools share `/mnt/workspace-tool/workspace` in-container and `~/.peakui/workspace` as the host-style alias
- **Selected-workspace sandbox default**: When the model omits `workspacePath`, code execution now defaults to the currently selected named workspace instead of an anonymous per-thread sandbox path.
- **Optional git auto-backup**: Each named workspace can auto-initialize a git repo and commit detected file changes automatically.

### Providers

- **Ollama**: Local models via Ollama
- **OpenAI-compatible**: Connect to any OpenAI-compatible API, including Hugging Face router or HF-compatible serving endpoints when configured with the right base URL and token

### Workspace Rail

- The left-side workspace rail is the app's primary navigation surface:
  - `Workspace` returns to the active WorkSpaces task view.
  - `Knowledge Base (RAG)` opens the Knowledge Base dashboard inside the WorkSpaces shell while keeping the selected WorkSpaces task thread visible.
  - `Settings` opens Settings inside the WorkSpaces shell; logout is available from the Settings header.
- WorkSpaces task threads support the core organization controls:
  - **Folders**: assign task threads to folders and filter the rail by folder
  - **Tags**: assign reusable tags and filter the rail by tag
  - **Session actions**: pin, rename, copy to clipboard, delete, move to folder, and toggle tags from each task thread menu
  - **Bulk management**: select multiple task threads, delete the selected set, or clear all WorkSpaces task threads at once
- On desktop, the rail shows session controls, current task mode and response style, objective and status, next step, checklist, quick-start prompts, workspace notes, and success criteria.
- The rail now prioritizes session browsing first: task threads are shown in pages of 15 with Previous/Next paging and range labels, while the deeper workspace controls live behind the dedicated modal launcher instead of stacking under the session list.
- Model selection lives in the shared top bar instead of the rail.
- On desktop, WorkSpaces-specific runtime controls now live in one featured **Workspace modes** dropdown in the top bar. That single menu contains Internet, UWAF Direct/Stealth, RAG, Unrestricted, and Uncensored, which keeps the header compact without dropping any functionality.
- On mobile, the same chat-style top bar carries the model picker and overflow menu, while the rail collapses into a drawer so the active session stays in context while still fitting a narrow screen.
- The rail now uses one primary scroll container instead of a nested session-list scroller, which makes wheel/trackpad behavior smoother and more predictable.

## Knowledge Base (RAG)

### Document Management

- Upload documents for semantic or keyword search
- Automatic chunking and indexing with incremental reindexing when the same file is uploaded again
- Per-user document storage with source paths, file kinds, chunk numbers, excerpt metadata, and whole-document flags for small safe files
- Background processing with status indicators
- PDF, Office, CSV/JSON/YAML/XML, code, OCR, and archive support are indexed as searchable content when text is available, with page-aware OCR fallback for scanned or mixed PDFs when the runtime image includes `poppler-utils` and `tesseract`
- Knowledge Base uploads can also ingest folder trees from the browser file picker or drag-and-drop. Relative paths are preserved, the uploaded tree stays intact in the index, and large drops are queued in batches so indexing stays responsive.
- A compact top status bar shows live RAG health counts: total files, indexed, full/chunked documents, pending, warnings, failed, and last indexed time.
- The indexed document list is server-paginated, lets users choose how many rows to show per page, and supports multi-select, select-all, and bulk delete actions. The folder/file view refreshes automatically every few seconds, so newly uploaded items and status changes appear without manual refresh.
- A OneDrive-style folder browser lets users navigate by the original `sourcePath`: breadcrumbs, immediate subfolders, file rows, a folder/files view toggle, sortable columns (name/size/createdAt/indexedAt/kind), and a kind filter. A whole subtree can be deleted in one action.
- The Knowledge Base dashboard opens from the WorkSpaces workspace rail.
- Opening it keeps the WorkSpaces session rail visible and swaps only the main content panel.
- On mobile, Knowledge Base uses the same top-bar/drawer chrome, so the selected WorkSpaces session context stays intact.
- Search supports `file:`, `folder:`, `type:`, and `ext:` narrowing, and the KB panel can open a full-document preview for a selected result

### Search Modes

- **Semantic**: Uses Ollama embeddings for similarity search (requires embedding model)
- **Keyword**: Uses BM25 text ranking (no embedding model needed)
- **Hybrid (RRF)**: Combines semantic + keyword results using Reciprocal Rank Fusion for better coverage

### Server-Side Integration

When **Enable Knowledge Base** is toggled ON in Settings, the shared completion pipeline automatically queries your indexed documents:
- RAG fires alongside web search in both Ollama and OpenAI-compatible paths
- Results sent as `knowledge_sources` in stream and displayed as source chips
- "Searching knowledge base..." phase shown during lookup
- The per-turn RAG state (toggle, search text, citation set) is saved with the chat, so a reopened session restores the same Knowledge Base draft instead of forcing the user to re-enable RAG and retype the query.
- The chat completion path injects a Knowledge Base tree summary as a system message so the model knows the corpus shape even when no chunks match. When a search runs but returns no context, a "no matching chunks" hint is appended so the model does not appear unaware of the corpus.

### Use in WorkSpaces

- Toggle RAG mode to automatically inject relevant context
- Search and inspect specific passages from the Knowledge Base panel
- Sources are cited inline with clickable chips
- Retrieved KB context is labeled with file metadata and chunk/full-document markers so the model knows whether it is seeing an excerpt or a safe full-document injection.
- The model prompt now explicitly tells the assistant that KB context is usually excerpt-based, but small files can be injected as full-document context when safe, and that it can ask for a broader lookup or direct file inspection when the snippet is not enough.

### Settings

- **Enable Knowledge Base**: Master toggle to activate auto-RAG during chat
- **Search Results (topK)**: Number of chunks to retrieve (1-200), or enter a number directly
- **Full Access**: When ON (topK = -1), retrieves ALL matching chunks instead of limiting
- **Mode**: Semantic or Keyword search
- **Embedding Model**: Model for semantic embeddings (test button available, with a larger recommended shortlist for speed vs recall tradeoffs)
- **RAG health bar**: Compact top status bar showing indexed, pending, failed, and warning counts, plus last indexed time

## Internet Mode

### Web Research

- Backend-managed public web search before generation
- Multi-engine fallback: Brave Search → SearXNG → DuckDuckGo → Bing
- Deep content extraction from fetched pages
- Schema.org and Open Graph metadata parsing

### Citations

- Inline [^N] citation markers
- Clickable source chips numbered [1], [2], etc.
- Opens original source URL in new tab

### Safety

- Read-only: Does not control browser or click links
- Blocks private/local addresses and credentialed URLs

## Settings

### Generation Settings

- **WorkSpaces provider/model**: Choose local Ollama or an OpenAI-compatible provider for WorkSpaces
- **Compatible provider base URL**: Default router or custom OpenAI-compatible endpoint
- **Provider token**: Stored only in the browser for compatible remote access
- **Temperature**: Response randomness (0-2)
- **Use Ollama default temperature**: Local Ollama requests can omit the custom temperature so the selected model uses its own native default
- **Context Window**: Requested max tokens for local Ollama (512-131072)
- **Use Ollama default context**: Local Ollama requests can omit `num_ctx` so Ollama chooses the selected model's native default context window
- **Prompt Detail Level** (`workspaceToolPromptTier`): `auto` (default) picks the system-prompt tier from the model's detected parameter size and native context; manual `minimal` / `compact` / `standard` / `full` overrides detection. See [Model-Capacity Adaptation](#model-capacity-adaptation).
- **Background system instructions**: The stock image-markdown and workspace-behavior guardrails run server-side instead of exposing a misleading shared System Prompt textbox in the primary UI
- **Exclusive Ollama Switching**: Unload other models before starting selected one
- **Logout**: Available from the Settings header

### Session Intelligence Settings

- **Default continuation mode**: New WorkSpaces threads default to `manual`, `ask`, or `safe`
- **Continuation step cap**: Limits how many safe auto-continue hops a thread can take before stopping
- **Rolling summaries toggle**: Enables or disables long-session summarization for WorkSpaces threads
- **Summary trigger threshold**: Token threshold where the backend starts compressing older turns
- **Recent-turn preservation**: Number of recent turns kept as raw transcript before summarization
- **Session analytics toggle**: Enables or disables per-thread analytics derivation
- **Branching toggle**: Enables or disables branch + compare workflows in WorkSpaces

### Appearance

- **Theme**: Aurora, Graphite, Midnight, Canvas, Ledger
- Themes apply immediately and persist per user

### WorkSpaces Tool Settings

- **Permission-aware status**: Shell, filesystem, code, browser, and UWAF settings now report when a capability is blocked by account permission instead of looking enabled and then failing with a generic route error.
- **Host access presets/status**: Quickly switch between safe workspace-only access, home-read/workspace-write access, or mounted-root audit mode; status reports host executor reachability and filesystem readiness
- **Shell target**: `container` or `host`
- **Shell mode**: `auto-approve`, `ask-first`, or `deny`
- **Shell allowlist extensions**: Additional command prefixes for auto-approval
- **Host shell roots/env/caps**: Approved working-directory roots, environment variable allowlist, max timeout, and max output size for host executor runs
- **Filesystem access mode**: `deny` or `read-only`
- **Allowed filesystem paths**: Host paths WorkSpaces may inspect
- **Filesystem write mode**: `deny`, `ask-first`, or `auto-approve`
- **Writable filesystem paths**: Host roots WorkSpaces may create or modify files in
- **Filesystem diagnostics**: `/api/workspace-tool/filesystem` returns structured denial codes and `actionRequired` hints for missing permissions, missing approved roots, paths outside mounts, and missing approval tokens
- **Code execution mode**: `deny`, `ask-first`, or `auto-approve`
- **Browser mode**: `deny`, `read-only`, or `ask-first`
- **UWAF browser mode**: `deny`, `direct` (Clear Web), or `stealth` (Dark Web/Tor)
- **UWAF default mode**: `direct` or `stealth` — sets the default browsing mode for the Unified Web Agent Framework
- **UWAF live browser**: Toggle whether the live interactive browser panel is shown during UWAF browser actions

### RAG Settings

- **Mode**: Semantic or Keyword
- **Embedding Model**: Model for semantic embeddings
- **Ollama Host**: Ollama server URL

## Ollama Integration

### Health Monitoring

- Live status: online, degraded, offline
- Shows loaded models and model count
- Retry and recovery actions from the health strip

### Model Control

- Stop running models from the UI
- Exclusive switching for GPU memory management
- Automatic context capping to prevent OOM

## Image Generation

PeakUI can generate images through a self-hosted **ComfyUI** engine that runs
alongside Ollama. The `image_generation` tool lets the model turn a text prompt
into an image that renders inline in chat and is downloadable as a Canvas
artifact.

### Engine

- **ComfyUI** is the image-generation engine (Ollama does not support image
  generation). It runs on the host, reachable at `http://127.0.0.1:8188`, and
  its `models/` directory is mounted into the app container at
  `/mnt/comfyui/models`.
- Settings → **Image Generation** configures the engine URL, the selected
  model, and an optional Hugging Face token (for gated models).

### Model discovery & download

- **Search Hugging Face** for text-to-image models directly from Settings.
- Results are classified by file layout and only genuinely-downloadable models
  get a download button:
  - `checkpoint` — a single-file `.safetensors`/`.ckpt` (e.g. `sd-turbo`,
    `dreamshaper`).
  - `diffusers` — a folder-based model (`unet/` + `vae/` + `text_encoder/`),
    downloaded as multiple files into `models/diffusers/`.
  - `collection` / `unknown` — not downloadable (e.g. "starter packs" of
    LoRAs/ControlNets, or sharded models).
- Downloads are **resumable** (HTTP Range) with persistent state that survives
  restarts, live progress bars, and pause/resume/delete.

### Generation

- The `image_generation` tool (`{ prompt, negativePrompt, width, height,
  steps, seed }`) is advertised to the model only when the engine is
  configured and a model is selected.
- The "Image Gen" mode toggle (next to Internet / RAG / Accountant) gates the
  tool.
- Generated images are fetched server-side, persisted as Canvas artifacts, and
  returned as absolute URLs so they render inline and download correctly
  regardless of how the user reaches PeakUI.

### API Routes

- `/api/image-gen/search` — Hugging Face model search + detail.
- `/api/image-gen/downloads` — list / queue / start / pause / delete downloads.
- `/api/image-gen/models` — ComfyUI health + model listing (checkpoints and
  diffusers).
- `/api/image-gen/generate` — submit a generation, poll for completion, and
  persist the result as a Canvas artifact.

## Architecture

### Tech Stack

- **Framework**: Next.js 16 (App Router), React 19
- **Database**: PostgreSQL via Prisma ORM
- **Auth**: JWT tokens via `jose`
- **Styling**: Vanilla CSS with glassmorphism UI and CSS variable themes
- **Container**: Docker & Docker Compose

### Key Libraries

- `ollama` SDK for LLM inference
- `officeparser` for document extraction
- `jose` for Edge-compatible JWTs
- `bcryptjs` for password hashing
- `lucide-react` for icons
- `playwright-core` for headless browser automation (UWAF)
- `turndown` for HTML → Markdown conversion (UWAF sanitizer)
- `pptxgenjs` for PowerPoint slide deck generation
- `archiver` for ZIP archive bundling
- `ics` for calendar event generation
- `exceljs` for Excel workbook parsing (preview endpoint)
- `mammoth` for Word document parsing (preview endpoint)
- `@mermaid-js/mermaid-cli` (mmdc) for Mermaid diagram rendering (uses the system Chromium)

### API Routes

- `/api/chat/completions` - Streaming chat for Ollama and Hugging Face/OpenAI-compatible providers
- `/api/chat/models` - Provider-aware model discovery for Ollama, Hugging Face, and hybrid chat
- `/api/chat/completed` - Finalize chat sessions
- `/api/files/extract` - Extract text from uploads
- `/api/rag/*` - Knowledge base operations
- `/api/web/context` - Internet research
- `/api/settings` - User preferences
- `/api/ollama/*` - Ollama health and control
- `/api/auth/*` - Authentication
- `/api/workspace-tool/*` - WorkSpaces workspace
- `/api/workspace-tool/shell/*` - Shell approval and execution
- `/api/workspace-tool/shell/settings` - Shell target, approval mode, host executor limits, and host executor health status
- `/api/workspace-tool/filesystem*` - Filesystem access and write approvals
- `/api/workspace-tool/code*` - Managed code sandbox execution and approvals
- `/api/workspace-tool/browser*` - Controlled public-web browsing and approval flow
- `/api/workspace-tool/uwaf-browser` - UWAF dual-mode browser execution (direct/stealth)
- `/api/workspace-tool/uwaf-browser/request` - UWAF browser approval tokens for submit/research_batch
- `/api/workspace-tool/uwaf-browser/status` - UWAF connection status (Direct IP, Tor reachability, Tor exit info)
- `/api/workspace-tool/workspaces/[id]/files` - Workspace Files panel: list / write / rename / move / delete
- `/api/workspace-tool/workspaces/[id]/files/raw` - ETag-aware file reads
- `/api/workspace-tool/workspaces/[id]/files/upload` - Multipart upload (50 MB / 100 files)
- `/api/workspace-tool/workspaces/[id]/files/download` - Single-file download (RFC 5987 filename)
- `/api/workspace-tool/workspaces/[id]/files/zip` - Bulk zip download (500 MB / 500 files)
- `/api/workspace-tool/workspaces/[id]/events` - SSE stream of file-mutation events
- `/api/image-gen/search` - Hugging Face model search + detail
- `/api/image-gen/downloads` - Image model download queue (list / queue / start / pause / delete)
- `/api/image-gen/models` - ComfyUI health + model listing (checkpoints and diffusers)
- `/api/image-gen/generate` - Submit an image generation and persist the result as a Canvas artifact

### Database Models

- `ShellCommandAudit` stores WorkSpaces shell requests, target, approval mode, status, output, exit code, duration, allowed roots, and env allowlist for auditability.

- `User` - User accounts
- `ChatSession` - WorkSpaces task threads
- `ChatMessage` - Individual messages
- `UserSettings` - Per-user preferences
- `RagDocument` - Knowledge base files
- `RagChunk` - Document chunks for search
- `ImageModelDownload` - Persistent, resumable image-model download queue

## Internal Naming Note

The user-facing label is **WorkSpaces**. Internal identifiers still use the `workspace-tool` prefix for API routes, database schema fields, CSS classes, and tool tags (for example, `<workspace_tool>`). This is a legacy internal codename; external documentation and UI labels use WorkSpaces.
