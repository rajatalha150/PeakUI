# Coder Deployment Runbook

How to deploy and roll back this hardening round. The changes are additive and
do not touch existing projects, accounts, credentials, or unrelated PeakUI
features — no volume reset, no credential rotation, no `docker compose down -v`.

## What changed (this round)

- **New DB column** `ChatSession.coderWorkspace TEXT NULL` — binds each Coding
  session to the workspace it was created against, so a reattach restores the
  original project even after the user's default workspace preference changes.
  Nullable: legacy sessions simply fall back to the current default.
- **Authorization** on every `/api/coder/*` route (ownership check + admin-only
  privileged paths) and a canonical workspace-path validator.
- **SSE resume** (fetch-based client + `Last-Event-ID` / `X-Qwen-Event-Epoch`
  header forwarding) and no-overlap polling.
- **Settings**: `coderToolSearchThreshold` now reaches the daemon
  (`tools.toolSearch.threshold`, user scope, `requiresRestart: true`).
- **Container isolation**: `pids_limit`, `mem_limit`, `no-new-privileges`,
  and `cap_drop` of the host-dangerous capabilities on the `coder` service.

## Prerequisites (secrets — all via `.env`, never committed)

| Variable | Required | Notes |
|---|---|---|
| `POSTGRES_PASSWORD` | yes | DB password (required by compose) |
| `DATABASE_URL` | yes | app's Postgres DSN |
| `JWT_SECRET` | yes | app JWT signing key (≥32 chars) |
| `CODER_SERVER_TOKEN` | no | bearer for the daemon when not loopback |
| `CODER_OPENAI_BASE_URL` | no | default `http://127.0.0.1:11434/v1` (host Ollama) |
| `CODER_MODEL` | no | default `gemma4:latest` |

## Deploy

```sh
# 1. Rebuild the coder + app images and recreate the services (additive).
docker compose up -d --build --force-recreate app coder

# 2. The app entrypoint runs `prisma db push --accept-data-loss` on boot, which
#    applies the nullable coderWorkspace column additively (no data loss). The
#    reviewed migration file is also present for future `migrate deploy` use:
#      prisma/migrations/20260921_bind_coder_session_workspace/migration.sql
```

No manual DB step is required for this round — `db push` applies the additive
column on the existing container start.

## Verify

```sh
# Daemon healthy + session shell enabled
curl -s http://127.0.0.1:4170/health        # {"status":"ok"}
curl -s http://127.0.0.1:4170/capabilities  # includes session_shell_command

# App up
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/   # 200

# Column present
docker exec peakui-db-1 psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "\d \"ChatSession\"" | grep -i coderWorkspace

# Container isolation flags actually applied
docker inspect peakui-coder-1 \
  --format '{{.HostConfig.PidsLimit}} pids / {{.HostConfig.Memory}} mem / {{.HostConfig.CapDrop}} caps'
```

## Functional smoke test (in the UI)

1. Open `/coder`, start a session, set the workspace cwd to a non-default path
   (e.g. `/apps`), and send a prompt. Confirm the session works.
2. Change the default workspace in Settings, then reopen the same session —
   it must reattach to the **original** cwd (`/apps`), not the new default.
3. Change the tool-search budget and confirm the daemon settings show it:
   `curl -s http://127.0.0.1:4170/workspace/settings | jq '.settings[] | select(.key=="tools.toolSearch.threshold")'`.
   It reports `requiresRestart: true` — the value takes effect on the next
   daemon restart.
4. Kill the SSE stream (e.g. stop/start the daemon) and confirm the transcript
   poll re-renders the full history with no gap.

## Rollback

The changes are additive and independently reversible:

- **Code**: `git revert` the commit, rebuild the images, recreate the services.
- **Schema**: the `coderWorkspace` column is nullable and unused by prior code,
  so reverting the code needs no column drop. (To drop it later:
  `ALTER TABLE "ChatSession" DROP COLUMN IF EXISTS "coderWorkspace";`)
- **Isolation flags**: delete the `pids_limit`/`mem_limit`/`security_opt`/
  `cap_drop` block from the `coder` service and recreate the container.

No `docker compose down -v` anywhere in this process.

## Known operational gaps (Phase 7 — not yet done)

- **`prisma db push --accept-data-loss` is still the boot-time migration path.**
  The Dockerfile uses `db push` (not `migrate deploy`) because installer-created
  DBs have no migration baseline. A reviewed-migrations workflow is a separate
  migration; until then the migration files are advisory records, not the
  applied path.
- **Non-root + dropping host networking** is not done. Host networking is how the
  coder container reaches the host's Ollama at `127.0.0.1:11434`; going non-root
  and/or moving to a bridge network (which would also let us enforce the egress
  policy against DB/searxng/tor-proxy) requires re-plumbing Ollama reachability.
- **`tools.toolSearch.threshold` needs a daemon restart to take effect.** The
  app persists it and states this in the UI; there is no daemon restart endpoint
  to trigger it automatically.
