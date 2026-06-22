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
- Cross-platform Tor proxy auto-detection: `uwaf-pool.ts` probes `localhost:9050` (Linux/macOS host-mode) and `tor-proxy:9150` (Windows Docker Desktop) and caches the first working endpoint, so stealth/dark-web browsing works on both platforms even when `TOR_PROXY_URL` is unset.
- Stealth `.onion` navigation now retries once on transient errors and reports clearer failure codes (`timeout`, `empty_response`, `connection_refused`, `tor_unavailable`).
- Cross-platform host shell executor (`scripts/openclaw-host-executor.mjs`) detects Windows and uses `cmd.exe`/`PowerShell`, preserves drive-letter paths, and translates container paths back to the host workspace.
- `.gitattributes` is created automatically for each workspace when git backups are enabled, normalizing line endings across Linux/macOS/Windows.
- Optional `PEAKUI_ALLOW_INTERNAL_HOSTS` environment variable permits `.internal` hostnames in browser/search guards.
- CI matrix now includes `windows-latest` alongside `ubuntu-latest`.

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
