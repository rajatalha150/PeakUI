# PeakUI | Local AI Studio - Project Memory

## 🤖 AI Instructions
**CRITICAL:** Any AI working on this project MUST read this file first.
**CRITICAL:** Whenever you make a new git commit, you MUST update this `memory.md` file to reflect the new state of the project, the latest features added, and the next steps.

## 📝 Project Overview
PeakUI is a Next.js (App Router) web application designed to act as a local-first AI Studio command center. It connects to a user-configured Ollama host (default `127.0.0.1:11434`) for local models, and main chat can also target Hugging Face or a hybrid Ollama + Hugging Face catalog. It is fully Dockerized (`docker-compose`) and secured behind a PostgreSQL-backed authentication layer.

## 🛠️ Tech Stack
- **Frontend:** Next.js 16 (App Router, React), `lucide-react` icons
- **Styling:** Vanilla CSS (`globals.css`) — dark mode, glassmorphism, CSS-variable themes, accent gradients
- **Backend:** Next.js API Routes
- **Database:** PostgreSQL 15 via Prisma ORM (`prisma.config.ts` adapter pattern)
- **Auth:** `jose` Edge-compatible JWTs + `bcryptjs`, `httpOnly` cookies
- **WebSocket:** `ws` library for screencast server (port 3001)
- **Deployment:** Docker + Docker Compose (`network_mode: host` for Ollama access)

## 🚀 Recent Fixes & Changes

### Live Interactive Browser (New Feature)
- **Screencast WebSocket server** (`src/lib/screencast-server.ts`): Streams live browser frames via CDP `Page.startScreencast` over WebSocket on port 3001. JWT auth on upgrade, per-session CDP sessions, auto-reconnect on disconnect.
- **LiveBrowserView component** (`src/app/components/LiveBrowserView.tsx`): Replaces static screenshot in OpenClaw sidebar when Live Browser is enabled. Shows live JPEG stream, connection status, Take Over/Resume AI buttons.
- **BrowserModal component** (`src/app/components/BrowserModal.tsx`): Full-screen overlay for expanded live browser view. Supports click, type, scroll, and keypress relay via CDP. Coordinates scaled from client viewport to 1280x720 browser viewport.
- **Interrupt/Resume mechanism**: "Take Over" button pauses AI browser actions (server-side flag checked in UWAF API route). Auto-resumes after 2 minutes of inactivity. "Resume AI" button returns control.
- **Settings**: `openClawUwafLiveBrowser` toggle in Settings Panel (on by default). Falls back to static screenshot mode when disabled.
- **Startup hook** (`src/instrumentation.ts`): Starts/stops screencast WebSocket server on Next.js lifecycle.

### Chat Mode System (All Modes)
- **Uncensored/Unrestricted modes now have full tool access.** Previous bug: `openClawPrompt` was excluded from uncensored/unrestricted system prompts.
- **Uncensored instructions updated:** Dynamic tool-aware clause replaces anti-tool language.
- **Current date/time injected into ALL system prompts** so the AI always knows the current date.

### RAG Knowledge Base (Full Access Fix)
- **topK=-1 (full access)** fixed across 5 code paths (client, search route, rag.ts, page.tsx)
- **KB stale detection:** 10 min timeout; moved from GET handler to POST/health only
- **KB embedding retry:** 2 retries with exponential backoff
- **KB error recovery:** Errored docs can be re-uploaded

### UWAF Browser
- Removed crash-causing Chromium flags; added retry logic in `getPage()`

## 🔑 Key Files
| File | Purpose |
|---|---|
| `src/app/page.tsx` | Main dashboard, chat, session management, surface-aware navigation |
| `src/app/components/OpenClawWorkspace.tsx` | Open Claw agent workspace |
| `src/app/components/LiveBrowserView.tsx` | Live browser view (WebSocket JPEG stream) |
| `src/app/components/BrowserModal.tsx` | Full-screen expandable browser with input relay |
| `src/app/components/UwafBrowserPreview.tsx` | Static screenshot fallback |
| `src/app/components/SettingsPanel.tsx` | Settings UI (includes Live Browser toggle) |
| `src/lib/screencast-server.ts` | WebSocket screencast server (CDP frames, interrupt/resume, input relay) |
| `src/lib/uwaf-pool.ts` | Playwright browser pool manager |
| `src/lib/uwaf-browser.ts` | UWAF browser actions (navigate, click, extract, etc.) |
| `src/instrumentation.ts` | Next.js startup hook (screencast server lifecycle) |
| `src/lib/chat-completion.ts` | System prompt assembly, mode handling, streaming completion |
| `src/lib/rag.ts` | RAG search, context building, RRF fusion |

## 🌐 Deployment Notes
- Runs on port `3000`, accessible via `localhost:3000` or LAN IP
- **Screencast WebSocket** runs on port `3001` (configurable via `SCREENCAST_PORT` env)
- **IMPORTANT:** Never use `prisma db push --force-reset` on production — it wipes all data!
- `network_mode: host` allows container to reach Ollama, Tor, and screencast server
- Behind Nginx Proxy Manager: add `proxy_buffering off; proxy_read_timeout 300s; proxy_http_version 1.1; proxy_set_header Connection '';`
- For WebSocket support in Nginx, also add: `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";` for `/ws` location

## ⏭️ Next Steps
- Open Claw agent infrastructure: heartbeats/autonomous scheduling, sub-agent delegation
- Development section: Code Interpreter, Docker orchestration, VM management
- Internet mode Phase 2: browser extension context flow
- RAG: consider raising context limits further for large knowledge bases
- Live Browser: add resolution/FPS settings, mobile touch optimization, error boundary