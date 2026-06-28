# PeakUI Architecture

This document provides a high-level overview of how PeakUI is organized.

## System Shape

```text
Browser
  |
  | WorkSpaces UI, Settings, Canvas, Knowledge Base, live browser
  v
Next.js app container
  |
  | chat streaming, auth, tools, RAG, Canvas, automation worker
  v
PostgreSQL
  |
  | users, settings, sessions, artifacts, RAG docs, audits, automation runs
  |
  +--> Ollama on host              local generation + embeddings
  +--> Optional host executor      approved host shell commands
  +--> Tor proxy + Chromium        UWAF stealth/direct browsing
```

## Layers

### Frontend

- `src/app/page.tsx` — app shell, renders WorkSpaces.
- `src/app/components/OpenClawWorkspace.tsx` — main WorkSpaces surface.
- `src/app/components/SettingsPanel.tsx` — per-user settings.
- `src/app/components/KnowledgeBase.tsx` — RAG document dashboard.
- `src/app/components/CanvasPanel.tsx` — artifact rail and previews.

### Streaming and Session Logic

- `src/lib/chat-completion.ts` — shared streaming completion pipeline for Ollama and OpenAI-compatible providers.
- `src/lib/chat-sessions.ts` — session persistence, branching, summaries, and analytics.
- `src/lib/session-intelligence.ts` — context compression, continuation detection, and health feedback.

### Tools and Browser

- `src/lib/openclaw-tools.ts` — tool request parsing.
- `src/lib/openclaw-shell*.ts` — shell approval and execution.
- `src/lib/openclaw-filesystem*.ts` — filesystem access and approvals.
- `src/lib/openclaw-code*.ts` — code sandbox execution.
- `src/lib/uwaf-*.ts` — unified browser engine, direct and stealth modes.

### Knowledge Base

- `src/lib/rag.ts` — indexing, chunking, and retrieval.
- `src/app/api/rag/*` — upload, search, health, and management routes.

### Automation

- `src/instrumentation.ts` — starts the server-side automation worker.
- `src/lib/openclaw-automation*.ts` — schedules, monitors, heartbeats, and unattended execution.

### Canvas

- `src/lib/canvas-artifacts.ts` — artifact persistence and revisions.
- `src/lib/canvas-artifact-metadata.ts` — presentation type / preview kind inference and export target resolution for binary + text artifacts.
- `src/lib/canvas-rendering.ts` — preview/edit eligibility helpers (e.g. `isBinaryArtifact`, `artifactSupportsTextEditing`).
- `src/lib/canvas-download.ts` — shared text/binary mime classifier (`isTextArtifactMimeType`) and base64 decoder (`decodeArtifactContent`) used by the download route, the preview route, the artifact POST/PUT/restore handlers, and the client-side download callbacks. The classifier is inverted (whitelists text mime types) so adding a new binary format never silently produces a corrupt download.
- `src/lib/pdf/*`, `src/lib/word/*`, `src/lib/workbook/*`, `src/lib/email/*`, `src/lib/markdown/*`, `src/lib/csv/*` — per-format schema, renderer, and artifact creator.
- `src/lib/slides/*`, `src/lib/archive/*`, `src/lib/calendar/*`, `src/lib/mermaid/*` — the four newer formats (PowerPoint, ZIP, ICS, Mermaid), each with the same schema → renderer → artifact creator → API route pipeline.
- `src/app/api/canvas/artifacts/*` — artifact CRUD, download, and the server-side preview endpoint that parses binary artifacts into a normalized JSON shape for inline preview.

## Data Model

Key Prisma models in `prisma/schema.prisma`:

- `User` — accounts, roles, and permissions.
- `UserSettings` — per-user preferences and tool permissions.
- `ChatSession` — WorkSpaces task threads.
- `ChatMessage` — serialized message history.
- `Folder` / `Tag` / `ChatSessionTag` — session organization.
- `RagDocument` / `RagChunk` — Knowledge Base content.
- `CanvasArtifact` / `CanvasArtifactRevision` — generated artifacts.
- `ShellCommandAudit` — shell command audit trail.
- `AutomationRun` / `AutomationNudge` / `AutomationSchedule` / `AutomationMonitor` — automation state.

## Security Boundaries

- Auth via JWT, permissions via account role and overrides, and tool access via personal settings.
- Interactive tools require approval tokens.
- Host executor is optional and enforces approved roots and env allowlists.
- UWAF stealth mode fails closed if Tor, DNS, or WebRTC checks fail.

## Internal Naming

The user-facing label is **WorkSpaces**. Internal identifiers use `openclaw` (routes, schema fields, CSS classes, tool tags). This document and public docs use WorkSpaces for external communication; code references remain as-is.
