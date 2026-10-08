#!/usr/bin/env bash
# Opt-in Linux Coder backend. Run from the PeakUI checkout after LXD init.
set -euo pipefail

cd "$(dirname "$0")/../.."
[[ -f .env ]] || { echo 'Run the PeakUI installer first to create .env.' >&2; exit 1; }
saved_instance=$(sed -n 's/^CODER_LXD_INSTANCE=//p' .env | tail -n 1)
instance=${CODER_LXD_INSTANCE:-${saved_instance:-peakui-coder}}
saved_port=$(sed -n 's/^CODER_LXD_PORT=//p' .env 2>/dev/null | tail -n 1)
host_port=${CODER_LXD_PORT:-${saved_port:-4171}}
if [[ -n "${PEAKUI_INSTANCE_CLI:-}" ]]; then
  instance_cli=$PEAKUI_INSTANCE_CLI
elif command -v incus >/dev/null 2>&1; then
  instance_cli=incus
else
  instance_cli=lxc
fi
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
coder_version=$(sed -n 's/^ARG CODER_ENGINE_VERSION=//p' Dockerfile.coder | head -n 1)
[[ -n "$coder_version" ]] || { echo 'Could not determine pinned Coder version.' >&2; exit 1; }
python3 -c 'import pathlib,secrets; p=pathlib.Path(".env"); lines=p.read_text().splitlines(); matches=[s.split("=",1)[1] for s in lines if s.startswith("CODER_SERVER_TOKEN=")]; token=matches[-1] if matches else ""; p.open("a").write("\nCODER_SERVER_TOKEN="+secrets.token_urlsafe(48)+"\n") if not token else None'
coder_token=$(docker compose config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["coder"]["environment"]["QWEN_SERVER_TOKEN"])')
[[ -n "$coder_token" ]] || { echo 'Coder token is empty.' >&2; exit 1; }
saved_backend=$(sed -n 's/^PEAKUI_CODER_BACKEND=//p' .env | tail -n 1)

# Migration order matters: copy /root first, then overlay the Docker volumes
# that were mounted at nested paths inside it.
volume_migrations=(
  'coder_root_home:/root'
  'coder_workspace:/workspace'
  'coder_apps:/apps'
  'coder_state:/root/.qwen'
  'coder_browser_state:/var/lib/peakui/browser'
  'coder_gradle_cache:/root/.gradle'
  'coder_android_home:/root/.android'
  'coder_npm_cache:/root/.npm'
  'coder_pip_cache:/root/.cache/pip'
  'coder_android_sdk:/opt/android-sdk'
)

# Incus 6.0 on some hosts completes `file push` but returns Forbidden while
# applying file metadata to an unprivileged guest. Stream bytes to a root
# process in the guest instead; this also avoids an API-size limit for trees.
push_guest_file() {
  local source=$1 destination=$2 mode=$3
  # mkdir -p leaves an existing directory's permissions intact. In particular,
  # never turn the guest's sticky /tmp (1777) into a private staging directory.
  "$instance_cli" exec "$instance" -- mkdir -p "$(dirname "$destination")"
  # Cloud-init may leave a staging file owned by its default user in sticky
  # /tmp. Remove only this explicit managed target before writing it as root.
  "$instance_cli" exec "$instance" -- rm -f "$destination"
  "$instance_cli" exec "$instance" -- sh -c 'umask 022; cat > "$1"; chmod "$2" "$1"' sh "$destination" "$mode" < "$source"
}

push_guest_tree() {
  local source=$1 destination=$2
  "$instance_cli" exec "$instance" -- install -d -m 0755 "$destination"
  tar -C "$source" -cf - . | "$instance_cli" exec "$instance" -- tar -C "$destination" --no-same-owner -xpf -
}

