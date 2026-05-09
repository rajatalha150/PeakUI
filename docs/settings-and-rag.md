# Settings and RAG Behavior

This document defines the production behavior for the Chat and Knowledge Base settings.

## Chat Settings

Chat settings are saved per user in `UserSettings` and normalized on both read and write through `/api/settings`.

### Chat Platform Selection

- Stored as `UserSettings.chatPlatform`, `UserSettings.chatModel`, `UserSettings.chatModelProvider`, and `UserSettings.huggingFaceBaseUrl`.
- Main chat supports three platform modes:
  - `ollama`: only discover and use local Ollama chat models
  - `huggingface`: only discover and use Hugging Face router or HF-compatible endpoint models
  - `hybrid`: merge discoverable Ollama and Hugging Face models into one picker
- The saved default chat model is provider-aware, so a duplicate model id on both platforms will still reopen against the correct source.
- Hugging Face tokens are intentionally not stored in `UserSettings`. The token stays only in browser storage.
- With the default Hugging Face router (`https://router.huggingface.co/v1`):
  - chat requests use the OpenAI-compatible `/v1/chat/completions` endpoint
  - model discovery uses the router-native `GET /v1/models` endpoint
  - the router selects the fastest available provider by default unless the model id already carries a suffix such as `:fastest`, `:cheapest`, `:preferred`, or `:provider-name`
- With custom HF-compatible bases such as TGI, vLLM, or SGLang:
  - chat requests still use the OpenAI-compatible chat-completions path
  - discovery first tries `/models`, then falls back to `/info` when available
  - if discovery is unavailable, Hugging Face-only mode still allows manual model entry in Settings

### Local Model Lifecycle

- ViewLlama no longer sends request-level `keep_alive` overrides for Chat, local-provider Open Claw, or Ollama embedding requests.
- The app also no longer issues background model warmup requests.
- Ollama's own default lifecycle and queueing behavior now control when local models stay resident or unload.
- Chat and Open Claw both expose a `Stop model` button next to their local-model controls.
- That button unloads the currently selected local model through an authenticated app route so the next request starts from a fresh load.
- The chat views now report startup phases separately so pre-stream delays are not all mislabeled as model warmup. Depending on the request, the user may see `Searching knowledge base...`, `Researching web...`, `Unloading other models...`, `Starting model...`, `Connecting to model...`, or `Generating...`.
- During streaming, the chat views only auto-stick to the bottom while the user is already near the latest message. If the user scrolls upward, generation continues without forcing the viewport down; a floating arrow returns to the newest message.
- The main app sidebar and the Open Claw workspace rail are independently collapsible on desktop, and their collapsed state persists in browser storage.
- On desktop, Open Claw now uses the same chat-style top bar as normal chat, with the model picker and overflow menu moved out of the rail.
- On mobile, both surfaces keep that shared top bar and use a slide-out drawer instead of the desktop rail chrome.
- When Open Claw is active, the main app sidebar is hidden on desktop and the Open Claw rail becomes the only left-side navigation surface for that session.
- The authenticated `GET /api/ollama/health` route now reports whether Ollama is `online`, `degraded`, or `offline`, along with version, installed model count, loaded model count, loaded model names, and whether the currently selected model is already resident.
- Chat and Open Claw both surface that health data in-app and provide one-click `Retry`, `Retry without web`, and `Stop + retry` recovery actions after a draft has been submitted.
- The Ollama health strip and `Stop model` control only appear when the currently selected chat model is actually running on Ollama.

### Exclusive Ollama Switching

- Stored as `UserSettings.exclusiveOllamaModels`.
- Enabled from Settings → Chat.
- Before a local Chat or local-provider Open Claw request starts, the backend calls Ollama `/api/ps`, identifies other loaded models, and unloads them with `POST /api/generate` plus `keep_alive: 0`.
- The `Stop model` button uses the same unload semantics, but targets only the actively selected local model when the user asks for a manual reset.
- This behavior is inspired by Open WebUI's explicit Ollama unload flow and is aimed at smaller VRAM systems where multiple resident models can block a new load.
- External OpenAI-compatible providers are unaffected.
- Hugging Face and other remote providers are unaffected.

