# Changelog

All notable changes to PeakUI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Image generation (ComfyUI engine)

PeakUI can now generate images through a self-hosted **ComfyUI** engine that runs alongside Ollama (Ollama does not support image generation). The `image_generation` tool turns a text prompt into an image that renders inline in chat and is downloadable as a Canvas artifact.

- **Engine**: ComfyUI runs on the host at `http://127.0.0.1:8188`; its `models/` directory is mounted into the app container at `/mnt/comfyui/models`.
- **Settings → Image Generation**: engine URL, selected model, and an optional Hugging Face token (for gated models).
- **Hugging Face search + download**: search text-to-image models, with results classified by file layout (`checkpoint` / `diffusers` / `collection` / `unknown`). Only genuinely-downloadable models get a download button. Downloads are resumable (HTTP Range) with persistent state, live progress, and pause/resume/delete.
- **Diffusers support**: folder-based models (`unet/` + `vae/` + `text_encoder/`) download as multiple files into `models/diffusers/` and generate via ComfyUI's `DiffusersLoader`.
- **Generation**: the `image_generation` tool is advertised only when the engine is configured and a model selected; the "Image Gen" mode toggle gates it. Generated images are fetched server-side, persisted as Canvas artifacts, and returned as absolute URLs (honoring `x-forwarded-host`/`proto`) so they render inline and download correctly.
- **New routes**: `/api/image-gen/search`, `/api/image-gen/downloads`, `/api/image-gen/models`, `/api/image-gen/generate`.
- **New schema**: `ImageModelDownload` table (persistent download queue) + `imageGenProvider`/`imageGenBaseUrl`/`imageGenModel`/`hfToken` settings.

### Added — In-flight model tracking (GPU arbiter)

PeakUI has two GPU consumers — the chat model and the embedding model — that share one GPU. New `src/lib/ollama-inflight.ts` tracks which models are actively streaming a response or computing an embedding, so the exclusive-model unload never evicts a model mid-flight (which would fail the in-flight request):

- `beginModelUse(model, kind)` returns a release function; the chat pipeline wraps the whole stream and the RAG embedding path wraps each embedding call.
- `unloadOtherOllamaModels` skips any model that is currently in use, unloading only the genuinely idle ones.
- The registry is refcounted, so concurrent requests on the same model keep it resident until the last one ends.

This is the PeakUI analogue of Unsloth's keep-warm middleware: a cheap, invisible bookkeeping layer that makes model eviction safe on a single-GPU box. 5 new tests in `src/lib/ollama-inflight.test.ts`.

### Added — Multi-format tool-call parser

Local GGUF models often emit their own native tool-call syntax instead of the custom `<workspace_tool>` wrapper, and the old parser rejected all of them — the single biggest source of tool-call failures on local models. `src/lib/workspace-tool-tools.ts` now recognizes and normalizes the common model-native formats to the same request shape, so per-tool validation runs unchanged:

- Qwen / Hermes `<tool_call>{"name","arguments"}` (tolerates a missing close tag)
- Anthropic `<invoke name><parameter>` (standalone or nested in `<function_calls>`)
- Llama-3 `<|python_tag|>NAME.call(k=v)`
- Mistral `[TOOL_CALLS] [...]` / `name{json}` / `name[ARGS]{json}`
- Gemma 4 `<|tool_call>call:NAME{json}`
- GLM 4.5-4.7 `<tool_call>NAME<arg_key>/<arg_value>`
- Qwen3.5 XML `<function=name><parameter=k>v</parameter>`

`stripAllToolTags` also strips every format (including closing tokens) so raw markup never leaks into the visible transcript. 20 new tests in `src/lib/workspace-tool-foreign-formats.test.ts` cover parsing, truncation tolerance, unknown-name rejection, and per-tool validation. See `docs/tool-call-formats.md`.

### Added — Bundle budget gate, streaming stall budget, model device-fit check

Three practices adopted from Unsloth to keep PeakUI premium and smooth:

- **Bundle budget gate** (`scripts/check-bundle-budget.mjs` + `npm run bundle:check`, wired into CI): measures the JS the browser downloads/parses before first paint and fails the build if it exceeds a hard budget, catching accidental static imports of heavy client libs into the entry bundle.
- **Streaming-render stall budget** (`src/app/components/AssistantContent.stall.test.ts`): locks in a budget for the pure markdown parser so a superlinear regression (the "transition starvation" that freezes the chat bubble during streaming) fails CI.
- **Model device-fit check** (`classifyModelFit` in `src/lib/model-context.ts`): flags models that won't fit the GPU's free VRAM, and annotates the model picker with size + `may not fit GPU` / `tight on GPU`.

### Changed — Renamed the "OpenClaw" surface to the generic "workspace-tool"

The internal agent/tool surface was branded "OpenClaw" (wire tag `<openclaw_tool>`, API routes `/api/openclaw/*`, `OpenClaw*` types, `openClaw*` settings columns, `OPENCLAW_*` env vars, and ~40 `openclaw-*.ts` filenames). It is now the generic **`workspace-tool`** name throughout:

- **Wire protocol** — the model-facing tag is now `<workspace_tool name="...">` (parser regexes, prompt, and all examples).
- **API routes** — `/api/openclaw/*` → `/api/workspace-tool/*` (30+ route files + directory), and every frontend `fetch()` call.
- **Code identifiers** — `OpenClaw*` → `WorkspaceTool*`, `openClaw*` → `workspaceTool*`, `OPENCLAW_*` → `WORKSPACE_TOOL_*`, and the `'openclaw'` surface string → `'workspace-tool'`.
- **Filenames** — 42 files (`openclaw-*.ts` → `workspace-tool-*.ts`, `OpenClawWorkspace.tsx` → `WorkspaceToolWorkspace.tsx`, `scripts/openclaw-host-executor.mjs` → `workspace-tool-host-executor.mjs`).
- **Env vars** — `OPENCLAW_HOST_*` → `WORKSPACE_TOOL_HOST_*` (`.env.example`, compose files, Dockerfile, host-executor script, and all code).
- **Prisma schema** — all ~40 `openClaw*` columns renamed to `workspaceTool*`; new migration `20260823_rename_openclaw_to_workspace_tool` uses `ALTER TABLE ... RENAME COLUMN` (data-preserving) plus an `UPDATE ChatSession SET surface='workspace-tool' WHERE surface='openclaw'`. Historical migrations are left untouched.

> **Breaking for existing deployments:** the `OPENCLAW_HOST_*` env vars are renamed to `WORKSPACE_TOOL_HOST_*`. Update any live `.env` / host-executor setup accordingly.

### Changed — Compact document-tool examples + query-gated `full` tier

The document-generation tools each carried a huge multi-line JSON example blob (the PDF one alone was ~1,200 chars), and the `full` prompt tier emitted all of them unconditionally. Both are now trimmed:

- **Removed the 14 verbose example constants** (`WORKSPACE_TOOL_*_DOCUMENT_TOOL_EXAMPLE`) from `workspace-tool-tools.ts`. `buildCapabilityPromptLines` now emits a compact one-line example built from each capability's existing `signature` field, so the model still sees the exact tool name + field shape without the fully-populated sample data.
- **`full` tier now query-gates document examples** (same as `standard`), instead of emitting every tutorial regardless of query. Only `minimal` keeps the empty-set behavior.

Measured system-prompt size for a small local model (all tools enabled): `full` idle dropped from ~31,357 → ~20,294 chars (~35% smaller), and only pulls in the relevant document tutorial when the query signals document intent.

### Fixed — Model loads slowly on small GPUs (keep-alive + context guidance)

Local models were "taking forever to load" because the selected model was larger than the free VRAM (Ollama offloads layers to CPU), keep-alive was short, and "use model default context" forced a large KV cache. See `TROUBLESHOOTING.md` for the full diagnosis and remediation (pick a model that fits the GPU, raise keep-alive, lower context).

### Fixed — Model reaches for shell+curl instead of the web tool for current data

For queries like "analyze pltr", the model improvised with `shell` + `curl` to scrape finance/news pages and got nothing back, because those sites are JavaScript-rendered. Two gaps caused it: (1) nothing in the prompt told the model *when* to pick `web` over `shell`, and (2) "analyze pltr" didn't match the `internet` intent keywords, so the full web-research instructions were never emitted (only a one-line "WEB RESEARCH: available" note).