verify_nested_docker() {
  # `docker info` only proves that its daemon started. Exercise runc as well,
  # because a host AppArmor/profile mismatch can make every OCI launch fail.
  local output
  if output=$("$instance_cli" exec "$instance" -- timeout 120 docker run --rm --pull=missing hello-world 2>&1); then
    echo 'Nested Docker verified.'
    return
  fi

  echo 'Nested Docker could not launch a container in the persistent Coder guest:' >&2
  printf '%s\n' "$output" >&2
  if [[ "$output" == *'net.ipv4.ip_unprivileged_port_start'* ]]; then
    echo 'The host Incus/LXD AppArmor integration is too old for this runc. Re-run with the maintained Incus default (PEAKUI_INCUS_CHANNEL=lts-6.0), then retry.' >&2
  fi
  return 1
}

if ! "$instance_cli" info "$instance" >/dev/null 2>&1; then
  "$instance_cli" init "$image" "$instance" \
    -c limits.cpu="${CODER_LXD_CPUS:-4}" -c limits.memory="${CODER_LXD_MEMORY:-12GiB}" \
    -c limits.processes=4096 -c security.nesting=true \
    -c security.syscalls.intercept.mknod=true \
    -c security.syscalls.intercept.setxattr=true
fi
current_memory=$("$instance_cli" config get "$instance" limits.memory)
if [[ -n "${CODER_LXD_MEMORY:-}" && "$current_memory" != "$CODER_LXD_MEMORY" ]]; then
  "$instance_cli" config set "$instance" limits.memory="$CODER_LXD_MEMORY"
elif [[ -z "${CODER_LXD_MEMORY:-}" && "$current_memory" == 8GiB ]]; then
  # Upgrade only the previous installer default; preserve custom guest limits.
  "$instance_cli" config set "$instance" limits.memory=12GiB
fi

# Older previews of this backend attached Docker's internal volume paths with
# shift=true. Remove those devices so startup works on every Incus-supported
# filesystem; the data itself remains untouched in Docker.
for name in workspace apps coder home gradle android-home npm pip android-sdk shift-test; do
  if "$instance_cli" config device get "$instance" "$name" path >/dev/null 2>&1; then
    "$instance_cli" config device remove "$instance" "$name"
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

rollback=1
on_failure() {
  if [[ "$rollback" == 1 ]]; then
    "$instance_cli" exec "$instance" -- systemctl stop peakui-coder.service >/dev/null 2>&1 || true
    docker compose -f docker-compose.yml up -d --no-deps --build app coder || true
  fi
}
trap on_failure EXIT

if [[ "$("$instance_cli" list "$instance" -f csv -c s)" != RUNNING ]]; then "$instance_cli" start "$instance"; fi
runtime_version=$("$instance_cli" version 2>/dev/null | sed -n 's/^Server version: //p' | head -n 1)
applied_runtime_version=$("$instance_cli" config get "$instance" user.peakui-runtime-version 2>/dev/null || true)
# Incus generates the guest AppArmor profile at start. Refresh an existing
# guest once after an Incus upgrade so its security profile gains runtime fixes.
if [[ -n "$runtime_version" && "$runtime_version" != "$applied_runtime_version" ]]; then
  echo "Refreshing $instance for Incus runtime $runtime_version..."
  "$instance_cli" restart "$instance"
  "$instance_cli" config set "$instance" user.peakui-runtime-version "$runtime_version"
fi
"$instance_cli" exec "$instance" -- cloud-init status --wait

"$instance_cli" exec "$instance" -- systemctl stop peakui-coder.service >/dev/null 2>&1 || true

push_guest_file scripts/coder-storage/peakui-coder-start /usr/local/bin/peakui-coder-start 755
push_guest_file scripts/coder-storage/peakui-coder-readiness /usr/local/bin/peakui-coder-readiness 755
push_guest_file scripts/coder-storage/peakui-install-android /usr/local/bin/peakui-install-android 755
push_guest_file scripts/coder-storage/peakui-cleanup /usr/local/bin/peakui-cleanup 755
push_guest_file scripts/coder-lxd/prepare.sh /usr/local/bin/peakui-coder-prepare 755
push_guest_file scripts/sync-coder-models.mjs /tmp/peakui-sync-coder-models.mjs 644
push_guest_file scripts/coder-workspace/CODER.md /tmp/peakui-workspace-CODER.md 644
push_guest_tree scripts/coder-workspace/skills /tmp/peakui-skills
push_guest_tree scripts/coder-workspace/memories /tmp/peakui-memories
push_guest_tree scripts/coder-browser /tmp/peakui-browser
push_guest_file scripts/coder-lxd/bootstrap.sh /tmp/peakui-bootstrap.sh 755
push_guest_file scripts/coder-lxd/workspace-router.mjs /opt/peakui/coder/workspace-router.mjs 644
push_guest_file scripts/coder-lxd/terminal.mjs /opt/peakui/coder/terminal.mjs 644
push_guest_file scripts/coder-lxd/terminal.node-test.mjs /opt/peakui/coder/terminal.node-test.mjs 644
push_guest_file scripts/coder-lxd/peakui-coder.service /etc/systemd/system/peakui-coder.service 644
# The unit was just copied into a running systemd guest. Reload before starting
# it so a redeploy cannot launch a stale cached definition and then silently
# roll back to the Docker Coder service.
"$instance_cli" exec "$instance" -- systemctl daemon-reload

