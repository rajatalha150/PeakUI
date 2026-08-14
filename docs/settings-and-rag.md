# Settings and RAG Behavior

This document defines the production behavior for WorkSpaces, generation, and Knowledge Base settings.

## WorkSpaces and Generation Settings

WorkSpaces is the primary app shell. Generation settings are saved per user in `UserSettings` and normalized on both read and write through `/api/settings`.

### Provider Selection

- WorkSpaces provider settings are stored as `UserSettings.openClawProvider`, `UserSettings.openClawModel`, and `UserSettings.openClawBaseUrl`.
- The legacy `UserSettings.chatPlatform`, `UserSettings.chatModel`, and `UserSettings.chatModelProvider` fields remain in the database for schema compatibility but are no longer exposed in the WorkSpaces UI.
- WorkSpaces supports local Ollama and OpenAI-compatible providers.
- The saved model is provider-aware, so a duplicate model id on both platforms will still reopen against the correct source.
- Hugging Face or compatible-provider tokens are intentionally not stored in `UserSettings`. Browser-entered tokens stay only in browser storage.
- With the default Hugging Face router (`https://router.huggingface.co/v1`):
  - WorkSpaces requests use the OpenAI-compatible `/v1/chat/completions` endpoint
  - model discovery uses the router-native `GET /v1/models` endpoint
  - the router selects the fastest available provider by default unless the model id already carries a suffix such as `:fastest`, `:cheapest`, `:preferred`, or `:provider-name`
- With custom HF-compatible bases such as TGI, vLLM, or SGLang:
  - WorkSpaces requests still use the OpenAI-compatible chat-completions path
  - discovery first tries `/models`, then falls back to `/info` when available
  - if discovery is unavailable, Settings still allows manual model entry

### Local Model Lifecycle

- PeakUI does not send request-level `keep_alive` by default. Ollama's own lifecycle and queueing behavior control when local models stay resident or unload.
- Settings -> Generation keeps Model Keep Alive as an opt-in local Ollama tuning option with quick values (`5m`, `30m`, `1h`, `2h`) plus custom Ollama-style durations such as `10m` or `1h`.
- PeakUI does not send `keep_alive` to Ollama-hosted cloud model aliases such as `*:cloud`, nor when `Use Ollama Cloud API` is enabled, because those requests are remote and should not use local runner residency hints.
- Keep-alive applies to any model served by the local Ollama runner, including Hugging Face-hosted GGUF models (`hf.co/...`) that Ollama downloads and serves locally.
- PeakUI still does not issue background model warmup prompts.
- WorkSpaces exposes a `Stop model` button next to its local-model controls.
- That button unloads the currently selected local model through an authenticated app route so the next request starts from a fresh load.
- WorkSpaces reports startup phases separately so pre-stream delays are not all mislabeled as model warmup. Depending on the request, the user may see `Searching knowledge base...`, `Researching web...`, `Unloading other models...`, `Starting model...`, `Connecting to model...`, or `Generating...`.
- During streaming, WorkSpaces only auto-sticks to the bottom while the user is already near the latest message. If the user scrolls upward, generation continues without forcing the viewport down; a floating arrow returns to the newest message.
- The chat scroll observer is throttled through `requestAnimationFrame`, which reduces jumpy updates while streaming and keeps manual reading steadier on large answers.
- The WorkSpaces workspace rail is the only left-side navigation surface. It is collapsible on desktop and opens as a drawer on mobile.
- The rail now keeps deep workspace state controls behind one `Workspace controls` modal launcher so the session list stays taller.
- WorkSpaces task threads are paged in the rail at 15 sessions per page, with range labels plus Previous/Next controls for longer histories.
- Settings and Knowledge Base render inside the WorkSpaces shell instead of restoring a normal-chat sidebar.
- Logout is available from the Settings header.
- The authenticated `GET /api/ollama/health` route now reports whether Ollama is `online`, `degraded`, or `offline`, along with version, installed model count, loaded model count, loaded model names, and whether the currently selected model is already resident.
- WorkSpaces surfaces that health data in-app and provides one-click `Retry`, `Retry without web`, and `Stop + retry` recovery actions after a draft has been submitted.
- The Ollama health strip and `Stop model` control only appear when the currently selected model is actually running on Ollama.
- When the provider is local Ollama, WorkSpaces no longer performs the extra OpenAI-compatible-style verify round trip during routine model refresh/switch flows; it relies on model discovery and Ollama health for the local path.

