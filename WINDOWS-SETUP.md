# PeakUI Windows Docker Setup Guide

This guide covers running PeakUI on **Windows 11** with **Docker Desktop** (WSL2 backend).

## Prerequisites

1. **Docker Desktop** (v4.73.0+) — installed via `winget install --id Docker.DockerDesktop --exact`
2. **Ollama** — installed and available at `C:\Users\raza\AppData\Local\Programs\Ollama\ollama.exe`
3. **PowerShell** — run as Administrator for first-time setup
4. **Hyper-V / WSL2** — Docker Desktop will enable these; a system restart is required after installation

## Architecture Notes (Why Windows is Different)

| Original Linux/Docker | Windows Equivalent |
|-----------------------|-------------------|
| `network_mode: host` | Not supported on Windows Docker Desktop. Uses named bridge network (`peakui`) instead. |
| `localhost:5432` for DB | Service name `db:5432` via Docker DNS |
| `localhost:9050` for Tor | Service name `tor-proxy:9150` |
| `localhost:11434` for Ollama | `host.docker.internal:11434` (requires Ollama bound to `0.0.0.0`) |
| `/home/user` host paths | `C:\Users\raza` via bind mounts |
| `/tmp` | `C:\Users\raza\AppData\Local\Temp` |

## Quick Start

### Option A: PowerShell Script (Recommended)

```powershell
# Open PowerShell, navigate to project
cd C:\Users\raza\Desktop\projects\PeakUI

# Full setup: verifies Docker, creates workspace, restarts Ollama, builds & runs app
.\setup-windows.ps1 -FullSetup

# Or run steps individually:
.\setup-windows.ps1 -OllamaOnly    # Just fix Ollama binding
.\setup-windows.ps1 -BuildOnly     # Just build and run (assumes Docker + Ollama ready)
```

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
Start-Process "C:\Users\raza\AppData\Local\Programs\Ollama\ollama.exe" -ArgumentList "serve"
```

Or double-click: `restart-ollama-for-docker.bat`

#### 3. Build and Run

```powershell
cd C:\Users\raza\Desktop\projects\PeakUI
docker compose -f docker-compose.windows.yml up --build
```

Wait for the build. First build takes ~5–10 minutes.

#### 4. Open the App

Navigate to: [http://localhost:3000](http://localhost:3000)

## File Reference

| File | Purpose |
|------|---------|
| `docker-compose.windows.yml` | Windows-compatible Docker Compose |
| `.env` | Environment variables with Windows paths |
| `setup-windows.ps1` | One-click setup script |
| `restart-ollama-for-docker.bat` | Rebinds Ollama to 0.0.0.0 |
| `docker-compose.yml.bak` | Original Linux compose (kept for reference) |

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
- If it shows `127.0.0.1`, run `restart-ollama-for-docker.bat`.

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
- Docker Desktop ? Settings ? Resources ? File sharing ? Ensure `C:\` is shared.
- WSL2 backend handles this automatically, but verify if errors occur.

## Post-Restart Workflow

After every Windows restart:

1. **Start Docker Desktop** (auto-starts by default).
2. **Run Ollama** with `0.0.0.0` binding.
3. **Run PeakUI**:
   ```powershell
   cd C:\Users\raza\Desktop\projects\PeakUI
   docker compose -f docker-compose.windows.yml up
   ```
   (Omit `--build` after first successful build to start instantly.)

## Updating PeakUI After Code Changes

```powershell
cd C:\Users\raza\Desktop\projects\PeakUI
docker compose -f docker-compose.windows.yml up --build
```

This rebuilds the Next.js app inside the container.

---

> **AI Context Note:** This project runs on Windows 11 with Docker Desktop (WSL2). The original `docker-compose.yml` uses `network_mode: host` which is Linux-only. Always use `docker-compose.windows.yml` for Windows deployments. Ollama must be explicitly restarted with `OLLAMA_HOST=0.0.0.0:11434` for container reachability.