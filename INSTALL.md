# Install PeakUI

PeakUI runs as a Docker Compose stack: a Next.js app container, a PostgreSQL database, and an optional Tor proxy for UWAF stealth browsing.

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
3. Copy `.env.example` to `.env` and fill in your values.
4. Run the setup helper or start manually:

```powershell
# Helper (adjust paths in the script if your Ollama/project directories differ)
.\setup-windows.ps1 -FullSetup

# Or manually:
$env:OLLAMA_HOST="0.0.0.0:11434"
Start-Process "C:\Path\To\Ollama\ollama.exe" -ArgumentList "serve"
docker compose -f docker-compose.windows.yml up --build
```

See [WINDOWS-SETUP.md](WINDOWS-SETUP.md) for full details.

## Optional Host Shell Executor

By default shell commands run inside the app container. To execute approved commands on the host:

```bash
export OPENCLAW_HOST_EXECUTOR_TOKEN="$(head -c 32 /dev/urandom | base64)"
npm run openclaw:host-executor
```

Set the same `OPENCLAW_HOST_EXECUTOR_TOKEN` in your `.env` and choose **Host** in WorkSpaces Settings.

## Updating

```bash
git pull origin main
docker compose up -d --build
```

## Troubleshooting

- **Port 5432 in use**: another PostgreSQL instance is running. Stop it or change the host port mapping in your compose file.
- **Ollama unreachable from container**: ensure Ollama is bound to `0.0.0.0:11434`, not `127.0.0.1`.
- **Build errors**: run `docker compose build --no-cache` after dependency changes.
