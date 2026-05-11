# PeakUI | Local AI Studio - Project Memory

## 🤖 AI Instructions
**CRITICAL:** Any AI working on this project MUST read this file first.
**CRITICAL:** Whenever you make a new git commit, you MUST update this `memory.md` file to reflect the new state of the project, the latest features added, and the next steps.

## 📝 Project Overview
PeakUI is a Next.js (App Router) web application designed to act as a local-first AI Studio command center. It connects to a user-configured Ollama host (default `127.0.0.1:11434`) for local models, and main chat can also target Hugging Face or a hybrid Ollama + Hugging Face catalog. It is fully Dockerized (`docker-compose`) and secured behind a PostgreSQL-backed authentication layer.

## 🛠️ Tech Stack
- **Frontend:** Next.js 16 (App Router, React 19), `lucide-react` icons
- **Styling:** Vanilla CSS (`globals.css`) — dark mode, glassmorphism, CSS-variable themes, accent gradients
- **Backend:** Next.js API Routes
- **Database:** PostgreSQL 15 via Prisma ORM (`prisma.config.ts` adapter pattern)
- **Auth:** `jose` Edge-compatible JWTs + `bcryptjs`, `httpOnly` cookies
- **WebSocket:** `ws` library for screencast server (port 3001)
- **Browser:** Playwright-core with CDP (Chrome DevTools Protocol) for live browser streaming and input relay
- **Deployment:** Docker + Docker Compose (`network_mode: host` for Ollama, Tor, and screencast access)

## 🚀 Recent Fixes & Changes

### Live Interactive Browser (New Feature)
A real-time interactive browser view that replaces the static screenshot preview in OpenClaw's sidebar. When the internet toggle is enabled, the sidebar shows a live JPEG stream of the browser, with the ability to take over control.

**Architecture:**
- `src/lib/screencast-server.ts`: Standalone WebSocket server on port 3001. Authenticates via `httpOnly` cookie (`auth_token` JWT) from the WebSocket upgrade request — no client-side token needed. Creates a CDP session via `page.context().newCDPSession(page)` and streams JPEG frames using `Page.startScreencast`. Supports interrupt/resume state with 2-minute auto-resume timer.
- `src/instrumentation.ts`: Starts/stops the screencast WebSocket server on Next.js `register()` lifecycle hook.
- `src/app/components/LiveBrowserView.tsx`: Sidebar component. Connects to WebSocket, renders live JPEG frames, shows connection status (Connecting/Live/Offline), Take Over/Resume AI buttons. Falls back to static screenshot when disconnected. Shows a "Connecting to browser..." placeholder when no frames are available yet.
- `src/app/components/BrowserModal.tsx`: Full-screen overlay for expanded live browser. Supports click, type, scroll, and keypress relay via CDP `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` / `Input.insertText`. Coordinate scaling from client viewport to 1280×720. Shows "YOU HAVE CONTROL" banner when interrupted.
- `src/app/components/UwafBrowserPreview.tsx`: Static screenshot fallback — used when Live Browser is disabled in settings.

**WebSocket Protocol:**
- Client → Server: `{ type: 'input', payload: { inputType: 'click'|'scroll'|'type'|'keypress', ... } }`, `{ type: 'interrupt' }`, `{ type: 'resume' }`, `{ type: 'ping' }`
- Server → Client: `{ type: 'frame', data: '<base64 jpeg>' }`, `{ type: 'state', aiActive: boolean, interrupted: boolean }`, `{ type: 'notification', message: string }`, `{ type: 'pong' }`

**Interrupt/Resume Mechanism:**
- "Take Over" button sets `client.interrupted = true` on the screencast server
- `/api/openclaw/uwaf-browser` route polls `isBrowserInterrupted(userId, sessionId)` — waits up to 2 minutes while browser is interrupted
- User input events (click/type/scroll) only relayed through CDP when `interrupted === true`
- Auto-resume timer resets on every user input; after 2 min of inactivity, AI control resumes automatically
- "Resume AI" button clears the interrupt flag immediately

**Rendering Logic:**
- LiveBrowserView appears in the sidebar whenever: `internetEnabled && openClawUwafBrowserMode !== 'deny' && openClawUwafLiveBrowser && currentSessionId`
- Does NOT require a screenshot to exist — shows connecting/waiting state when no browser activity yet
- UwafBrowserPreview (static screenshot) only shows when Live Browser is disabled and a screenshot exists
- BrowserModal "Expand" button opens a full-screen popup with interactive browser view

**Authentication:**
- WebSocket auth reads `auth_token` from the `httpOnly` cookie in the upgrade request headers (no client-side JS needed)
- Falls back to URL `?token=` parameter if cookie not present
- JWT validated via `verifyToken()` — same auth as the rest of the app

**Settings:**
- `openClawUwafLiveBrowser` boolean toggle in Settings Panel (default: true)
- Added to Prisma schema, settings lib, API route, SettingsPanel UI
- When disabled, falls back to static UwafBrowserPreview

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
| `src/app/components/OpenClawWorkspace.tsx` | Open Claw agent workspace, internet toggle, live browser integration |
| `src/app/components/LiveBrowserView.tsx` | Live browser view (WebSocket JPEG stream, Take Over/Resume) |
| `src/app/components/BrowserModal.tsx` | Full-screen expandable browser with CDP input relay |
| `src/app/components/UwafBrowserPreview.tsx` | Static screenshot fallback |
| `src/app/components/UwafNetworkPanel.tsx` | Network hub panel (Direct/Stealth mode toggle) |
| `src/app/components/SettingsPanel.tsx` | Settings UI (includes Live Browser toggle) |
| `src/lib/screencast-server.ts` | WebSocket screencast server (CDP frames, interrupt/resume, input relay, cookie auth) |
| `src/lib/uwaf-pool.ts` | Playwright browser pool manager (contexts, pages, Tor proxy) |
| `src/lib/uwaf-browser.ts` | UWAF browser actions (navigate, click, extract, etc.) |
| `src/lib/chat-completion.ts` | System prompt assembly, mode handling, streaming completion |
| `src/lib/rag.ts` | RAG search, context building, RRF fusion |
| `src/instrumentation.ts` | Next.js startup hook (screencast server lifecycle) |
| `src/app/api/openclaw/uwaf-browser/route.ts` | UWAF browser API with interrupt check |

## 🌐 Deployment Notes
- App runs on port `3000`, screencast WebSocket on port `3001`
- `network_mode: host` allows container to reach Ollama (`127.0.0.1:11434`), Tor (`localhost:9050`), and screencast (`localhost:3001`)
- `SCREENCAST_PORT` env var configures WebSocket port (default: 3001)
- `SCREENCAST_QUALITY`, `SCREENCAST_WIDTH`, `SCREENCAST_HEIGHT` env vars configure stream params
- Behind Nginx Proxy Manager: add `proxy_buffering off; proxy_read_timeout 300s; proxy_http_version 1.1; proxy_set_header Connection '';` and for WebSocket: `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";` for port 3001
- **IMPORTANT:** Never use `prisma db push --force-reset` on production — it wipes all data!

## ⏭️ Next Steps
- Open Claw agent infrastructure: heartbeats/autonomous scheduling, sub-agent delegation
- Development section: Code Interpreter, Docker orchestration, VM management
- Internet mode Phase 2: browser extension context flow
- RAG: consider raising context limits further for large knowledge bases
- Live Browser: mobile touch optimization, FPS/resolution settings UI, error boundary