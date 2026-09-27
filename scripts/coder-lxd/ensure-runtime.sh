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

apt_os_codename() {
  # Linux Mint and several Ubuntu derivatives keep their own VERSION_CODENAME
  # but publish the compatible Ubuntu suite separately.
  [ -r /etc/os-release ] || return 1
  # shellcheck disable=SC1091
  . /etc/os-release
  codename=${UBUNTU_CODENAME:-${DEBIAN_CODENAME:-${VERSION_CODENAME:-}}}
  case "$codename" in
    jammy|noble|plucky|questing|bookworm|trixie) printf '%s\n' "$codename" ;;
    *) return 1 ;;
  esac
}

install_supported_incus() {
  # Older LTS point releases can start Docker in an unprivileged guest but
  # fail every OCI launch due to an AppArmor/runc incompatibility. Zabbly
  # publishes maintained Incus builds for supported Debian/Ubuntu suites. The
  # AppArmor fix required by current runc landed after the 6.0 LTS series, so
  # Coder defaults to stable rather than a known-insufficient 6.0 release.
  channel=${PEAKUI_INCUS_CHANNEL:-stable}
  if [ "$channel" = distribution ]; then
    command -v incus >/dev/null 2>&1 || install_incus
    return
  fi
  case "$channel" in lts-6.0|lts-7.0|stable) ;; *) fail 'PEAKUI_INCUS_CHANNEL must be distribution, lts-6.0, lts-7.0, or stable.' ;; esac

  command -v apt-get >/dev/null 2>&1 || { install_incus; return; }
  suite=$(apt_os_codename 2>/dev/null || true)
  command -v dpkg >/dev/null 2>&1 || { install_incus; return; }
  [ -n "$suite" ] || { install_incus; return; }

  log "Installing maintained Incus $channel packages for nested Docker support. sudo may ask for your account password."
  refresh_apt_indexes
  run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg
  key_file=$(mktemp)
  source_file=$(mktemp)
  trap 'rm -f "$key_file" "$source_file"' EXIT HUP INT TERM
  curl -fsSL https://pkgs.zabbly.com/key.asc -o "$key_file"
  fingerprint=$(gpg --show-keys --with-colons "$key_file" 2>/dev/null | awk -F: '$1 == "fpr" { print $10; exit }')
  [ "$fingerprint" = 4EFC590696CB15B87C73A3AD82CC8797C838DCFD ] || fail 'The Incus package-signing key fingerprint did not match the published Zabbly key.'
  arch=$(dpkg --print-architecture)
  printf 'Enabled: yes\nTypes: deb\nURIs: https://pkgs.zabbly.com/incus/%s\nSuites: %s\nComponents: main\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/zabbly.asc\n' \
    "$channel" "$suite" "$arch" > "$source_file"
  run_as_root install -d -m 755 /etc/apt/keyrings /etc/apt/sources.list.d
  run_as_root install -m 644 "$key_file" /etc/apt/keyrings/zabbly.asc
  run_as_root install -m 644 "$source_file" /etc/apt/sources.list.d/zabbly-incus.sources
  refresh_apt_indexes
  run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y incus incus-client
  rm -f "$key_file" "$source_file"
  trap - EXIT HUP INT TERM
}

