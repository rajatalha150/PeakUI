# Changelog

All notable changes to PeakUI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
- Cross-platform host shell executor (`scripts/openclaw-host-executor.mjs`) detects Windows and uses `cmd.exe`/`PowerShell`, preserves drive-letter paths, and translates container paths back to the host workspace.
- `.gitattributes` is created automatically for each workspace when git backups are enabled, normalizing line endings across Linux/macOS/Windows.
- Optional `PEAKUI_ALLOW_INTERNAL_HOSTS` environment variable permits `.internal` hostnames in browser/search guards.
- CI matrix now includes `windows-latest` alongside `ubuntu-latest`.
- UWAF browser now keeps per-session memory of visited pages and searches (direct and stealth), with automatic pruning and cross-tab link resolution so the model can return to previous results instead of repeating searches.
- UWAF browser actions now record per-tab snapshots and expose `new_tab/list_tabs/switch_tab/close_tab` consistently; the runtime context tells the model it is not limited to a single tab.
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
- **Tool dispatch hardening.** The tool-block parser regex, the `normalizeExtractedToolRequestName` helper, and the `OPENCLAW_TOOL_NAMES` constant are now derived from a single shared list. Adding a new tool only requires updating the list and adding a parser branch — the regex no longer silently drops less-common tool names. The four new tools (`slides_document`, `archive_document`, `calendar_document`, `mermaid_document`) all dispatch correctly.
- **Tool payload validation.** `workbook_document` template values are now validated against the same union that powers the renderer (so invalid templates no longer pass through). `archive_document` entries without `name`/`content` and `calendar_document` events without `start` are filtered out before rendering, so the renderers never see malformed payloads.
- **Artifact source-artifact lineage.** All artifact creators (`workbook`, `word`, `csv`, `email`, `markdown`) now accept a `sourceArtifactId` input parameter, matching the existing PDF/slides/archive/calendar/mermaid creators. The tax `fill_pdf_form` route now records the template `Document` as the source artifact so re-rendering and preview carry the lineage forward.
- **`fetch_summarize` HTTP semantics.** Failed upstream fetches now return HTTP 502 (bad gateway) instead of HTTP 200 with `success: false`, so client `response.ok` checks behave correctly.
- **WorkSpaces system prompt primer.** The chat system prompt now begins with an explicit tool-call format primer (`<openclaw_tool name="...">...</openclaw_tool>`) so the model cannot forget the wrapper even on less-common tools. The previous prompt only showed the format inside capability-specific examples.

### Changed
- Replaced user-facing "Open Claw" branding with **WorkSpaces** across documentation.
- Parameterized Windows setup scripts and Docker Compose files to remove hardcoded personal paths.
- Knowledge Base RAG health UI simplified to a compact top status bar instead of an expandable panel.
- Default Ollama host now reads from the `OLLAMA_HOST` environment variable, so Windows Docker Desktop deployments default to `http://host.docker.internal:11434` instead of the unreachable container-local `127.0.0.1`.
- Default host shell executor URL now defaults to `http://host.docker.internal:4318` and can be overridden via `OPENCLAW_HOST_EXECUTOR_URL`.
- File monitor automation normalizes Windows absolute paths and evaluates them through the mounted container path so monitors work on Docker Desktop for Windows.
- Shell command allowlist/denylist now covers common Windows shell commands and dangerous Windows patterns (e.g. `diskpart`, `format`, mass `del` on system drive).
- `commandExists` now uses `where` on Windows and `command -v` on Unix.
- Process termination helpers gracefully handle Windows signal limitations.
- Memory directory can be redirected to a persistent volume via `PEAKUI_DATA_DIR`.
- `docker-compose.yml` now carries a prominent warning that `network_mode: host` is Linux-only and links to the Windows compose file.

### Removed
- Discontinued regular-chat interface code and unused API routes.
- Internal TODO, memory, and agent-instruction files from the public repository.

## [0.1.0] - 2026-06-17

### Added
- WorkSpaces agentic workspace with task modes, workspace controls, and named workspaces.
- Session intelligence: rolling summaries, context health, auto-continue, branching, and analytics.
- Knowledge Base (RAG) with semantic, keyword, and hybrid RRF retrieval.
- Canvas artifacts with revisions, previews, downloads, and lineage.
- Tools: shell, filesystem, code sandbox, public browser, UWAF direct/stealth browser.
- Automation: heartbeats, cron schedules, file/URL monitors, wake events, and guarded unattended runs.
- Vision-first media uploads with PDF page rasterization for vision-capable models.