### Model-Capacity Adaptation

- PeakUI detects each model's capacity (parameter size + native context window) via Ollama `/api/show` (cached 5 min per model, with name-based fallback) and adapts both the system prompt and the `num_ctx` window to it.
- **Prompt Detail Level** (`UserSettings.openClawPromptTier`): `auto` (default) picks the tier from the detected capacity; manual `minimal` / `compact` / `standard` / `full` overrides detection. Stored in `UserSettings.openClawPromptTier` and normalized on read/write through `/api/settings`.
- Tier mapping: `minimal` (≤4B), `compact` (≤9B), `standard` (≤30B), `full` (>30B or cloud). `minimal` drops the verbose core-protocol rules, recovery behavior, single-shot mode, and all document examples so the manifest fits a 2048-token window; `full` includes every document example.
- When `/api/show` reports a native context window, the default `num_ctx` is raised when the model comfortably allows it (≤9B → 8192 when native ≥ 8192; ≤4B → 4096 when native ≥ 4096) and both the default and the hard cap are clamped to the native window. The existing OOM backoff loop still steps down automatically if a raise is too aggressive for the GPU.
- Both interactive WorkSpaces chats and unattended automation runs honor the tier, so background runs no longer send a 17KB full prompt to an 8B model.

### Exclusive Ollama Switching

- Stored as `UserSettings.exclusiveOllamaModels`.
- Enabled from Settings → Generation.
- Before a local-provider WorkSpaces request starts, the backend calls Ollama `/api/ps`, identifies other loaded models, and unloads them with `POST /api/generate` plus `keep_alive: 0`.
- The `Stop model` button uses the same unload semantics, but targets only the actively selected local model when the user asks for a manual reset.
- This behavior is inspired by Open WebUI's explicit Ollama unload flow and is aimed at smaller VRAM systems where multiple resident models can block a new load.
- External OpenAI-compatible providers are unaffected.
- Hugging Face and other remote providers are unaffected.

### File Attachments

- **Upload limit**: 100 MB per file (configured via `MAX_UPLOAD_BYTES` in `src/lib/file-shared.ts`)
- **Image handling**: Images are handled vision-first. The browser keeps preview metadata, `/api/files/extract` can add OCR as supplemental context, and the chat request preserves image data, MIME type, and filename so the server can normalize unsupported still-image formats before calling Ollama.
- **Compatibility normalization**: HEIC/HEIF, TIFF, BMP, AVIF, and related still-image uploads are converted to JPEG for model compatibility. The server tries `sharp` first, then falls back to `heif-convert` or ImageMagick when the runtime codec support is needed.
- **Audio/video handling**: Audio/video uploads are classified by extension/MIME and attached as metadata-only until dedicated transcription or frame extraction is implemented.
- **Document extraction**: Non-image files are sent to `/api/files/extract` for text extraction using officeparser
- **Extraction pipeline**:
  - Office files (PDF, DOCX, PPTX, XLSX, RTF) → officeparser
  - Still images → vision payload + optional OCR text
  - Text files → direct read with charset detection
  - Unknown files → text extraction attempt with fallback to metadata-only
- **Attachment context**: Extracted text is prepended to the message with metadata header showing filename, MIME type, size, extraction status, and content preview

### AI Response Output

- **Inline images**: AI responses containing `![alt](data:image/...;base64,...)` syntax render as an inline image gallery
- **Image gallery**: Shows thumbnails with click-to-expand and download buttons
- **Code blocks**: Include copy-to-clipboard button with "Copied!" feedback
- **Response download**: Full response can be downloaded as text file
- **Generated file downloads**: Base64-encoded files embedded in responses appear as download buttons

## Internet Mode

