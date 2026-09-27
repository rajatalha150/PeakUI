#!/usr/bin/env bash
# Runs inside the LXD instance. Safe to run again after a PeakUI update.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
# Cloud images require a world-writable sticky /tmp. Repair it defensively in
# case a prior interrupted provisioner staged files there with a restrictive
# parent directory mode.
chmod 1777 /tmp
# Some desktop networks advertise IPv6 but do not route it. Prefer a working
# IPv4 path so apt, curl, and the initial image toolchain bootstrap don't wait
# on repeated IPv6 connection timeouts.
printf 'Acquire::ForceIPv4 "true";\n' > /etc/apt/apt.conf.d/99peakui-force-ipv4
if ! grep -q '^precedence ::ffff:0:0/96  100$' /etc/gai.conf 2>/dev/null; then
  printf '\n# Prefer IPv4 when an upstream IPv6 route is unavailable.\nprecedence ::ffff:0:0/96  100\n' >> /etc/gai.conf
fi
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl git build-essential openjdk-17-jdk-headless python3 \
  python3-pip python3-venv procps jq ripgrep unzip zip openssh-client sqlite3 \
  rsync dnsutils netcat-openbsd lsof docker-buildx \
  fontconfig fontconfig-config fonts-dejavu-core fonts-liberation \
  libglib2.0-0 libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 \
  libatspi2.0-0t64 libdbus-1-3 libgbm1 libx11-6 libxcb1 libxcomposite1 \
  libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 libxi6 \
  libxrender1 libdrm2 libasound2t64 libpango-1.0-0 libcairo2 libcups2t64 \
  libfontconfig1 golang-go docker.io docker-compose-v2

# Docker resolves image registries through the daemon, independently of the
# guest's systemd-resolved stub. Incus bridge DNS is normally reliable, but a
# transient timeout here otherwise makes pulls and builds fail for no project
# related reason. Preserve an administrator-supplied daemon DNS list; when it
# is absent, add dependable public resolvers. Set PEAKUI_DOCKER_DNS to a
# comma-separated list before provisioning to choose different resolvers.
docker_dns_csv=${PEAKUI_DOCKER_DNS:-1.1.1.1,8.8.8.8}
docker_dns_json=$(printf '%s' "$docker_dns_csv" | jq -Rsc '
  split(",")
  | map(gsub("^\\s+|\\s+$"; "") | select(length > 0))
')
if ! jq -e 'length > 0 and all(.[]; type == "string" and test("^[0-9A-Fa-f:.]+$"))' \
  <<<"$docker_dns_json" >/dev/null; then
  echo 'PEAKUI_DOCKER_DNS must be a comma-separated list of IP addresses.' >&2
  exit 1
fi

mkdir -p /etc/docker
docker_daemon_config=/etc/docker/daemon.json
docker_daemon_tmp=$(mktemp)
if [[ -s "$docker_daemon_config" ]]; then
  if ! jq --argjson dns "$docker_dns_json" '
    if ((.dns | type) == "array" and (.dns | length) > 0)
    then .
    else . + { dns: $dns }
    end
  ' "$docker_daemon_config" > "$docker_daemon_tmp"; then
    echo 'Existing /etc/docker/daemon.json is invalid JSON; refusing to overwrite it.' >&2
    rm -f "$docker_daemon_tmp"
    exit 1
  fi
else
  jq -n --argjson dns "$docker_dns_json" '{ dns: $dns }' > "$docker_daemon_tmp"
fi
if ! cmp -s "$docker_daemon_tmp" "$docker_daemon_config" 2>/dev/null; then
  install -m 644 "$docker_daemon_tmp" "$docker_daemon_config"
  docker_dns_changed=1
else
  docker_dns_changed=0
fi
rm -f "$docker_daemon_tmp"

NODE_VERSION=${PEAKUI_NODE_VERSION:-22.22.2}
case "$(uname -m)" in
  x86_64) node_arch=x64 ;;
  aarch64) node_arch=arm64 ;;
  *) echo 'Unsupported Node architecture' >&2; exit 1 ;;
esac
node_archive="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"
if ! command -v node >/dev/null || [[ "$(node --version)" != "v${NODE_VERSION}" ]]; then
  curl -4 -fsSLo "/tmp/${node_archive}" "https://nodejs.org/dist/v${NODE_VERSION}/${node_archive}"
  curl -4 -fsSLo /tmp/node-sha256sums "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
  (cd /tmp && grep "  ${node_archive}$" node-sha256sums | sha256sum -c -)
  tar -xJf "/tmp/${node_archive}" -C /usr/local --strip-components=1
fi

mkdir -p /opt /workspace /apps /root/.qwen /root/.ssh \
  /root/.gradle /root/.android /root/.npm /root/.cache/pip /opt/android-sdk
qwen_version=$(sed -n 's/^PEAKUI_QWEN_VERSION=//p' /etc/peakui-coder.env | tail -n 1)
[[ "$qwen_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid pinned Qwen version.' >&2; exit 1; }
if [[ ! -d /opt/qwen-code/.git ]]; then
  git clone --depth 1 --branch "v${qwen_version}" https://github.com/QwenLM/qwen-code.git /opt/qwen-code
else
  git -C /opt/qwen-code fetch --depth 1 origin "v${qwen_version}"
  git -C /opt/qwen-code checkout --detach FETCH_HEAD
fi
runtime_stamp=/opt/qwen-code/.peakui-runtime-version
if [[ ! -f "$runtime_stamp" || "$(cat "$runtime_stamp")" != "$qwen_version" || ! -f /opt/qwen-code/packages/cli/dist/index.js ]]; then
  npm --prefix /opt/qwen-code ci
  # Qwen's prepare lifecycle normally builds the monorepo during npm ci. Keep
  # an explicit fallback for package-manager versions that skip that hook.
  if [[ ! -f /opt/qwen-code/packages/cli/dist/index.js ]]; then
    npm --prefix /opt/qwen-code run build
  fi
  printf '%s\n' "$qwen_version" > "$runtime_stamp"
fi
cp /tmp/peakui-sync-coder-models.mjs /opt/qwen-code/sync-coder-models.mjs
cp /tmp/peakui-workspace-QWEN.md /opt/qwen-code/workspace-qwen.md
mkdir -p /opt/qwen-code/browser
cp -a /tmp/peakui-browser/. /opt/qwen-code/browser/
export PUPPETEER_CACHE_DIR=/opt/puppeteer-cache
npm --prefix /opt/qwen-code/browser install --no-audit --no-fund
(cd /opt/qwen-code/browser && npx puppeteer browsers install chrome-headless-shell && npx puppeteer browsers install chrome)

chmod 755 /usr/local/bin/peakui-coder-start /usr/local/bin/peakui-coder-prepare /usr/local/bin/peakui-coder-readiness /usr/local/bin/peakui-cleanup
chmod 600 /etc/peakui-coder.env
java_home=$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")
sed -i '/^JAVA_HOME=/d' /etc/peakui-coder.env
printf 'JAVA_HOME=%s\n' "$java_home" >> /etc/peakui-coder.env
systemctl daemon-reload
systemctl enable --now docker.service
if [[ "$docker_dns_changed" == 1 ]]; then
  systemctl restart docker.service
fi
systemctl enable peakui-coder.service