cleanup_orphaned_incus_proxies() {
  # Ubuntu's older Incus package can leave forkproxy children reparented to
  # PID 1 during a transition to the maintained package. They retain Coder's
  # loopback ports and prevent the refreshed guest from starting. A healthy
  # Incus daemon owns its proxies, so only reap the unmistakably orphaned
  # legacy children; never kill a currently managed proxy.
  command -v ps >/dev/null 2>&1 || return
  stale_pids=$(ps -eo pid=,ppid=,args= | awk '$2 == 1 && $0 ~ /\/usr\/libexec\/incus\/incusd forkproxy --/ { print $1 }')
  [ -n "$stale_pids" ] || return
  log 'Removing orphaned legacy Incus proxy listeners after the runtime upgrade.'
  run_as_root kill $stale_pids || true
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
  # Package installs commonly activate a socket unit. Avoid asking for sudo on
  # every update merely to start an already reachable daemon; group activation
  # happens below before the client is used.
  if [ -S /var/lib/incus/unix.socket ] || [ -S /run/incus/unix.socket ]; then
    return
  fi
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

configure_instance_network() {
  # Incus creates incusbr0 during `admin init --minimal`. UFW and Docker both
  # commonly default to dropping forwarded traffic, which leaves a guest able
  # to reach its gateway but unable to download its toolchain. Configure only
  # the managed bridge and keep this independent of the host distribution.
  case "$runtime_cli" in
    incus) default_bridge=incusbr0 ;;
    lxc) default_bridge=lxdbr0 ;;
  esac
  bridge=${PEAKUI_INSTANCE_BRIDGE:-$default_bridge}
  "$runtime_cli" network show "$bridge" >/dev/null 2>&1 || return

  log "Configuring host forwarding for the $bridge Incus bridge."

  if command -v ufw >/dev/null 2>&1 && run_as_root ufw status 2>/dev/null | grep -q '^Status: active'; then
    # These persistent rules permit the trusted local Coder instance to use
    # DHCP/DNS and reach the network through the host. They don't open an
    # external port on the host.
    run_as_root ufw allow in on "$bridge" >/dev/null
    run_as_root ufw route allow in on "$bridge" >/dev/null
    run_as_root ufw route allow out on "$bridge" >/dev/null
  fi

  if command -v firewall-cmd >/dev/null 2>&1 && run_as_root firewall-cmd --state >/dev/null 2>&1; then
    # The bridge is local-only and is the boundary owned by Incus. Firewalld's
    # trusted zone is the portable, persistent equivalent of forwarding it.
    run_as_root firewall-cmd --permanent --zone=trusted --add-interface="$bridge" >/dev/null
    run_as_root firewall-cmd --reload >/dev/null
  fi

  # Docker may set a global FORWARD drop. Put the Incus bridge in DOCKER-USER
  # before Docker's own policy and install a boot hook where the host init
  # system supports it. The helper is harmless when Docker/iptables is absent.
  script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
  run_as_root install -m 755 "$script_dir/host-network.sh" /usr/local/sbin/peakui-incus-network
  run_as_root sh -c "printf '%s\\n' 'PEAKUI_INSTANCE_BRIDGE=$bridge' > /etc/peakui-instance-network.conf"
  run_as_root /usr/local/sbin/peakui-incus-network "$bridge" || true

  if command -v systemctl >/dev/null 2>&1; then
    run_as_root install -m 644 "$script_dir/peakui-incus-network.service" /etc/systemd/system/peakui-incus-network.service
    run_as_root systemctl daemon-reload
    run_as_root systemctl enable --now peakui-incus-network.service >/dev/null
  elif command -v rc-service >/dev/null 2>&1 && command -v rc-update >/dev/null 2>&1; then
    run_as_root install -m 755 "$script_dir/peakui-incus-network.openrc" /etc/init.d/peakui-incus-network
    run_as_root rc-update add peakui-incus-network default >/dev/null 2>&1 || true
    run_as_root rc-service peakui-incus-network restart >/dev/null 2>&1 || true
  fi
}

case "$runtime_cli" in
  incus)
    # A maintained build includes the AppArmor/runc fixes necessary for Docker
    # to create OCI containers inside the unprivileged Coder guest.
    install_supported_incus
    cleanup_orphaned_incus_proxies
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
  first_pool=$(incus storage list --format csv -c n 2>/dev/null | sed -n '1p')
  if [ -z "$first_pool" ]; then
    log 'Initializing Incus with local-only defaults and host-backed directory storage.'
    incus admin init --minimal
  fi
  incus info >/dev/null
  configure_instance_network
else
  if ! lxc info >/dev/null 2>&1; then
    fail 'LXD is installed but its daemon is unavailable. Check: sudo snap services lxd'
  fi
  first_pool=$(lxc storage list --format csv -c n 2>/dev/null | sed -n '1p')
  if [ -z "$first_pool" ]; then
    log 'Initializing LXD with local-only defaults.'
    lxd init --minimal
  fi
  lxc info >/dev/null
  configure_instance_network
fi

available_kb=$(df -Pk /var/lib 2>/dev/null | awk 'NR == 2 { print $4 }')
if [ -n "$available_kb" ] && [ "$available_kb" -lt 20971520 ]; then
  log 'WARNING: less than 20 GiB is free under /var/lib; large builds may exhaust storage.'
fi

log "$runtime_cli is installed, initialized, and available to $install_user."