- Enabled per browser session from the **Workspace modes** dropdown in the WorkSpaces desktop header or the WorkSpaces mobile overflow menu.
- Internet mode now runs as a backend-managed cited web-context lookup inside the shared chat pipeline.
- The backend performs the public search and page fetch work directly before the model starts, so Internet mode no longer depends on a local model deciding to call tools first.
- WorkSpaces, local Ollama, and OpenAI-compatible providers all use the same research path now.
- **Multi-engine search priority (v3):** The backend tries search engines in this order -- Google Programmable Search Engine (if GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX are configured), Brave Search API (if BRAVE_API_KEY is configured), SearXNG (if SEARXNG_URL is configured), DuckDuckGo HTML + Lite fallback parsers, and Bing as final fallback.
- **Query intelligence:** The user prompt is analyzed to generate 1-3 targeted search queries for broader coverage (e.g., comparisons get per-side queries, questions get stripped keyword variants).
- **Deep content extraction:** Pages are parsed through schema.org JSON-LD, Open Graph meta tags, and readability heuristics that score paragraphs by link density, length, and keyword filtering (drops nav/footer/ads) to extract article text while preserving structure.
- **Date extraction:** Publication dates are pulled from meta tags and JSON-LD so the model can reason about recency.
- **Retry logic:** Failed page fetches retry once with exponential backoff.
- **Higher context limits:** Up to 8 search results, 4 pages fetched, 3000 chars per excerpt, 12000 chars total context.
- **Strong citation prompt:** The system context instructs the model to cite every factual claim with inline [^N] markers. Frontend source chips are numbered [1], [2], etc., and inline citations render as clickable superscript links that open the original source URL in WorkSpaces.
- Search and page-fetch steps run with tighter per-request timeouts and inherit the active request abort signal, which keeps Researching web... from sitting on an unbounded pre-generation stall.
- The authenticated /api/web/context route uses that same backend-managed lookup path.
- Responses display clickable source chips for fetched web pages, reusing the same assistant citation area as Knowledge Base results.
- This phase is read-only. It does not control the user's browser, click pages, or use a browsing agent.

## Knowledge Base (RAG)

### Core Architecture

- Document storage, chunking, and retrieval are handled in Postgres with Prisma.
- Chunk embeddings are generated through Ollama's `/api/embed` endpoint using a designated embedding model.
- Query-time retrieval ranks chunks by cosine similarity or BM25 and injects the top matches as a prefixed system message so the model grounds answers in the retrieved text.
- Retrieved sources also carry file metadata such as filename, file kind, extension, file size, excerpt length, source path, and chunk index so the model knows whether it is reading a snippet or a full-document entry.
- The retrieval contract now explicitly tells the model that KB context is usually excerpt-based, but small files can be injected as full-document context when safe, and it can ask for a broader lookup or direct file inspection when the context is not enough.
- Folder uploads preserve relative paths, keep the uploaded tree intact in the index, and queue large drops in batches so the UI stays responsive during big project uploads.
- Uploaded PDFs, workbook files (`.xlsx`, `.xlsm`, `.xls`), and Word files (`.docx`, `.doc`) retain their original bytes in `Document.originalContent` so downstream workflows such as tax-template filling, workbook regeneration, or Word document regeneration can reconstruct the original files after text indexing completes. Other uploads remain text/index oriented and do not store original binary bytes.
- Query directives like `file:`, `folder:`, `type:`, and `ext:` are parsed into real KB filters, and the KB UI exposes the same filters for manual searching.
- Citations include chunk metadata so the frontend can render source chips and full-document drill-down previews, and the KB dashboard now includes a health panel that summarizes indexed, pending, failed, and warning files with reasons.
- The document list is server-paginated, supports configurable page sizes, multi-select, select-all, and bulk delete, and keeps source paths visible so folder uploads remain readable at scale.
- A OneDrive-style folder browser is available for users who organize uploads in folders. The browser shows breadcrumbs, immediate subfolders, files, a folder/file view toggle, sortable columns (name/size/createdAt/indexedAt/kind), and a kind filter. The folder tree is polled every 8s during uploads to keep counts fresh. The whole subtree of a folder can be deleted in one action via the "Delete folder" affordance. The `kb-folders.ts` library and `/api/rag/folders` endpoint are the source of truth; `kb-folders-server.ts` exposes a user-scoped tree summary that the chat completion path consumes as a system message so the model knows the corpus shape even when no chunks match a query.
- Per-turn Knowledge Base state (RAG toggle, search text, and citation set) is persisted to `ChatSession` (`ragEnabled`, `ragQuery`, `ragSourcesJson`) so a reopened chat restores the same RAG draft and the user does not have to re-enable RAG or retype the query. When RAG is disabled, the saved query and sources are dropped to prevent stale citations. The chat completion path also injects a "no matching chunks" hint when a search runs against the corpus but returns no context.
- **Vector search:** Semantic chunks now store embeddings in a `pgvector` `vector(1536)` column when the extension is available, falling back to JSON string embeddings in-memory if pgvector is not enabled. This keeps the same dimensionality across models; vectors are normalized to 1536 dimensions before storage or comparison.
- **Hybrid search:** Keyword results are fused with semantic results using weighted linear fusion plus reciprocal rank fusion. Results are then deduplicated (by exact chunk identity and Jaccard content similarity) and optionally re-ranked with MMR for diversity.
- **Background indexing queue:** Document indexing runs asynchronously after the HTTP response via `after()`. Each document tracks `indexingJobId`, `indexingProgress`, `indexingAttempts`, and `status`. Failed jobs retry up to a configurable maximum with exponential backoff; users can cancel a queued/processing job. Stuck processing documents are automatically marked stale after a timeout.
- **Model-change re-indexing:** When the RAG embedding model or mode changes in Settings, existing semantic documents whose stored model/dimensions no longer match are marked `queued` so the next upload or background sweep re-indexes them.
- **Health retry:** The `/api/health` endpoint probes Ollama with exponential backoff retries and reports whether the configured chat and embedding models are reachable.

