#!/bin/sh
# Keep an Incus bridge usable when Docker's global forwarding policy is DROP.
# Run as root; it is intentionally a no-op on hosts without Docker/iptables.
set -eu

bridge=${1:-incusbr0}
command -v iptables >/dev/null 2>&1 || exit 0
iptables -w -nL DOCKER-USER >/dev/null 2>&1 || exit 0

if ! iptables -w -C DOCKER-USER -i "$bridge" -j ACCEPT >/dev/null 2>&1; then
  iptables -w -I DOCKER-USER 1 -i "$bridge" -j ACCEPT
fi
if ! iptables -w -C DOCKER-USER -o "$bridge" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT >/dev/null 2>&1; then
  iptables -w -I DOCKER-USER 1 -o "$bridge" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
fi
