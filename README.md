# PeakUI

PeakUI is a local-first AI studio built around **WorkSpaces**, a persistent agent workspace for local Ollama models, OpenAI-compatible providers, RAG, tools, browser research, Canvas artifacts, automation, and session intelligence.

The UI label is **WorkSpaces**. The internal implementation still uses `openclaw` names in routes, schema fields, CSS classes, and tool tags such as `<openclaw_tool>`.

## At A Glance

| Area | What it does |
|---|---|
| WorkSpaces | Main agent shell for task threads, model selection, modes, tools, settings, and Knowledge Base |
| Local models | Ollama-first generation with health checks, model stop, exclusive switching, and context backoff |
| Remote providers | OpenAI-compatible endpoints, including Hugging Face router, TGI, vLLM, and SGLang-style servers |
| Knowledge Base | PostgreSQL-backed document index with semantic, keyword, hybrid RRF, source chips, and full-access mode |
| Canvas | Persistent artifacts, bundles, revisions, lineage, search, restore, and exports |
| Tools | Shell, filesystem, code sandbox, public browser, and UWAF Direct/Stealth browser with approval gates |
| Automation | Heartbeats, cron tasks, monitors, wake events, nudges, and guarded unattended local Ollama runs |
| Session intelligence | Rolling summaries, context health, auto-continue modes, branches, branch compare, and analytics |

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

## What Is Shipped

### WorkSpaces

- Opens as the primary app shell.
- Keeps Workspace, Knowledge Base, Settings, task threads, folders, tags, and logout in one left rail.
- Uses a shared top bar for model selection, Ollama health, and the `Workspace modes` menu.
- Supports task modes: `Plan`, `Research`, `Execute`, and `Review`.
- Keeps workspace notes, success criteria, pinned checklist, persona, user profile, shell settings, and capability status in one Workspace controls modal.
- Pages task threads 15 at a time so long histories remain usable.

### Session Intelligence

- Per-thread auto-continue policy: `manual`, `ask`, or `safe`.
- Safe auto-continue only follows unfinished tool-driven turns and respects a step cap.
- Long sessions use rolling context summaries instead of blind transcript trimming.
- Context health is surfaced as `Fresh`, `Near limit`, `Summarized`, or `Trimmed`.
- Any thread can branch from the latest state or an individual message.
- Branches can be compared side by side.
- Session analytics track messages, time span, assistant tokens, TPS, sources, attachments, images, and tool calls by type.

### Knowledge Base

- Upload files or folder trees.
- Index documents with semantic embeddings, keyword/BM25, or hybrid RRF retrieval.
- Use `topK = -1` for full-access retrieval when you want every matching chunk.
- Supports PDFs, Office files, text, code, CSV/JSON/YAML/XML, OCR fallback, archive extraction, and incremental reindexing by content hash.
- Shows health, failed documents, processing state, paginated document lists, filters, preview, multi-select, and bulk delete.
- Injects retrieved context server-side into WorkSpaces and returns cited source chips.

### Canvas

- Persists generated artifacts per session.
- Supports code, markdown, images, tables, charts, reports, diagrams, slides, and generic files.
- Stores revision snapshots on create, edit, and restore.
- Supports artifact search, cursor paging, lineage, bundle export/delete, history restore, and lightweight revision comparison.
- Uses lazy preview rendering and size thresholds so large artifacts do not render eagerly.

### Tools

Tool access is the intersection of account permission, personal setting, and runtime availability.

| Tool | Capability |
|---|---|
| Shell | Approved command execution in the app container or optional host executor |
| Filesystem | Read, stat, list, write, append, and mkdir inside approved mounted roots |
| Code | Managed Python/Node sandbox scoped to the selected workspace |
| Browser | Public page open/click/fill/submit/extract with SSRF guardrails |
| UWAF | Direct clear-web browsing and Tor-routed stealth browsing through live Chromium |

Filesystem and shell denials return structured diagnostics, so the UI and model can tell whether the blocker is account permission, personal settings, Docker mounts, approved roots, approval tokens, or host executor availability.

### Browser And Network

- Direct mode uses Playwright Chromium for clear-web research.
- Stealth mode routes through Tor and fails closed when preflight checks fail.
- UWAF validates DNS behavior, WebRTC lockdown, Tor exit alignment, `.onion` handling, and proxy-bypass protections.
- Stealth sessions use broader desktop fingerprints, `normal` and `high` profiles, approved onion-search-engine rotation, provider scoring, and anti-bot/search-failure diagnostics.
- The built-in stealth search lineup is now onion-search-only by default: Ahmia, OnionWay, OnionLand, TorDex, and Excavator. Optional engines from the same approved catalog can be enabled through env-backed provider URLs.
- The live browser is a real headed Chromium display over noVNC, so the user and agent share the same browser session.

