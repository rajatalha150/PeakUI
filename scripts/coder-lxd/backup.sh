#!/usr/bin/env bash
# Consistent Coder backup: persistent instance root and PeakUI database.
set -euo pipefail
umask 077
cd "$(dirname "$0")/../.."
[[ -f .env ]] || { echo 'Missing PeakUI .env.' >&2; exit 1; }
saved_instance=$(sed -n 's/^CODER_LXD_INSTANCE=//p' .env | tail -n 1)
saved_cli=$(sed -n 's/^PEAKUI_INSTANCE_CLI=//p' .env | tail -n 1)
instance=${CODER_LXD_INSTANCE:-${saved_instance:-peakui-coder}}
instance_cli=${PEAKUI_INSTANCE_CLI:-${saved_cli:-lxc}}
destination=${1:-"$HOME/PeakUI-backups/$(date -u +%Y%m%dT%H%M%SZ)"}
[[ ! -e "$destination" ]] || { echo "Backup destination already exists: $destination" >&2; exit 1; }
mkdir -p -m 700 "$destination"
destination=$(realpath "$destination")

restore_services() {
  local restore_status=0
  if [[ "$("$instance_cli" list "$instance" -f csv -c s)" != RUNNING ]]; then
    "$instance_cli" start "$instance" || restore_status=1
  fi
  "$instance_cli" exec "$instance" -- systemctl start peakui-coder.service || restore_status=1
  docker compose -f docker-compose.yml -f docker-compose.lxd.yml up -d --no-deps app workspace-daemon rag-worker || restore_status=1
  return "$restore_status"
}
on_exit() {
  local backup_status=$?
  trap - EXIT
  restore_services || backup_status=1
  exit "$backup_status"
}
trap on_exit EXIT

docker compose -f docker-compose.yml -f docker-compose.lxd.yml stop app workspace-daemon rag-worker
"$instance_cli" exec "$instance" -- systemctl stop peakui-coder.service
"$instance_cli" stop "$instance"
cp -- .env "$destination/peakui.env"
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$destination/peakui.sql"
"$instance_cli" export "$instance" "$destination/coder-root.tar.gz"

trap - EXIT
restore_services
(cd "$destination" && sha256sum coder-root.tar.gz peakui.sql peakui.env > SHA256SUMS)
printf 'Coder backup complete: %s\n' "$destination"
