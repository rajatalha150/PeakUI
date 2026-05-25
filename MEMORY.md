# PeakUI | Local AI Studio - Project Memory

## 🤖 AI Instructions
**CRITICAL:** Any AI working on this project MUST read this file first.
**CRITICAL:** Whenever you make a new git commit, you MUST update this `memory.md` file to reflect the new state of the project, the latest features added, and the next steps.

## 📝 Project Overview
PeakUI is a Next.js (App Router) web application designed to act as a local-first Open Claw AI Studio command center. It connects to a user-configured Ollama host (default `127.0.0.1:11434`) for local models, and Open Claw can target OpenAI-compatible providers when configured. The legacy chat completion APIs remain as shared backend infrastructure, but the user-facing app now opens directly into Open Claw. It is fully Dockerized (`docker-compose`) and secured behind a PostgreSQL-backed authentication layer.

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
| `src/app/components/UwafBrowserPreview.tsx` | Legacy static preview component; live noVNC browser is the active visual browsing surface |
| `src/app/components/OpenClawWorkspace.tsx` | Integration: LiveBrowserView shows when internet toggle is on |

## ✅ Recent UI Update — Open Claw Header Cleanup

- Desktop Open Claw mode controls were consolidated into one featured `Workspace modes` dropdown in the shared top bar.
- That single menu now contains Internet, UWAF Direct/Stealth, RAG, Unrestricted, and Uncensored instead of rendering five separate top-bar buttons.
- Mobile keeps the existing overflow-menu pattern, and the desktop dropdown closes on outside click, `Esc`, and viewport collapse.

## ✅ Recent UI Update — Open Claw-Only Shell

- The app now boots directly into the Open Claw workspace instead of restoring the old normal chat surface.
- The normal chat sidebar/top-level surface is no longer part of the reachable app shell; Open Claw's rail is the single left navigation model.
- Workspace, Knowledge Base, Settings, task sessions, folders, tags, and search all stay inside the Open Claw shell.
- Settings now render as an Open Claw main-panel view, and Logout moved into the Settings header.
- Legacy `/api/chat/*` routes and shared completion helpers remain available as backend infrastructure for streaming and compatibility.

## 🚀 Recent Fixes & Changes (Stable)

### Open Claw Workspace Rail
- Workspace state controls now live behind one `Workspace controls` launcher in the rail instead of stacking every card below the session list.
- The session list is now paged at 15 task threads per page with range labels plus Previous/Next controls.
- Rail scrolling now uses one main scroll container, and Open Claw chat sticky-scroll is throttled to reduce jumpiness during streaming.
- Raw internal `<openclaw_tool>` bridge messages are stripped and hidden before session persistence/reload so reopened Open Claw sessions do not crash on leaked tool turns.
- Local Ollama refresh/switch flows now skip redundant compatible-provider verification calls and rely on model discovery plus Ollama health instead.

### Chat Mode System
- **Uncensored/Unrestricted modes have full tool access.** Dynamic tool-aware clause replaces anti-tool language.
- **Current date/time injected into ALL system prompts.**

### RAG Knowledge Base
- **topK=-1 (full access)** fixed across all code paths
- **KB stale detection**: 10 min timeout, moved from GET handler to POST/health only
- **KB embedding retry**: 2 retries with exponential backoff
- **KB error recovery**: Errored docs can be re-uploaded

### File & Media Uploads
- WorkSpaces image uploads are vision-first: native image bytes stay attached by default, while OCR text is optional supplemental context.
- Per-image modes let users choose `Vision only`, `Vision + OCR`, or `OCR only`.
- HEIC/HEIF, TIFF, BMP, AVIF, and related still-image formats are normalized to JPEG before Ollama receives them, using `sharp` first and `heif-convert`/ImageMagick fallbacks when runtime codec support is external.
- Image payloads now preserve `data`, `mimeType`, and `name` through chat serialization so server-side normalization can make model-facing bytes safe.
- Audio/video files are detected by MIME or extension instead of generic binary fallback, but remain metadata-only until transcription/frame extraction is implemented.

### Canvas Artifacts
- Canvas now stores durable `CanvasArtifactRevision` snapshots on create, edit, and restore instead of only incrementing a version counter.
- The Canvas API supports revision history/restore through `/api/canvas/artifacts/[id]/revisions`.
- Artifact lists now support search, cursor paging, totals, and load-more behavior beyond the old fixed 100-artifact cap.
- Bundles can collapse/expand, export as grouped JSON, or delete all artifacts in a group.
- Artifact cards expose source/derived lineage links, lightweight revision comparison, restore controls, and retryable error states for content/history/list loading.

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
- Stealth mode now uses a broader versioned desktop fingerprint catalog with deterministic per-session selection across locale, timezone, platform, hardware concurrency, device memory, viewport, screen size, and WebGL identity.
- Added `normal` and `high` stealth profiles with different Chromium launch flags and fingerprint bias; high profile is used automatically for `.onion`, hidden-service, or research-batch flows and can also be requested explicitly.
- Stealth init scripts now normalize more browser surfaces: `navigator.userAgentData`, plugins/mime-types, screen/window sizing, media-device exposure, `navigator.connection`, WebGL vendor/renderer, and `doNotTrack`.
- Stealth preflight now includes cached fingerprint-regression checks against known detector pages in addition to Tor reachability, DNS leak, WebRTC constructor removal, media-capture denial, and UDP/proxy-bypass verification.
- Stealth search now rotates across multiple providers such as Ahmia, DuckDuckGo Lite, and Startpage, with provider scoring, degradation cooldowns, and curated entry-point metadata exposed through the status route.
- Tor audit fixes now keep approval/preflight/execution on the same resolved stealth profile, block non-proxy host resolution for stealth Chromium, and avoid duplicate `.onion` pre-navigation checks on successful opens while preserving precise diagnostics on failures.

### Open Claw Session Management
- Open Claw task threads now have organization controls in the primary rail: folder assignment/filtering, reusable tags, pin/unpin, inline rename, copy-to-clipboard, and per-thread delete
- Added bulk session management in the Open Claw rail: select multiple task threads, delete the selected set, or clear all Open Claw sessions at once
- Extended the shared `/api/chats` deletion path to support bulk deletes by explicit `ids` or by `surface`, so clear-all only removes `surface: 'openclaw'` sessions without touching normal chat history

## 🌐 Deployment Notes
- App runs on port `3000`, and the standalone live-browser websocket bridge listens on `3001` as a fallback if same-origin attachment is unavailable
- `network_mode: host` allows the container to reach Ollama, Tor, and the live-browser bridge
- The Docker runtime includes media conversion/OCR helpers: `poppler-utils`, `tesseract-ocr`, `imagemagick`, `imagemagick-heic`, `imagemagick-tiff`, `imagemagick-webp`, and `libheif-tools`
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
- Consider propagating role/permission state into the Open Claw rail so feature tabs hide proactively instead of relying only on backend enforcement
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
