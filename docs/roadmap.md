# Roadmap

## Completed

### v0.1.0 - Initial Release
- Basic chat interface with Ollama
- Session management
- JWT authentication
- PostgreSQL storage

### v0.2.0 - Core Features
- Open Claw workspace for agentic tasks
- Task modes: Plan, Research, Execute, Review
- Response styles: Concise, Structured, Deep
- Workspace notes and success criteria
- Pinned checklists

### v0.3.0 - RAG Knowledge Base
- Document upload and chunking
- Semantic search with Ollama embeddings
- Keyword search with BM25
- Source citations in chat

### v0.4.0 - File Handling
- File and image attachments in chat
- Document extraction (PDF, Office, RTF, text)
- 100 MB upload limit
- Attachment preview and removal
- Open Claw file attachments

### v0.5.0 - Response Improvements
- Inline image gallery for AI-generated images
- Copy-to-clipboard for code blocks
- Response download
- Generated file downloads

### v0.6.0 - Canvas & Artifacts ✅
- CanvasArtifact DB model for persistent artifact storage
- Visual artifact cards with code syntax highlighting
- Markdown and image file preview
- Artifact versioning and edit-in-place
- Canvas panels in both Open Claw and main chat
- Inline image rendering for AI picture requests
- AI system prompt instructions for image awareness

### v0.10.0 - UWAF Dual-Mode Browser ✅
- [x] UWAF (Unified Web Agent Framework) dual-mode browser engine (Direct/Stealth)
- [x] Playwright-core integration with system Chromium for full page rendering
- [x] Tor proxy sidecar (peterdavehello/tor-socks-proxy) for stealth mode
- [x] Three-stage sanitize-first pipeline (HTML pruning → readability → Markdown)
- [x] unified_browser tool with open, click, extract, extract_table, research_batch, fill, submit actions
- [x] Live noVNC browser as the visual browsing surface; static screenshot capture is now disabled
- [x] Network Hub Panel showing Direct IP, Tor status, and mode selector
- [x] Source chip labeling (Clear Web blue, Dark Web purple)
- [x] Approval-gated submit and research_batch actions
- [x] Binary download blocking and .onion URL restrictions
- [x] Stealth mode fail-closed design (no Tor fallback to direct)
- [x] UWAF settings in Settings Panel (mode, default mode, live-browser toggle)
- [x] Connection status API endpoint

## In Progress

### v0.7.0 - Open Claw Tooling (continued)
- [x] Shell command execution with approvals
- [x] Optional host shell executor for host-installed CLI access
- [x] Shell target selection with container fallback when host executor is unavailable
- [x] Shell command audit records in PostgreSQL
- [x] Filesystem read access for approved host paths
- [x] Filesystem write support for approved writable roots
- [x] Managed Python/Node code sandbox
- [x] Public-web browser control with staged form submission
- [x] Shared managed Open Claw workspace mount

### v0.7.1 - Open Claw Shell Polish
- [x] Client-side error capture path for browser/render crashes
- [x] Hidden-tool-message normalization to prevent raw tool bridges from crashing session reloads
- [x] Local-Ollama switch path trimmed to avoid redundant verification calls
- [x] Workspace-controls modal to free rail space without removing controls
- [x] Session rail paging (15 per page) and smoother rail/chat scrolling

### v0.7.0 - Chat Organization
- [x] Chat folders
- [x] Chat tags
- [x] Chat search
- [ ] Share/export chat

### v0.8.0 - Enhanced Chat UX
- [ ] Message queue (send later)
- [ ] Input variables in prompts
- [ ] Chat controls per-message
- [ ] Voice input (speech-to-text)

## Planned

### v0.9.0 - Collaboration
- [ ] User groups
- [ ] Granular permissions
- [ ] Shared knowledge bases
- [ ] Chat sharing between users

### v1.0.0 - Advanced Features
- [ ] Development-section code interpreter beyond Open Claw's current managed sandbox
- [ ] Docker orchestration from the Development section
- [ ] VM orchestration from the Development section
- [ ] Image generation
- [ ] Advanced citation control

### v1.1.0 - Production Ready
- [ ] Comprehensive testing
- [ ] Performance optimization
- [ ] Documentation completeness
- [ ] Mobile UI polish

## Future Ideas

### Development Section
- Docker container management
- Virtual machine control
- Code interpreter workspace beyond the current Open Claw sandbox
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
- API access
