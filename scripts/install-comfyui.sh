#!/usr/bin/env bash
# ComfyUI engine installer for PeakUI image generation (Linux/macOS).
#
# Installs ComfyUI + PyTorch CUDA into ~/ComfyUI with a uv-managed venv,
# registers a systemd user service so it survives reboots, and prints the
# values to put into PeakUI's .env / Settings.
#
# Usage:
#   ./scripts/install-comfyui.sh          # install + start
#   ./scripts/install-comfyui.sh --uninstall   # stop + remove service (keeps models)
#
# Prerequisites: NVIDIA GPU + driver. Uses uv if available, else falls back
# to python3 -m venv (needs python3-venv installed).
#
# This script is idempotent: safe to re-run; it upgrades in place.

set -eu

C_BLUE='\033[1;34m'; C_GREEN='\033[1;32m'; C_YELLOW='\033[1;33m'; C_OFF='\033[0m'
C_RED='\033[1;31m'
log()  { printf "${C_BLUE}==>${C_OFF} %s\n" "$*"; }
ok()   { printf "${C_GREEN}==>${C_OFF} %s\n" "$*"; }
warn() { printf "${C_YELLOW}==>${C_OFF} %s\n" "$*" >&2; }
die()  { printf "${C_RED}==>${C_OFF} %s\n" "$*" >&2; exit 1; }

COMFYUI_DIR="${COMFYUI_DIR:-$HOME/ComfyUI}"
COMFYUI_PORT="${COMFYUI_PORT:-8188}"
COMFYUI_SERVICE="comfyui"
PINNED_TORCH="2.10.0"
PINNED_CUDA="cu128"

# --- uninstall ---------------------------------------------------------------
if [ "${1:-}" = "--uninstall" ]; then
  if systemctl --user is-active --quiet "$COMFYUI_SERVICE" 2>/dev/null; then
    systemctl --user stop "$COMFYUI_SERVICE"
  fi
  systemctl --user disable "$COMFYUI_SERVICE" 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/$COMFYUI_SERVICE.service"
  systemctl --user daemon-reload
  ok "ComfyUI service stopped and removed. Models kept at $COMFYUI_DIR/models."
  exit 0
fi

# --- 1. GPU check ------------------------------------------------------------
if ! command -v nvidia-smi >/dev/null 2>&1; then
  die "nvidia-smi not found. An NVIDIA GPU + driver is required for image generation."
fi
GPU_NAME="$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 || echo 'unknown')"
VRAM_TOTAL="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader 2>/dev/null | head -1 || echo 'unknown')"
ok "GPU detected: $GPU_NAME ($VRAM_TOTAL)"

# --- 2. Python / package manager ---------------------------------------------
UV_BIN=""
if command -v uv >/dev/null 2>&1; then
  UV_BIN="$(command -v uv)"
elif [ -x "$HOME/.hermes/bin/uv" ]; then
  UV_BIN="$HOME/.hermes/bin/uv"
fi

if [ -z "$UV_BIN" ]; then
  log "Installing uv (Python package manager)..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  UV_BIN="$HOME/.local/bin/uv"
  [ -x "$UV_BIN" ] || die "uv installation failed. Install it manually: https://docs.astral.sh/uv/"
fi
ok "Using package manager: $UV_BIN ($(basename "$UV_BIN") $(("$UV_BIN" --version 2>/dev/null | grep -oE '[0-9.]+' || echo '') ))"

# --- 3. Clone / update ComfyUI -------------------------------------------------
if [ -d "$COMFYUI_DIR/.git" ]; then
  log "Updating ComfyUI at $COMFYUI_DIR..."
  git -C "$COMFYUI_DIR" pull --ff-only 2>/dev/null || warn "git pull failed — using current checkout."
else
  log "Cloning ComfyUI into $COMFYUI_DIR..."
  git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git "$COMFYUI_DIR"
fi
ok "ComfyUI code ready."

# --- 4. Venv + dependencies ----------------------------------------------------
log "Creating/updating Python environment (first run downloads ~3 GB of PyTorch CUDA)..."
cd "$COMFYUI_DIR"

