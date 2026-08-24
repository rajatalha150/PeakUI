# PeakUI one-command installer — Windows (PowerShell).
#
#   irm https://raw.githubusercontent.com/rajatalha150/PeakUI/main/scripts/install.ps1 | iex
#
# Or, after a manual clone, from the repo root:
#   .\scripts\install.ps1 [-TargetDir <path>]
#
# Idempotent: safe to re-run to update an existing deployment.
# Hard prerequisite: Docker Desktop (WSL2 backend).
# Ollama is a soft prerequisite — the stack comes up without it.

[CmdletBinding()]
param(
    [string]$TargetDir = $env:PEAKUI_TARGET,
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$Repo = "https://github.com/rajatalha150/PeakUI.git"
$Branch = "main"
$ComposeFile = "docker-compose.windows.yml"

function Write-Step($t) { Write-Host "`n==> $t" -ForegroundColor Cyan }
function Write-OK($t)    { Write-Host "==> $t" -ForegroundColor Green }
function Write-Warn($t)  { Write-Host "==> $t" -ForegroundColor Yellow }
function Write-Err($t)   { Write-Host "==> $t" -ForegroundColor Red }

if (-not $TargetDir) { $TargetDir = "C:\Users\$env:USERNAME\Projects\PeakUI" }

# Ensure Docker is on PATH for fresh sessions.
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# --- 1. Verify Docker Desktop ----------------------------------------------
Write-Step "Checking Docker Desktop..."
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Err "Docker is not installed or not on PATH."
    Write-Host "  Install it with:" -ForegroundColor Yellow
    Write-Host "    winget install --id Docker.DockerDesktop --exact" -ForegroundColor Yellow
    Write-Host "  Then start Docker Desktop and re-run this command." -ForegroundColor Yellow
    exit 1
}
function Test-DockerRunning { (docker info 2>&1 | Out-Null); $LASTEXITCODE -eq 0 }
if (-not (Test-DockerRunning)) {
    Write-Warn "Docker daemon not responding. Starting Docker Desktop..."
    $dd = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dd) { Start-Process $dd -WindowStyle Hidden } else { Write-Err "Docker Desktop not found at $dd"; exit 1 }
    $tries = 0
    while (-not (Test-DockerRunning) -and $tries -lt 30) {
        Start-Sleep -Seconds 2; $tries++
        Write-Host "  waiting for Docker daemon... ($tries/30)" -ForegroundColor DarkGray
    }
    if (-not (Test-DockerRunning)) { Write-Err "Docker Desktop failed to start. A reboot may be required."; exit 1 }
}
docker compose version 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Err "The 'docker compose' plugin is missing. Update Docker Desktop and re-run."; exit 1 }
Write-OK "Docker is available."

# --- 2. Obtain / update the repository -------------------------------------
if (Test-Path (Join-Path $TargetDir $ComposeFile)) {
    Write-Step "Updating existing checkout at $TargetDir"
    Set-Location $TargetDir
    git fetch --quiet origin $Branch 2>$null
    if ($LASTEXITCODE -eq 0) { git checkout $Branch 2>$null; git pull --ff-only --quiet origin $Branch 2>$null }
} else {
    Write-Step "Cloning PeakUI into $TargetDir"
    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
    git clone --depth 1 --branch $Branch $Repo $TargetDir
    Set-Location $TargetDir
}
if (-not (Test-Path $ComposeFile)) { Write-Err "$ComposeFile not found in $TargetDir — incomplete checkout."; exit 1 }

# --- 3. Generate .env (idempotent) -----------------------------------------
$EnvFile = Join-Path $TargetDir ".env"
if (Test-Path $EnvFile) {
    Write-OK ".env already exists — keeping your values."
} else {
    Write-Step "Generating .env with random secrets..."
    $pgPass = -join ((48..57) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
    $jwtBytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($jwtBytes)
    $jwt = [Convert]::ToBase64String($jwtBytes)
    $workspace = "C:\Users\$env:USERNAME\peakui-workspace"
    $projects  = "C:\Users\$env:USERNAME\Desktop"
    New-Item -ItemType Directory -Path $workspace -Force | Out-Null
    New-Item -ItemType Directory -Path $projects  -Force | Out-Null
    $envContent = @"
POSTGRES_USER=peakui
POSTGRES_PASSWORD=$pgPass
POSTGRES_DB=peakui
DATABASE_URL=postgresql://peakui:$pgPass@db:5432/peakui
JWT_SECRET=$jwt
OLLAMA_HOST=http://host.docker.internal:11434
WORKSPACE_TOOL_HOST_HOME_DIR=C:\Users\$env:USERNAME
WORKSPACE_TOOL_HOST_TMP_DIR=C:\Users\$env:USERNAME\AppData\Local\Temp
WORKSPACE_TOOL_HOST_WORKSPACE_DIR=$workspace
WORKSPACE_TOOL_HOST_PROJECTS_DIR=$projects
TOR_PROXY_URL=socks5://tor-proxy:9150
"@
    Set-Content -Path $EnvFile -Value $envContent -Encoding UTF8
    Write-OK ".env created."
}

# --- 4. Build + start (detached) -------------------------------------------
Write-Step "Building and starting PeakUI (first build takes a few minutes)..."
docker compose -f $ComposeFile up -d --build
if ($LASTEXITCODE -ne 0) { Write-Err "docker compose up failed. See output above."; exit 1 }

# --- 5. Wait for the app and report ---------------------------------------
Write-Step "Waiting for the app to come up on http://localhost:$Port ..."
$tries = 0
$up = $false
while ($tries -lt 90) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400) { $up = $true; break }
    } catch { }
    Start-Sleep -Seconds 2
    $tries++
}
if ($up) {
    Write-OK "PeakUI is running at http://localhost:$Port"
    Write-Host "  - On first visit, create the initial admin account."
    Write-Host "  - Ollama: run .\restart-ollama-for-docker.bat so containers can reach it, then set OLLAMA_HOST in Settings."
    Write-Host "  - Logs:   docker compose -f $ComposeFile logs -f app"
    Write-Host "  - Stop:   docker compose -f $ComposeFile down"
    Write-Host "  - Update: re-run this installer (it git-pulls and rebuilds)."
} else {
    Write-Warn "App did not respond on :$Port within ~3 minutes."
    Write-Err "Check logs: docker compose -f $ComposeFile logs app"
    exit 1
}