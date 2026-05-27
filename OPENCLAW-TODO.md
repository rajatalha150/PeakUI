# WorkSpaces Workspace — Missing Features & TODO

## ⚠️ Database Reset Notice
The database was wiped during the Phase 7 Canvas implementation. All prior data is lost.

# WorkSpaces Workspace — Missing Features & TODO

## What We Have (The UX Shell)
- Agent mode selector: Plan, Research, Execute, Review
- Response styles: Concise, Structured, Deep
- Task state: Objective, Current status, Next step, Done criteria
- Pinned checklist with assistant-answer import
- Workspace brief: notes + success criteria injected per request
- Session/thread CRUD, provider selection, and the shared top-bar model picker
- Verify connection, model list refresh
- RAG toggle, Internet toggle
- Ollama health strip, retry/recovery actions
- Streaming with thinking blocks, source chips
- Quick-start prompt cards
- Collapsible right rail
- Workspace controls modal launcher in the rail
- Session rail paging (15 per page) with smoother single-container scrolling
- UWAF/network hardening backlog is tracked separately in `UWAF-NETWORK-TODO.md`
- **Identity & Persona System:** agent persona config, user profile, 6 pre-built templates, operating instructions injected into every request

---

## What's Missing (The Agent Infrastructure)

### 1. Identity & Persona System
- [x] **Agent persona config** — Let users define agent name, tone, boundaries, expertise (like `SOUL.md`)
- [x] **User profile** — Context about the user injected into every request (`USER.md` equivalent)
- [x] **Operating instructions** — Per-workspace `AGENTS.md` that defines how the agent should behave
- [x] **Per-session persona override** — Different sessions can have different agent personalities
- [x] **Persona templates** — Pre-built agent types: Developer, Researcher, Writer, Analyst, etc.

### 2. Multi-Layer Memory System
- [x] **Daily memory logs** — Auto-generate `memory/YYYY-MM-DD.md` summaries of each day's work
- [x] **Auto-load recent memory** — Inject today + yesterday memory into session context
- [x] **Curated long-term memory** — User-maintained `MEMORY.md` for persistent knowledge (read by memory system)
- [x] **Cross-session recall** — Agent can reference findings from past sessions (via injected memory context)
- [x] **Session summaries** — Auto-generated TL;DR when a session ends (stored in DB + memory dir)
- [ ] **Memory search** — Search across all past sessions for relevant context (future UI enhancement)

### 3. Tool Execution
- [x] **Shell command execution** — Agent runs commands on host, displays output in chat
- [x] **Tool approval modes** — Auto-approve, ask-first, or deny for shell commands
- [x] **Shell target selection** — WorkSpaces can run shell commands in the app container or through an optional host executor
- [x] **Host access presets and status** — Settings can configure safe workspace-only, home-read/workspace-write, or mounted-root audit access and report host executor/filesystem readiness
- [x] **Filesystem denial diagnostics** — Filesystem API failures include structured codes, action-required guidance, and mounted/approved-root diagnostics for model and operator feedback
- [x] **Host executor realpath guardrails** — Host shell allowed roots and requested cwd are resolved through real paths before execution to prevent symlinked cwd boundary bypasses
- [x] **Shell command audit log** — Shell requests/results persist in DB via `ShellCommandAudit`
- [x] **File system read** — Agent reads files from designated directories
- [x] **File system write** — Agent creates/edits files with user approval
- [x] **Code execution sandbox** — Managed Python/Node sandbox with workspace-scoped guardrails
- [x] **Browser control** — Agent navigates public web pages, stages form input, submits with approval, and scrapes page structure/content

