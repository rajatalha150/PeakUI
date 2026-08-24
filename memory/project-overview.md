---
name: project-overview
description: PeakUI public open-source project overview — architecture, mission, and key capabilities
type: project
---

# PeakUI

**PeakUI** is a local-first, self-hosted AI studio built by [Muhammad Talha Raza](https://peakservices-inc.com) and owned by **Peak Services INC**.

It gives individuals and small teams a privacy-respecting, self-controlled command center for local LLMs and OpenAI-compatible providers. The flagship surface is **WorkSpaces**, an agentic workspace with persistent task threads, tools, Canvas artifacts, Knowledge Base RAG, session intelligence, and background automation.

## Mission

Provide an open, local-first alternative to cloud-hosted chat and agent platforms:

- Your models, documents, browsing, and execution environment stay under your control.
- Built for developers, power users, privacy-conscious teams, and security researchers who want transparent, auditable AI tooling.
- Designed to be self-hosted via Docker Compose with minimal external dependencies.

## Architecture

- **Framework**: Next.js 16 (App Router), React 19, TypeScript
- **Database**: PostgreSQL 15 via Prisma 7 ORM
- **Auth**: JWT tokens via `jose`, bcrypt password hashing
- **Styling**: Vanilla CSS with glassmorphism UI and CSS variable themes
- **Container**: Docker & Docker Compose
- **Local inference**: Ollama
- **Browser automation**: Playwright Core with system Chromium
- **Document processing**: `officeparser`, `pdf-lib`, `poppler-utils`, `tesseract`

## Core Capabilities

- **WorkSpaces**: Persistent agent workspace with task modes (Plan, Research, Execute, Review), workspace notes, success criteria, checklists, and named project workspaces.
- **Session Intelligence**: Rolling summaries, context health, auto-continue modes, branching, branch comparison, and analytics.
- **Knowledge Base (RAG)**: PostgreSQL-backed document index with semantic, keyword, and hybrid RRF retrieval; supports PDFs, Office files, code, archives, and OCR fallback.
- **Canvas**: Persistent artifact generation with previews, downloads, revisions, lineage, search, and bundle export.
- **Tools**: Shell, filesystem, code sandbox, public browser, and UWAF Direct/Stealth browser with approval gates.
- **Automation**: Heartbeats, cron schedules, URL/file monitors, wake events, and guarded unattended local Ollama runs.
- **Media**: Vision-first image handling, PDF page rasterization for vision-capable models, and audio/video metadata detection.

## Internal Naming Note

The public UI label is **WorkSpaces**. The internal implementation still uses `workspace-tool` identifiers in API routes (`/api/workspace-tool/*`), database fields, CSS classes, and tool tags such as `<workspace_tool>`. This is a legacy internal codename; external documentation and UI labels use WorkSpaces.

## Repository Health

- Build: `npm run build`
- Tests: `npm test`
- Docker: `docker compose up -d --build`

**Owner:** Peak Services INC  
**Author:** Muhammad Talha Raza  
**Contact:** info@peakservices-inc.com  
**Website:** https://peakservices-inc.com
