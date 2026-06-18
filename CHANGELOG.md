# Changelog

All notable changes to PeakUI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Public open-source release under MIT License.
- `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, `CODE_OF_CONDUCT.md`, `.env.example`, `INSTALL.md`, `DEVELOPMENT.md`, and `docs/ARCHITECTURE.md`.

### Changed
- Replaced user-facing "Open Claw" branding with **WorkSpaces** across documentation.
- Parameterized Windows setup scripts and Docker Compose files to remove hardcoded personal paths.

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
