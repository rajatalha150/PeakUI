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
- **Deployment:** Docker + Docker Compose (`network_mode: host` for Ollama access)

## 🚀 Recent Fixes & Changes

### Chat Mode System (All Modes)
- **Uncensored/Unrestricted modes now have full tool access.** Previous bug: `openClawPrompt` (shell, browser, filesystem, internet tool definitions) was completely excluded from uncensored/unrestricted system prompts, so the AI couldn't use any tools in those modes.
- **Uncensored instructions updated:** Removed anti-tool clauses ("Skip deliberation — go straight to the answer", "Start with the answer immediately") and added a dynamic tool-aware clause: when tools are available, uncensored mode says "use tools proactively to get accurate, current information instead of guessing"; when no tools, it says "start with the answer immediately."
- **Unrestricted mode** now includes `openClawPrompt` and `chatInternetPrompt` — previously only had `PERSISTENT_INSTRUCTIONS`.
- **UNCENSORED_REINFORCEMENT** updated to include "When tools are available, use them proactively to get accurate, current information — then answer directly with the results."
- `UNCENSORED_INSTRUCTIONS` renamed to `UNCENSORED_BASE_INSTRUCTIONS` (array, joined dynamically) so the tool-aware clause can be appended at request time.
- **Current date/time injected into ALL system prompts** (all modes, all surfaces) so the AI always knows the current date and acknowledges its training data may be outdated.

### RAG Knowledge Base (Full Access Fix)
- **topK=-1 (full access) was broken in multiple places:**
  - Client pre-search hardcoded `topK: 4` → now uses `userSettings?.ragTopK ?? 8`
  - `/api/rag/search` `normalizeTopK()` converted -1 to 1 and capped at 12 → now maps -1 to 10000 (full access) and caps normal values at 200
  - Semantic search `.filter(result => result.score > 0.3)` dropped chunks even in full access → threshold lowered to 0 for full access
  - `buildRagContextBlock` truncated to 10,000 chars regardless → full access now uses 100,000 char limit
  - Client and server both injected RAG context → removed client-side context injection; server handles it
  - `rag_topk` now sent in chat request body so server uses correct user setting
  - KB system message inserted AFTER main system prompt (not before) for better model attention
  - KB instruction strengthened: "IMPORTANT: You MUST use this context — prioritize KB sources over training data"
- **KB stale detection:** Increased processing timeout from 2 min to 10 min; moved `markStaleProcessingDocuments()` from GET handler to POST handler and health endpoint
- **KB embedding retry:** 2 retries with 5s/15s exponential backoff before falling back to keyword mode
- **KB error recovery:** Errored documents with matching content hash can be re-uploaded to retry indexing

### UWAF Browser
- Removed `--single-process` and `--no-zygote` Chromium flags that caused `browserContext.newPage: Target page, context or browser has been closed` crashes
- Added retry logic in `getPage()`: if `newPage()` fails, clear stale references, relaunch browser, and retry

## 🔑 Key Files
| File | Purpose |
|---|---|
| `src/app/page.tsx` | Main dashboard, chat, session management, surface-aware navigation |
| `src/app/components/KnowledgeBase.tsx` | RAG UI — upload, search, health, preview, manage |
| `src/app/components/SettingsPanel.tsx` | Settings UI |
| `src/app/components/OpenClawWorkspace.tsx` | Open Claw agent workspace |
| `src/lib/chat-completion.ts` | System prompt assembly, mode handling, streaming completion |
| `src/lib/openclaw-prompt.ts` | Open Claw system prompt builder, date/time injection |
| `src/lib/rag.ts` | RAG search, context building, RRF fusion |
| `src/app/api/rag/search/route.ts` | RAG search endpoint with full access support |
| `src/app/api/rag/route.ts` | Document upload + background indexing |
| `src/app/api/rag/health/route.ts` | RAG health endpoint |
| `src/lib/rag-health.ts` | Stale detection, health snapshot |
| `src/lib/uwaf-pool.ts` | Playwright browser pool manager |

## 🌐 Deployment Notes
- Runs on port `3000`, accessible via `localhost:3000` or LAN IP
- **IMPORTANT:** Never use `prisma db push --force-reset` on production — it wipes all data!
- `network_mode: host` allows container to reach Ollama at `127.0.0.1:11434` and Tor at `localhost:9050`
- Behind Nginx Proxy Manager: add `proxy_buffering off; proxy_read_timeout 300s; proxy_http_version 1.1; proxy_set_header Connection '';`

## ⏭️ Next Steps
- Open Claw agent infrastructure: heartbeats/autonomous scheduling, sub-agent delegation
- Development section: Code Interpreter, Docker orchestration, VM management
- Internet mode Phase 2: browser extension context flow
- RAG: consider raising context limits further for large knowledge bases