### Automation

- A server-side worker starts from `src/instrumentation.ts`.
- Heartbeats can check stale WorkSpaces threads.
- Cron schedules can fire recurring prompts.
- URL and file monitors can create nudges or queue background runs.
- Wake events can be raised through `POST /api/openclaw/automation/wake-event`.
- Unattended execution is guarded, local-Ollama-only, rate-limited per user, recorded in durable run history, and does not invoke interactive tools in the background.

### Media Uploads

- Images are vision-first by default.
- Per-image modes: `Vision only`, `Vision + OCR`, and `OCR only`.
- HEIC/HEIF, TIFF, BMP, AVIF, and other unsupported still images are normalized to JPEG before Ollama receives them.
- Audio and video are detected correctly but remain metadata-only until transcription/frame extraction is added.

## Quick Start

### 1. Start Ollama

```bash
ollama serve
```

Pull at least one chat model. Pull an embedding model only if you want semantic RAG.

```bash
ollama pull phi3:mini
ollama pull nomic-embed-text
```

### 2. Start PeakUI

```bash
docker compose up -d --build
```

Open:

```text
http://localhost:3000
```

On first visit, create the initial Admin account. After login, the app opens directly into WorkSpaces.

### 3. Configure The Studio

Open Settings inside WorkSpaces and set:

| Setting | Use it for |
|---|---|
| WorkSpaces provider/model | Pick local Ollama or an OpenAI-compatible provider |
| Ollama host | Default is `http://127.0.0.1:11434` |
| Temperature | Response randomness |
| Use Ollama default temperature | Let the selected local model use its own native default temperature |
| Context window | Requested max context for local Ollama |
| Use Ollama default context | Let Ollama choose the selected local model's native context window |
| Exclusive Ollama switching | Unload other local models before starting the selected one |
| RAG mode/model | Semantic embeddings or keyword-only retrieval |
| Tool permissions | Shell, filesystem, code, browser, UWAF, automation |
| Session intelligence | Continuation defaults, summaries, analytics, and branching |
| Appearance | Aurora, Graphite, Midnight, Canvas, or Ledger |

## Optional Host Shell Executor

By default, shell commands run inside the app container. To run approved commands on the host machine, start the host executor outside Docker and give the app the same token.

```bash
export OPENCLAW_HOST_EXECUTOR_TOKEN="change-me"
npm run openclaw:host-executor
```

Then set `OPENCLAW_HOST_EXECUTOR_TOKEN` for the app container and choose `Host` in Settings.

Host execution is guarded by approved working-directory roots, allowed environment variables, timeout caps, output caps, approval mode, and shell audit records.

More detail: [docs/openclaw-host-executor.md](docs/openclaw-host-executor.md)

## Important Paths

| Path | Purpose |
|---|---|
| `/mnt/openclaw/workspace` | Managed workspace path inside the app container |
| `/tmp/peakui-openclaw-workspace` | Host-style alias for the managed workspace |
| `src/app/components/OpenClawWorkspace.tsx` | Main WorkSpaces UI |
| `src/lib/chat-completion.ts` | Shared streaming completion pipeline |
| `src/lib/chat-sessions.ts` | Session persistence, branching, summaries, analytics |
| `src/lib/session-intelligence.ts` | Context management, analytics, continuation detection |
| `src/lib/openclaw-automation*.ts` | Automation worker and unattended execution |
| `src/lib/uwaf-*` | Unified browser, stealth/direct browsing, sanitization |
| `src/lib/rag.ts` | Knowledge Base retrieval and indexing logic |
| `prisma/schema.prisma` | PostgreSQL data model |

## API Map

