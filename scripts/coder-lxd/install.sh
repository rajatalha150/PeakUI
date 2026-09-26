#!/usr/bin/env bash
# Opt-in Linux Coder backend. Run from the PeakUI checkout after LXD init.
set -euo pipefail

cd "$(dirname "$0")/../.."
[[ -f .env ]] || { echo 'Run the PeakUI installer first to create .env.' >&2; exit 1; }
saved_instance=$(sed -n 's/^CODER_LXD_INSTANCE=//p' .env | tail -n 1)
instance=${CODER_LXD_INSTANCE:-${saved_instance:-peakui-coder}}
saved_port=$(sed -n 's/^CODER_LXD_PORT=//p' .env 2>/dev/null | tail -n 1)
host_port=${CODER_LXD_PORT:-${saved_port:-4171}}
instance_cli=${PEAKUI_INSTANCE_CLI:-lxc}
[[ "$instance_cli" == lxc || "$instance_cli" == incus ]] || { echo 'PEAKUI_INSTANCE_CLI must be lxc or incus' >&2; exit 1; }
if [[ "$instance_cli" == incus ]]; then
  image=${CODER_LXD_IMAGE:-images:ubuntu/24.04/cloud}
else
  image=${CODER_LXD_IMAGE:-ubuntu:24.04}
fi
case "$instance" in *[!a-zA-Z0-9-]*|'') echo 'Invalid CODER_LXD_INSTANCE' >&2; exit 1 ;; esac
case "$host_port" in *[!0-9]*|'') echo 'Invalid CODER_LXD_PORT' >&2; exit 1 ;; esac
[[ "$host_port" -ge 1024 && "$host_port" -le 65535 ]] || { echo 'CODER_LXD_PORT must be 1024..65535' >&2; exit 1; }
for command in "$instance_cli" docker python3 curl; do
  command -v "$command" >/dev/null || { echo "Missing $command" >&2; exit 1; }
done
"$instance_cli" info >/dev/null || { echo 'LXD/Incus is not initialized or this user cannot access it.' >&2; exit 1; }
docker compose version >/dev/null

