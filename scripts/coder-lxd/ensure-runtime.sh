#!/bin/sh
# Install and initialize the selected system-container runtime on Linux.
set -eu

runtime_cli=${PEAKUI_INSTANCE_CLI:-incus}
install_user=${SUDO_USER:-$(id -un)}

log() { printf '==> %s\n' "$*"; }
fail() { printf '==> %s\n' "$*" >&2; exit 1; }

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    command -v sudo >/dev/null 2>&1 || fail "sudo is required to install $runtime_cli."
    sudo "$@"
  fi
}

active_group() {
  id -nG | tr ' ' '\n' | grep -qx "$1"
}

group_exists() {
  if command -v getent >/dev/null 2>&1; then
    getent group "$1" >/dev/null 2>&1
  else
    grep -q "^$1:" /etc/group
  fi
}

refresh_apt_indexes() {
  if ! run_as_root apt-get update; then
    log 'WARNING: apt update reported a repository error; trying the signed package indexes that updated successfully.'
  fi
}

install_incus() {
  log 'Incus is required. sudo may ask for your account password.'
  if command -v apt-get >/dev/null 2>&1; then
    refresh_apt_indexes
    run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y incus
  elif command -v dnf >/dev/null 2>&1; then
    run_as_root dnf install -y incus
  elif command -v zypper >/dev/null 2>&1; then
    run_as_root zypper --non-interactive install incus
  elif command -v pacman >/dev/null 2>&1; then
    run_as_root pacman -S --needed --noconfirm incus
  elif command -v apk >/dev/null 2>&1; then
    run_as_root apk add incus incus-client
  elif command -v xbps-install >/dev/null 2>&1; then
    run_as_root xbps-install -Sy incus incus-client
  elif command -v emerge >/dev/null 2>&1; then
    run_as_root emerge --ask=n app-containers/incus
  else
    fail 'No supported Incus package manager was found. Install Incus or LXD, then rerun this installer.'
  fi
}

start_incus() {
  if command -v systemctl >/dev/null 2>&1; then
    run_as_root systemctl enable --now incus.socket >/dev/null 2>&1 || true
    run_as_root systemctl start incus.service >/dev/null 2>&1 || true
  elif command -v rc-service >/dev/null 2>&1; then
    run_as_root rc-update add incusd default >/dev/null 2>&1 || true
    run_as_root rc-service incusd start >/dev/null 2>&1 || true
  elif command -v dinitctl >/dev/null 2>&1; then
    run_as_root dinitctl enable incus >/dev/null 2>&1 || true
    run_as_root dinitctl start incus >/dev/null 2>&1 || true
  elif command -v sv >/dev/null 2>&1; then
    run_as_root sv up incus >/dev/null 2>&1 || true
    run_as_root sv up incus-user >/dev/null 2>&1 || true
  fi
}

ensure_group() {
  group_name=$1
  if ! group_exists "$group_name"; then
    if command -v groupadd >/dev/null 2>&1; then
      run_as_root groupadd --system "$group_name"
    elif command -v addgroup >/dev/null 2>&1; then
      run_as_root addgroup -S "$group_name"
    else
      fail "The $group_name group is missing and no group-management command is available."
    fi
    [ "$runtime_cli" != incus ] || start_incus
  fi
}

add_user_to_group() {
  user_name=$1
  group_name=$2
  if command -v usermod >/dev/null 2>&1; then
    run_as_root usermod -aG "$group_name" "$user_name"
  elif command -v adduser >/dev/null 2>&1; then
    run_as_root adduser "$user_name" "$group_name"
  elif command -v addgroup >/dev/null 2>&1; then
    run_as_root addgroup "$user_name" "$group_name"
  else
    fail "No supported command can add $user_name to $group_name."
  fi
}

install_lxd() {
  if ! command -v snap >/dev/null 2>&1; then
    command -v apt-get >/dev/null 2>&1 || fail 'Automatic LXD installation requires snap.'
    log 'Installing snapd for LXD. sudo may ask for your account password.'
    refresh_apt_indexes
    run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y snapd
  fi
  log 'Installing the LXD snap. sudo may ask for your account password.'
  run_as_root snap install lxd
}

case "$runtime_cli" in
  incus)
    command -v incus >/dev/null 2>&1 || install_incus
    runtime_group=incus-admin
    start_incus
    ;;
  lxc)
    command -v lxc >/dev/null 2>&1 || install_lxd
    runtime_group=lxd
    ;;
  *) fail 'PEAKUI_INSTANCE_CLI must be incus or lxc.' ;;
esac

ensure_group "$runtime_group"
if [ "$(id -u)" -ne 0 ] && ! id -nG "$install_user" | tr ' ' '\n' | grep -qx "$runtime_group"; then
  log "Granting existing user $install_user access through $runtime_group."
  add_user_to_group "$install_user" "$runtime_group"
fi

# The current shell does not inherit newly added groups. Exit 42 so the parent
# installer can re-enter itself through `sg` without requiring a logout.
if [ "$(id -u)" -ne 0 ] && ! active_group "$runtime_group"; then
  command -v sg >/dev/null 2>&1 || fail "Group $runtime_group was added, but 'sg' is unavailable. Log out and back in, then rerun the installer."
  exit 42
fi

if [ "$runtime_cli" = incus ]; then
  if ! incus info >/dev/null 2>&1; then
    fail 'Incus is installed but its daemon is unavailable. Check: sudo systemctl status incus'
  fi
  first_pool=$(incus storage list --format csv --columns n 2>/dev/null | sed -n '1p')
  if [ -z "$first_pool" ]; then
    log 'Initializing Incus with local-only defaults and host-backed directory storage.'
    incus admin init --minimal
  fi
  incus info >/dev/null
else
  if ! lxc info >/dev/null 2>&1; then
    fail 'LXD is installed but its daemon is unavailable. Check: sudo snap services lxd'
  fi
  first_pool=$(lxc storage list --format csv --columns n 2>/dev/null | sed -n '1p')
  if [ -z "$first_pool" ]; then
    log 'Initializing LXD with local-only defaults.'
    lxd init --minimal
  fi
  lxc info >/dev/null
fi

available_kb=$(df -Pk /var/lib 2>/dev/null | awk 'NR == 2 { print $4 }')
if [ -n "$available_kb" ] && [ "$available_kb" -lt 20971520 ]; then
  log 'WARNING: less than 20 GiB is free under /var/lib; large builds may exhaust storage.'
fi

log "$runtime_cli is installed, initialized, and available to $install_user."