### Chunking Strategy

- Small files under the safe whole-document threshold stay in a single chunk so they can be indexed and injected as full-document context instead of only as excerpts.
- Chunk size target: 1000 characters.
- Overlap: 200 characters between adjacent chunks to preserve context across boundaries.
- Minimum chunk size target: 200 characters to avoid tiny fragments.
- Chunk text is normalized before embedding: whitespace collapsed, control characters stripped.
- Documents are routed to document-aware boundary chunkers based on file kind:
  - **Markdown:** split on headings, preserving front-matter and fenced code blocks.
  - **Code:** split on function/class/struct boundaries when possible.
  - **CSV/TSV:** split on row boundaries, repeating the header in each chunk.
  - **JSON/YAML/XML/HTML:** preserve block indentation while falling back to paragraph boundaries.
  - **Plain text and long-form files:** paragraph/sentence boundary chunking with overlap.
- Every chunk stores extracted metadata: keywords, rule-based entities, section heading, summary, and chunk position.

### Semantic Mode

- Uses Ollama embeddings for semantic similarity search.
- **Recommended models**: `all-minilm`, `nomic-embed-text`, `embeddinggemma`, `snowflake-arctic-embed`, `mxbai-embed-large`, `nomic-embed-text-v2-moe`, `bge-m3`, `qwen3-embedding:0.6b`
- Production behavior:
  - The embedding model is configurable in Settings → RAG.
  - The settings UI surfaces both speed-first and higher-recall embedding suggestions so users can pick based on hardware and library size.
  - Documents are indexed immediately after upload.
  - Upload embedding is batched to reduce per-chunk overhead.
  - Query-time search only compares chunks indexed with the same normalized embedding model.

### Keyword Mode

Keyword mode uses local BM25-style text ranking.

Production behavior:

- No embedding model is required.
- No Ollama embedding call is made during upload or search.
- Documents are indexed immediately with nullable chunk embeddings.

### File Extraction Coverage

- PDFs are parsed page-by-page with PDF.js text extraction first, then OCR fallback is applied to sparse pages; if PDF.js cannot parse the file, `pdftotext` and full-document OCR remain fallback paths. The shipped container image installs `poppler-utils` and `tesseract-ocr` so scanned and mixed PDFs can be indexed instead of failing as metadata-only uploads.
- Image attachments are OCR'd when `tesseract` is available.
- Office documents are extracted with `officeparser`, with fallback handling for RTF and UTF-8 text-like files.
- Archives are unpacked with `7z` and each member is indexed recursively up to a safe depth and size limit.
- Structured data and code files are normalized with line-aware formatting so search results cite more useful chunks.

## WorkSpaces Workspace Behavior

- WorkSpaces now persists its agent-workspace preferences in browser storage, separate from server-side user settings.
- The persisted workspace preferences are:
  - task mode: `Plan`, `Research`, `Execute`, or `Review`
  - response style: `Concise`, `Structured`, or `Deep`
  - clarify-first toggle
  - workspace notes
  - success criteria
