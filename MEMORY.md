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
- **WebSocket:** `ws` library for authenticated control + VNC bridge (standalone on port 3001 + upgrade handler on Next.js HTTP server)
- **Browser:** Playwright-core with headed Chromium per session, `Xvfb`, `x11vnc`, and noVNC for true live interactive browser sharing
- **Deployment:** Docker + Docker Compose (`network_mode: host`)

## ⚠️ Known Issues — Live Interactive Browser

The old screenshot/CDP screencast path has been replaced. The current live browser architecture is a real headed-browser display share and is working, but there are still a few follow-ups:

1. **Reverse-proxy websocket support still matters**: the preferred path is now same-origin `/ws/live-browser/control` and `/ws/live-browser/vnc`, attached directly to the Next.js HTTP server. Fronting proxies still need to pass websocket upgrades correctly.
2. **`instrumentation.ts` server attachment still relies on active-handle discovery**: the transport no longer depends on a separate screenshot port, but attaching upgrade handlers still uses `process._getActiveHandles()` polling and should eventually move to a more explicit startup hook if Next exposes one.
3. **Unused legacy files should still be cleaned up**: `scripts/start-with-ws.mjs` and `src/app/api/ws/screencast/route.ts` are still legacy leftovers.

## 🔑 Key Files — Live Browser
| File | Purpose |
|---|---|
| `src/lib/live-browser-server.ts` | Authenticated control socket + raw VNC WebSocket bridge for the real interactive browser |
| `src/lib/screencast-server.ts` | Compatibility re-export for older imports |
| `src/lib/uwaf-pool.ts` | Per-session headed Chromium runtime under `Xvfb` + `x11vnc` |
| `src/instrumentation.ts` | Starts the live-browser bridge and attaches websocket upgrades to the Next.js HTTP server |
| `src/app/components/useLiveBrowserConnection.ts` | Shared control/noVNC connection hook for sidebar and modal |
| `src/app/components/LiveBrowserView.tsx` | Sidebar live interactive browser surface |
| `src/app/components/BrowserModal.tsx` | Full-screen expandable interactive browser surface |
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
- Live browser is now a true interactive remote display instead of frame polling: headed Chromium runs under `Xvfb`, `x11vnc` exposes the session, and the client embeds noVNC over authenticated websocket paths
- Manual user navigation now refreshes AI-side page metadata before later click/fill/extract actions, so Take Over no longer leaves the agent acting on stale page structure
- Open Claw now routes visible searches/page visits through the shared `unified_browser` when UWAF is available, including a new visible `search` action
- UWAF session tracking now follows the active Playwright page and brings it to the front before/after actions, preventing the user-facing noVNC view from staying on a stale blank tab while the AI browses elsewhere
- Added `wait_for_user` human-assist flow: the model can pause for CAPTCHA/login/MFA/bot checks, the UI opens the live browser in Take Over mode, and after Resume AI the agent observes the updated page state and continues
- Unified browser results are now evidence-driven instead of optimistic: validated search checks detect homepage bounces, zero-result pages, anti-bot gates, login redirects, and no-op interactions before the model can treat them as success
- Added richer browser actions: `type`, `press`, `wait_for_selector`, `scroll`, `back`, `forward`, `new_tab`, `list_tabs`, `switch_tab`, `close_tab`, `select`, and `hover`
- Browser results now return redirect state, HTTP status when available, query-match flags, result counts, tab state, selector/wait outcomes, and recent JS/network failures; the Open Claw prompt instructs the model to treat those fields as authoritative evidence

## 🌐 Deployment Notes
- App runs on port `3000`, and the standalone live-browser websocket bridge listens on `3001` as a fallback if same-origin attachment is unavailable
- `network_mode: host` allows the container to reach Ollama, Tor, and the live-browser bridge
- **Nginx Proxy Manager**: if you proxy the app externally, websocket upgrades must reach the app server so `/ws/live-browser/control` and `/ws/live-browser/vnc` work:
  ```
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 86400;
  ```
- **IMPORTANT:** Never use `prisma db push --force-reset` on production — it wipes all data!

## ⏭️ Next Steps
- Manual UI pass for Settings → User Management: create user, role change, permission override, deactivate, reset password, delete
- Consider propagating role/permission state into the main navigation so feature tabs hide proactively instead of relying only on backend enforcement
- Consider dedicated account recovery / forced-password-rotation flows if this app will be shared across more operators
- **Manual UX validation of noVNC interaction** — protocol-level VNC handshake is confirmed, but broader browser-side mouse/keyboard validation across sidebar and modal is still worth doing
- **End-to-end human-assist validation** — test a real CAPTCHA/auth/MFA-style site manually to confirm `wait_for_user` pauses, takeover, resume, and post-resume extraction all behave correctly with the selected model
- **Clean up unused files** — `scripts/start-with-ws.mjs`, `src/app/api/ws/screencast/route.ts`
- Open Claw agent infrastructure: heartbeats/autonomous scheduling, sub-agent delegation
- Development section: Code Interpreter, Docker orchestration, VM management

## 🔐 Latest Changes — Auth & User Management
- Hardened authentication:
  - JWTs now carry issuer/audience/subject/type/tokenVersion claims
  - auth cookies now use consistent `sameSite=lax`, `priority=high`, secure detection, and mirrored logout clearing
  - production now requires a real `JWT_SECRET`; container runtime auto-generates and persists one in `/var/lib/peakui/jwt-secret` when none is supplied
  - login/bootstrap now validates usernames and strong passwords, checks inactive accounts, updates `lastLoginAt`, and uses a serializable transaction for first-admin bootstrap races
- Expanded user model:
  - `User` now tracks `isActive`, `tokenVersion`, `permissionOverrides`, `lastLoginAt`, and `updatedAt`
  - added `MANAGER` role between `ADMIN` and `USER`
- Added centralized authorization:
  - new `src/lib/permissions.ts` defines role defaults plus explicit allow/deny overrides
  - new `src/lib/request-auth.ts` resolves the current authenticated DB user, rejects inactive users and stale token versions, and exposes permission-aware helpers
  - migrated deprecated `src/middleware.ts` to `src/proxy.ts`
- Added admin user-management APIs:
  - `GET/POST /api/admin/users`
  - `PATCH/DELETE /api/admin/users/[id]`
  - includes last-active-admin safeguards, password reset, activation toggle, role changes, and permission override persistence
- Added authenticated session API:
  - `GET /api/auth/session` returns current user role and effective permissions
- Added Settings UI for user management:
  - admin-only section in `src/app/components/SettingsPanel.tsx`
  - create users, change roles, toggle activation, reset passwords, set per-permission overrides, and view effective permissions
- Enforced permissions server-side for:
  - knowledge base routes (`knowledge.use`)
  - canvas artifact routes (`canvas.use`)
  - OpenClaw access, including filesystem/browser/UWAF/shell sub-capabilities
  - live-browser WebSocket authentication now checks DB-backed permission state, not just JWT validity