| Route | Purpose |
|---|---|
| `/api/chat/completions` | Streaming chat and WorkSpaces generation |
| `/api/chat/completed` | Session finalization after generation |
| `/api/chats` | List, create, update, delete sessions |
| `/api/chats/[id]/branch` | Fork a session from a selected message |
| `/api/settings` | Per-user app and WorkSpaces settings |
| `/api/rag/*` | Knowledge Base upload, search, health, diagnostics |
| `/api/canvas/artifacts*` | Canvas artifact list, create, edit, delete, revisions |
| `/api/openclaw/shell/*` | Shell request, approval, execution, settings |
| `/api/openclaw/filesystem*` | Filesystem read/write request flow |
| `/api/openclaw/code*` | Managed code execution sandbox |
| `/api/openclaw/browser*` | Standard controlled browser |
| `/api/openclaw/uwaf-browser*` | Direct/stealth unified browser |
| `/api/openclaw/automation*` | Heartbeats, schedules, monitors, nudges, wake events |
| `/api/openclaw/workspaces*` | Named project workspaces |

## Environment

| Variable | Required | Description |
|---|---:|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Optional | If omitted, Docker startup persists a generated secret |
| `OPENCLAW_HOST_EXECUTOR_TOKEN` | Optional | Enables host-side shell executor integration |
| `OPENCLAW_HOST_WORKSPACE_DIR` | Optional | Host path mounted as the managed workspace |
| `TOR_PROXY_URL` | Optional | SOCKS proxy for UWAF stealth mode, defaulted by Compose |
| `UWAF_STEALTH_PROVIDER_TOR66_HOME_URL` | Optional | Enable Tor66 as an env-backed approved stealth provider |
| `UWAF_STEALTH_PROVIDER_TOR66_QUERY_URL` | Optional | Optional explicit Tor66 query URL, supports `{query}` |
| `UWAF_STEALTH_PROVIDER_TORCH_HOME_URL` | Optional | Enable Torch as an env-backed approved stealth provider |
| `UWAF_STEALTH_PROVIDER_TORCH_QUERY_URL` | Optional | Optional explicit Torch query URL, supports `{query}` |
| `UWAF_STEALTH_PROVIDER_OUR_REALM_HOME_URL` | Optional | Enable Our Realm as an env-backed approved stealth provider |
| `UWAF_STEALTH_PROVIDER_OUR_REALM_QUERY_URL` | Optional | Optional explicit Our Realm query URL, supports `{query}` |
| `UWAF_STEALTH_PROVIDER_TORCH_BY_TORDEX_HOME_URL` | Optional | Enable Torch by TorDex as an env-backed approved stealth provider |
| `UWAF_STEALTH_PROVIDER_TORCH_BY_TORDEX_QUERY_URL` | Optional | Optional explicit Torch by TorDex query URL, supports `{query}` |
| `BRAVE_API_KEY` | Optional | Brave search backend |
| `SEARXNG_URL` | Optional | Self-hosted SearXNG backend |
| `GOOGLE_SEARCH_API_KEY` | Optional | Google Programmable Search backend |
| `GOOGLE_SEARCH_CX` | Optional | Google Programmable Search CX id |
| `PEAKUI_OLLAMA_CONTEXT_CAP` | Optional | Server-side cap for requested Ollama context |

## Operations

Useful commands:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f app
npm test
npm run build
npx prisma generate
DATABASE_URL=postgresql://peakui:password@localhost:5432/peakui npx prisma db push
```

Do not use destructive Prisma reset commands on a real database.

```bash
# Avoid this unless you intentionally want to wipe data:
npx prisma db push --force-reset
```

## Current Boundaries

- WorkSpaces is the primary UI. The old normal-chat shell is no longer the main reachable surface, but shared chat APIs remain as backend infrastructure.
- Unattended automation can run local Ollama text generations, but it does not run shell/filesystem/browser/code tools in the background.
- Audio and video uploads are detected but not transcribed yet.
- Stealth browsing is best-effort and intentionally fails closed when Tor, DNS, WebRTC, or proxy checks fail.
- The optional host executor is required for true host-command execution. Without it, host shell mode falls back to the container and labels the actual target.

## More Documentation

| Document | Description |
|---|---|
| [docs/features.md](docs/features.md) | Full feature reference |
| [docs/settings-and-rag.md](docs/settings-and-rag.md) | Settings and RAG behavior |
| [docs/openclaw-host-executor.md](docs/openclaw-host-executor.md) | Host shell executor setup |
| [docs/development-section-plan.md](docs/development-section-plan.md) | Development section plan |
| [OPENCLAW-TODO.md](OPENCLAW-TODO.md) | WorkSpaces roadmap |
| [RAG-TODO.md](RAG-TODO.md) | Knowledge Base roadmap |
| [UWAF-NETWORK-TODO.md](UWAF-NETWORK-TODO.md) | Browser/network roadmap |