- Those preferences are converted into a workspace brief and injected into every WorkSpaces request as an additional system message.
- WorkSpaces also persists per-thread task state in browser storage:
  - objective
  - current status
  - next step
  - done criteria
  - editable pinned checklist
- That task state is converted into its own system-level task brief and injected into each WorkSpaces request alongside the workspace-preference brief.
- The pinned checklist can be built manually or imported from assistant bullet/numbered checklist output, then edited independently of the chat transcript.
- WorkSpaces's provider/session controls live in a dedicated left-side workspace rail on desktop, while model selection lives in the shared top bar.
- That rail can be collapsed on desktop without introducing a second app sidebar.
- The rail uses one main scroll container rather than a nested session-list scroller, which makes wheel/trackpad behavior more predictable.
- On mobile, the same top bar stays in place and the rail collapses into a drawer while preserving the active WorkSpaces session.
- If Knowledge Base or Settings is opened from the WorkSpaces rail, that panel renders inside the WorkSpaces shell so the selected task thread and WorkSpaces rail stay visible.
- When WorkSpaces calls shell or filesystem tools mid-turn, the tool result is fed back into the model as a hidden `user` message so the same task can continue naturally. This avoids the older behavior where some multi-step reviews stopped after the first tool call because the resumed conversation ended on a hidden `system` message instead of a real follow-up turn.
- Raw internal `<openclaw_tool>` bridge messages are stripped and hidden before session persistence/reload, which prevents malformed tool turns from rendering as visible assistant content or crashing the workspace on reopen.

### WorkSpaces Tool Permissions

- Shell execution defaults to `auto-approve` mode — safe commands execute immediately without a confirmation prompt. Network-capable commands (`curl`, `wget`, `npm install`, `git clone`, `docker compose up`) still require explicit approval. Dangerous commands (`sudo`, `rm -rf /`, `ssh`) are blocked outright.
- When Auto-continue is enabled, tool approval dialogs show a 4-second countdown and auto-approve unless the user clicks Reject. This lets the agent run multi-step tasks hands-free while still giving visibility into each command.
- Shell execution is stored in `UserSettings.shellExecutionMode`, `UserSettings.shellExecutionTarget`, `UserSettings.shellAllowedCommands`, and the host-executor guardrail settings.
- Filesystem read access defaults to `read-only` and is stored in `UserSettings.openClawFileAccessMode` plus `UserSettings.openClawAllowedPaths`.
- Filesystem write access defaults to `ask-first` and is stored in `UserSettings.openClawFileWriteMode` plus `UserSettings.openClawWritablePaths`.
- Code sandbox access defaults to `ask-first` and is stored in `UserSettings.openClawCodeExecutionMode`.
- Browser control access is stored in `UserSettings.openClawBrowserMode`.
- WorkSpaces' default writable workspace root is `~/.peakui/workspace`, which is mounted inside the app container at `/mnt/openclaw/workspace`.
- Shell commands run inside the app container by default with a 120-second timeout (host executor timeout is configurable up to 5 minutes).
- Code sandbox execution has a 60-second timeout and 256MB memory limit.
- If `UserSettings.shellExecutionTarget` is set to `host`, shell requests are forwarded to the optional host executor daemon at `OPENCLAW_HOST_EXECUTOR_URL` with `OPENCLAW_HOST_EXECUTOR_TOKEN`.
- Host execution is constrained by allowed working roots, environment-variable names, timeout, output caps, and approval mode.
- Host executor cwd checks now resolve approved roots and requested working directories through real paths before execution, so symlinked cwd paths cannot bypass the configured root boundary.
- If Host target is selected but the host executor is not configured or reachable, WorkSpaces falls back to the container executor and shows the fallback reason in the approval or blocked-command UI.
- Every shell command request/result is audited in `ShellCommandAudit`, including requested target, effective target, approval decision, fallback reason, exit code, duration, and output preview.
- Commands that fetch from the network, install packages, or start services such as `git clone`, `curl`, `wget`, `npm install`, `npx`, `docker run`, or `docker compose up` are intentionally not auto-approved and require explicit approval when shell access is enabled.
- Truly dangerous shell operations like `rm -rf /`, `sudo`, `ssh`, `mkfs`, and sensitive `/etc/passwd` or `/etc/shadow` access are blocked outright.
- Filesystem writes are constrained to approved writable roots and use full-content write/append semantics rather than shell patching.
- Filesystem denials return a machine-readable `code`, `actionRequired`, and current access diagnostics. This keeps the model from retrying the same blocked path and tells the operator whether to grant account permission, approve a root, add a Docker bind mount, or approve the pending write.
- Settings includes Host Access presets for safe workspace-only access, home-read/workspace-write access, and mounted-root audit mode. These presets keep writes workspace-only by default and leave shell execution in `ask-first`.
- Code execution runs only in the managed WorkSpaces workspace, with runtime guards, timeouts, and output caps.
- Browser control is limited to public `http` and `https` pages. Local/private targets, credentialed URLs, and non-standard ports are blocked. In `read-only`, WorkSpaces can inspect pages but cannot fill or submit forms.
- Every tool execution (shell, code, filesystem, browser, web) shows a live phase label during execution: `Running command...`, `Running code...`, `Reading filesystem...`, `Browsing page...`, or `Searching web...`. If a tool fails, the error becomes a model-visible message and the tool loop continues instead of crashing the session.