### File Attachments

- **Upload limit**: 100 MB per file (configured via `MAX_UPLOAD_BYTES` in `src/lib/file-shared.ts`)
- **Image handling**: Images are read as base64 and sent in the Ollama/OpenAI images array for vision-capable models
- **Document extraction**: Non-image files are sent to `/api/files/extract` for text extraction using officeparser
- **Extraction pipeline**:
  - Office files (PDF, DOCX, PPTX, XLSX, RTF) → officeparser
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

- Enabled per browser session from the Internet toggle in the main chat header and the Open Claw top bar.
- Internet mode now runs as a backend-managed cited web-context lookup inside the shared chat pipeline.
- The backend performs the public search and page fetch work directly before the model starts, so Internet mode no longer depends on a local model deciding to call tools first.
- Chat, Open Claw, local Ollama, and OpenAI-compatible providers all use the same research path now.
- **Multi-engine search priority (v3):** The backend tries search engines in this order -- Google Programmable Search Engine (if GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX are configured), Brave Search API (if BRAVE_API_KEY is configured), SearXNG (if SEARXNG_URL is configured), DuckDuckGo HTML + Lite fallback parsers, and Bing as final fallback.
- **Query intelligence:** The user prompt is analyzed to generate 1-3 targeted search queries for broader coverage (e.g., comparisons get per-side queries, questions get stripped keyword variants).
- **Deep content extraction:** Pages are parsed through schema.org JSON-LD, Open Graph meta tags, and readability heuristics that score paragraphs by link density, length, and keyword filtering (drops nav/footer/ads) to extract article text while preserving structure.
- **Date extraction:** Publication dates are pulled from meta tags and JSON-LD so the model can reason about recency.
- **Retry logic:** Failed page fetches retry once with exponential backoff.
- **Higher context limits:** Up to 8 search results, 4 pages fetched, 3000 chars per excerpt, 12000 chars total context.
- **Strong citation prompt:** The system context instructs the model to cite every factual claim with inline [^N] markers. Frontend source chips are numbered [1], [2], etc., and inline citations render as clickable superscript links that open the original source URL. This works in both Chat and Open Claw.
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
- Query directives like `file:`, `folder:`, `type:`, and `ext:` are parsed into real KB filters, and the KB UI exposes the same filters for manual searching.
- Citations include chunk metadata so the frontend can render source chips and full-document drill-down previews, and the KB dashboard now includes a health panel that summarizes indexed, pending, failed, and warning files with reasons.
- The document list is server-paginated, supports configurable page sizes, multi-select, select-all, and bulk delete, and keeps source paths visible so folder uploads remain readable at scale.

### Chunking Strategy

- Small files under the safe whole-document threshold stay in a single chunk so they can be indexed and injected as full-document context instead of only as excerpts.
- Chunk size target: 1000 characters.
- Overlap: 200 characters between adjacent chunks to preserve context across boundaries.
- Minimum chunk size target: 200 characters to avoid tiny fragments.
- Chunk text is normalized before embedding: whitespace collapsed, control characters stripped.

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

## Open Claw Workspace Behavior

- Open Claw now persists its agent-workspace preferences in browser storage, separate from server-side user settings.
- The persisted workspace preferences are:
  - task mode: `Plan`, `Research`, `Execute`, or `Review`
  - response style: `Concise`, `Structured`, or `Deep`
  - clarify-first toggle
  - workspace notes
  - success criteria
- Those preferences are converted into a workspace brief and injected into every Open Claw request as an additional system message.
- Open Claw also persists per-thread task state in browser storage:
  - objective
  - current status
  - next step
  - done criteria
  - editable pinned checklist
