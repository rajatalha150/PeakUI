#!/usr/bin/env bash
# Consistent Coder backup: persistent instance root and PeakUI database.
set -euo pipefail
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
  if [[ "$("$instance_cli" list "$instance" -f csv -c s)" != RUNNING ]]; then "$instance_cli" start "$instance"; fi
  "$instance_cli" exec "$instance" -- systemctl start peakui-coder.service || true
  docker compose -f docker-compose.yml -f docker-compose.lxd.yml up -d --no-deps app || true
}
trap restore_services EXIT

docker compose -f docker-compose.yml -f docker-compose.lxd.yml stop app
"$instance_cli" exec "$instance" -- systemctl stop peakui-coder.service
"$instance_cli" stop "$instance"
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$destination/peakui.sql"
"$instance_cli" export "$instance" "$destination/coder-root.tar.gz"

restore_services
trap - EXIT
(cd "$destination" && sha256sum ./*.tar.gz peakui.sql > SHA256SUMS)
printf 'Coder backup complete: %s\n' "$destination"