compose_project=$(docker compose config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')
coder_key=$(docker compose config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["coder"]["environment"]["OPENAI_API_KEY"])')
coder_model=$(docker compose config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["coder"]["environment"]["OPENAI_MODEL"])')
coder_model_url=$(docker compose config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["coder"]["environment"]["OPENAI_BASE_URL"])')
qwen_version=$(sed -n 's/^ARG QWEN_CODE_VERSION=//p' Dockerfile.coder | head -n 1)
[[ -n "$qwen_version" ]] || { echo 'Could not determine pinned Qwen version.' >&2; exit 1; }
python3 -c 'import pathlib,secrets; p=pathlib.Path(".env"); lines=p.read_text().splitlines(); matches=[s.split("=",1)[1] for s in lines if s.startswith("CODER_SERVER_TOKEN=")]; token=matches[-1] if matches else ""; p.open("a").write("\nCODER_SERVER_TOKEN="+secrets.token_urlsafe(48)+"\n") if not token else None'
coder_token=$(docker compose config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["coder"]["environment"]["QWEN_SERVER_TOKEN"])')
[[ -n "$coder_token" ]] || { echo 'Coder token is empty.' >&2; exit 1; }

# Reuse the Docker volumes already mounted by the app. LXD's idmapped disk
# mounts let its unprivileged root use them without changing host ownership.
volume_mounts=(
  'coder_workspace:/workspace:workspace'
  'coder_apps:/apps:apps'
  'coder_qwen_state:/root/.qwen:qwen'
  'coder_root_home:/root:home'
  'coder_gradle_cache:/root/.gradle:gradle'
  'coder_android_home:/root/.android:android-home'
  'coder_npm_cache:/root/.npm:npm'
  'coder_pip_cache:/root/.cache/pip:pip'
  'coder_android_sdk:/opt/android-sdk:android-sdk'
)

if ! "$instance_cli" info "$instance" >/dev/null 2>&1; then
  "$instance_cli" init "$image" "$instance" \
    -c limits.cpu="${CODER_LXD_CPUS:-4}" -c limits.memory="${CODER_LXD_MEMORY:-8GiB}" \
    -c limits.processes=4096 -c security.nesting=true \
    -c security.syscalls.intercept.mknod=true \
    -c security.syscalls.intercept.setxattr=true
fi

for spec in "${volume_mounts[@]}"; do
  IFS=: read -r suffix destination name <<< "$spec"
  volume="${compose_project}_${suffix}"
  docker volume create "$volume" >/dev/null
  source=$(docker volume inspect --format '{{.Mountpoint}}' "$volume")
  if ! "$instance_cli" config device get "$instance" "$name" path >/dev/null 2>&1; then
    "$instance_cli" config device add "$instance" "$name" disk "source=$source" "path=$destination" shift=true
  fi
done

if ! "$instance_cli" config device get "$instance" coder-api listen >/dev/null 2>&1; then
  "$instance_cli" config device add "$instance" coder-api proxy \
    "listen=tcp:127.0.0.1:${host_port}" 'connect=tcp:127.0.0.1:4170'
fi
if ! "$instance_cli" config device get "$instance" coder-preview listen >/dev/null 2>&1; then
  "$instance_cli" config device add "$instance" coder-preview proxy \
    'listen=tcp:127.0.0.1:4172' 'connect=tcp:127.0.0.1:4172'
fi
if ! "$instance_cli" config device get "$instance" ollama listen >/dev/null 2>&1; then
  "$instance_cli" config device add "$instance" ollama proxy bind=instance \
    'listen=tcp:127.0.0.1:11434' 'connect=tcp:127.0.0.1:11434'
fi

if [[ "$("$instance_cli" list "$instance" -f csv -c s)" != RUNNING ]]; then "$instance_cli" start "$instance"; fi
"$instance_cli" exec "$instance" -- cloud-init status --wait

rollback=1
on_failure() {
  if [[ "$rollback" == 1 ]]; then
    "$instance_cli" exec "$instance" -- systemctl stop peakui-coder.service >/dev/null 2>&1 || true
    docker compose -f docker-compose.yml up -d --no-deps --build app coder || true
  fi
}
trap on_failure EXIT
"$instance_cli" exec "$instance" -- systemctl stop peakui-coder.service >/dev/null 2>&1 || true

"$instance_cli" file push -p scripts/coder-storage/peakui-coder-start "$instance/usr/local/bin/peakui-coder-start"
"$instance_cli" file push -p scripts/coder-storage/peakui-coder-readiness "$instance/usr/local/bin/peakui-coder-readiness"
"$instance_cli" file push -p scripts/coder-storage/peakui-cleanup "$instance/usr/local/bin/peakui-cleanup"
"$instance_cli" file push -p scripts/coder-lxd/prepare.sh "$instance/usr/local/bin/peakui-coder-prepare"
"$instance_cli" file push -p scripts/sync-coder-models.mjs "$instance/tmp/peakui-sync-coder-models.mjs"
"$instance_cli" file push -p scripts/coder-workspace/QWEN.md "$instance/tmp/peakui-workspace-QWEN.md"
"$instance_cli" file push -r -p scripts/coder-browser "$instance/tmp/peakui-browser"
"$instance_cli" file push -p scripts/coder-lxd/bootstrap.sh "$instance/tmp/peakui-bootstrap.sh"
"$instance_cli" file push -p scripts/coder-lxd/workspace-router.mjs "$instance/opt/peakui/coder/workspace-router.mjs"
"$instance_cli" file push -p scripts/coder-lxd/peakui-coder.service "$instance/etc/systemd/system/peakui-coder.service"

env_file=$(mktemp)
trap 'on_failure; rm -f "$env_file"' EXIT
chmod 600 "$env_file"
printf 'QWEN_SERVER_TOKEN=%s\nOPENAI_API_KEY=%s\nOPENAI_MODEL=%s\nOPENAI_BASE_URL=%s\nQWEN_DEBUG_LOG_FILE=1\nCODER_MIN_FREE_GB=%s\nPEAKUI_QWEN_VERSION=%s\n' \
  "$coder_token" "$coder_key" "$coder_model" "$coder_model_url" "${CODER_MIN_FREE_GB:-12}" "$qwen_version" > "$env_file"
"$instance_cli" file push -p "$env_file" "$instance/etc/peakui-coder.env"

echo "Provisioning $instance (first run downloads the toolchain and browser)..."
"$instance_cli" exec "$instance" -- bash /tmp/peakui-bootstrap.sh

# Keep Docker Coder available for rollback until LXD is healthy. Both daemons
# must not write the same Qwen state at the same time.
docker compose stop coder
"$instance_cli" exec "$instance" -- systemctl start peakui-coder.service
for i in {1..60}; do
  if curl -fsS --max-time 5 -H "Authorization: Bearer $coder_token" "http://127.0.0.1:${host_port}/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS --max-time 10 -H "Authorization: Bearer $coder_token" "http://127.0.0.1:${host_port}/health" >/dev/null
docker compose -f docker-compose.yml -f docker-compose.lxd.yml up -d --no-deps app
rollback=0
sed -i '/^PEAKUI_CODER_BACKEND=/d; /^PEAKUI_INSTANCE_CLI=/d; /^CODER_LXD_PORT=/d; /^CODER_LXD_INSTANCE=/d' .env
printf '\nPEAKUI_CODER_BACKEND=lxd\nPEAKUI_INSTANCE_CLI=%s\nCODER_LXD_PORT=%s\nCODER_LXD_INSTANCE=%s\n' "$instance_cli" "$host_port" "$instance" >> .env
echo "Coder is running in LXD ($instance). PeakUI is connected on loopback port $host_port."
