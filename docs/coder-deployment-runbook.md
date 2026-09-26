# Coder Deployment Runbook

For the opt-in LXD/Incus Coder backend, see its [installation and recovery
runbook](coder-lxd.md). The steps below operate the Docker Coder backend.

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
- **Shared-runtime access boundary**: because the current daemon is one root,
  host-network runtime, coder routes are restricted to `ADMIN` users until
  per-user runtimes and bridge networking are implemented.
- **Persistent build runtime**: Java 17 is image-managed; workspace, Qwen and
  SSH state, Gradle, Android SDK/NDK, Android user state, npm, and pip each use
  named volumes. Recreating the Coder container therefore does not discard
  projects, session state, credentials, or downloaded build dependencies.
- **Safe storage operations**: `peakui-coder-readiness --strict` checks the
  Java baseline, writable persistent locations, and build disk headroom.
  `peakui-cleanup` accepts only `status` and `prune-tmp`; it never accepts an
  arbitrary path and never deletes protected runtime locations.
- **Large-file explorer downloads**: the app mounts both coder workspace
  volumes (`coder_workspace`→`/coder-workspace`, `coder_apps`→`/coder-apps`) and
  streams both individual files and generated ZIP archives directly from them,
  with no application-memory download-size cap. The same mounts and environment
  are present in the Linux and Windows Compose files. Shared-volume paths are
  resolved through symlinks and rejected if their final target leaves the
  workspace root. Unknown roots fall back to validated, incrementally streamed
  256 KiB daemon reads rather than buffering an entire artifact.

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

# 2. The app entrypoint runs `prisma migrate deploy` on boot. It applies the
#    committed migration history and fails closed if the database is unbaselined
#    or inconsistent. Take a backup and explicitly baseline legacy databases;
#    do not reintroduce a `db push --accept-data-loss` startup fallback.
```

No manual DB step is required when the database already has the committed
migration history.

## Verify

```sh
# Daemon healthy + session shell enabled
curl -s http://127.0.0.1:4170/health        # {"status":"ok"}
curl -s http://127.0.0.1:4170/capabilities  # includes session_shell_command

# App up
  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/   # 200/307

# DB + daemon readiness
  curl -s http://127.0.0.1:3000/api/coder/readiness

# Disposable end-to-end browser/API smoke test
  node scripts/coder-review-smoke.mjs http://127.0.0.1:3000

# Column present
docker exec peakui-db-1 psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "\d \"ChatSession\"" | grep -i coderWorkspace

# Container isolation flags actually applied
docker inspect peakui-coder-1 \
  --format '{{.HostConfig.PidsLimit}} pids / {{.HostConfig.Memory}} mem / {{.HostConfig.CapDrop}} caps'

# Persistent-runtime readiness. Use --strict before Gradle, Android, model, or
# other disk-heavy work; it exits nonzero below CODER_MIN_FREE_GB (12 by default).
docker compose exec coder peakui-coder-readiness --strict
docker compose exec coder peakui-cleanup status

# Confirm the immutable Java baseline and protected volumes are mounted.
docker compose exec coder sh -lc 'java -version && echo "$JAVA_HOME" && echo "$ANDROID_SDK_ROOT"'
docker inspect peakui-coder-1 --format '{{range .Mounts}}{{println .Destination}}{{end}}' \
  | grep -E '^/(workspace|apps|root/.qwen|root/.ssh|root/.gradle|root/.android|root/.npm|root/.cache/pip|opt/android-sdk)$'
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
5. Open **Preview** with a local dev-server URL such as
   `http://127.0.0.1:5173`. External URLs are intentionally rejected. Switch
   Desktop / Tablet / Mobile, then select **Vision** to capture the selected
   viewport and send it to the coding agent for visual review and fixes.

Preview capture uses an isolated Chromium page in the app container. It permits
only requests back to the approved preview origin, caps the JPEG at 3 MiB, and
passes the capture to Qwen as a native image block; it does not expose a general
server-side browser or external URL fetcher.

## Rollback

The changes are additive and independently reversible:

- **Code**: `git revert` the commit, rebuild the images, recreate the services.
- **Schema**: the `coderWorkspace` column is nullable and unused by prior code,
  so reverting the code needs no column drop. (To drop it later:
  `ALTER TABLE "ChatSession" DROP COLUMN IF EXISTS "coderWorkspace";`)
- **Isolation flags**: delete the `pids_limit`/`mem_limit`/`security_opt`/
  `cap_drop` block from the `coder` service and recreate the container.

No `docker compose down -v` anywhere in this process.

## Storage operations

The Coder container is intentionally not a fully persistent root filesystem.
The image owns operating-system libraries and Java; Docker volumes own all
state that must outlive an image rebuild. This keeps upgrades reproducible
while preserving active development work.

| Location | Persistence | Purpose |
|---|---|---|
| `/workspace`, `/apps` | named volume | projects and working files |
| `/root/.qwen`, `/root/.ssh`, `/root` | named volumes | sessions, memories, Git identity, SSH keys, user state |
| `/root/.gradle`, `/root/.android`, `/opt/android-sdk` | named volumes | Gradle cache, Android/NDK tooling and user state |
| `/root/.npm`, `/root/.cache/pip` | named volumes | package caches |
| `/usr/lib/jvm` | immutable image | Java 17 baseline; never cleanup-managed |

Do not run broad cleanup commands in Coder. In particular, never use `apt
autoremove`, `apt clean`, `rm -rf /root`, or recursive deletion of an SDK/cache
directory. Use `peakui-cleanup status` to inspect capacity and
`peakui-cleanup prune-tmp` only for PeakUI-owned temporary verification files.
The helper refuses every other cleanup form. Set `CODER_MIN_FREE_GB` in `.env`
to raise the strict-readiness threshold for large Android builds.

## Known operational gaps (Phase 7 — not yet done)

- **Legacy databases without migration history require explicit remediation.**
  Startup is intentionally fail-closed with `migrate deploy`; create a backup,
  baseline the known schema, and then deploy. Never restore an automatic
  `db push --accept-data-loss` fallback to production startup.
- **Non-root + dropping host networking** is not done. Host networking is how the
  coder container reaches the host's Ollama at `127.0.0.1:11434`; going non-root
  and/or moving to a bridge network (which would also let us enforce the egress
  policy against DB/searxng/tor-proxy) requires re-plumbing Ollama reachability.
- **`tools.toolSearch.threshold` needs a daemon restart to take effect.** The
  app persists it and states this in the UI; there is no daemon restart endpoint
  to trigger it automatically.
