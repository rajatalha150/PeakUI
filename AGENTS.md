<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# PeakUI Development Context

## Platform
This project is actively developed and run on **Windows 11 Pro** (Build 26200 / 25H2).

## Docker Setup (Windows)
- Docker Desktop v4.73.0+ with **WSL2 backend** is installed.
- **Do NOT use the original `docker-compose.yml` on Windows.** It uses `network_mode: host`, which is unsupported on Windows Docker Desktop.
- Always use **`docker-compose.windows.yml`** for Windows deployments.
- Key differences from Linux:
  - Named bridge network (`peakui`) instead of `network_mode: host`
  - Service names (`db:5432`, `tor-proxy:9150`) instead of `localhost`
  - `host.docker.internal:11434` for Ollama instead of `localhost:11434`
  - Windows paths (`C:\Users\raza`) in bind mounts
- Ollama must be explicitly restarted with `OLLAMA_HOST=0.0.0.0:11434` for Docker containers to reach it.
- See `WINDOWS-SETUP.md` for full instructions.

## Workspace Rename Note
The workspace feature previously called "Open Claw" is now displayed as **"WorkSpaces"** in the UI. This is a cosmetic, UI-only change. All internal code, API routes (`/api/openclaw/*`), database fields (`openClaw*` columns), CSS classes (`.openclaw-*`), and system prompts remain unchanged. When editing UI labels, replace "Open Claw" with "WorkSpaces". When editing code, keep the existing identifiers.

## Quick Commands (Windows)

```powershell
# Build and run PeakUI
cd C:\Users\raza\Desktop\projects\PeakUI
docker compose -f docker-compose.windows.yml up --build

# Just restart without rebuilding
docker compose -f docker-compose.windows.yml up

# Fix Ollama binding for Docker
$env:OLLAMA_HOST="0.0.0.0:11434"
C:\Users\raza\AppData\Local\Programs\Ollama\ollama.exe serve

# Full one-click setup
.\setup-windows.ps1 -FullSetup
```