env_file=$(mktemp)
trap 'on_failure; rm -f "$env_file"' EXIT
chmod 600 "$env_file"
printf 'QWEN_SERVER_TOKEN=%s\nOPENAI_API_KEY=%s\nOPENAI_MODEL=%s\nOPENAI_BASE_URL=%s\nQWEN_DEBUG_LOG_FILE=1\nCODER_MIN_FREE_GB=%s\nPEAKUI_CODER_VERSION=%s\n' \
  "$coder_token" "$coder_key" "$coder_model" "$coder_model_url" "${CODER_MIN_FREE_GB:-12}" "$coder_version" > "$env_file"
push_guest_file "$env_file" /etc/peakui-coder.env 600

echo "Provisioning $instance (first run downloads the toolchain and browser)..."
"$instance_cli" exec "$instance" -- bash /tmp/peakui-bootstrap.sh
verify_nested_docker

# Keep Docker data available for rollback, but make the Incus root filesystem
# authoritative. Tar streaming preserves large workspaces without relying on
# host bind mounts, UID shifting, or a particular host filesystem.
docker compose stop app coder
if [[ "$saved_backend" != lxd ]]; then
  docker image inspect alpine:3.20 >/dev/null 2>&1 || docker pull alpine:3.20
  for spec in "${volume_migrations[@]}"; do
    IFS=: read -r suffix destination <<< "$spec"
    volume="${compose_project}_${suffix}"
    docker volume create "$volume" >/dev/null
    "$instance_cli" exec "$instance" -- mkdir -p "$destination"
    docker run --rm --network none -v "$volume:/source:ro" alpine:3.20 \
      tar -C /source -cf - . | "$instance_cli" exec "$instance" -- tar -C "$destination" -xpf -
  done
fi
# A migrated Docker SDK volume may be empty or incomplete. Verify the final
# guest filesystem after migration, before switching the app to this runtime.
"$instance_cli" exec "$instance" -- /usr/local/bin/peakui-install-android
"$instance_cli" exec "$instance" -- systemctl start peakui-coder.service
for i in {1..60}; do
  if curl -fsS --max-time 5 -H "Authorization: Bearer $coder_token" "http://127.0.0.1:${host_port}/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS --max-time 10 -H "Authorization: Bearer $coder_token" "http://127.0.0.1:${host_port}/health" >/dev/null
docker compose -f docker-compose.yml -f docker-compose.lxd.yml up -d --no-deps app
# Docker Coder is started temporarily as a rollback target while the guest is
# provisioned. Once the Incus daemon and app overlay are healthy, release its
# duplicate CPU and memory rather than leaving two coding runtimes running.
docker compose stop coder
rollback=0
sed -i '/^PEAKUI_CODER_BACKEND=/d; /^PEAKUI_INSTANCE_CLI=/d; /^CODER_LXD_PORT=/d; /^CODER_LXD_INSTANCE=/d' .env
printf '\nPEAKUI_CODER_BACKEND=lxd\nPEAKUI_INSTANCE_CLI=%s\nCODER_LXD_PORT=%s\nCODER_LXD_INSTANCE=%s\n' "$instance_cli" "$host_port" "$instance" >> .env
echo "Coder is running in LXD ($instance). PeakUI is connected on loopback port $host_port."
