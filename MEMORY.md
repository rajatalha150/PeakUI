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
- **WebSocket:** `ws` library for screencast server (standalone on port 3001 + upgrade handler on Next.js HTTP server)
- **Browser:** Playwright-core with CDP (Chrome DevTools Protocol) for live browser streaming and input relay
- **Deployment:** Docker + Docker Compose (`network_mode: host`)

## ⚠️ Known Issues — Live Interactive Browser (IN PROGRESS)

The live browser feature is partially implemented but has significant issues that need fixing:

1. **WebSocket connectivity behind reverse proxy**: The client tries same-origin `/ws/screencast` first, then falls back to port 3001. Both fail when behind an Nginx reverse proxy with TLS because:
   - Same-origin path requires Nginx to proxy WebSocket upgrades for `/ws/screencast` to port 3001 (not configured by default)
   - Direct port 3001 uses `wss://` but the port doesn't have TLS certificates
   - **Fix needed**: Either add Nginx proxy config for `/ws/screencast`, or integrate the WebSocket into the Next.js server properly

2. **`instrumentation.ts` HTTP server attachment is fragile**: The `setTimeout(1000)` approach to find the Next.js HTTP server via `process._getActiveHandles()` is unreliable. The server may not be ready yet, and the internal API is undocumented.

3. **Screencast server creates a new browser page for each WebSocket connection**: If the UWAF browser hasn't been used yet, `getPage()` creates a new context which shows a blank page. The live view should show "about:blank" or a loading state, not a blank page.

4. **No graceful degradation**: When the WebSocket fails to connect, the user sees "Connecting..." indefinitely with no helpful message or fallback to screenshot mode.

5. **BrowserModal input relay not tested**: Click/type/scroll relay via CDP hasn't been tested end-to-end yet.

6. **The `scripts/start-with-ws.mjs` and `src/app/api/ws/screencast/route.ts` files are unused/placeholder**: They should be cleaned up or properly integrated.

## 🔑 Key Files — Live Browser
| File | Purpose |
|---|---|
| `src/lib/screencast-server.ts` | WebSocket server (noServer mode), CDP screencast, interrupt/resume, cookie auth |
| `src/instrumentation.ts` | Starts screencast server, tries to attach to Next.js HTTP server |
| `src/app/components/LiveBrowserView.tsx` | Sidebar live view, WebSocket connection with fallback URLs |
| `src/app/components/BrowserModal.tsx` | Full-screen expandable browser with CDP input relay |
| `src/app/components/UwafBrowserPreview.tsx` | Static screenshot fallback |
| `src/app/components/OpenClawWorkspace.tsx` | Integration: LiveBrowserView shows when internet toggle is on |

## 🚀 Recent Fixes & Changes (Stable)

### Chat Mode System
- **Uncensored/Unrestricted modes have full tool access.** Dynamic tool-aware clause replaces anti-tool language.
- **Current date/time injected into ALL system prompts.**

### RAG Knowledge Base
- **topK=-1 (full access)** fixed across all code paths
- **KB stale detection**: 10 min timeout, moved from GET handler to POST/health only
- **KB embedding retry**: 2 retries with exponential backoff
- **KB error recovery**: Errored docs can be re-uploaded

### UWAF Browser
- Removed crash-causing Chromium flags; added retry logic in `getPage()`
- Live browser preview now ignores blank startup frames, shares connection logic between sidebar and modal, disables the sidebar feed while the modal is open, and prefers the last valid screenshot until a usable live frame arrives

## 🌐 Deployment Notes
- App runs on port `3000`, screencast WebSocket on port `3001`
- `network_mode: host` allows container to reach Ollama, Tor, and screencast server
- **Nginx Proxy Manager**: To enable WebSocket for live browser, add a custom location for `/ws/screencast` that proxies to `http://localhost:3001` with WebSocket upgrade headers:
  ```
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 86400;
  ```
- **IMPORTANT:** Never use `prisma db push --force-reset` on production — it wipes all data!

## ⏭️ Next Steps
- **Finish live browser transport hardening behind reverse proxies** — same-origin `/ws/screencast` still depends on correct Nginx/WebSocket proxying in front of the app
- **Test and refine BrowserModal input relay** — click/type/scroll via CDP now has cleaner connection handling but still needs broader manual validation
- **Clean up unused files** — `scripts/start-with-ws.mjs`, `src/app/api/ws/screencast/route.ts`
- Open Claw agent infrastructure: heartbeats/autonomous scheduling, sub-agent delegation
- Development section: Code Interpreter, Docker orchestration, VM management