### File Attachments in WorkSpaces

WorkSpaces uses the shared attachment system:

- Paperclip button in the composer opens file picker
- Images sent as normalized image bytes to vision-capable models
- Per-image mode controls decide whether a given image is sent as `Vision only`, `Vision + OCR`, or `OCR only`
- Documents extracted to text via `/api/files/extract`
- Attachment preview chips with X to remove
- Processing state and error handling
- Send button works with just attachments (no text required)

### UWAF Stealth Runtime

- Stealth mode now uses a larger desktop fingerprint catalog instead of a tiny static UA list.
- Each stealth session randomizes coherent fingerprint surfaces such as locale, timezone, platform hints, hardware concurrency, device memory, viewport, screen, and WebGL identity.
- Browser feature exposure is normalized in the init script to reduce obvious automation combinations: webdriver is hidden, WebRTC constructors are removed, media capture is denied, plugin/mime-type state is normalized, and `navigator.userAgentData` / `navigator.connection` are made more coherent.
- Stealth Chromium launch args also disable QUIC and block non-proxy host resolution so a proxy bypass cannot silently fall back to direct DNS.
- Two stealth profiles now exist:
  - `normal`: broader diversity with lower compatibility risk
  - `high`: more conservative fingerprints and stricter Chromium flags for bot-heavier targets
- Normal stealth remains the default for broad dark-web searches. High stealth is selected automatically for `.onion`, hidden-service, and research-batch flows, or when a tool request explicitly asks for `stealthProfile: "high"`.
- Stealth preflight now also runs cached fingerprint-regression checks against known detector pages in addition to Tor, DNS leak, and WebRTC verification.
- The WebRTC/runtime verifier treats blank generic device enumeration as acceptable only when media capture is denied and WebRTC constructors are unavailable, preventing false failures from the intended stealth media-device shim.
- Stealth search no longer relies on only Ahmia. The provider layer can rotate across multiple stealth-safe search engines and scores them by recent uptime, latency, anti-bot friction, and result usefulness.
- `.onion` navigation validates onion hostnames before loading and runs the expensive diagnostic resolution pass only when navigation fails, so successful onion opens avoid duplicate page loads while failures still return precise Tor diagnostics.

Useful pull commands:

```bash
ollama pull nomic-embed-text
ollama pull mxbai-embed-large
ollama pull all-minilm
```

## Troubleshooting

