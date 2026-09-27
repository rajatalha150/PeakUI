#!/bin/sh
set -eu

mkdir -p /mnt/workspace-tool/workspace /var/lib/peakui

if [ -z "${JWT_SECRET:-}" ] || [ "${#JWT_SECRET}" -lt 32 ]; then
  if [ -f /var/lib/peakui/jwt-secret ]; then
    JWT_SECRET="$(cat /var/lib/peakui/jwt-secret)"
  else
    JWT_SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '\n' | cut -c1-64)"
    printf '%s' "$JWT_SECRET" > /var/lib/peakui/jwt-secret
    chmod 600 /var/lib/peakui/jwt-secret
  fi
  export JWT_SECRET
fi

WORKSPACE_TOOL_HOST_WORKSPACE_DIR="${WORKSPACE_TOOL_HOST_WORKSPACE_DIR:-/home/raza/.peakui/workspace}"
if [ "$WORKSPACE_TOOL_HOST_WORKSPACE_DIR" != "/mnt/workspace-tool/workspace" ] \
  && [ ! -e "$WORKSPACE_TOOL_HOST_WORKSPACE_DIR" ] \
  && ! printf '%s' "$WORKSPACE_TOOL_HOST_WORKSPACE_DIR" | grep -qE '^[A-Za-z]:'; then
  mkdir -p "$(dirname "$WORKSPACE_TOOL_HOST_WORKSPACE_DIR")"
  ln -s /mnt/workspace-tool/workspace "$WORKSPACE_TOOL_HOST_WORKSPACE_DIR"
fi

npx prisma migrate deploy
node scripts/coder-preview-gateway.mjs &
gateway_pid=$!
trap 'kill "$gateway_pid" 2>/dev/null || true' EXIT INT TERM
node server.js