"$UV_BIN" venv .venv --python 3.12 2>/dev/null || die "Failed to create venv."

log "Installing PyTorch $PINNED_TORCH+$PINNED_CUDA (this is the big download)..."
"$UV_BIN" pip install --python .venv/bin/python \
  "torch==$PINNED_TORCH" torchvision torchaudio \
  --index-url "https://download.pytorch.org/whl/$PINNED_CUDA"

log "Installing ComfyUI requirements..."
"$UV_BIN" pip install --python .venv/bin/python -r requirements.txt

# torchaudio must match torch's exact version or it fails on import.
INSTALLED_TORCH="$(.venv/bin/python -c 'import torch; print(torch.__version__.split("+")[0])')"
"$UV_BIN" pip install --python .venv/bin/python "torchaudio==$INSTALLED_TORCH" \
  --index-url "https://download.pytorch.org/whl/$PINNED_CUDA" 2>/dev/null || true

ok "ComfyUI dependencies installed."

# --- 5. systemd user service ----------------------------------------------------
SERVICE_DIR="$HOME/.config/systemd/user"
mkdir -p "$SERVICE_DIR"
cat > "$SERVICE_DIR/$COMFYUI_SERVICE.service" <<EOF
[Unit]
Description=ComfyUI image generation engine (PeakUI)
After=network.target

[Service]
Type=simple
WorkingDirectory=$COMFYUI_DIR
ExecStart=$COMFYUI_DIR/.venv/bin/python main.py --listen 127.0.0.1 --port $COMFYUI_PORT
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now "$COMFYUI_SERVICE"
ok "ComfyUI registered as a systemd user service (auto-starts on boot, restarts on crash)."

# --- 6. Wait for the engine -------------------------------------------------------
log "Waiting for ComfyUI to come up on http://127.0.0.1:$COMFYUI_PORT ..."
i=0
while [ "$i" -lt 60 ]; do
  if curl -fsS -o /dev/null "http://127.0.0.1:$COMFYUI_PORT/system_stats" 2>/dev/null; then
    break
  fi
  i=$((i + 1)); sleep 2
done
[ "$i" -lt 60 ] || die "ComfyUI did not respond. Check: journalctl --user -u $COMFYUI_SERVICE"

ok "ComfyUI is running."

# --- 7. PeakUI .env wiring ----------------------------------------------------------
PEAKUI_DIR="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd || echo '')"
if [ -f "$PEAKUI_DIR/.env" ]; then
  log "Wiring COMFYUI_MODELS_DIR into PeakUI .env..."
  if grep -q '^COMFYUI_MODELS_DIR=' "$PEAKUI_DIR/.env"; then
    sed -i "s|^COMFYUI_MODELS_DIR=.*|COMFYUI_MODELS_DIR=$COMFYUI_DIR/models|" "$PEAKUI_DIR/.env"
  else
    echo "COMFYUI_MODELS_DIR=$COMFYUI_DIR/models" >> "$PEAKUI_DIR/.env"
  fi
  ok "COMFYUI_MODELS_DIR=$COMFYUI_DIR/models — restart PeakUI (docker compose up -d) to pick it up."
else
  warn "No PeakUI .env found next to this script. Add this line to it:"
  warn "  COMFYUI_MODELS_DIR=$COMFYUI_DIR/models"
fi

# --- 8. Summary ----------------------------------------------------------------------
printf "\n"
ok "ComfyUI is ready for PeakUI image generation."
printf "  • Engine:     http://127.0.0.1:%s\n" "$COMFYUI_PORT"
printf "  • GPU:        %s (%s)\n" "$GPU_NAME" "$VRAM_TOTAL"
printf "  • Models dir: %s/models\n" "$COMFYUI_DIR"
printf "  • Service:    systemctl --user %s %s\n" "start|stop" "$COMFYUI_SERVICE"
printf "\n"
printf "  Next: in PeakUI Settings → Image Generation, set Engine to ComfyUI,\n"
printf "  then search Hugging Face for a model (try 'dreamshaper' or 'sdxl')\n"
printf "  and download it. Toggle 'Image Gen' on in the chat and ask for an image.\n"
printf "\n"