- **Always-on `TOOL SELECTION` routing block** in `buildWorkspaceToolSystemPrompt`, emitted in every tier (including `minimal`), pinning the intent→tool mapping: current/external info → `web` (with an explicit "NEVER use shell with curl/wget to scrape a page" rule), local-machine facts → `filesystem`/`shell`, navigation/JS/forms/login → `browser`/`unified_browser`, running code → `code` sandbox.
- **Expanded `internet` intent keywords** (`stock`, `ticker`, `price`, `quote`, `market`, `analyze`, `analysis`, `earnings`, `financial`, `weather`, `statistics`, `stats`) so market-data and analysis queries trigger the full web-research instructions.

### Fixed — Clipboard copy on non-secure contexts (whole chats + messages)

`navigator.clipboard.writeText` is only available in secure contexts (HTTPS or `localhost`). When PeakUI was accessed over plain HTTP on a LAN IP, every copy button — copy whole chat, copy message, code blocks, shell output, Canvas artifacts, and workspace-file paths — silently failed (or threw). A shared `copyToClipboard` helper (`src/lib/clipboard.ts`) now falls back to the legacy `document.execCommand('copy')` textarea trick when the Clipboard API is unavailable, and all copy sites route through it.

### Fixed — Small local models hallucinate tool names and fields

Small local models (`minimal`/`compact`/`standard` prompt tiers) had their verbose tool tutorials trimmed to fit the context window, but the trimmed prompt left only the human *label* of each tool ("browser", "PDF generation") — never the actual tool `name` (`name="browser"`) or the JSON field names (`action: "open"`, `url`). The result was malformed calls like `browser {"action":"open_url","query":"..."}` (wrong action, wrong field, bare JSON with no wrapper), followed by "I described the next step but never emitted the matching tool block."

- **Always-on compact tool manifest** — `buildWorkspaceToolSystemPrompt` now emits a `TOOL MANIFEST` block in *every* tier (including `minimal`), listing each active tool's exact `name` and one-line JSON signature (`web {"query":"..."}`, `shell {"command":"..."}`, `browser {"action":"open","url":"..."}`, `pdf_document {"title":"..."}`, etc.). The core tools (shell/filesystem/code/browser/unified_browser/web) are enumerated inline from the existing availability flags; the document-generation tools come from new `signature` fields on each `WORKSPACE_TOOL_CAPABILITIES` entry.
- **New `listCapabilitySignatures`** in `src/lib/workspace-tool-capabilities.ts` exports the compact JSON signatures alongside `listActiveCapabilityLabels`.

### Added — Universal model-capacity-aware prompt & context adaptation

Small local models were producing malformed tool calls and truncated responses because the WorkspaceTool system prompt ate most of the `num_ctx` window. gemma4 (an 8B model) got the "compact" manifest (~2,370 tokens) at 4096 `num_ctx`, leaving almost no room for conversation + response. The fix is universal: PeakUI now detects each model's capacity (parameter size + native context window) and gives it the prompt and window accordingly — for 4B, 9B, 30B, 100B, and cloud models alike, with a manual setting as a fallback.