### 4. Workspace File System
- [x] **Workspace directory** — Dedicated managed workspace roots now exist per user/workspace under the Open Claw workspace mount, and code runs default into the selected workspace
- [x] **`TOOLS.md`** — Every workspace now scaffolds `TOOLS.md`, and its contents are injected into the Open Claw system prompt as local operating conventions
- [x] **`BOOT.md`** — Every workspace now scaffolds `BOOT.md`, and its startup checklist is loaded into prompt context for the selected workspace
- [x] **Custom skills library** — Every workspace now has a `skills/` library for user-defined Markdown prompt/skill templates, and skill summaries are injected into prompt context
- [x] **Workspace git backup** — Optional per-workspace git auto-backup now initializes a repo and snapshots detected file changes automatically
- [x] **Multi-workspace support** — WorkSpaces can now create, select, and persist multiple named project workspaces from the workspace controls modal

### 5. Autonomous Scheduling
- [x] **Heartbeat check-ins** — Persistent background worker now creates server-side heartbeat nudges for stale WorkSpaces threads on a configurable interval
- [x] **Cron-based tasks** — Cron scheduler now stores recurring prompts per user, computes next run times, and raises recurring automation nudges/events
- [x] **Background monitoring** — URL and file monitors now poll in the background with SSRF checks plus approved-root filesystem guardrails and create nudges when rules trigger
- [x] **Wake-on-event** — Authenticated wake-event pipeline now exists via polling monitors and `POST /api/openclaw/automation/wake-event`
- [x] **Proactive nudges** — Server-side nudges now surface in WorkSpaces UI and are injected into Open Claw request context for follow-up action
- [ ] **Unattended model execution** — Future enhancement. Current automation is notification-driven and context-aware, but it does not yet launch background LLM runs fully autonomously

### 6. Sub-Agent Delegation
- [ ] **Task decomposition** — Break complex objective into sub-tasks
- [ ] **Parallel sub-agents** — Spawn multiple agents for research, coding, writing in parallel
- [ ] **Sub-agent chat** — Each sub-agent gets isolated context
- [ ] **Result merging** — Sub-agent outputs are combined into final response
- [ ] **Coordinator agent** — Manager agent that delegates and synthesizes

### 7. Canvas & Artifacts
- [x] **Persistent artifacts** — Agent outputs persist beyond chat via CanvasArtifact DB model
- [x] **Canvas nodes** — Visual cards for generated artifacts
- [x] **File preview** — Render code files, markdown docs, images inline
- [x] **Artifact versioning** — Tracked via version field plus durable `CanvasArtifactRevision` snapshots for restore/compare
- [x] **Export artifacts** — Download individually from Canvas panel or batch download
- [x] **Edit-in-place** — Edit agent-generated code/docs directly in the UI
- [x] **Revision restore and compare** — Canvas history can restore prior versions and show lightweight revision comparisons
- [x] **Canvas search and paging** — Artifact API/UI now supports search plus cursor-based loading beyond the old 100-item cap
- [x] **Collapsible bundles** — Artifact bundles can collapse, export as grouped JSON, or be deleted as a group
- [x] **Lineage navigation** — Canvas cards expose source/derived artifact links when lineage metadata exists
- [x] **Canvas recovery states** — Artifact load, revision load, and list fetch failures now surface retryable UI states
- [x] **Vision-first image attachments** — Uploaded images stay as native image input, with OCR kept as optional supplemental context
- [x] **Per-image attachment mode** — Vision only / Vision + OCR / OCR only controls in the WorkSpaces composer
- [x] **Media-format detection** — Image/audio/video uploads are classified by MIME or extension instead of falling through to generic binary metadata
- [x] **Model-safe still-image normalization** — HEIC/HEIF, TIFF, BMP, AVIF, and related still-image formats convert to JPEG before Ollama receives the image payload
- [x] **Canvas lazy previews** — Large code and markdown artifacts avoid full eager rendering until expanded
- [x] **Canvas virtualization** — Artifact lists are now windowed to keep large sessions responsive
- [x] **Long chat virtualization** — WorkSpaces chat history now window-renders long threads
- [x] **Blob/object URL previews** — UI previews no longer rely on base64-heavy `data:` URLs by default

