# Deployment

This document covers production-style deployments of PeakUI. For local
quick-start, see [README.md](README.md) and [INSTALL.md](INSTALL.md).

## Topology

```text
peakui-app        (Next.js 16 + React 19, all features)
peakui-db         (PostgreSQL 16)
peakui-tor-proxy  (SOCKS5 proxy for UWAF stealth mode) [optional but recommended]
```

The app container holds every user-facing feature — chat streaming, the
WorkSpaces UI, the Knowledge Base, the Workspace Files panel, automation,
Canvas artifact rendering, and the host shell executor's API surface — so
the only outbound dependencies are Ollama and, if enabled, the optional
host shell executor daemon.

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
`docker-compose.macos.yml` (see below).

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
OPENCLAW_HOST_EXECUTOR_URL=http://your.host:4318
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
| `OPENCLAW_HOST_EXECUTOR_URL` | `http://127.0.0.1:4318` (Linux) or `http://host.docker.internal:4318` (Win/macOS) | Host shell executor endpoint |
| `OPENCLAW_HOST_EXECUTOR_TOKEN` | _(unset)_ | Shared secret for the host executor. **Required** when running the host executor |
| `TOR_PROXY_URL` | Auto-detected | SOCKS5 proxy for UWAF stealth mode. Override only if you have a non-Docker Tor instance |
| `BRAVE_API_KEY` / `SEARXNG_URL` / `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_CX` | _(unset)_ | Internet-mode search backends (any one is enough) |
| `PEAKUI_DATA_DIR` | `/mnt/openclaw/workspace` | Override the managed workspace mount |
| `PEAKUI_ALLOW_INTERNAL_HOSTS` | `false` | Permits `.internal` hostnames in browser/search guards. Do not enable in production |

## Persistent Volumes

Two host paths need durable storage. The default compose file mounts both
to local directories.

| Host path (Linux example) | What lives there |
|---|---|
| `./data/db` | PostgreSQL data directory |
| `~/.peakui/workspace` | Managed workspace (per-user, per-workspace) |

In production, replace `./data/db` with a named volume or a bind mount to a
dedicated disk:

```yaml
volumes:
  - peakui-db:/var/lib/postgresql/data

volumes:
  peakui-db:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /srv/peakui/db
```

Back up the workspace path regularly — it is the source of truth for every
file the AI writes or uploads.

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

- **App readiness:** `GET /api/auth/me` returns 401 (no session) or 200
  (valid session). Anything else indicates the app failed to start.
- **Database:** `docker compose exec db pg_isready -U peakui`.
- **Ollama:** `curl http://localhost:11434/api/tags` returns the model
  catalog.
- **Tor proxy:** `docker compose logs tor-proxy | grep "Bootstrapped 100%"`.

## Backup

Back up at minimum:

1. The PostgreSQL data directory (`./data/db` by default).
2. The managed workspace (`~/.peakui/workspace` by default).

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
  account permission (`openclaw.shell`, `openclaw.filesystem`,
  `openclaw.code`, `openclaw.uwaf`). Default to deny; grant per-user.
- **UWAF stealth** — leave it disabled unless you actually need it.
- **Host shell executor** — run it on the same machine, behind a token,
  with a tight root allowlist and timeout cap. The executor runs shell
  commands as the user that started it.