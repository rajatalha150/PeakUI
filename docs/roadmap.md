# Roadmap

## Completed

### v0.1.0 - Foundation
- JWT authentication and per-user settings
- PostgreSQL persistence via Prisma
- Docker Compose deployment

### v0.2.0 - WorkSpaces Shell
- WorkSpaces as the primary agent workspace
- Task modes: Plan, Research, Execute, Review
- Response styles: Concise, Structured, Deep
- Workspace notes, success criteria, and pinned checklists

### v0.3.0 - Knowledge Base (RAG)
- Document upload and chunking
- Semantic search with Ollama embeddings
- Keyword search with BM25
- Source citations in WorkSpaces

### v0.4.0 - File Handling
- File and image attachments in WorkSpaces
- Document extraction for PDF, Office, RTF, and text
- 100 MB upload limit
- Vision-first image uploads with OCR as supplemental context
- Server-side JPEG normalization for HEIC/HEIF, TIFF, BMP, AVIF, and other still-image formats

### v0.5.0 - Response Improvements
- Inline image gallery for AI-generated images
- Copy-to-clipboard for code blocks
- Response download and generated file downloads

### v0.6.0 - Canvas & Artifacts
- Persistent CanvasArtifact DB model
- CanvasArtifactRevision history for edit/restore snapshots
- Compact artifact rows with Copy, Download, Preview, and Delete controls
- Modal previews for PDF, markdown, code, image, table, Word, Excel, and other artifacts
- Artifact versioning, revision restore, lightweight compare, lineage, search, and bundle export

### v0.7.0 - WorkSpaces Tooling
- Shell command execution with approvals and audit records
- Optional host shell executor
- Filesystem read/write with approved roots
- Managed Python/Node code sandbox
- Public-web browser control with staged form submission
- Shared managed workspace mount

### v0.8.0 - Session Intelligence
- Per-thread auto-continue modes (manual, ask, safe)
- Rolling context summaries and context health feedback
- Session branching and branch comparison
- Session analytics (tokens, TPS, tool calls, sources)

### v0.10.0 - UWAF Dual-Mode Browser
- Direct (clear-web) and Stealth (Tor-routed) browsing
- Playwright-core integration with system Chromium
- Tor proxy sidecar for stealth mode
- Sanitize-first HTML → Markdown pipeline
- Live noVNC browser as the visual browsing surface
- Source chip labeling and binary download blocking
- Stealth fail-closed design and fingerprint diversity

### v0.11.0 - Automation
- Server-side automation worker
- Heartbeats, cron schedules, file/URL monitors
- Wake events and unattended local Ollama execution
- Durable run history and nudge inbox

### v0.12.0 - Vision Documents
- PDF page rasterization for vision-capable models
- Vision capability auto-detection per model
- Multi-tab browsing and improved WorkSpaces continuity

## In Progress

### v0.13.0 - Polish and Public Release
- Open-source under MIT License
- Public documentation and standard project files
- Scrubbed internal-only notes and legacy chat surface
- Parameterized deployment configuration

## Planned

### v0.9.0 - Collaboration
- User groups and granular permissions
- Shared knowledge bases
- Session sharing between users

### v1.0.0 - Advanced Features
- Development-section code interpreter beyond WorkSpaces's current sandbox
- Docker orchestration from the Development section
- VM orchestration from the Development section
- Image generation
- Advanced citation control

### v1.1.0 - Production Hardening
- Comprehensive testing
- Performance optimization
- Documentation completeness
- Mobile UI polish

## Future Ideas

### Development Section
- Dedicated code interpreter workspace
- Docker container management
- Virtual machine control
- Terminal integration

### Enterprise Features
- LDAP/SSO integration
- SCIM provisioning
- Audit logging
- Rate limiting

### Platform Expansion
- Mobile apps
- Desktop client
- Browser extension
- Public API access
