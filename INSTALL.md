# Install PeakUI

PeakUI runs as a Docker Compose stack: a Next.js app container, a PostgreSQL database, and an optional Tor proxy for UWAF stealth browsing.

## Quick install (one command)

If Docker is already installed, you can deploy the whole stack with a single
command — it clones the repo, generates a `.env` with random secrets, builds,
and starts everything detached, then prints the URL.

**Linux / macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/rajatalha150/PeakUI/main/scripts/install.sh | sh
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/rajatalha150/PeakUI/main/scripts/install.ps1 | iex
```

The installer is idempotent — re-running it `git pull`s the latest code and
rebuilds, so the same command upgrades an existing deployment. It auto-selects
the right compose file per OS (host networking on Linux, bridge networking on
macOS/Windows) and writes OS-appropriate `DATABASE_URL` / `OLLAMA_HOST` values.

The only hard prerequisite is Docker. Ollama is a soft prerequisite: the stack
comes up without it, and you point PeakUI at your Ollama host in Settings
after first login. To clone manually instead, run `./scripts/install.sh`
(Linux/macOS) or `.\scripts\install.ps1` (Windows) from the repo root.

## Requirements

- Docker and Docker Compose
- Ollama installed locally
- At least one Ollama chat model pulled
- (Optional) An embedding model for semantic RAG

## Linux / macOS / Docker Desktop

```bash
# 1. Clone the repository
git clone https://github.com/rajatalha150/PeakUI.git
cd PeakUI

# 2. Copy and edit environment variables
cp .env.example .env
# Edit .env and set DATABASE_URL and a strong JWT_SECRET

# 3. Start the stack
docker compose up -d --build

# 4. Open the app
open http://localhost:3000
```

On first visit, create the initial admin account.

## Windows 11

Windows Docker Desktop does not support `network_mode: host`, so use the Windows-specific compose file.

1. Install Docker Desktop with the WSL2 backend.
2. Install Ollama for Windows.
3. Restart Ollama so it binds to `0.0.0.0:11434` (containers cannot reach `127.0.0.1`):
   ```powershell
   .\restart-ollama-for-docker.bat
   ```
4. Copy `.env.example` to `.env` and use the **Windows** values in the commented examples:
   - `DATABASE_URL=postgresql://peakui:CHANGE_ME@db:5432/peakui`
   - `OLLAMA_HOST=http://host.docker.internal:11434`
   - `WORKSPACE_TOOL_HOST_HOME_DIR=C:\Users\%USERNAME%`
   - `WORKSPACE_TOOL_HOST_TMP_DIR=C:\Users\%USERNAME%\AppData\Local\Temp`
   - `WORKSPACE_TOOL_HOST_WORKSPACE_DIR=C:\Users\%USERNAME%\peakui-workspace`
   - `WORKSPACE_TOOL_HOST_EXECUTOR_URL=http://host.docker.internal:4318`
   - `TOR_PROXY_URL=socks5://tor-proxy:9150` (auto-detected if omitted)
5. Run the setup helper or start manually:

```powershell
# Helper (adjust paths in the script if your Ollama/project directories differ)
.\setup-windows.ps1 -FullSetup

# Or manually:
docker compose -f docker-compose.windows.yml up --build
```

6. Open [http://localhost:3000](http://localhost:3000) and create the initial admin account.

> **Note:** The first time you sign in, PeakUI stores the `OLLAMA_HOST` value as your default Ollama host. Make sure the env var is set correctly before that first login.

See [WINDOWS-SETUP.md](WINDOWS-SETUP.md) for full details.

## Optional Host Shell Executor

By default shell commands run inside the app container. To execute approved commands on the host:

```bash
export WORKSPACE_TOOL_HOST_EXECUTOR_TOKEN="$(head -c 32 /dev/urandom | base64)"
npm run workspace-tool:host-executor
```

Set the same `WORKSPACE_TOOL_HOST_EXECUTOR_TOKEN` in your `.env` and choose **Host** in WorkSpaces Settings.

## Updating

```bash
git pull origin main
docker compose up -d --build
```

## Troubleshooting

- **Port 5432 in use**: another PostgreSQL instance is running. Stop it or change the host port mapping in your compose file.
- **Ollama unreachable from container**: ensure Ollama is bound to `0.0.0.0:11434`, not `127.0.0.1`.
- **Build errors**: run `docker compose build --no-cache` after dependency changes.
