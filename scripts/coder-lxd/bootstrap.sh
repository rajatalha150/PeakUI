#!/usr/bin/env bash
# Runs inside the LXD instance. Safe to run again after a PeakUI update.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl git build-essential openjdk-17-jdk-headless python3 \
  python3-pip python3-venv procps jq ripgrep unzip zip openssh-client sqlite3 \
  fontconfig fontconfig-config fonts-dejavu-core fonts-liberation \
  libglib2.0-0 libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 \
  libatspi2.0-0t64 libdbus-1-3 libgbm1 libx11-6 libxcb1 libxcomposite1 \
  libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 libxi6 \
  libxrender1 libdrm2 libasound2t64 libpango-1.0-0 libcairo2 libcups2t64 \
  libfontconfig1 golang-go docker.io docker-compose-v2

NODE_VERSION=${PEAKUI_NODE_VERSION:-22.16.0}
case "$(uname -m)" in
  x86_64) node_arch=x64 ;;
  aarch64) node_arch=arm64 ;;
  *) echo 'Unsupported Node architecture' >&2; exit 1 ;;
esac
node_archive="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"
if ! command -v node >/dev/null || [[ "$(node --version)" != "v${NODE_VERSION}" ]]; then
  curl -fsSLo "/tmp/${node_archive}" "https://nodejs.org/dist/v${NODE_VERSION}/${node_archive}"
  curl -fsSLo /tmp/node-sha256sums "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
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
npm --prefix /opt/qwen-code ci
npm --prefix /opt/qwen-code run build
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
systemctl enable peakui-coder.service