- **`getModelCapacityProfile` in `src/lib/model-context.ts`** — async, cached 5 min per model, queries Ollama `/api/show` (handles BOTH API shapes: old `details.parameter_size` + `model_info["<family>.context_length"]`, new `general.parameter_count` + `general.context_length`), falls back to name-based heuristics on any failure. Returns `{ parameterSizeB, nativeContextLength, isCloud, promptTier, recommendedContext, maxContext }`. Non-Ollama providers get the cloud profile immediately without a fetch.
- **Graduated prompt tiers** — `PromptTier = 'minimal' | 'compact' | 'standard' | 'full'` (≤4B / ≤9B / ≤30B / >30B; cloud → full; unknown → compact). `workspace-tool-prompt.ts` replaced the binary `toolManifestMode` with `promptTier`: `minimal` drops core-protocol rules 4-9 + RECOVERY + CLEAR-GOAL + NO FAKE STACK PIVOTS + all document examples (~6.5KB); `compact` = the old compact manifest (~9.5KB); `standard` = the old full manifest (~17KB); `full` = the old full manifest + ALL document examples (~26.8KB).
- **Native-context rules** — when `/api/show` reports a native window, the default is raised when the model comfortably allows it (≤9B → 4096→8192 when native ≥ 8192; ≤4B → 2048→4096 when native ≥ 4096) and both values are clamped to the native window (rounded to a multiple of 512). Safe because the existing `isContextMemoryError` retry loop backs off on OOM.
- **New `workspaceToolPromptTier` setting** — `auto` (default; picks the tier from the detected capacity) or a manual override (`minimal` / `compact` / `standard` / `full`). Wired through `src/lib/settings.ts`, `/api/settings`, the SettingsPanel "Prompt Detail Level" select, and a new Prisma column (`20260813_add_workspace-tool_prompt_tier` migration).
- **Both prompt callers pass the tier** — `chat-completion.ts` fetches the profile before the prompt build and threads it into `buildContextCandidates` (so gemma4's `num_ctx` candidates become `[8192, 4096, 2048, 1024, 512]` instead of `[4096, ...]`); `workspace-tool-automation-execution.ts` does the same for unattended runs.
- **Measured on a reference host:** gemma4 = 8.0B / native 131072 → compact tier with ~5,125 tokens of response headroom (was ~1,000); nemotron-3.5-lightning = 32.9B → full; muse-glimmer = 27.9B → standard.

### Changed — Session intelligence is now fully data-driven

`src/lib/session-intelligence.ts` was refactored from a chain of `if` statements into rule tables + loops, so behavior is declarative and easy to extend:

- `TOOL_RESULT_PREFIXES` (tool-result summarization), `USER_MESSAGE_RULES` / `ASSISTANT_MESSAGE_RULES` (memory classification), `TASK_STATE_RULES` (task-state extraction), and `legacyRules` (legacy memory parsing, catch-all default) replace the old if-chains.
- Perf: `computeSessionAnalytics` is single-pass (was 5 filter passes), `uniqueLines` is Set-based (was O(n²) `indexOf`), `applyContextManagement` counts non-system messages in one loop. Dead `summarizeMessage` removed.
- Benchmark on a 200-message session: sub-millisecond before AND after (0.33/0.60/0.05ms vs 0.34/0.61/0.04ms) — this is a code-quality win, not a latency win; the JS side was already negligible.

### Changed — Document tool structure is a recommendation, not a requirement

Small local models kept failing the document tools with "content, sections, fields, tables, or callouts are required" because they sent `{title, description}`-only requests. All six tools now accept a title alone (optionally with a description) and still produce a valid file:

- **`word_document`** — the parser in `workspace-tool-tools.ts` now requires only `title`; `word-document/route.ts` no longer 400s on an empty structure and promotes `description` → `content` so a title-only request still renders a valid `.docx`.
- **`pdf_document`** — the identical fix: parser requires only `title`, `pdf-document/route.ts` promotes `description` → `content` instead of 400ing.
- **`markdown_document`** — parser requires only `title`; `markdown-document/route.ts` falls back to the `description` as the body, then to a `# title` heading.
- **`csv_document`** — parser requires only `title`; `csv-document/route.ts` falls back to the `description` as the body, then to the title as a single cell.
- **`email_document`** — parser requires at least one of `subject`/`body`/`title`/`description`; `email-document/route.ts` defaults the subject from the title and the body from the description.
- **`workbook_document`** — parser requires only `title`; `workbook-document/route.ts` synthesizes a single "Notes" sheet from the description (or title) lines when no sheet has rows.
- **Capability prompts** (`workspace-tool-capabilities.ts`) now tell the model the full structure is recommended but not required — a title with a simple content string (or just a title and description) is sufficient.

### Changed — Themed PDF renderer

`src/lib/pdf/rich-document-pdf.tsx` was upgraded so structured PDFs render as polished, professional documents:

- Per-template accent palettes (report / memo / letter / invoice / checklist / form each get a primary + soft + border color).
- Accent-colored eyebrow + header rule, section headings with an accent bar, zebra-striped tables with tinted headers, callouts with tone labels (NOTE / WARNING / SUCCESS) and colored left borders, and field grids with a tinted label column.
- The capability prompt now says structured documents render as polished professional PDFs, and the `WORKSPACE_TOOL_PDF_DOCUMENT_TOOL_EXAMPLE` was expanded to show `fields` + `callouts`.

## [Unreleased]

### Changed — WorkSpaces tool-calling robustness (long-session stalls, loops, wrong-format recovery)
- **Within-turn tool-result compaction (the big one):** the agent loop resends the full `sessionHistory` to the model on every round, and tool results are stored as hidden `role: 'user'` messages up to 6000 chars each. On a long browsing/shell session the context grew ~10k+ chars/round, and local models degrade in tool-call format adherence as the context balloons — the root cause of "tool calls get worse as the session grows." New `src/lib/workspace-tool-context-compaction.ts` runs a pure, storage-agnostic `compactStaleToolResults` pass at resend time (`WorkspaceToolWorkspace.tsx` builds `conversationMessages` from it): it keeps the 4 most-recent tool results in full and replaces only the *bodies* of older large results (≥1500 chars) with a compact stub that preserves the identifying metadata (header, command, path, status, exit code, …). Storage and the user-visible transcript are untouched — only what is resent to the model shrinks. Small results (errors, stat metadata) are left intact. `trimMessagesToFit` still runs afterward as the hard eviction; compaction is the softer, tool-aware pass that runs first.
- **Cycle-detection loop guard:** `lastToolRequestSignature` only caught an immediate A→A repeat, so an A→B→A→B ping-pong (the loop shape seen in real browsing transcripts) slipped past it. Added a 6-entry `recentToolSignatures` ring alongside the existing immediately-previous check; a repeat of any recent signature now trips the duplicate guard with a "you are looping" notice and breaks the cycle instead of bouncing until the iteration cap. Immediate-repeat behavior (A→A→A breaks on the third) is unchanged.
- **Malformed-wrapper nudge:** when the model emitted a foreign SDK tool-call format (Anthropic `<function_calls>`/`<invoke>`/`<parameter>`, `<antml:function_calls>`, `<tool_use>`, `<tool_call>`, or Qwen `<|tool_call|>`/`<|im_start|>`/`<|end_of_turn|>` tokens) instead of the `<workspace_tool>` wrapper, `stripAllToolTags` removed it and the runtime nudged generically — so the model usually re-emitted the same wrong format and burned the nudge budget. New `detectMalformedToolWrapper` (in `workspace-tool-tools.ts`) names the exact offending format and `buildMalformedWrapperNudgeText` (in `workspace-tool-narration-nudge.ts`) tells the model precisely what it did wrong and shows the one correct shape, breaking the second-attempt loop.
- **Financial-research recovery catalog:** `KNOWN_SITE_PAGES` (and the lockstep nudge `PAGE_NAME_PATTERNS`) now cover stockanalysis.com, marketbeat.com, and finance.yahoo.com, so prose like "open the PLTR forecast page" now recovers a real `unified_browser open` instead of stalling. Ticker is extracted from the prose (falling back to the prior URL), and MarketBeat's exchange-scoped `/stocks/{EXCHANGE}/{TICKER}/` path is rebuilt only from the prior URL's exchange — so recovery never dispatches a fabricated URL for a ticker/exchange it didn't actually see (returns null → falls to the nudge when the prior page has no exchange). The nudge pre-fill for the new `/stocks/T/…` shapes is site-scoped to stockanalysis so it can't pre-fill a wrong-shaped URL on Yahoo (`/quote/`) or MarketBeat.
- **Prompt: hoisted tool-call protocol (no content removed):** local models attend most to the first lines of the system prompt, and the most-violated rule was that the model narrated an action ("Let me search…") and stopped without the wrapper. A compact, high-signal TOOL CALL PROTOCOL block with a concrete positive/negative example and the "use real values, never copy `<value>`/`<https URL>` placeholders" + "no other SDK format" rules is now pinned to the very top of `buildWorkspaceToolSystemPrompt`. This is reinforcement only — the detailed primer and every existing line further down are unchanged, so no capability or strength is lost.
- **Non-breaking by construction:** correct tool calls are untouched; the parser only rejects more garbage, recovery only catches more prose, compaction only shrinks what is resent, and the loop guard only catches more cycles. Existing tool flows are unaffected.
- **Tests:** +30 tests across `workspace-tool-context-compaction.test.ts` (11), `workspace-tool-tools.test.ts` (8 for `detectMalformedToolWrapper`), `workspace-tool-narration-recovery.test.ts` (6 for financial-site recovery), and `workspace-tool-narration-nudge.test.ts` (5 for the malformed-wrapper nudge + financial pre-fill symmetry). `npx tsc --noEmit`, `npm test` (565 tests), and `npm run build` all pass.

### Fixed — WorkSpaces tool-call stalls (narration loop, placeholder crashes)
- **Root cause:** when the model narrated an imminent tool action in prose but never emitted a valid `<workspace_tool>` wrapper, the run stalled through a 2-attempt nudge loop and then a "Reply continue" pause — the failure the user saw as "crashes when it calls for tools." Three distinct modes: (A) silent stop when `detectMissingToolIntent` didn't flag longer narration, (B) nudge loop when recovery failed because the prose had no full `https://` URL (only a bare domain or page name), and (C) a dispatch loop when the model copied the nudge's `<https URL>` / `<value>` placeholder verbatim and the parser accepted it as a real field value, dispatching a browser `open` to the literal string `<https URL>`.
- **Template-placeholder guard:** `extractWorkspaceToolRequest` now rejects field values that are entirely an angle-bracketed template token (e.g. `<https URL>`, `<value>`, `<command to run>`, `<what to inspect>`) via a new `cleanFieldValue`/`isTemplatePlaceholder` helper, applied to the required string fields of `web`, `shell`, `code`, `browser`, `unified_browser`, `fetch_summarize`, and `filesystem` (including `linkText`, `text`, `selector`, `key`, and write `content`). A copied placeholder now routes to the example-free "malformed" nudge instead of dispatching a broken call. Conservative regex (`/^<[a-z][a-z0-9 _.\-]*>$/i`) keeps real values like `<App />` and HTML/JSX code intact.
- **Bare-domain URL promotion:** prose recovery (`parseToolIntentFromProse` in `workspace-tool-tools.ts` and `synthesizeUnifiedBrowser` in `workspace-tool-narration-recovery.ts`) now promotes a bare domain / domain+path (`stockanalysis.com`, `marketbeat.com/stocks/NASDAQ/PLTR/forecast/`) to `https://` via a shared `normalizeUrlToken`, so narration like "open stockanalysis.com for the PLTR forecast" recovers a real `unified_browser open` instead of stalling. Full `https://` URLs still work unchanged; non-domain tokens still fall through.
- **No behavior change for correct calls:** a well-formed wrapper with real values is untouched; the parser only *rejects more* garbage and recovery only *catches more* prose. Existing tool flows (search, open-with-real-URL, documents, filesystem, shell) are unaffected.
- **Tests:** new placeholder-guard cases (6) and bare-domain-promotion cases (4 in `workspace-tool-tools.test.ts`, 3 in `workspace-tool-narration-recovery.test.ts`) lock in the behavior, including a regression that `<App />` in `code` is preserved while `<https URL>` in `unified_browser` is rejected. `npx tsc --noEmit`, `npm test` (535 tests), and `npm run build` all pass.

### Fixed — WorkSpaces session list load latency (20-30s on every refresh)
- **Root cause:** `GET /api/chats` (`listChatSessions`) used `include` with no `select`, so it fetched the full `messages` transcript blob for **every** session and ran `JSON.parse` + `normalizeStoredChatMessages` over every message of every session just to render the sidebar. No pagination, no caching — so the full parse cost was paid on every page refresh, which is why the chat list took 20-30s every time (not just cold start).
- **Lean list projection:** `listChatSessions` now uses an explicit `select` that omits only the heavy `messages` column. Small/capped columns (`summary`, `contextSummary`, `contextSummaryUpdatedAt`, `analyticsJson`, `ragSourcesJson`) are still selected so sidebar features (analytics pill, working-memory status, summary) render without a per-session detail fetch. List rows return the same `ChatSessionDto` shape with `messages: []`.
- **Lazy transcript loading:** added `GET /api/chats/[id]` (calls the existing `getChatSessionById`) so the active session's transcript is fetched on demand when a session is opened or switched to, instead of being bundled into the list response. A `sessionDetailCache` hydrates the in-memory sidebar row so re-selecting, copy-to-clipboard, and branch-compare don't refetch.
- **De-serialized init path:** the mount effect previously awaited `Promise.all([loadSettings, loadFolders, loadChatTags])` **then** `loadSessions` (a regression from `167d8b0`). Sessions are independent of the metadata triple, so all four now fan out together in one `Promise.all`, cutting the gate that held the chat list behind the slowest metadata call.
- **Per-call retry instead of wholesale:** a single transient failure no longer re-fetches all four init endpoints. Each call is wrapped in a `withRetry` helper (3 attempts, `500 * attempt` backoff) so only the failing call retries.
- **Fail-fast fetch timeouts:** the four init fetches (`/api/settings`, `/api/folders`, `/api/chat-tags`, `/api/chats`) and the single-session fetch now use `AbortSignal.timeout(10s)` so a hung request fails into the retry path instead of waiting on the browser default. The retry helper treats `TimeoutError`/`AbortError` as retryable.
- **Data-loss guard:** `updateCurrentThreadMemory` (clear/refresh working memory) previously PATCHed `currentSession.messages`, which is now `[]` on the lean row — it would have wiped the server transcript. It now uses the live `chatHistory` state, the authoritative transcript for the active session.
- **Race guard:** a `activeSessionLoadRef` token ensures a slow transcript response from a previously-selected session cannot overwrite the chat history of the session the user actually switched to.
- **No redundant re-parse on writes:** the session write paths (`upsertChatSession`, `updateChatSession`, `finalizeChatSession`, `branchChatSession`) used to re-read the just-saved row and `JSON.parse` + re-normalize its `messages` transcript to build the returned DTO. They now thread the already-normalized in-memory messages through `mapSessionRows` via a `messagesOverride` map, so a save returns its DTO without an extra DB round-trip or transcript re-parse. Output is byte-identical (re-parsing the serialized string yields the same normalized array); only the redundant work is dropped. `branchChatSession` also drops its post-create `getChatSessionById` re-read by reusing the source session's already-loaded tags.
- **Tests:** `src/lib/chat-sessions-lean.test.ts` (5 tests) locks in the lean projection (`listChatSessions` omits `messages` and returns `messages: []`; `getChatSessionById` returns the full transcript; ownership check returns null for other users) and the write path (an `upsertChatSession` create returns the in-memory messages with no follow-up `findUnique`). `npx tsc --noEmit`, `npm test` (521 tests), and `npm run build` all pass.

### Added — Ollama Cloud API mode
- Settings can now switch Ollama from the default local endpoint (`http://127.0.0.1:11434`) to `https://ollama.com/api` with a per-user API key.
- Cloud mode routes chat, model discovery, health checks, model stops, session summaries, vision capability probes, RAG embeddings, and embedding-model tests to Ollama Cloud with an `Authorization: Bearer <key>` header.
- The API key is stored server-side in `UserSettings.ollamaApiKey` and redacted (returned as an empty string) from every `/api/settings` response (GET and POST) so the browser never receives the real key.
- Settings shows `ollama.com` in the host field when cloud mode is enabled.

### Changed — Ollama Cloud compatibility
- `/api/ps` (local-only running-models) probes, running-model diagnostics, and exclusive-model unloading are skipped when `ollamaUseCloudApi` is true. Ollama Cloud returns 401 for `/api/ps`; PeakUI now avoids that endpoint entirely in cloud mode.
- Affected routes: `/api/ollama/health`, `/api/workspace-tool/verify`, `/api/rag/test-embed`, and the `unloadOtherOllamaModels` path in `src/lib/chat-completion.ts`.

### Documentation
- `docs/features.md` expanded with Ollama Cloud API, local-only endpoint, and cloud status display notes.
- `TROUBLESHOOTING.md` adds four Ollama Cloud recipes: 401 on `/api/ps`, local URL shown in Settings, model list differences, and exclusive-switching behavior.

## [Unreleased] - Browsing / Internet / Stealth hardening

### Fixed
- **SSRF redirect bypass in `src/lib/web-context.ts`.** `assertPublicHttpUrl` only checked the original URL before DNS resolution; a redirect could point to a private/internal address after the first hop. The fetch layer now resolves manually (`redirect: 'manual'`) and re-validates every redirect hop against public-IP / internal-host guards, including `retry-after` and `location` handling for 301/302/303/307/308 responses.
- **Browser fetch ignored the managed UWAF pool.** `fetchViaBrowser` in `src/lib/web-fetch-strategy.ts` used an isolated `chromium.launch` context for every browser fetch. It now tries `getPage` from `uwaf-pool.ts` first so browser-grade fetches reuse the same display, proxy rules, stealth fingerprints, and persistent identity as live browser sessions, and only falls back to an ephemeral Chromium when the pool is unavailable.
- **Unsafe context truncation broke citation numbering.** `buildContext` truncated raw text, which could remove a source while leaving higher citation numbers for absent sources. Sources are now bundled as whole sections and removed from the end, so every `[N]` in the returned context has a matching source.
- **Cache locked hosts to `fast` after browser infra failures.** A failed browser upgrade left the strategy cache unset so the next request could retry; the old behavior cached `fast` only after a successful fast result and now explicitly avoids caching on infra errors.
- **Over-aggressive browser auto-upgrade.** The old threshold required only 2 `<script>` tags and ignored semantic markup. The new threshold requires ≥3 scripts, an excerpt under 200 chars, and no `<main|article|section>` tags; known static hosts (Wikipedia, HN, StackExchange, etc.) skip the browser path entirely.
- **Weak URL extraction.** `extractUrlsFromText` captured trailing punctuation, markdown delimiters, and closing parentheses as part of URLs. It now uses a tighter regex that strips `.,;!?)]}` suffixes and avoids unbalanced parenthesis issues.

### Changed
- **Per-provider rate limiting for web search.** `src/lib/web-context.ts` now tracks `searchRateLimits` per provider with progressive backoff (2 s, 8 s, 32 s) on consecutive failures, preventing free providers from being hammered and giving configured paid providers a recovery window.
- **Provider scoring penalizes zero-result pages.** A provider that returns links but no extractable results now scores below providers that actually produced content, so empty SERPs don't dominate the merged ranking.
- **Stealth provider catalog clarity.** `getStealthProviderCatalog` in `src/lib/uwaf-search-providers.ts` now exposes both `active` (will be used in the current stealth profile) and `configured` (has required env vars / dependencies) so the UI can distinguish "enabled" from "ready to use".
- **UWAF direct search falls back to public-web search.** When every stealth/direct HTML scraper returns no useful results, `executeSearch` in `src/lib/uwaf-browser.ts` now calls `searchPublicWeb` (Brave/SearXNG/Bing/DDG) as a final fallback so the browser search path remains usable when curated onion engines or raw-HTML scraping fail.

### Tests
- `src/lib/web-fetch-strategy.test.ts` updated for the new managed-pool fallback path and stricter JS-required detection.
- `npx tsc --noEmit`, `npm test -- --run`, and `npm run build` all pass. Docker image builds and the Compose stack starts cleanly.

## [0.15.1] - 2026-06-26 - Guard Against Oversized unified_browser Tool Results

Fixes the "model picked the wrong tool and crashed on a 25K-char SERP" failure mode. Two layered guards, no behavior change for legitimate unified_browser use.

### Changed — Prompt rule at `workspace-tool-prompt.ts`
- **Replaces** "prefer unified_browser over the background web tool so the user can see what you are opening" (which caused the model to reach for the heavy Playwright path for plain "find me Y" searches).
- **New rule**: for plain web searches (news, market data, statistics, quotes, "what is the latest X"), use the lightweight `web` tool — clean text snippets, no full browser page. Reserve `unified_browser` for the cases that actually need a real browser: step-by-step navigation, JS-heavy pages, form interaction or login, multi-page workflows with click/extract cycles, or when the user explicitly wants to take over the live browser. All legitimate uses are enumerated in the new wording.

### Changed — `formatUwafBrowserToolResult` extracted + size-capped
- **New module** `src/lib/workspace-tool-tool-results.ts` holds the formatter and the `UwafBrowserToolResultEntry` type. `WorkspaceToolWorkspace.tsx` now imports from it. Makes the formatter unit-testable.
- **Page text cap**: 6,000 chars for non-search actions (`open`, `click`, `extract`, `research_batch`), 2,000 chars for `action === 'search'`. When truncated, an explicit marker `[... N more characters truncated; full content visible in the live browser pane]` is appended. The model can call `unified_browser action=extract mode=text` if it really needs more.
- **Link list cap**: max 60 entries. Strips `data:image` / `;base64,` URLs (inlined base64 image blobs) and oversized URLs > 2,000 chars (redirect chains / session internals). Real navigation targets are preserved.
- **Untouched**: failure path (already terse), forms, tables, tabs, batch research preview, all metadata fields. The model still sees everything it needs to answer — just not the noise.
- **End-to-end check**: a 25K-char Brave SERP fixture with 80 mixed links now produces a tool result under 8K chars, with 40 real search-result links preserved and a clear truncation marker.

### Tests
- 1 new test in `workspace-tool-prompt.test.ts` confirming the old rule is gone and the new rule enumerates every legitimate unified_browser use case.
- 30 new tests in `workspace-tool-tool-results.test.ts` covering: truncateWithMarker math, compactLinks filtering + capping, isJunkLinkUrl classification, action-based text caps, markdown fallback, failure-path passthrough, structural sections (forms/tables/tabs/batchResults), and the end-to-end 25K SERP fixture.
- **401 total tests pass, 0 regressions.**

## [0.15.0] - 2026-06-29 - Parallelize Sequential Search Bottlenecks

This release cuts the user-visible latency of "search the web" workflows from ~15-30 s to ~5-10 s on cold start. The wins come from three targeted parallelism changes plus a per-tool-call fetch timeout. No behavior change for the model — same `searchAttempts` array, same result shape, same side effects. The user just gets an answer faster.

### Changed — Provider fallback parallelism (`searchPublicWeb`)
- **Configured-tier race**: when 2+ paid providers (Google, Brave, SearXNG) are configured, the first two are now raced in parallel via `Promise.allSettled` instead of falling through sequentially. The winner returns; the loser's result is discarded. 2 is the safe bound — typical configs are 0-2 paid providers, and 3 concurrent paid API calls is right at the rate-limit cliff.
- **Single-provider branch**: when only 1 provider is configured, behavior is unchanged (single sequential call). The parallel code path adds no value for 1 provider and the overhead is wasted.
- **3rd+ configured providers**: fall through sequentially as a safety net for the rare 3-provider case.
- **Always-on tier** (DuckDuckGo → Bing): stays sequential because both are free and don't rate-limit us, and the user wants the first result.

### Changed — Query-variant parallelism (`buildWebContext`)
- **3 query variants × 8 s each used to serialize to ~24 s** (`generateSearchQueries` produces up to 3 variants — original + comparison sides + focused keyword). Now run in parallel via `Promise.allSettled` for ~8 s total. The dedup/seenUrls merge is still sequential. Each variant respects the caller's `AbortSignal` — aborting propagates through.

### Changed — Per-provider timeout in `executeSearch`
- **`PER_PROVIDER_FALLBACK_BUDGET_MS = 8_000`** — hard ceiling on any single provider attempt inside the `executeSearch` fallback chain. The full per-provider timeout (18-22 s) is still the cap the provider *may* consume; this is the wall budget we *allow* it before we move to the next. The new `runWithTimeout` helper races the per-provider body against a 8 s deadline. On timeout, the provider is recorded as a `failureDetail: 'Search provider "<x>" exceeded the 8000ms per-attempt budget.'` and we move on. The 8 s budget is enough for the JS render + `waitForMatchingSelectors` (5 s) on any working search engine — slow providers get cut. Single-provider setups (`preferredProviderId` set) are exempt and use the full `providerTimeoutMs`.

### Changed — Per-tool-call fetch timeout (`fetch-summarize`)
- **`FETCH_TOOL_TIMEOUT_MS = 45_000`** — tighter inner budget inside the 60 s `maxDuration` ceiling. If `fetchAsReadableText` hangs (e.g. Playwright context is wedged), the route now returns a clean **504** with `error: "Fetch timed out after 45s. The site may be slow or blocking automated access."` instead of a generic 500. The catch path distinguishes `AbortError` / `TimeoutError` from generic failures and returns the appropriate status code (504 vs 500).

### Test coverage
- **`src/lib/web-context.test.ts`** (new) — 5 tests: empty-query fast path, offline shape, configured-tier single-provider branch, configured-tier parallel race (call spread <50 ms, wall <500 ms for 300 ms latency), fallthrough to always-on tier, and `buildWebContext` query-variant parallelism (call spread <100 ms, wall <N × latency).
- **`src/lib/uwaf-browser.test.ts`** (new) — 5 tests: `runWithTimeout` happy path, timeout path, late-rejection suppression, budget constant sanity, zero-budget edge case.
- **`src/app/api/workspace-tool/fetch-summarize/route.test.ts`** (new) — 9 tests: missing/empty url, auth delegation, null-fetch 502, success 200, TimeoutError 504, AbortError 504, generic 500, signal/userId wiring, response shape.

## [0.14.0] - 2026-06-29 - Web Trust: Browser-Grade Fetch, Persistent Identity, Live-Browser Focus Fix

This release makes the AI's web access ChatGPT-grade by combining a browser-grade fetch path for JavaScript-rendered sites (SEC EDGAR XBRL viewer, GitHub blobs, modern SPAs) with a first-party persistent identity layer so a returning direct-mode user keeps their cookies, locale, timezone, and login state across sessions. A new opt-in CAPTCHA/WAF solver adapter sits alongside the strategy layer for sites that gate access behind Cloudflare Turnstile or hCaptcha. The live-browser UX also gets the click-glitch fix that previously pulled DOM focus off the noVNC canvas within ~1 second of clicking the search bar.

### Added — Browser-grade fetch (Phase 3, Option A)
- **`src/lib/web-fetch-strategy.ts`** — new dispatcher with explicit `fast` and `browser` strategies plus an auto-detect path. Calls `fetchPublicWebPage` first; if the excerpt is short (<200 chars) and the body contains ≥2 `<script>` tags the call is upgraded to a Playwright render. Decisions are cached per host for 10 minutes (`clearStrategyCache` for tests). The browser path navigates with `domcontentloaded` + `networkidle`, settles 250 ms, reads `document.body.innerText`, and detects Cloudflare / DDoS-Guard / hCaptcha interstitials via `looksLikeChallengePage`.
- **`src/lib/captcha-solver.ts`** — opt-in 2captcha / anti-captcha adapter. No-ops when `CAPTCHA_PROVIDER` / `CAPTCHA_API_KEY` env vars are unset, so the surface stays minimal until the operator opts in. Per-user budget is tracked in `Map<userId, { spentUsd, resetAt }>` and capped by `CAPTCHA_BUDGET_USD_PER_USER` (default $5) and `CAPTCHA_BUDGET_RESET_HOURS` (default 24 h). `solveCaptchaIfConfigured`, `getCaptchaSolverConfig`, `getRemainingBudget` exported.
- **`src/app/api/workspace-tool/fetch-summarize/route.ts`** — switched to `fetchAsReadableText` with the caller's userId so identity-hydrated browser fetches benefit from persistent state.
- 8 regression tests across `web-fetch-strategy.test.ts` (4 tests: fast / browser / cached / JS-required detector) and `captcha-solver.test.ts` (4 tests: no-op without config, "none" provider, budget cap enforced, challenge heuristics).

### Added — First-party identity layer (Phase 4, Option C)
- **`src/lib/uwaf-identity.ts`** — per-(userId, sessionId, mode) record persisted to `${PEAKUI_IDENTITY_ROOT:-/var/lib/peakui/identity}/<userId>/<sessionId>/<mode>/`. API: `getOrCreateIdentity`, `deleteIdentity`, `loadCookies` / `saveCookies`, `applyIdentityToContext`, `identityToFingerprint`. The deterministic seed key `${userId}:${sessionId}` keeps UA / locale / timezone / viewport stable across reconnections. `applyIdentityToContext` calls `addCookies` and injects an `addInitScript` that locks `Intl.DateTimeFormat().resolvedOptions().timeZone` to the record's timezone.
- **`src/app/api/workspace-tool/identity` — `DELETE` route** — rotates the persistent identity (deletes the directory and resets the seed) so the next direct-mode session regenerates a fresh fingerprint and starts with no cookies. Gated by `workspace-tool.use` + `workspace-tool.uwaf`.
- **Live-browser context integration** — `uwaf-pool.ts createManagedSession` and `closeManagedSession` now hydrate direct contexts with the user's persistent identity on launch and flush cookies back to disk on close. A returning direct-mode user keeps their login state across reconnections.
- 8 unit tests in `uwaf-identity.test.ts` cover creation, idempotency, distinct-per-mode records, cookie round-trip, empty-load, corruption tolerance, deterministic fingerprint, and `deleteIdentity` removes the directory.

### Fixed — Live-browser click glitch (Phase 2)
- **Search-bar focus was stolen back within ~1 s of clicking.** Root cause: `PAGE_POLL_INTERVAL_MS = 1000` in `live-browser-server.ts` broadcast a `page` event every second, causing `LiveBrowserView` to re-render its wrapper div, which pulled DOM focus off the noVNC canvas. Polling now skips while `session.interrupted` is true (the user has control) and resumes on interrupt-off. The forced `broadcastPageState(true)` on resume covers the case where the URL/title changed while polling was paused.
- **`src/app/components/LiveBrowserViewport.tsx`** — new memoized `forwardRef` component wrapping the noVNC canvas so React reconciliation in parents (`currentUrl`, `title`, `status`, the AI ACTIVE / YOU HAVE CONTROL badge) does not steal canvas focus. `LiveBrowserView.tsx` and `BrowserModal.tsx` were updated to use it.
- **`useLiveBrowserConnection.ts`** — new `requestFocus()` callback exposed via the hook. `LiveBrowserView` calls it from the wrapper's `signalActivity` handler so every mousedown pulls focus onto the canvas deterministically.

### Changed — Model guidance (Phase 1)
- **Rule (8) appended to the workspace-tool system prompt** forbidding off-topic pivots: "If the user's most recent message is a follow-up to a prior turn, do not pivot to an unrelated topic (VPN setup, anonymity, censorship workarounds, etc.) just because a search returned results on that topic. If you cannot answer from the prior turn, say so and ask the user to clarify rather than chase a tangent." Addresses the prior session's bug where the model pivoted from a follow-up question to an unrelated VPN / anonymity guide after EDGAR search returned. `workspace-tool-prompt.test.ts` gained an assertion for the new rule.

## [0.13.0] - 2026-06-29 - Workspace Files Panel (Phases 1-7)

This release ships WorkSpaces's **Workspace Files panel** end-to-end and
prepares PeakUI for a wider public release. The panel is a right-rail GUI
over the active workspace's on-disk state — virtualized tree, type-dispatched
preview, in-place editor with ETag conflict detection, upload, delete,
multi-select + bulk ops (copy paths / zip / delete), rename, move-to,
right-click context menu, and live SSE-driven updates whenever the model
or another tab mutates the workspace.

Every mutation goes through the same `workspace-tool.use` + `workspace-tool.filesystem`
permission gate that the model's filesystem / shell / code tools use, and
every successful mutation publishes a `WorkspaceEvent` over the existing
in-process pub/sub. See [docs/workspace-files-panel.md](docs/workspace-files-panel.md)
for the full surface, API, and client library reference.

### Added — Open Source Release
- Public open-source release under MIT License.
- `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, `CODE_OF_CONDUCT.md`, `.env.example`, `INSTALL.md`, `DEVELOPMENT.md`, and `docs/ARCHITECTURE.md`.
- New WorkSpaces tools: `csv_document` export, `email_document` draft generation, `fetch_summarize` URL summarization, `markdown_document` artifact generation, and `word_document` meeting-notes template.
- Copy-to-clipboard action on every user and assistant chat message.
- Polished login/rail logo sizing with reduced border/background visual weight.
- Markdown document outputs now return Canvas artifact download links instead of filesystem paths.
- Knowledge Base folder/document list refreshes every 4 seconds so uploads and indexing status update without manual refresh.
- Canvas artifact download links are parsed from both relative and absolute URLs and normalized to the current domain, preventing model-hallucinated domains from breaking downloads.
- Windows Docker Desktop support: `docker-compose.windows.yml` with bridge networking, env-driven service names, and `host.docker.internal` defaults for Ollama and the optional host shell executor.
- Cross-platform Tor proxy auto-detection: `uwaf-pool.ts` probes `localhost:9050` (Linux/macOS host-mode) and `tor-proxy:9150` (Windows Docker Desktop) and caches the first working endpoint. If an explicit `TOR_PROXY_URL` is unreachable, the app falls back to the built-in candidates automatically, so stealth/dark-web browsing works on both platforms whether or not the env var is set.
- Stealth `.onion` navigation now retries once on transient errors and reports clearer failure codes (`timeout`, `empty_response`, `connection_refused`, `tor_unavailable`).
- Stealth search now waits for JS-rendered result selectors after navigation and after the on-page form fallback, so JS-heavy onion engines (OnionLand, TorDex) no longer appear empty at `domcontentloaded`.
- Cross-platform host shell executor (`scripts/workspace-tool-host-executor.mjs`) detects Windows and uses `cmd.exe`/`PowerShell`, preserves drive-letter paths, and translates container paths back to the host workspace.
- `.gitattributes` is created automatically for each workspace when git backups are enabled, normalizing line endings across Linux/macOS/Windows.
- Optional `PEAKUI_ALLOW_INTERNAL_HOSTS` environment variable permits `.internal` hostnames in browser/search guards.
- CI matrix now includes `windows-latest` alongside `ubuntu-latest`.
- UWAF browser now keeps per-session memory of visited pages and searches (direct and stealth), with automatic pruning and cross-tab link resolution so the model can return to previous results instead of repeating searches.
- UWAF browser actions now record per-tab snapshots and expose `new_tab/list_tabs/switch_tab/close_tab` consistently; the runtime context tells the model it is not limited to a single tab.

### Added — Workspace Files Panel (Phases 1-5)
- Workspace Files panel (Phase 1): new sidebar entry mounts a `WorkspaceFilesPanel` in the WorkSpaces right-rail. Lists the active workspace's directory tree via the new `GET /api/workspace-tool/workspaces/[id]/files` endpoint, with depth-limited recursive expansion and ETag-aware `GET .../files/raw` for content reads. Supports per-user, per-workspace sandboxed paths (`/mnt/workspace-tool/workspace/users/<userId>/workspaces/<slug>/`) and inherits the existing `workspace-tool.filesystem` permission gate. In-process pub/sub (`workspace-files-pubsub.ts`) is wired for future SSE-driven real-time updates.
- Workspace Files panel (Phase 2): virtualized tree (`WorkspaceFileTree.tsx`, memoized rows, lazy-load on expand via `WorkspaceBreadcrumb`), inline preview router (`WorkspaceFilePreview.tsx`) with type-dispatched renderers for markdown, code (Prism via `LazySyntaxHighlighter`), JSON (pretty-printed), CSV, images (base64 data URL + zoom toggle), PDF (iframe), and binaries (download-only). Phase 2 ships the read-only MVP — write/edit, upload, delete, multi-select, and SSE-driven real-time refresh arrive in later phases.
- Workspace Files panel (layout polish): the side-rail no longer hosts a narrow inline preview. Clicking a file now opens `WorkspaceFilePreviewModal`, a full-size dialog (`min(1100px, 96vw)` wide, `88vh` tall, blurred backdrop, click-outside + Escape to close) that mirrors the Canvas `ArtifactPreviewModal` pattern. Folder navigation is Explorer-style: clicking a folder changes `cwd` in place and `WorkspaceBreadcrumb` + a "← Back" button let the user step up. The tree (`flattenTreeRows`) now walks from `cwd`, reading the root listing from `rootEntriesByDirectory` and lazily loaded sub-trees from `childrenByDirectory`.
- Workspace Files panel (Phase 3): in-place text editor (`WorkspaceFileEditor.tsx`) with line numbers, dirty dot, and `Cmd/Ctrl+S` to save. The toolbar of the preview modal gains an Edit/Preview toggle. Writes go through `POST /api/workspace-tool/workspaces/[id]/files` with `If-Match: <etag>` so the server returns 412 when the file changed on disk between load and save; the editor surfaces a non-destructive banner with three actions — Reload (discard edits and re-fetch), Overwrite (force-save by retrying without If-Match), and Save as copy (writes `<name>.edited.ext` next to the original). On successful save the modal re-fetches the file content and refreshes the cwd listing so the tree's size/mtime update in place. The editor is remounted via `key={path:etag}` so internal state never has to sync from props.
- Workspace Files panel (Phase 4): upload + delete. Drag-and-drop or click-to-pick upload via `WorkspaceFileUpload.tsx` (native HTML5 events, no extra dependency) posts `multipart/form-data` to the new `POST /api/workspace-tool/workspaces/[id]/files/upload` (50 MB per file, 100 files per request, JSON-encoded `paths` field). Single-file downloads stream through `GET /api/workspace-tool/workspaces/[id]/files/download` with RFC 5987 UTF-8 filenames. Deletes land on the existing `DELETE /files` endpoint; `WorkspaceConfirmDialog.tsx` is a tiny modal (Esc/Enter keybindings, click-outside-to-cancel, destructive variant with red confirm) shared by every confirm flow going forward. Successful uploads and deletes re-fetch the cwd listing so the tree updates in place; the active file preview's `Download` button also gets a single-file path now.
- Workspace Files panel (Phase 5): multi-select + bulk ops. The tree publishes its current visible row order to the panel via a new `onVisiblePathsChange` callback; the panel uses that order to drive shift-range selection (anchor..path inclusive), Cmd/Ctrl+click toggling, plain click for single-select with toggle-to-deselect, and a document-level Cmd/Ctrl+A that selects every visible path when focus is inside the panel. The selection toolbar (count + Copy paths / Download zip / Delete / Clear) appears only when something is selected. Bulk download streams a single zip via `POST /api/workspace-tool/workspaces/[id]/files/zip` (500 MB / 500 files per archive, `archiver` driven directly with no intermediate pipe so the route returns the stream as a `NextResponse` body); bulk delete routes through the same confirm dialog but auto-uses the recursive flag when any selected entry is a directory. Copy paths uses `navigator.clipboard.writeText` with a `document.execCommand('copy')` fallback for non-secure-context browsers. All bulk operations follow the existing per-user, per-workspace sandbox and `workspace-tool.filesystem` permission gate.
- Chat runtime context includes a live UWAF session summary (current page, open tabs, recent visits, recent searches) so the model can reference previously browsed links in the same chat session.
- Chat auto-scroll now stays pinned to the bottom across all messages (not just the first response) by watching content height growth and ignoring scroll events caused by programmatic auto-scroll. Streaming uses instant scrolling to keep up with tokens; non-streaming updates use smooth scrolling.
- **Canvas: source-editable binary artifacts.** PDF, Word, Excel, PowerPoint, and Mermaid artifacts now expose their underlying JSON or `.mmd` source as a sibling `kind: 'data'` artifact. Clicking **Edit** on one of these artifacts opens the source JSON in the editor, and saving it re-renders the binary through the existing render endpoint. The previous binary is preserved as a revision and the source artifact remains the single point of truth for future re-renders.
- **Canvas: server-side preview endpoint.** A new `/api/canvas/artifacts/<id>/preview` route returns a normalized JSON representation of binary artifacts so the Canvas modal can render real Excel tables (per-sheet, per-column), Word documents (per-section, paragraphs + tables), email drafts (parsed `.eml` headers + body), and slide decks (slide titles + bullet previews) inline instead of the previous "Browser-native inline preview is limited" fallback.
- **Canvas: Mermaid client-side rendering.** When the Mermaid artifact preview endpoint is fetched, the modal lazy-loads Mermaid from the CDN and renders the source as a live SVG in place. The same flow is used as the inline fallback when the server-side renderer is unavailable.
- **Canvas: download fix for binary types.** PDF, Excel, Word, PowerPoint, ZIP, ICS, email, and Mermaid downloads now go through `/api/canvas/artifacts/<id>/download`, which decodes base64 correctly. The previous inline Blob path produced corrupt files for binary types.
- **New WorkSpaces tools:**
  - `slides_document` — generates downloadable `.pptx` Canvas artifacts via `pptxgenjs`. Layouts include `title`, `section`, `content`, `bullets`, `two-column`, `quote`, and `closing`.
  - `archive_document` — bundles multiple artifacts/files into a single `.zip` Canvas artifact via `archiver`. Each entry can carry raw text content or a base64-encoded binary payload.
  - `calendar_document` — produces a downloadable `.ics` Canvas artifact via the `ics` package. Each event supports `uid`, `title`, `description`, `location`, `start`, `end`, `allDay`, `organizer`, `attendees`, and `url`.
  - `mermaid_document` — renders a Mermaid diagram to `.svg` (or `.png`) via `@mermaid-js/mermaid-cli` using the system Chromium bundled in the container. Diagrams also get a source artifact so they remain re-editable.
- **Mermaid renderer reliability.** The renderer writes a Puppeteer config that points mmdc at `/usr/bin/chromium-browser` (installed in the container image) instead of relying on Puppeteer's auto-download, which fails inside locked-down containers. The placeholder fallback SVG now looks like a real diagram outline (titled source panel with a border, formatted `.mmd` body, footer with format/theme metadata) instead of an empty black canvas.
- **Tool dispatch hardening.** The tool-block parser regex, the `normalizeExtractedToolRequestName` helper, and the `WORKSPACE_TOOL_NAMES` constant are now derived from a single shared list. Adding a new tool only requires updating the list and adding a parser branch — the regex no longer silently drops less-common tool names. The four new tools (`slides_document`, `archive_document`, `calendar_document`, `mermaid_document`) all dispatch correctly.
- **Tool payload validation.** `workbook_document` template values are now validated against the same union that powers the renderer (so invalid templates no longer pass through). `archive_document` entries without `name`/`content` and `calendar_document` events without `start` are filtered out before rendering, so the renderers never see malformed payloads.
- **Artifact source-artifact lineage.** All artifact creators (`workbook`, `word`, `csv`, `email`, `markdown`) now accept a `sourceArtifactId` input parameter, matching the existing PDF/slides/archive/calendar/mermaid creators. The tax `fill_pdf_form` route now records the template `Document` as the source artifact so re-rendering and preview carry the lineage forward.
- **`fetch_summarize` HTTP semantics.** Failed upstream fetches now return HTTP 502 (bad gateway) instead of HTTP 200 with `success: false`, so client `response.ok` checks behave correctly.
- **WorkSpaces system prompt primer.** The chat system prompt now begins with an explicit tool-call format primer (`<workspace_tool name="...">...</workspace_tool>`) so the model cannot forget the wrapper even on less-common tools. The previous prompt only showed the format inside capability-specific examples.

### Added — Workspace Files Panel (Phases 6-7)
- Workspace Files panel (Phase 6): right-click context menu on every tree row with Open / Rename / Copy path / Download / Move to / Delete actions; F2 keyboard shortcut enters in-place rename (Enter commits, Esc/blur cancels); in-place rename input is style-matched to the existing tree row; a new "Move to…" dialog (`WorkspaceMoveDialog.tsx`) reuses `WorkspaceFileTree` in a directories-only mode (`selectableKinds={['directory']}`) to pick any folder as the destination; the rename and move operations route through the existing `PATCH /api/workspace-tool/workspaces/[id]/files` `action: 'rename' | 'move'` endpoint.
- Workspace Files panel (Phase 7): real-time updates via a new Server-Sent Events stream at `GET /api/workspace-tool/workspaces/[id]/events` (Node `ReadableStream<Uint8Array>` over the existing in-process pub/sub, 25s keepalive, `X-Accel-Buffering: no` for nginx). The panel subscribes on mount and schedules a debounced (150 ms) refetch of cwd + every expanded subdirectory on `tree.invalidated`, the parent on `file.created`/`file.modified`/`file.deleted`, and re-fetches the active file's content so the editor's ETag stays fresh. The client `subscribeWorkspaceEvents` reconnects with jittered exponential backoff (500 ms → 5 s, reset on each successful read) so a transient fetch failure does not permanently disable live updates. A new `WORKSPACE FILES GUI PANEL` block in the system prompt + the default `BOOT.md` / `TOOLS.md` templates teach the model that the panel mirrors live on-disk state and that paths in the panel are workspace-relative.

### Changed
- Replaced user-facing "Workspace Tool" branding with **WorkSpaces** across documentation.
- Parameterized Windows setup scripts and Docker Compose files to remove hardcoded personal paths.
- Knowledge Base RAG health UI simplified to a compact top status bar instead of an expandable panel.
- Default Ollama host now reads from the `OLLAMA_HOST` environment variable, so Windows Docker Desktop deployments default to `http://host.docker.internal:11434` instead of the unreachable container-local `127.0.0.1`.
- Default host shell executor URL now defaults to `http://host.docker.internal:4318` and can be overridden via `WORKSPACE_TOOL_HOST_EXECUTOR_URL`.
- File monitor automation normalizes Windows absolute paths and evaluates them through the mounted container path so monitors work on Docker Desktop for Windows.
- Shell command allowlist/denylist now covers common Windows shell commands and dangerous Windows patterns (e.g. `diskpart`, `format`, mass `del` on system drive).
- `commandExists` now uses `where` on Windows and `command -v` on Unix.
- Process termination helpers gracefully handle Windows signal limitations.
- Memory directory can be redirected to a persistent volume via `PEAKUI_DATA_DIR`.
- `docker-compose.yml` now carries a prominent warning that `network_mode: host` is Linux-only and links to the Windows compose file.
- WorkSpaces `onDownload` callback (passed to `CanvasPanel`) now uses the shared `isTextArtifactMimeType` classifier from `src/lib/canvas-download.ts` instead of the divergent `isBinaryArtifact` whitelist, eliminating the last known client-side source of corrupt downloads. The dead-code `downloadArtifactById` helper was removed; the surviving `onDownload` callback already covered every actual call site.

### Fixed
- **Canvas: artifact download corruption for PPTX/ZIP/EML/etc.** The download route's mime-type classifier was a hardcoded whitelist of binary types and silently omitted `application/vnd.openxmlformats-officedocument.presentationml.presentation`, `application/zip`, `message/rfc822`, and any future binary format. Affected artifacts were served as their raw base64 string instead of decoded bytes, causing `.pptx` files to open in LibreOffice as the literal text `UEsDBAoAA...` and Google Drive's converter to reject them with HTTP 432 from `/loadingconvert`. The classifier is now inverted (whitelist *text* mime types instead) so adding a new binary format never silently produces a corrupt download. The same fix applies to the preview route, the client-side download callback in `WorkspaceToolWorkspace.tsx`, and the CSV/ICS artifact creators that were storing text-mime content as base64. A backward-compat shim detects legacy base64-stored CSV/ICS rows in the DB and decodes them on read. See `src/lib/canvas-download.ts` for the shared helpers and `src/lib/canvas-download.test.ts` for the 22 regression tests.
- **Canvas: artifact size overcounted by ~37% for binary types.** POST/PUT and revision-restore handlers used `Buffer.byteLength(content, 'utf8')` which measured the **base64 string** length instead of the decoded file size. A 41 KB PPTX was reported as 56 KB and quota tracking was off by the same ratio. Now uses the decoded byte length via `decodeArtifactContent`.
- **Canvas: redundant per-route mime whitelists.** The download route, the preview route, and two client-side callbacks each maintained their own independent text/binary classifier, causing silent divergence when one was updated without the others. All four now share `isTextArtifactMimeType` / `decodeArtifactContent` from `src/lib/canvas-download.ts`.
- **WorkSpaces: tool-call recovery loop swallowed subsequent attempts.** When the model failed to emit a valid `<workspace_tool>` block, the recovery notice injected as a hidden user message literally contained the wrapper substring `<workspace_tool name="TOOL_NAME">{ ...json args... }</workspace_tool>` as a format example. The model would read that text on the next turn and pattern-match on the wrapper, repeating the same "invalid tool block" response instead of emitting the actual call. Recovery text now points at the system prompt's wrapper format without including the wrapper substring. Bumped the recovery nudge budget from 2 to 4 retries, and the post-stall pause notice now includes the model's last attempted intent so the next "continue" turn has the context it needs to recover.
- **WorkSpaces: recovery loop still failed after first nudge even with longer budget.** Recent session transcripts showed the model emitting the wrapper but with malformed/truncated JSON inside, leaving the chat history with empty `hidden: true` assistant messages for up to 8 consecutive rounds. The recovery budget has been tightened from 4 to 2 retries so the user-facing stall notice (which now mentions the inferred tool name, the last artifact, and the last description) appears faster. The narration-case nudge now includes a short, tool-aware placeholder example (using `<placeholder>` markers, never real content) so the model has a concrete shape to mirror. Successful document tool calls (`pdf_document`, `slides_document`, `word_document`, etc.) now record `lastSuccessfulDocumentTool` so the stall notice can say "It looked like you wanted to run slide deck generator (slides_document)" instead of leaving the user to guess.
- Discontinued regular-chat interface code and unused API routes.
- Internal TODO, memory, and agent-instruction files from the public repository.
- **WorkSpaces: chat inline download links rewritten to correct relative URL.** When the model emits a markdown download link with an absolute URL pointing at a wrong host (e.g. `[deck.pptx](https://gpt.dachicorp.com/deck.pptx)`), `ChatMessageContent` now matches the URL basename (and a normalized form of the link text) against the in-memory canvas artifact index and rewrites the href to `/api/canvas/artifacts/<id>/download` before rendering. This only fires when the URL already looks like an artifact (absolute URL, protocol-relative, or ends in a known document extension) so genuine external links (e.g. `[OpenAI](https://openai.com/about)`) are left alone. The system prompt for the tool result was also strengthened with explicit "do NOT produce" examples.

## [0.13.1] - 2026-06-29 - Runtime Narration Recovery

Fixes a long-standing failure mode where the model would describe an imminent tool call in prose (e.g. "Inspecting path metadata: /home/raza/Downloads/foo.zip" or "Running `df -h` to check disk.") and stop without emitting the matching `<workspace_tool>` wrapper. Previously the runtime would burn two extra model invocations on a recovery nudge and then surface a "Reply continue to retry" stall notice. The runtime now infers the missing tool call from the prose and dispatches it directly.

### Added
- **`src/lib/workspace-tool-narration-recovery.ts`** — pure synthesizer covering `filesystem` (stat/read/list), `shell`, `code`, `web`, `fetch_summarize`, `unified_browser`, `tax_return`, and all 10 document tools (`pdf_document`, `workbook_document`, `word_document`, `csv_document`, `email_document`, `markdown_document`, `slides_document`, `archive_document`, `calendar_document`, `mermaid_document`). 38 unit tests cover canonical and edge-case narration patterns.
- **System prompt primer rule (7) and a `RECOVERY BEHAVIOR` block** describing the auto-recovery layer so the model understands what to expect when it drops the wrapper, and is reminded never to end a message on bare narration.

### Changed
- **`WorkspaceToolWorkspace` tool-loop** — when `detectMissingToolIntent` flags a missing wrapper, the runtime now tries `synthesizeToolCallFromNarration` first. If a high-confidence pattern matches (e.g. `Inspecting path metadata: /path` → `filesystem stat /path`, `Running \`df -h\`` → `shell df -h`, `navigating to https://...` → `unified_browser open <url>`, "regenerate it" → resubmit the prior document tool), the runtime dispatches the inferred call directly without a second model invocation. A small visible notice ("Auto-recovered `<tool>` call from prose narration") tells the user what happened.
- **`lastSuccessfulDocumentTool` → `lastSuccessfulToolRequest`** — the recovery-layer hint now tracks ALL 18 tool kinds (not just documents) and persists the full prior request payload so the synthesizer can re-submit the same call when the narration says "regenerate it" / "render the same thing again".
- **Path safety** — synthesized filesystem calls still go through `pathLooksLikeHostFilesystemTarget`; paths outside `/home`, `/tmp`, or the workspace's `allowedFilesystemPaths` are dropped and the runtime falls through to the nudge path.
- **Shell metacharacter guard** — synthesized shell calls reject `|`, `&`, `;`, `<`, `>`, `$`, `(`, `)`, `\`, and newlines, so only safe inspection commands (e.g. `df -h`, `du -sh /tmp`, `ls -la /home`) are dispatched.
- **`WORKSPACE_TOOL_NAMES` is now exported** from `src/lib/workspace-tool-tools.ts` so the synthesizer can validate names against the single source of truth.

### Fixed
- Models that dropped the `<workspace_tool>` wrapper for `filesystem` `stat` calls (the most common bug surface) now have their intent recovered automatically — no more "Reply continue to retry" stalls.
- The chat transcript example from the bug report (`Inspecting path metadata: /home/raza/Downloads/camera-planner-windows-main.zip` → no wrapper) now produces a `filesystem` `stat` call directly, instead of a recovery nudge that wasted two model invocations.

## [0.1.0] - 2026-06-17

### Added
- WorkSpaces agentic workspace with task modes, workspace controls, and named workspaces.
- Session intelligence: rolling summaries, context health, auto-continue, branching, and analytics.
- Knowledge Base (RAG) with semantic, keyword, and hybrid RRF retrieval.
- Canvas artifacts with revisions, previews, downloads, and lineage.
- Tools: shell, filesystem, code sandbox, public browser, UWAF direct/stealth browser.
- Automation: heartbeats, cron schedules, file/URL monitors, wake events, and guarded unattended runs.
- Vision-first media uploads with PDF page rasterization for vision-capable models.
