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

## Quick Start

### Option A: PowerShell Script (Recommended)

Edit `setup-windows.ps1` to match your project directory, workspace directory, and Ollama executable path, then run:

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
- `OPENCLAW_HOST_HOME_DIR=C:\Users\%USERNAME%`
- `OPENCLAW_HOST_TMP_DIR=C:\Users\%USERNAME%\AppData\Local\Temp`
- `OPENCLAW_HOST_WORKSPACE_DIR=C:\Users\%USERNAME%\peakui-workspace`

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
# OPENCLAW_HOST_*, and TOR_PROXY_URL.
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

### Volume mount issues
- Docker Desktop → Settings → Resources → File Sharing → Ensure `C:\` is shared.
- WSL2 backend handles this automatically, but verify if errors occur.

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