### 7A. Fresh TODO — Canvas, Rendering, and Presentation
- [x] **Parsed-content cache** — Cached normalized assistant content, generated files, and inline-image extraction through the shared assistant-content cache
- [x] **Real markdown renderer for Canvas** — Replaced regex HTML conversion with `react-markdown` + `remark-gfm` + `rehype-sanitize`
- [x] **Image preview dimension caps** — Added bounded thumbnail generation for previews and full-resolution decode only when expanded
- [x] **Persist preview metadata** — Artifacts now store preview kind, dimensions, summary, presentation type, bundle metadata, and content hash
- [x] **Artifact presentation types** — Canvas now distinguishes reports, code, tables, charts, diagrams, slides, and generic files at render time
- [x] **Structured artifact bundles** — Assistant-created files/images now save into grouped bundles keyed by message/bundle metadata, and Canvas renders bundle headers
- [x] **Artifact lineage** — Canvas artifacts now persist `sourceArtifactId`, derived artifact IDs, and message linkage in the API/UI metadata path
- [x] **Table and chart rendering** — CSV/TSV/JSON artifacts now render as first-class tables or lightweight charts
- [x] **Presentation-mode exports** — Added memo, report, and dev-handoff export buttons per artifact
- [x] **Lazy-load heavy renderers** — Syntax highlighting and markdown rendering are code-split with `next/dynamic`
- [x] **Streaming render isolation** — Memoized WorkSpaces message rows and shared assistant content to reduce rerenders during streaming
- [x] **Content-size thresholds** — Large artifacts now stay in preview mode until the user explicitly loads the full render
- [x] **Render metrics** — Added optional render/decode metrics collection for assistant rows, artifact previews, and image decode paths
- [x] **Precomputed render data** — Server-side artifact metadata and client-side parsed-content caching moved expensive derivation off the hot render path

### 8. Teams (Multi-Agent)
- [ ] **Multi-agent ensembles** — Multiple agents with different roles collaborate
- [ ] **Coordinator + workers** — One agent plans, others execute
- [ ] **Role-based routing** — Messages routed to the right agent based on content
- [ ] **Team chat view** — See all agent interactions in one thread
- [ ] **Agent handoff** — Seamlessly transfer context between agents

### 9. Session Intelligence
- [ ] **Auto-continue sessions** — Agent picks up where it left off
- [ ] **Context window management** — Smart trimming, summarization for long sessions
- [ ] **Branch conversations** — Fork a session at any message
- [ ] **Compare branches** — Side-by-side view of different approaches
- [ ] **Session analytics** — Time spent, tokens used, tools called per session

### 10. UX Polish
- [ ] **Resizable right rail** — Drag to resize, not just collapse
- [ ] **Keyboard shortcuts** — Quick mode switches, send, new session
- [ ] **Drag-drop files** — Drop files directly into composer for context
- [ ] **@-mentions for files/sessions** — Reference workspace files or past sessions inline
- [ ] **Rich composer** — Markdown preview, syntax highlighting as you type
- [ ] **Notification badges** — Alert on completed background tasks
- [ ] **Activity timeline** — Chronological view of all agent actions across sessions

---

## Suggested Priority Order

### Phase 1 — Foundation (make it feel like an agent, not a chat skin) ✅ COMPLETE
1. Agent persona config + templates
2. User profile injection
3. Daily memory logs + auto-load recent memory
4. Session summaries on end

### Phase 2 — Real Capabilities
5. Shell command execution (with approval gates)
6. File system read/write in designated workspace
7. Code execution sandbox
8. Workspace directory structure (TOOLS.md, BOOT.md, skills/) ✅ COMPLETE

### Phase 3 — Autonomous Behavior
9. Heartbeat check-ins ✅ COMPLETE
10. Cron-based scheduled tasks ✅ COMPLETE
11. Proactive task nudge on incomplete objectives ✅ COMPLETE
12. Unattended model execution from automation triggers

### Phase 4 — Advanced
12. Task decomposition + sub-agent delegation
13. Canvas artifacts + versioning
14. Multi-agent teams
15. Cross-session memory search