- If Hugging Face-compatible mode shows no models while you are using the default router, add an HF token in Settings first. Router discovery uses the authenticated `GET /v1/models` endpoint and will not populate without credentials.
- If a Hugging Face router model works only when typed manually, the model may not have been returned by the current router listing or may require an explicit suffix like `:fastest`, `:cheapest`, `:preferred`, or a provider name.
- If a custom HF-compatible endpoint does not list models, type the model id manually in Settings and verify that the endpoint still supports OpenAI-style chat completions.
- If WorkSpaces shows a provider connection problem before sending a task, use its **Verify** button to test the configured Ollama or OpenAI-compatible endpoint directly.
- If Internet mode is on but no web chips appear, the lookup may have returned no readable public pages or the target may have been blocked by the public-network safety rules.
- If the health strip says `Ollama offline`, the app could not reach the configured Ollama host at all. Check the host value in Settings and verify the daemon with `ollama ps`.
- If the health strip says `Runner status limited`, Ollama itself is reachable but the loaded-model inspection call failed. Chat requests may still work, but resident-model visibility or stop/retry behavior may be incomplete until Ollama is healthy again.
- If a request takes a long time before tokens appear, check the phase label first. `Searching knowledge base...` means client-side RAG lookup is still running, `Researching web...` means Internet mode is still gathering sources, and `Starting model...` means the request has reached Ollama and is waiting for the model runner to begin streaming.
- If a weather/news/current-events prompt still feels thin, the search engine may have returned JS-heavy pages or low-signal snippets. The app now keeps search snippets even when some page fetches succeed, which makes short current-info prompts more reliable than the older all-or-nothing fetch path.
- If you want current-tab or browser-control behavior, that is not part of Phase 1. The shipped Internet mode is intentionally limited to read-only public web context.
- If an WorkSpaces shell task fails because a tool is missing, verify it inside the container rather than assuming host availability. The runtime image now includes `git`, `curl`, `wget`, `bash`, `tar`, and `unzip`, but commands still execute in the container context.
- If a WorkSpaces shell task expects `~/.peakui/workspace`, that path should resolve inside the container as an alias to `/mnt/openclaw/workspace`.
- If switching local models still fails under GPU pressure, enable **Exclusive Ollama Switching** so Ollama unloads other loaded models before starting the new one.
- If a model says pull required, run `ollama pull <model-name>`.
- If testing times out, Ollama may still be loading the model. Check `ollama ps`, then try again.
- If Semantic search returns no results after changing models, the existing documents may still be indexed for the old model. Open the KB dashboard and re-index them, or change the model in Settings to trigger automatic re-indexing for mismatched documents.
- If the KB health panel shows documents stuck in `processing`, wait for the background queue to retry or click Cancel and re-upload. Documents that stay processing longer than the stale timeout are automatically marked `queued` for retry.
- If `pgvector` is not enabled in Postgres, semantic search falls back to in-memory cosine over stored JSON embeddings. Performance is fine for small libraries but will degrade for large corpora; switch to the `pgvector/pgvector:pg15` image to enable native vector indexing.
- If a Knowledge Base upload fails immediately with a 413, the file exceeds the configured upload byte limit. Split the file or raise `MAX_UPLOAD_BYTES` / `MAX_UPLOAD_LABEL` if your deployment can handle it.
- If a document indexes in keyword mode even though semantic mode is selected, the embedding model at the configured Ollama host is unreachable or returned an error. The indexer falls back to keyword search so the file is still searchable.
- If memory pressure appears during generation, reduce Context Window before retrying.
- If WorkSpaces still fails with a model-memory error, the selected context window is probably larger than the host can fit. The app will auto-fit downward, but lowering the slider manually will make responses start faster.
- If you enable **Use Ollama default context**, WorkSpaces omits `num_ctx` entirely for local Ollama requests and lets the selected model use its own native default context window.
- If you enable **Use Ollama default temperature**, WorkSpaces omits the custom temperature entirely for local Ollama requests and lets the selected model use its own native default sampling temperature.
- If WorkSpaces reports a connection or socket failure to `http://127.0.0.1:11434`, verify the host service with `ollama ps` and `ollama run <model> "hello"`. If terminal requests also hang or reset, restart the Ollama service before debugging the app.
- If WorkSpaces reports that the Ollama runner crashed or a model stays wedged in load/backoff, use the in-app `Stop model` button or run `ollama stop <model>`, then inspect `journalctl -u ollama` for GPU/runtime details.

## References

- Ollama Embed API: https://docs.ollama.com/api/embed
- Ollama Chat API: https://docs.ollama.com/api/chat
- Ollama Embeddings capability: https://docs.ollama.com/capabilities/embeddings
- Ollama embedding models blog: https://ollama.com/blog/embedding-models
- Ollama context length: https://docs.ollama.com/context-length
- Hugging Face Inference Providers: https://huggingface.co/docs/inference-providers/en/index
- Hugging Face Chat Completion: https://huggingface.co/docs/inference-providers/tasks/chat-completion
