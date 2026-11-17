# Deployment

This document covers production-style deployments of PeakUI. For local
quick-start, see [README.md](README.md) and [INSTALL.md](INSTALL.md).

## Topology

```text
app               (Next.js 16 + React 19 UI, streaming APIs, and host executor client)
workspace-daemon  (Persistent WorkSpaces daemon for interactive runs & automation)
rag-worker        (Background Knowledge Base extraction & vector indexing worker)
coder             (Isolated coding environment daemon + dev/Android toolchain)
db                (PostgreSQL 15 with pgvector via pgvector/pgvector:pg15)
searxng           (Local no-key metasearch backend)
tor-proxy         (SOCKS5 proxy for UWAF stealth mode)
```

The `app` container serves the Next.js UI and API routes — chat streaming,
the WorkSpaces UI, the Knowledge Base, the Workspace Files panel, Canvas
artifact rendering, and the host shell executor client — while delegating
detached interactive runs and scheduled/monitored automation to
`workspace-daemon`, document extraction and vector indexing to `rag-worker`,
and isolated coding sessions to `coder`. Outbound dependencies are Ollama (or
configured remote providers) and, if enabled, the optional host shell executor
daemon.

## Linux (host network mode)

`docker-compose.yml` is the default and uses `network_mode: host`. The app
binds directly to the host's network stack so the host shell executor and
Ollama can reach it on `127.0.0.1` without any DNS trickery.

```bash
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL and JWT_SECRET.
docker compose up -d --build
docker compose logs -f app
```

`network_mode: host` is **Linux-only**. On macOS or Windows it is silently
ignored, and the app listens only on the bridge network. If you see "host
shell executor unreachable" on macOS, switch to
`docker-compose.windows.yml` (see below).

## Windows / macOS Docker Desktop

Use the bridge-network compose file:

```bash
docker compose -f docker-compose.windows.yml up -d --build
```

This compose file defaults `OLLAMA_HOST` to `http://host.docker.internal:11434`
so Ollama running on the host is reachable from the app container. The
host shell executor, when enabled, defaults to `http://host.docker.internal:4318`.

If you're behind a corporate proxy or VPN that blocks `host.docker.internal`,
override these via `.env`:

```env
OLLAMA_HOST=http://your.ollama.host:11434
WORKSPACE_TOOL_HOST_EXECUTOR_URL=http://your.host:4318
```

## Environment Variables

See `.env.example` for the full template. Required:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | At least 32 characters, random |

Common optional:

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_HOST` | `http://host.docker.internal:11434` (Win/macOS) or `http://127.0.0.1:11434` (Linux host) | Ollama server URL |
| `WORKSPACE_TOOL_HOST_EXECUTOR_URL` | `http://127.0.0.1:4318` (Linux) or `http://host.docker.internal:4318` (Win/macOS) | Host shell executor endpoint |
| `WORKSPACE_TOOL_HOST_EXECUTOR_TOKEN` | _(unset)_ | Shared secret for the host executor. **Required** when running the host executor |
| `TOR_PROXY_URL` | Auto-detected | SOCKS5 proxy for UWAF stealth mode. Override only if you have a non-Docker Tor instance |
| `SEARXNG_URL` | Local Compose default | Private no-key search backend; override only for a separately managed instance |
| `BRAVE_API_KEY` / `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_CX` | _(unset)_ | Optional paid search fallbacks |
| `FIRECRAWL_API_KEY` | _(unset)_ | Optional Firecrawl v2 search fallback; no-key search continues to use SearXNG/DDG/Bing |
| `FIRECRAWL_API_URL` | `https://api.firecrawl.dev` | Firecrawl-compatible API base URL |
| `PEAKUI_DATA_DIR` | `/mnt/workspace-tool/workspace` | Override the managed workspace mount |
| `PEAKUI_ALLOW_INTERNAL_HOSTS` | `false` | Permits `.internal` hostnames in browser/search guards. Do not enable in production |

## Persistent Volumes

`docker-compose.yml` uses named Docker volumes for database, runtime, and
Coder state alongside a host bind mount for the managed workspace:

| Volume / Host Path | Container Path | What lives there |
|---|---|---|
| `db_data` (named volume) | `/var/lib/postgresql/data` | PostgreSQL + `pgvector` database storage |
| `app_runtime` (named volume) | `/var/lib/peakui` | Shared runtime state & RAG upload spool (`PEAKUI_DATA_DIR`) |
| `WORKSPACE_TOOL_HOST_WORKSPACE_DIR` (defaults to `~/.peakui/workspace`) | `/mnt/workspace-tool/workspace` | Managed workspace bind mount (per-user, per-workspace files) |
| `coder_workspace` & `coder_apps` (named volumes) | `/workspace`, `/apps` (and `/coder-workspace`, `/coder-apps` in `app`) | Coder projects, apps, and shared explorer download roots |
| `coder_state`, `coder_root_home`, `coder_browser_state`, `coder_*_cache` (named volumes) | `/root/.qwen`, `/root`, `/var/lib/peakui/browser`, toolchain caches | Persistent Coder daemon state, dotfiles, and build/SDK caches |
| `searxng_cache` (named volume) | `/var/cache/searxng` | Local SearXNG cache |

To pin `db_data` to a specific disk or directory in production, override the
named volume definition in a `docker-compose.override.yml`:

```yaml
volumes:
  db_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /srv/peakui/db
```

Back up the managed workspace path (`WORKSPACE_TOOL_HOST_WORKSPACE_DIR`,
defaulting to `~/.peakui/workspace`) and the `db_data` volume regularly — they
are the source of truth for user data and every file the AI writes or uploads.

## Reverse Proxy

For TLS termination, put nginx or Caddy in front of the app. Important
settings for SSE (Workspace Files panel events, chat streaming):

```nginx
# nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;

    # SSE / streaming — disable buffering and increase read timeout.
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
    chunked_transfer_encoding on;
}
```

The app already sends `X-Accel-Buffering: no` on SSE responses, which
honors the `proxy_buffering off` directive above.

## Updating

```bash
git pull
docker compose pull        # if you pull prebuilt images
docker compose up -d --build
docker compose exec app npx prisma migrate deploy
```

The compose file uses a builder + runner multi-stage Dockerfile, so
rebuilds are fast (only changed layers are rebuilt).

## Health Checks

- **App readiness:** `GET /api/auth/session` returns 401 (no session) or 200
  (valid session), `GET /api/auth/check` returns 200 with setup and auth status,
  and `GET /api/health` checks authenticated app/Ollama health.
- **WorkSpaces daemon:** `http://127.0.0.1:4320/health` returns 200 when
  `workspace-daemon` holds the runtime lease and is processing runs.
- **Coder daemon:** `http://127.0.0.1:4170/health` returns `{"status":"ok"}`
  (include `Authorization: Bearer $CODER_SERVER_TOKEN` if a token is configured).
- **Database:** `docker compose exec db pg_isready -U peakui`.
- **Ollama:** `curl http://localhost:11434/api/tags` returns the model
  catalog.
- **Tor proxy:** `docker compose logs tor-proxy | grep "Bootstrapped 100%"`.

## Backup

Back up at minimum:

1. The PostgreSQL database (`db_data` named volume or `pg_dump` snapshots).
2. The managed workspace (`WORKSPACE_TOOL_HOST_WORKSPACE_DIR`, `~/.peakui/workspace` by default).

For point-in-time restores, run nightly `pg_dump` snapshots in addition
to filesystem backups:

```bash
docker compose exec -T db pg_dump -U peakui -d peakui > backup-$(date +%F).sql
```

## Security Hardening

See [SECURITY.md](SECURITY.md) for the full threat model and reporting
process. Production must-do:

- **JWT_SECRET** — generate a real secret (`openssl rand -base64 48`) and
  never commit it.
- **HTTPS** — terminate TLS at a reverse proxy; the app does not ship TLS.
- **Account permissions** — every interactive capability is gated by an
  account permission (`workspace-tool.shell`, `workspace-tool.filesystem`,
  `workspace-tool.code`, `workspace-tool.uwaf`). Default to deny; grant per-user.
- **UWAF stealth** — leave it disabled unless you actually need it.
- **Host shell executor** — run it on the same machine, behind a token,
  with a tight root allowlist and timeout cap. The executor runs shell
  commands as the user that started it.
