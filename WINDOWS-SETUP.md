# PeakUI Windows Docker Setup Guide

This guide covers running PeakUI on **Windows 11** with **Docker Desktop** (WSL2 backend).

## Prerequisites

1. **Docker Desktop** (v4.73.0+) — installed via `winget install --id Docker.DockerDesktop --exact`
2. **Ollama** — installed and available on your system
3. **PowerShell** — run as Administrator for first-time setup
4. **Hyper-V / WSL2** — Docker Desktop will enable these; a system restart is required after installation

## Architecture Notes (Why Windows is Different)

| Original Linux/Docker | Windows Equivalent |
|-----------------------|-------------------|
| `network_mode: host` | Not supported on Windows Docker Desktop. Uses named bridge network (`peakui`) instead. |
| `localhost:5432` for DB | Service name `db:5432` via Docker DNS |
| `localhost:9050` for Tor | Service name `tor-proxy:9150` |
| `localhost:11434` for Ollama | `host.docker.internal:11434` (requires Ollama bound to `0.0.0.0`) |
| `/home/user` host paths | Configured via environment variables / `.env` |
| `/tmp` | Configured via environment variables / `.env` |
| Tor SOCKS proxy | Auto-detected: `tor-proxy:9150` on Windows bridge, `localhost:9050` on Linux host-mode |

## Quick Start

### Option A: PowerShell Script (Recommended)

`setup-windows.ps1` picks up paths from environment variables (`PEAKUI_PROJECT_DIR`, `PEAKUI_WORKSPACE_DIR`, `PEAKUI_OLLAMA_EXE`) and falls back to sensible defaults. You can also override them with parameters, then run:

```powershell
# Full setup: verifies Docker, creates workspace, generates .env, restarts Ollama, builds & runs app
.\setup-windows.ps1 -FullSetup

# Or run steps individually:
.\setup-windows.ps1 -OllamaOnly    # Just fix Ollama binding
.\setup-windows.ps1 -BuildOnly     # Just build and run (assumes Docker + Ollama ready)
```

The script creates a `.env` file automatically on first run. If you already have a `.env`, it keeps your existing values.

The generated `.env` uses the correct Windows Docker values:
- `DATABASE_URL=postgresql://peakui:<password>@db:5432/peakui`
- `OLLAMA_HOST=http://host.docker.internal:11434`
- `WORKSPACE_TOOL_HOST_HOME_DIR=C:\Users\%USERNAME%`
- `WORKSPACE_TOOL_HOST_TMP_DIR=C:\Users\%USERNAME%\AppData\Local\Temp`
- `WORKSPACE_TOOL_HOST_WORKSPACE_DIR=C:\Users\%USERNAME%\peakui-workspace`

### Option B: Manual Steps

#### 1. Start Docker Desktop

Ensure Docker Desktop is running. If you just installed it, **restart your computer first**.

#### 2. Restart Ollama for Container Access

Ollama defaults to `127.0.0.1:11434`. Docker containers need it on `0.0.0.0:11434`:

```powershell
# Stop current Ollama
Get-Process -Name "ollama" | Stop-Process -Force

# Restart with 0.0.0.0 binding
$env:OLLAMA_HOST="0.0.0.0:11434"
Start-Process "C:\Path\To\Ollama\ollama.exe" -ArgumentList "serve"
```

Or double-click `restart-ollama-for-docker.bat` after editing the Ollama path inside it.

#### 3. Configure Environment

```powershell
# From your project directory
cd C:\Path\To\PeakUI

# Copy environment template and fill it in.
# Make sure to uncomment the Windows examples for DATABASE_URL, OLLAMA_HOST,
# WORKSPACE_TOOL_HOST_*, and TOR_PROXY_URL.
copy .env.example .env
notepad .env
```

#### 4. Build and Run

```powershell
docker compose -f docker-compose.windows.yml up --build
```

Wait for the build. First build takes ~5–10 minutes.

#### 5. Open the App

