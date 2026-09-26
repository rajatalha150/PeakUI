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

install_incus() {
  command -v apt-get >/dev/null 2>&1 || fail 'Automatic Incus installation currently requires an apt-based Linux host.'
  log 'Incus is required. sudo may ask for your account password.'
  run_as_root apt-get update
  run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y incus
}

install_lxd() {
  if ! command -v snap >/dev/null 2>&1; then
    command -v apt-get >/dev/null 2>&1 || fail 'Automatic LXD installation requires snap.'
    log 'Installing snapd for LXD. sudo may ask for your account password.'
    run_as_root apt-get update
    run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y snapd
  fi
  log 'Installing the LXD snap. sudo may ask for your account password.'
  run_as_root snap install lxd
}

case "$runtime_cli" in
  incus)
    command -v incus >/dev/null 2>&1 || install_incus
    runtime_group=incus-admin
    ;;
  lxc)
    command -v lxc >/dev/null 2>&1 || install_lxd
    runtime_group=lxd
    ;;
  *) fail 'PEAKUI_INSTANCE_CLI must be incus or lxc.' ;;
esac

if [ "$(id -u)" -ne 0 ] && ! id -nG "$install_user" | tr ' ' '\n' | grep -qx "$runtime_group"; then
  log "Granting existing user $install_user access through $runtime_group."
  run_as_root usermod -aG "$runtime_group" "$install_user"
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
