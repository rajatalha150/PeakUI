# PeakUI Windows Docker Setup Script
# Run this from PowerShell as Administrator (for Hyper-V features if needed)
# Prerequisites: Docker Desktop installed, Ollama installed

param(
    [switch]$BuildOnly,
    [switch]$OllamaOnly,
    [switch]$FullSetup
)

$ErrorActionPreference = "Stop"
$ProjectDir = "C:\Users\raza\Desktop\projects\PeakUI"
$WorkspaceDir = "C:\Users\raza\peakui-workspace"
$OllamaExe = "C:\Users\raza\AppData\Local\Programs\Ollama\ollama.exe"

function Write-Header($text) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host $text -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
}

function Test-DockerRunning {
    try {
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        docker info 2>$null | Out-Null
        return $LASTEXITCODE -eq 0
    } catch { return $false }
}

function Test-OllamaRunning {
    try {
        $res = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
        return $res.StatusCode -eq 200
    } catch { return $false }
    }

# --- 1. Verify Docker Desktop ---
if (-not $OllamaOnly) {
    Write-Header "Step 1: Checking Docker Desktop"
    if (-not (Test-Path "C:\Program Files\Docker\Docker\Docker Desktop.exe")) {
        Write-Host "ERROR: Docker Desktop not found. Install it first with:" -ForegroundColor Red
        Write-Host "  winget install --id Docker.DockerDesktop --exact" -ForegroundColor Yellow
        exit 1
    }

    if (-not (Test-DockerRunning)) {
        Write-Host "Docker daemon not responding. Starting Docker Desktop..." -ForegroundColor Yellow
        Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe" -WindowStyle Hidden
        $tries = 0
        while (-not (Test-DockerRunning) -and $tries -lt 30) {
            Write-Host "  Waiting for Docker daemon... ($tries/30)" -ForegroundColor DarkGray
            Start-Sleep -Seconds 2
            $tries++
        }
        if (-not (Test-DockerRunning)) {
            Write-Host "ERROR: Docker Desktop failed to start. Restart may be required." -ForegroundColor Red
            exit 1
        }
    }
    Write-Host "Docker Desktop is running." -ForegroundColor Green
}

# --- 2. Verify/Create Workspace ---
if (-not $OllamaOnly) {
    Write-Header "Step 2: Workspace Directory"
    if (-not (Test-Path $WorkspaceDir)) {
        New-Item -ItemType Directory -Path $WorkspaceDir | Out-Null
        Write-Host "Created: $WorkspaceDir" -ForegroundColor Green
    } else {
        Write-Host "Already exists: $WorkspaceDir" -ForegroundColor Green
    }
}

# --- 3. Restart Ollama for Docker ---
Write-Header "Step 3: Ollama Configuration"
$ollamaNeedsRestart = $false

if (-not (Test-Path $OllamaExe)) {
    Write-Host "WARNING: Ollama not found at $OllamaExe" -ForegroundColor Yellow
    Write-Host "Download from https://ollama.com/download/windows" -ForegroundColor Yellow
} else {
    # Check if Ollama is bound to 0.0.0.0
    $ollamaProcs = Get-NetTCPConnection -LocalPort 11434 -ErrorAction SilentlyContinue | 
        Select-Object -Property LocalAddress
    $isBoundToAll = $ollamaProcs | Where-Object { $_.LocalAddress -eq "0.0.0.0" }

    if (-not $isBoundToAll) {
        Write-Host "Ollama is NOT bound to 0.0.0.0. Docker containers cannot reach it." -ForegroundColor Yellow
        $ollamaNeedsRestart = $true
    } else {
        Write-Host "Ollama is already bound to 0.0.0.0:11434. Good." -ForegroundColor Green
    }

    if ($ollamaNeedsRestart -or $OllamaOnly -or $FullSetup) {
        Write-Host "Stopping Ollama..." -ForegroundColor Yellow
        Get-Process -Name "ollama" -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 2

        Write-Host "Starting Ollama on 0.0.0.0:11434..." -ForegroundColor Yellow
        $env:OLLAMA_HOST = "0.0.0.0:11434"
        Start-Process $OllamaExe -ArgumentList "serve" -WindowStyle Hidden
        Start-Sleep -Seconds 3

        $tries = 0
        while ($tries -lt 15) {
            if (Test-OllamaRunning) {
                Write-Host "Ollama is running and reachable!" -ForegroundColor Green
                break
            }
            Write-Host "  Waiting for Ollama... ($tries/15)" -ForegroundColor DarkGray
            Start-Sleep -Seconds 1
            $tries++
        }
        if (-not (Test-OllamaRunning)) {
            Write-Host "WARNING: Could not confirm Ollama is running." -ForegroundColor Yellow
        }
    }
}

if ($OllamaOnly) { exit 0 }

# --- 4. Build & Run PeakUI ---
Write-Header "Step 4: Building & Starting PeakUI"
Set-Location $ProjectDir

Write-Host "Running: docker compose -f docker-compose.windows.yml up --build" -ForegroundColor Cyan
Write-Host "(This will take several minutes on first build)" -ForegroundColor DarkGray
docker compose -f docker-compose.windows.yml up --build

# If we get here, the user stopped with Ctrl+C
Write-Host ""
Write-Host "PeakUI stopped. To restart without rebuilding:" -ForegroundColor Cyan
Write-Host "  docker compose -f docker-compose.windows.yml up" -ForegroundColor Yellow