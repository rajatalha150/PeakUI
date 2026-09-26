#!/usr/bin/env bash
# Keep the managed Coder context and Git/SSH defaults in sync on every boot.
set -euo pipefail

mkdir -p /root/.qwen /root/.ssh /workspace
chmod 700 /root/.ssh
cp /opt/qwen-code/workspace-qwen.md /root/.qwen/QWEN.md
cp /opt/qwen-code/workspace-qwen.md /workspace/QWEN.md

if [[ -f /root/.ssh/id_ed25519 ]] && ! ssh-keygen -F github.com -f /root/.ssh/known_hosts >/dev/null 2>&1; then
  timeout 10 ssh-keyscan -H github.com >> /root/.ssh/known_hosts 2>/dev/null || true
  [[ ! -f /root/.ssh/known_hosts ]] || chmod 600 /root/.ssh/known_hosts
fi

[[ -n "$(git config --global user.name 2>/dev/null)" ]] || git config --global user.name 'PeakUI Coding Agent'
[[ -n "$(git config --global user.email 2>/dev/null)" ]] || git config --global user.email 'agent@peakui.local'
[[ -n "$(git config --global init.defaultBranch 2>/dev/null)" ]] || git config --global init.defaultBranch main
git config --global core.sshCommand 'ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes'
