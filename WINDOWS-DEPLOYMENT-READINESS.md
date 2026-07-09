# PeakUI Windows Deployment Readiness Report

Generated from current main (`267f42d`).

## Existing Windows support

- `docker-compose.windows.yml` exists and uses bridge networking instead of `network_mode: host`.
- `WINDOWS-SETUP.md` and `setup-windows.ps1` provide PowerShell setup.
- `restart-ollama-for-docker.bat` script to rebind Ollama to `0.0.0.0`.
- `.env.example` has Windows examples.
- `src/lib/openclaw-workspace.ts` already detects and preserves Windows drive-letter paths.
- `scripts/openclaw-host-executor.mjs` has Windows shell/cmd support and path normalization.

## What still needs fixing for Windows

### 1. Original `docker-compose.yml` still uses `network_mode: host`
- It is fine for Linux/macOS but **will not start on Windows Docker Desktop**.
- The user must be told to always use `docker-compose -f docker-compose.windows.yml up --build`.
- Fix: make `docker-compose.yml` itself portable by removing `network_mode: host`, using bridge network with service names, and conditionally switching via COMPOSE_FILE or profiles. Currently Windows users must remember the override file.

### 2. Windows compose is missing the host executor / Docker socket mount
- `docker-compose.windows.yml` does not mount `docker.sock` or `${DOCKER_SOCK}`.
- If host shell executor is used, there is no `npipe` mount for the Docker engine.
- Fix: add an optional `host-executor` service or document that Docker-in-container is not available on Windows Docker Desktop without WSL2 sidecar.

### 3. Windows compose uses wrong `OPENCLAW_HOST_HOME_DIR` fallback
- In `.env.example` the default is `/home` which is invalid on Windows.
- The setup script generates `C:\Users\%USERNAME%`, which is good.
- Fix: ensure `docker-compose.windows.yml` marks `OPENCLAW_HOST_HOME_DIR`, `TMP_DIR`, and `WORKSPACE_DIR` as required and fails loudly if not set.

### 4. Workspace root per-user override may conflict with bind mounts
- We added `openClawWorkspaceHostRoot` per user. On Linux the container resolves it via `OPENCLAW_HOST_WORKSPACE_DIR`.
- On Windows, if a user sets their default root to `C:\Users\John\Desktop\projectA`, the container must have that exact path bind-mounted or the app cannot reach it.
- `docker-compose.windows.yml` only mounts `OPENCLAW_HOST_WORKSPACE_DIR` to `/mnt/openclaw/workspace`.
- Fix: either (a) require all per-user roots to live under the single mounted workspace dir, or (b) detect out-of-mount roots and warn/fall back, or (c) add a `OPENCLAW_HOST_PROJECTS_DIR` mount (already in Linux compose) and route per-user roots there.

### 5. Path translation for host-mode code execution on Windows is incomplete
- We patched `openclaw-code-execution.ts` to accept `C:\...` paths, but `resolveHostPathToContainer` mirrors them under `/mnt/openclaw/workspace/host/C/...`.
- That mirror only works if the Windows path is inside the mounted workspace. Paths on `D:\` or outside the bind mount will not exist in the container.
- Fix: on Windows, run code tools through the host executor (`OPENCLAW_HOST_EXECUTOR_URL`) rather than inside the container, or document that only paths under the mounted workspace are reachable.

### 6. Filesystem tool hardcodes `/home`, `/tmp`, and `/mnt/openclaw` mounted roots
- `openclaw-filesystem.ts` builds roots from `OPENCLAW_HOST_HOME_DIR`, `OPENCLAW_HOST_TMP_DIR`, `OPENCLAW_HOST_WORKSPACE_DIR`.
- On Windows these are set from `.env`, so that part is okay.
- But there is no `OPENCLAW_HOST_PROJECTS_DIR` root in the Windows compose, so Desktop/project paths outside the workspace dir are not reachable.
- Fix: add `OPENCLAW_HOST_PROJECTS_DIR` bind mount to Windows compose.

### 7. `openclaw-narration-recovery.ts` and `OpenClawWorkspace.tsx` still hardcode `/home` / `/tmp`
- We patched both to also accept Windows paths and `/mnt/openclaw`.
- Better fix: remove all hardcoded prefixes and check against `getMountedRoots().map(r => r.hostPath)`.

### 8. Shell executor on Windows uses `cmd.exe` but container-side shell assumes POSIX
- `src/lib/shell-execution.ts` resolves `cwd` into a container path and runs `bash` inside the app container.
- On Windows, container shell is still Linux, so host-targeted commands must go through `scripts/openclaw-host-executor.mjs` running on the Windows host.
- Fix: ensure `OPENCLAW_HOST_EXECUTOR_URL` is set to `http://host.docker.internal:4318` on Windows, and that the user starts the executor with the correct token.

### 9. PostgreSQL and Redis / pgvector on Windows
- `pgvector/pgvector:pg15` image works on Docker Desktop WSL2.
- The Linux compose exposes `5432:5432`; Windows compose does too.
- No issue here, but host Postgres on port 5432 must not conflict.

### 10. File-watcher / hot reload inside container on Windows
- Next.js dev file-watcher may miss changes across the Windows bind mount.
- Fix: set `CHOKIDAR_USEPOLLING=true` and `WATCHPACK_POLLING=true` for Windows dev builds.

### 11. Path separator in prompts and tool examples
- The AI prompt now says "Account default workspace root: ..." but on Windows the path uses `/` (from our normalization) while the real Windows path uses `\`.
- This is acceptable because we normalize, but the AI may show paths with forward slashes to the user.
- Fix: when displaying, convert back to native separators for Windows.

### 12. Build output is Linux-only
- `Dockerfile` uses `node:22-alpine` and Linux binaries. That is expected because containers on Docker Desktop WSL2 run Linux.
- No native Windows EXE build exists. This is normal for a containerized app.

## Immediate action items

1. Update `docker-compose.windows.yml` to mount `${OPENCLAW_HOST_PROJECTS_DIR}` too.
2. Update `WINDOWS-SETUP.md` to explain per-user `openClawWorkspaceHostRoot` must be under the mounted workspace dir or projects dir.
3. Remove hardcoded `/home`/`/tmp` prefixes from narration recovery by checking mounted roots.
4. Add Windows-specific `.env` generation in `setup-windows.ps1` for `OPENCLAW_HOST_PROJECTS_DIR`.
5. Test that host-mode code execution works with `C:\Users\...\project` paths when the directory is inside the mounted workspace/projects dir.
6. Document that `openclaw.host` + `auto-approve` on Windows requires the host executor for true host shell access.

## Current status

- Linux build, tests, and typecheck are green.
- Docker redeploy on Linux is healthy (`/login` 200, `/api/health` 401).
- Windows support scaffolding exists but needs the mount/project-dir wiring above for a smooth admin experience.
