# Persistent Coder Server (LXD / Incus)

This is an opt-in Linux deployment for Coding. PeakUI, Postgres, search, and
other services remain in Docker. Coder runs in an unprivileged LXD or Incus
system container with a persistent root filesystem. The `/` visible to the
agent is the instance's root, never the host's root. Packages installed with
`apt`, systemd services, `/etc`, `/usr/local`, and Docker containers created
inside the instance survive restart. On first cutover, the installer copies the
existing Coder Docker volumes into their original guest paths, so projects,
SSH/Git state, Qwen state, Android SDK, and caches are retained. The old Docker
volumes remain untouched for rollback.

## Requirements

- Linux host with Docker Compose. Windows and macOS continue using Docker Coder.
- A supported package manager for automatic Incus installation: APT, DNF,
  Zypper, Pacman, APK, XBPS, or Portage. Existing Incus or LXD installations
  are detected and preserved. Distributions that do not package the Incus
  server must install Incus or LXD first.
- The installer can ask for the current account's `sudo` password. It uses
  elevated access only to install the host runtime and add that same account to
  its administration group; it does not create or switch login users.
- `python3`, `curl`, internet access for the Ubuntu image, Qwen source, Node,
  packages, and Chromium; free host loopback ports 4171 and 4172.

Access to the Incus/LXD administration socket is host-administrator equivalent.
The Coding agent does not receive that socket, so it can control its nested
Linux environment without controlling host instances.

## Install And Update

From this branch's checkout, this is the complete installation command:

```bash
PEAKUI_CODER_BACKEND=lxd ./scripts/install.sh
```

The installer performs the host setup too. When no runtime exists, it:

1. asks through `sudo` and installs Incus with the host package manager;
2. adds the current login account to `incus-admin`;
3. activates that membership for the installer without requiring a logout;
4. initializes Incus when needed; and
5. provisions, verifies, and cuts over the persistent Coder instance.

Re-running the same command updates all components. Incus is preferred for a
fresh installation. To use an existing LXD installation explicitly:

```bash
PEAKUI_CODER_BACKEND=lxd PEAKUI_INSTANCE_CLI=lxc ./scripts/install.sh
```

The backend and selected runtime are recorded in `.env`, so subsequent
`./scripts/install.sh` runs preserve them. The automatic first-time setup uses
Incus's local-only minimal configuration and directory-backed storage, which
uses available host filesystem capacity instead of creating a small fixed-size
loop pool. It is broadly compatible but slower and lacks the snapshot features
of Btrfs/ZFS. For a production host with a dedicated disk, initialize Incus
yourself with Btrfs or ZFS before running PeakUI; the installer will preserve it.
See the official [Incus installation](https://linuxcontainers.org/incus/docs/main/installing/)
and [initialization](https://linuxcontainers.org/incus/docs/main/howto/initialize/)
guides.

The instance defaults to four CPUs and 8 GiB of RAM; set `CODER_LXD_CPUS` and
`CODER_LXD_MEMORY` before its first creation to change them. `CODER_LXD_IMAGE`
selects a compatible Ubuntu image. `CODER_LXD_PORT` changes the host API port
from 4171; Preview uses 4172. `CODER_LXD_INSTANCE` changes the instance name
from `peakui-coder` and is saved for updates, backups, and rollback.

The installer creates an unprivileged Ubuntu 24.04 instance with nested Docker
support, installs Qwen and the current development/browser toolchain, migrates
the nine existing Coder volumes through portable tar streams, then starts a
systemd service. The migration does not depend on host bind-mount idmapping, so
it works across Incus-supported filesystems and distributions. It stops Docker
Coder only at cutover, checks a real Qwen runtime health response, and
reconnects PeakUI. If setup fails, it restores Docker Coder and the app's
original daemon URL. It never removes the Docker volumes.
On every instance boot, the service refreshes the managed QWEN.md, Git defaults,
SSH host trust, and runtime readiness checks.

When installing through a pipe, place the deployment variables on the `sh`
side so they reach the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/rajatalha150/PeakUI/coder-lxd/scripts/install.sh \
  | PEAKUI_REF=coder-lxd PEAKUI_CODER_BACKEND=lxd sh
```

Run this from an interactive terminal so `sudo` can request the password. The
password is read by `sudo`; PeakUI never reads or stores it.

If an unrelated third-party APT source fails signature validation, the
installer prints a warning and still attempts to install Incus from the signed
distribution indexes that updated successfully. It does not disable the broken
source or bypass APT signature checks. Repair that source separately so normal
system updates return to a clean state.

To return to Docker Coder deliberately:

```bash
PEAKUI_CODER_BACKEND=docker ./scripts/install.sh
```

## Directories And Sessions

The workspace router starts one Qwen runtime per selected **existing** absolute
directory. This permits `/workspace` and `/workspace/vision-proxy` concurrently,
even though a single Qwen daemon rejects nested workspace registrations. Each
runtime has its own persistent `QWEN_HOME`; `/workspace` keeps the existing
`/root/.qwen` data. New runtimes copy model settings and historical project
transcripts without copying debug caches. The session-to-directory map is
persisted under `/var/lib/peakui/coder-router`. Create a directory before
selecting it as a workspace. Existing sessions remain bound to their original
directory. The managed QWEN.md is refreshed when a runtime starts after an
update.

The instance root persists all directories, including `/workspace`, `/apps`,
tool caches, and SSH/Qwen state. The agent can install
packages, start systemd services, build projects, and use nested `docker` and
`docker compose`. PeakUI streams downloads from the authenticated Coder daemon
in bounded windows, so file and ZIP size is not capped or buffered wholly in
the app. GitHub imports use a private daemon endpoint and do not expose the
installation token in shell history or agent transcripts.

Preview URLs such as `http://127.0.0.1:5173` map to the loopback-only origin
`http://p5173.localhost:4172`. The proxy forwards HTTP paths and WebSocket
upgrades into the guest. Preview screenshots use the same mapped origin. As
with Docker Coder, a browser on another machine cannot use that machine's
`localhost` to reach the PeakUI host.

## Backups And Recovery

```bash
./scripts/coder-lxd/backup.sh /path/to/new/backup-directory
```

The script briefly stops the app and instance, dumps Postgres, exports the
complete persistent instance root, restarts services, and writes SHA-256
checksums. Store the resulting directory on another disk or machine. An
instance snapshot or export still omits Postgres session metadata.

Recovery requires restoring the exported instance and SQL dump as one set
during a maintenance window. Verify `SHA256SUMS`
and retain the original data until sessions, imports, downloads, Preview, and
nested Docker have been checked in the restored deployment.

## Verification

```bash
node --test scripts/coder-lxd/workspace-router.node-test.mjs
npx vitest run src/lib/coder-preview.test.ts src/app/api/coder/preview/route.test.ts src/app/api/coder/'[...path]'/route.test.ts
docker compose -f docker-compose.yml -f docker-compose.lxd.yml config --services
```

After host installation, verify `incus exec peakui-coder -- systemctl status
peakui-coder docker`, `incus exec peakui-coder -- docker info`, an existing
session reopen, a new nested-directory session, GitHub import, a large ZIP
download, and a dev server in Preview with screenshot capture. Use `lxc` in
place of `incus` when deployed with LXD.

This backend currently has one shared Coder instance per PeakUI installation,
as the Docker backend does. It is intended for a trusted single-user/admin
deployment. Separate instances per PeakUI user are needed before providing
independent Linux roots to untrusted users.