Navigate to: [http://localhost:3000](http://localhost:3000)

Create the initial admin account. The Ollama host default is taken from the `OLLAMA_HOST` env var at first login, so set it to `http://host.docker.internal:11434` before signing in.

## File Reference

| File | Purpose |
|------|---------|
| `docker-compose.windows.yml` | Windows-compatible Docker Compose |
| `.env` | Environment variables with Windows paths |
| `setup-windows.ps1` | One-click setup script |
| `restart-ollama-for-docker.bat` | Rebinds Ollama to 0.0.0.0 |

## Pull a Model

Before chatting, pull at least one Ollama model from the host:

```powershell
ollama pull llama3.2
```

If you want semantic RAG, also pull an embedding model such as `nomic-embed-text`.

## Troubleshooting

### Docker daemon not responding
- Ensure Docker Desktop is running in the system tray.
- If freshly installed, **restart Windows**.

### Ollama not reachable from container
- Verify Ollama is on `0.0.0.0:11434`:
  ```powershell
  Get-NetTCPConnection -LocalPort 11434 | Select-Object LocalAddress
  # Should show 0.0.0.0, not 127.0.0.1
  ```
- If it shows `127.0.0.1`, run `restart-ollama-for-docker.bat` with the correct path.

### Port 5432 already in use
- Another PostgreSQL instance may be running locally. Stop it:
  ```powershell
  Get-Process -Name "postgres" | Stop-Process -Force
  ```
- Or change the host port mapping in `docker-compose.windows.yml`:
  ```yaml
  ports:
    - "5433:5432"  # Use 5433 on host
  ```

### Host shell / Docker commands on Windows

To run true host shell commands or `docker` commands from PeakUI on Windows, you need the optional **host executor** running on the Windows host:

1. Set `WORKSPACE_TOOL_HOST_EXECUTOR_TOKEN` to a strong secret in `.env`.
2. From PowerShell on the host, run:
   ```powershell
   $env:WORKSPACE_TOOL_HOST_EXECUTOR_TOKEN="your-secret-token"
   $env:WORKSPACE_TOOL_HOST_EXECUTOR_BIND="0.0.0.0"
   node scripts/workspace-tool-host-executor.mjs
   ```
3. Ensure `WORKSPACE_TOOL_HOST_EXECUTOR_URL=http://host.docker.internal:4318` in `.env`.
4. Grant the `workspace-tool.host` permission and set **Unrestricted Host Access** to **Auto-approve** in settings.

Without the host executor, shell/code tools run inside the Linux container and cannot execute native Windows commands or access the Windows Docker engine directly.

### Volume mount issues
- Docker Desktop → Settings → Resources → File Sharing → Ensure `C:\` is shared.
- WSL2 backend handles this automatically, but verify if errors occur.

## Workspace Directory Mapping

Per-user workspace roots are supported. You can set **Settings → WorkSpaces → Default workspace root for this account** for each user. For this to work on Windows, that directory must be inside one of the bind mounts listed below (typically `WORKSPACE_TOOL_HOST_WORKSPACE_DIR` or `WORKSPACE_TOOL_HOST_PROJECTS_DIR`). Paths outside the mounted directories (for example `D:\`) will not be reachable from the container.

PeakUI keeps two views of the same workspace directory:

| Location | Path on Windows host | Path inside Docker container |
|----------|----------------------|------------------------------|
| Managed workspace | `C:\Users\%USERNAME%\peakui-workspace` (set by `WORKSPACE_TOOL_HOST_WORKSPACE_DIR`) | `/mnt/workspace-tool/workspace` |
| Host home tree | `C:\Users\%USERNAME%` (set by `WORKSPACE_TOOL_HOST_HOME_DIR`) | `/mnt/workspace-tool/home` (read-only) |
| Host temp | `C:\Users\%USERNAME%\AppData\Local\Temp` (set by `WORKSPACE_TOOL_HOST_TMP_DIR`) | `/mnt/workspace-tool/tmp` (read-only) |
| Projects / Desktop | `C:\Users\%USERNAME%\Desktop` (set by `WORKSPACE_TOOL_HOST_PROJECTS_DIR`) | `/mnt/workspace-tool/projects` (read-write) |

The app stores files inside the container at `/mnt/workspace-tool/workspace`, but it presents the Windows host path (`C:\Users\...`) to you and the AI. Filesystem and shell tools translate between the two automatically. Make sure the paths in your `.env` match the bind mounts in `docker-compose.windows.yml`.

If you set a per-user default workspace root, choose a path under `WORKSPACE_TOOL_HOST_WORKSPACE_DIR` (for managed WorkSpaces) or under `WORKSPACE_TOOL_HOST_PROJECTS_DIR` (for project-level host access). The AI will use that root as the project directory.

## Post-Restart Workflow

After every Windows restart:

1. **Start Docker Desktop** (auto-starts by default).
2. **Run Ollama** with `0.0.0.0` binding.
3. **Run PeakUI**:
   ```powershell
   cd C:\Path\To\PeakUI
   docker compose -f docker-compose.windows.yml up
   ```
   (Omit `--build` after first successful build to start instantly.)

## Updating PeakUI After Code Changes

```powershell
cd C:\Path\To\PeakUI
docker compose -f docker-compose.windows.yml up --build
```

This rebuilds the Next.js app inside the container.

### Resetting to default settings

If you already signed in while `OLLAMA_HOST` was wrong, the bad URL is saved in the database. You can fix it in **Settings → Ollama host**, or reset all settings by deleting the `userSettings` row in PostgreSQL and signing in again.

---

> **Note:** Always use `docker-compose.windows.yml` for Windows deployments. The original `docker-compose.yml` uses `network_mode: host`, which is unsupported on Windows Docker Desktop. Ollama must be explicitly restarted with `OLLAMA_HOST=0.0.0.0:11434` for container reachability.
