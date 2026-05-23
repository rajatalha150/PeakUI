---
name: Project Overview
description: PeakUI local AI Studio — architecture, tech stack, key features, and UWAF browser integration
type: project
---

PeakUI is a local-first AI Studio web app built on Next.js 16 (App Router), React 19, Prisma 7, and PostgreSQL 15, deployed via Docker Compose.

**Development platform:** Windows 11 Pro (Build 26200 / 25H2) with Docker Desktop (WSL2 backend).

**Core capabilities:**
- Chat with Ollama, HuggingFace, or Hybrid model selection; streaming responses with session management, folders, tags, and search
- WorkSpaces agent workspace (formerly "Open Claw") with task modes, shell execution (container/host), filesystem access, code sandbox, browser tool, canvas artifacts, and multi-layer memory
- Knowledge Base / RAG with hybrid semantic+BM25 search, document upload (PDF, DOCX, code, etc.), and per-chat RAG toggle
- Internet mode with backend-managed web search (Brave/SearXNG/DuckDuckGo/Bing) and citation rendering
- JWT auth with admin-only user management; per-user settings (themes, model defaults, persona, permissions)
- **UWAF (Unified Web Agent Framework):** Dual-mode browser engine supporting Direct (Clear Web) and Stealth (Tor-routed) modes, Playwright rendering, sanitize-first HTML→Markdown pipeline, screenshots, table extraction, research batch crawling, and binary download blocking

**Why:** Designed as a self-hosted, privacy-respecting AI command center that runs entirely local models via Ollama, with optional cloud inference via HuggingFace, and anonymous dark web research via Tor.

**How to apply:** When working on this project, understand that it's a monolithic Next.js app (single `page.tsx` + components + API routes). The `memory.md` file at project root is the detailed changelog/roadmap — consult it for feature history and next steps. Key libs are `jose` for JWT, `bcryptjs` for passwords, `pg` + `@prisma/adapter-pg` for DB, `ollama` SDK for model interaction, `playwright-core` + system Chromium for UWAF browser, and `turndown` for HTML→Markdown conversion. Styling is vanilla CSS (glassmorphism, CSS variables, dark mode) — no Tailwind or CSS-in-JS.

**Windows Docker Notes:**
- The original `docker-compose.yml` uses `network_mode: host`, which is unsupported on Windows Docker Desktop.
- Use `docker-compose.windows.yml` for Windows deployments. It uses a named bridge network and service names for inter-container communication.
- Ollama must be restarted with `OLLAMA_HOST=0.0.0.0:11434` for containers to reach it via `host.docker.internal:11434`.
- See `WINDOWS-SETUP.md` and `setup-windows.ps1` for full Windows deployment instructions.

**WorkSpaces Rename:** The workspace feature previously called "Open Claw" is now displayed as **"WorkSpaces"** in the UI. This is a cosmetic, UI-only change. All internal code, API routes (`/api/openclaw/*`), database fields (`openClaw*` columns), CSS classes (`.openclaw-*`), and system prompts remain unchanged.

**Key new dependencies:** `playwright-core` (browser engine), `turndown` (HTML→Markdown), `@types/turndown` (types)

**Key new Docker services:** `tor-proxy` (peterdavehello/tor-socks-proxy) on host port 9050 (container port 9150)

**Key new env vars:** `TOR_PROXY_URL` (default: `socks5://localhost:9050`), `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (default: `/usr/bin/chromium-browser`)

**UWAF architecture:** The UWAF browser uses Playwright-core with system Chromium in headless mode. Direct mode connects without proxy; Stealth mode routes through the Tor SOCKS5 proxy. Browser contexts are managed by `uwaf-pool.ts` with lazy init, 30-minute TTL, and auto-cleanup. The sanitize pipeline in `uwaf-sanitizer.ts` runs three stages: HTML pruning, readability filtering, and Turndown-based Markdown conversion. Stealth mode applies stricter sanitization (stripping inline styles, data attributes, tracking URL parameters). The `unified_browser` tool is integrated into WorkSpaces alongside the existing `browser` tool for backward compatibility. Approval tokens are always required for `submit` and `research_batch` actions regardless of mode.