- That task state is converted into its own system-level task brief and injected into each Open Claw request alongside the workspace-preference brief.
- The pinned checklist can be built manually or imported from assistant bullet/numbered checklist output, then edited independently of the chat transcript.
- Open Claw's provider/session controls now live in a dedicated left-side workspace rail on desktop that replaces the main app sidebar while Open Claw is active, while model selection lives in the shared top bar.
- That rail can be collapsed without affecting the main app sidebar, and each surface keeps its own navigation context.
- On mobile, the same top bar stays in place and the rail collapses into a drawer while preserving the active Open Claw session.
- If Knowledge Base is opened from the Open Claw rail, the Knowledge Base dashboard renders inside the Open Claw shell so the selected task thread and Open Claw rail stay visible.
- If Knowledge Base is opened from the main app sidebar, the standard app sidebar remains visible instead.
- When Open Claw calls shell or filesystem tools mid-turn, the tool result is fed back into the model as a hidden `user` message so the same task can continue naturally. This avoids the older behavior where some multi-step reviews stopped after the first tool call because the resumed conversation ended on a hidden `system` message instead of a real follow-up turn.

### Open Claw Tool Permissions

- Shell execution defaults to `auto-approve` mode — safe commands execute immediately without a confirmation prompt. Network-capable commands (`curl`, `wget`, `npm install`, `git clone`, `docker compose up`) still require explicit approval. Dangerous commands (`sudo`, `rm -rf /`, `ssh`) are blocked outright.
- When Auto-continue is enabled, tool approval dialogs show a 4-second countdown and auto-approve unless the user clicks Reject. This lets the agent run multi-step tasks hands-free while still giving visibility into each command.
- Shell execution is stored in `UserSettings.shellExecutionMode`, `UserSettings.shellExecutionTarget`, `UserSettings.shellAllowedCommands`, and the host-executor guardrail settings.
- Filesystem read access defaults to `read-only` and is stored in `UserSettings.openClawFileAccessMode` plus `UserSettings.openClawAllowedPaths`.
- Filesystem write access defaults to `ask-first` and is stored in `UserSettings.openClawFileWriteMode` plus `UserSettings.openClawWritablePaths`.
- Code sandbox access defaults to `ask-first` and is stored in `UserSettings.openClawCodeExecutionMode`.
- Browser control access is stored in `UserSettings.openClawBrowserMode`.
- Open Claw's default writable workspace root is `/tmp/viewllama-openclaw-workspace`, which is mounted inside the app container at `/mnt/openclaw/workspace`.
- Shell commands run inside the app container by default with a 120-second timeout (host executor timeout is configurable up to 5 minutes).
- Code sandbox execution has a 60-second timeout and 256MB memory limit.
- If `UserSettings.shellExecutionTarget` is set to `host`, shell requests are forwarded to the optional host executor daemon at `OPENCLAW_HOST_EXECUTOR_URL` with `OPENCLAW_HOST_EXECUTOR_TOKEN`.
- Host execution is constrained by allowed working roots, environment-variable names, timeout, output caps, and approval mode.
- If Host target is selected but the host executor is not configured or reachable, Open Claw falls back to the container executor and shows the fallback reason in the approval or blocked-command UI.
- Every shell command request/result is audited in `ShellCommandAudit`, including requested target, effective target, approval decision, fallback reason, exit code, duration, and output preview.
- Commands that fetch from the network, install packages, or start services such as `git clone`, `curl`, `wget`, `npm install`, `npx`, `docker run`, or `docker compose up` are intentionally not auto-approved and require explicit approval when shell access is enabled.
- Truly dangerous shell operations like `rm -rf /`, `sudo`, `ssh`, `mkfs`, and sensitive `/etc/passwd` or `/etc/shadow` access are blocked outright.
- Filesystem writes are constrained to approved writable roots and use full-content write/append semantics rather than shell patching.
- Code execution runs only in the managed Open Claw workspace, with runtime guards, timeouts, and output caps.
- Browser control is limited to public `http` and `https` pages. Local/private targets, credentialed URLs, and non-standard ports are blocked. In `read-only`, Open Claw can inspect pages but cannot fill or submit forms.
- Every tool execution (shell, code, filesystem, browser, web) shows a live phase label during execution: `Running command...`, `Running code...`, `Reading filesystem...`, `Browsing page...`, or `Searching web...`. If a tool fails, the error becomes a model-visible message and the tool loop continues instead of crashing the session.

### File Attachments in Open Claw

Open Claw shares the same attachment system as main chat:

- Paperclip button in the composer opens file picker
- Images sent as base64 to vision-capable models
- Documents extracted to text via `/api/files/extract`
- Attachment preview chips with X to remove
- Processing state and error handling
- Send button works with just attachments (no text required)

Useful pull commands:

```bash
ollama pull nomic-embed-text
ollama pull mxbai-embed-large
ollama pull all-minilm
```

## Troubleshooting

- If Hugging Face mode shows no models while you are using the default router, add an HF token in Settings first. Router discovery uses the authenticated `GET /v1/models` endpoint and will not populate without credentials.
- If a Hugging Face router model works only when typed manually, the model may not have been returned by the current router listing or may require an explicit suffix like `:fastest`, `:cheapest`, `:preferred`, or a provider name.
- If a custom HF-compatible endpoint does not list models, keep the platform on `huggingface`, type the model id manually in Settings, and verify that the endpoint still supports OpenAI-style chat completions.
- If Open Claw shows a provider connection problem before sending a task, use its **Verify** button to test the configured Ollama or OpenAI-compatible endpoint directly.
- If Internet mode is on but no web chips appear, the lookup may have returned no readable public pages or the target may have been blocked by the public-network safety rules.
- If the health strip says `Ollama offline`, the app could not reach the configured Ollama host at all. Check the host value in Settings and verify the daemon with `ollama ps`.
- If the health strip says `Runner status limited`, Ollama itself is reachable but the loaded-model inspection call failed. Chat requests may still work, but resident-model visibility or stop/retry behavior may be incomplete until Ollama is healthy again.
- If a request takes a long time before tokens appear, check the phase label first. `Searching knowledge base...` means client-side RAG lookup is still running, `Researching web...` means Internet mode is still gathering sources, and `Starting model...` means the request has reached Ollama and is waiting for the model runner to begin streaming.
- If a weather/news/current-events prompt still feels thin, the search engine may have returned JS-heavy pages or low-signal snippets. The app now keeps search snippets even when some page fetches succeed, which makes short current-info prompts more reliable than the older all-or-nothing fetch path.
- If you want current-tab or browser-control behavior, that is not part of Phase 1. The shipped Internet mode is intentionally limited to read-only public web context.
- If an Open Claw shell task fails because a tool is missing, verify it inside the container rather than assuming host availability. The runtime image now includes `git`, `curl`, `wget`, `bash`, `tar`, and `unzip`, but commands still execute in the container context.
- If an Open Claw shell task expects `/tmp/viewllama-openclaw-workspace`, that path should resolve inside the container as an alias to `/mnt/openclaw/workspace`.
- If switching local models still fails under GPU pressure, enable **Exclusive Ollama Switching** so Ollama unloads other loaded models before starting the new one.
- If a model says pull required, run `ollama pull <model-name>`.
- If testing times out, Ollama may still be loading the model. Check `ollama ps`, then try again.
- If Semantic search returns no results after changing models, re-upload or re-index documents with the selected embedding model.
- If memory pressure appears during chat, reduce Context Window before retrying.
- If chat still fails with a model-memory error, the selected context window is probably larger than the host can fit. The app will auto-fit downward, but lowering the slider manually will make responses start faster.
- If chat reports a connection or socket failure to `http://127.0.0.1:11434`, verify the host service with `ollama ps` and `ollama run <model> "hello"`. If terminal requests also hang or reset, restart the Ollama service before debugging the app.
- If chat reports that the Ollama runner crashed or a model stays wedged in load/backoff, use the in-app `Stop model` button or run `ollama stop <model>`, then inspect `journalctl -u ollama` for GPU/runtime details.

## References

- Ollama Embed API: https://docs.ollama.com/api/embed
- Ollama Chat API: https://docs.ollama.com/api/chat
- Ollama Embeddings capability: https://docs.ollama.com/capabilities/embeddings
- Ollama embedding models blog: https://ollama.com/blog/embedding-models
- Ollama context length: https://docs.ollama.com/context-length
- Hugging Face Inference Providers: https://huggingface.co/docs/inference-providers/en/index
- Hugging Face Chat Completion: https://huggingface.co/docs/inference-providers/tasks/chat-completion
