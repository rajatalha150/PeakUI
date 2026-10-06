# Persistent Coder Server (LXD / Incus)

This is an opt-in Linux deployment for Coding. PeakUI, Postgres, search, and
other services remain in Docker. Coder runs in an unprivileged LXD or Incus
system container with a persistent root filesystem. The `/` visible to the
agent is the instance's root, never the host's root. Packages installed with
`apt`, systemd services, `/etc`, `/usr/local`, and Docker containers created
inside the instance survive restart. On first cutover, the installer copies the
existing Coder Docker volumes into their original guest paths, so projects,
SSH/Git state, Coder state, Android SDK, and caches are retained. The old Docker
volumes remain untouched for rollback.

## Why A System Container

The standard Docker Coder backend is excellent for a lightweight, reproducible
coding daemon. The Incus/LXD backend is for work that benefits from a durable
Linux server. It gives Coder an unprivileged system container with its own
persistent `/`, package database, service manager, process tree, network
namespace, and nested Docker capability. The agent can install build tools,
start long-lived services, run native or Android builds, use any selected
absolute directory in the guest root, and return to the same environment after
an app update or host restart.

This does not grant Coder the host root filesystem or the Incus administration
socket. PeakUI remains in Docker; only the Coding runtime moves into the guest.
That separation gives Coder more room to behave like a complete development
machine while keeping host control in the hands of the installation owner.

| Need | Docker Coder | Incus/LXD Coder |
|---|---|---|
| Fast, disposable coding daemon | Strong choice | Supported, but more infrastructure |
| Durable packages, services, and build tools | Requires custom image/volume work | Native system-container behavior |
| Long native, Android, or multi-service projects | Rebuild and cache constraints can get in the way | Persistent toolchains, caches, services, and nested Docker |
| Workspace directories | Mounted project paths | Any validated absolute path in the isolated guest root |
| Host protection | Container boundary | Unprivileged guest; no host root or Incus socket is exposed to Coder |

## Requirements

- Linux host with Docker Compose. Windows and macOS continue using Docker Coder.
- A supported package manager for automatic Incus installation: APT, DNF,
  Zypper, Pacman, APK, XBPS, or Portage. Existing instances and storage are
  preserved. Distributions that do not package the Incus server must install
  Incus or LXD first.
- The installer can ask for the current account's `sudo` password. It uses
  elevated access only to install the host runtime and add that same account to
  its administration group; it does not create or switch login users.
- `python3`, `curl`, internet access for the Ubuntu image, Coder source, Node,
  packages, Chromium, and Google's Android SDK downloads; free host loopback
  ports 4171 and 4172. Allow at least 12 GiB free on the guest SDK filesystem
  during Android provisioning; 25 GiB or more free is recommended for native
  Android builds and Gradle caches.

On supported Debian/Ubuntu releases and Ubuntu derivatives such as Linux Mint,
the installer configures the maintained Incus `stable` package channel. The
AppArmor/runc fix required by modern nested Docker landed after the 6.0 LTS
series, so `lts-6.0` is not a suitable default. The package signing key is
fingerprint-checked before the source is added. Set
`PEAKUI_INCUS_CHANNEL=distribution` only when the host distribution already
ships a current, tested Incus build; `lts-7.0` is suitable where it contains
the required fix, while `stable` remains the default for Coder.
Once that verified channel's current package is installed, ordinary PeakUI
redeployments do not ask for `sudo` or refresh host packages again. Set
`PEAKUI_INCUS_REFRESH=1` when intentionally checking the selected channel for
a newer Incus release.

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
5. configures forwarding for its local Incus bridge when UFW, firewalld, or
   Docker's forwarding policy is active; and
6. provisions, verifies, and cuts over the persistent Coder instance.

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

The instance defaults to four CPUs and 12 GiB of RAM. Set `CODER_LXD_CPUS`
before its first creation to change its CPU count. Set `CODER_LXD_MEMORY` to
choose a different memory limit, including on an existing guest. On update,
the installer raises guests still using its former 8 GiB default to 12 GiB;
other custom limits are preserved. `CODER_LXD_IMAGE`
selects a compatible Ubuntu image. `CODER_LXD_PORT` changes the host API port
from 4171. `CODER_LXD_INSTANCE` changes the instance name
from `peakui-coder` and is saved for updates, backups, and rollback.

The installer creates an unprivileged Ubuntu 24.04 instance with nested Docker
support, installs Coder and the current development/browser toolchain, migrates
the nine existing Coder volumes through portable tar streams, then starts a
systemd service. The migration does not depend on host bind-mount idmapping, so
it works across Incus-supported filesystems and distributions. It stops Docker
Coder only at cutover, checks a real Coder runtime health response, and
reconnects PeakUI. If setup fails, it restores Docker Coder and the app's
original daemon URL. It never removes the Docker volumes.
After a successful cutover the temporary Docker Coder container is stopped;
its volumes remain available for rollback and are not deleted.
Provisioning assets are streamed through guest-root processes rather than the
Incus file-push metadata API, which avoids a known permission-reporting quirk
on some unprivileged Incus 6.0 hosts and supports large browser/tooling trees.
It refreshes the guest after an Incus runtime upgrade, then runs `docker run --rm hello-world` inside the guest before cutover.
This is a real OCI-runtime check, not a shallow `docker info` check. A failed
probe keeps Docker Coder active, so a deployment cannot report a fully capable
persistent environment when nested Docker is actually blocked.
When upgrading from Ubuntu's older Incus package, the installer also removes
only orphaned legacy loopback proxy children that can otherwise retain Coder's
ports during the package handoff; managed Incus proxy processes are untouched.
The bootstrap also verifies the standard sticky permissions on `/tmp` before
using APT, allowing a failed earlier attempt to recover cleanly.
It installs the everyday system tools expected of a real development machine,
including `rsync`, DNS diagnostics, `netcat`, `lsof`, and Docker Buildx. Docker
Coder and the Incus guest also include JDK 17, Node/Corepack, Go, Python,
Git LFS, CMake, Ninja, Clang, LLD, `pkg-config`, `file`, `patch`, and `xz`.
The Android SDK baseline is installed and verified as described below. Docker
is configured with stable upstream resolvers when its daemon configuration does
not already define `dns`; this prevents an intermittent Incus bridge DNS lookup
from making registry pulls or builds fail. Existing administrator-managed Docker
resolver settings are preserved. Set `PEAKUI_DOCKER_DNS` to a comma-separated
IP list before provisioning when a private network requires different
resolvers.
After a successful toolchain build, it records the pinned Coder version so an
interrupted cutover can resume without rebuilding the same source tree.
Managed staging files are replaced explicitly on retry, including files first
created by a cloud image's non-root default user under the sticky `/tmp` path.
The persistent service explicitly sets `HOME=/root` so Git, SSH, Coder, and
their state directories behave the same under systemd as they do in an
interactive Coder shell. Its bounded stop timeout prevents a Coder child process
that ignores `SIGTERM` from making an update appear stuck; active jobs should
be allowed to finish before deliberately redeploying Coder.
On every instance boot, the service refreshes the managed CODER.md, Git defaults,
SSH host trust, and runtime readiness checks.

## Android Build Toolchain

On Linux x86_64, fresh installations provision Android command-line tools,
platform tools (`adb`), Android APIs 35 and 36, matching build tools, NDK
27.3.13750724, CMake 3.22.1, and JDK 17. The command-line tools download is
checksum-verified and the SDK licenses are accepted non-interactively during
provisioning. The SDK lives at `/opt/android-sdk`; Gradle and Android user
state also persist across guest restarts and PeakUI updates. Docker Coder uses
the same baseline in its image and repairs older SDK volumes at startup. An
LXD cutover checks the SDK *after* migrating any old Docker volume, so an empty
volume cannot masquerade as an installed toolchain.

```bash
# Inside the Coder guest (or use `incus exec peakui-coder --` before each command):
peakui-install-android --check
peakui-coder-readiness --strict
java -version
adb version
sdkmanager --list_installed
```

`peakui-install-android` is idempotent: run it to repair missing baseline
packages. For a project's different API/NDK requirement, use
`sdkmanager --install 'platforms;android-<API>' 'ndk;<VERSION>'` inside Coder.
The default does **not** install an Android emulator or provide hardware
acceleration; instrumented/device tests need an attached device, emulator
configuration with host virtualization support, or external CI. Google's pinned
Linux Android toolchain here supports x86_64; on other guest architectures,
provisioning warns and strict readiness fails instead of claiming Android
build readiness. See Google's [SDK manager guide](https://developer.android.com/tools/sdkmanager).

When installing through a pipe, place the deployment variables on the `sh`
side so they reach the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/rajatalha150/PeakUI/coder-lxd/scripts/install.sh \
  | PEAKUI_CODER_BACKEND=lxd sh
```

The persistent-Coder flag selects the `coder-lxd` branch automatically on a
fresh installation. Set `PEAKUI_REF` only when intentionally deploying a
different branch.

Run this from an interactive terminal so `sudo` can request the password. The
password is read by `sudo`; PeakUI never reads or stores it.

If an unrelated third-party APT source fails signature validation, the
installer prints a warning and still attempts to install Incus from the signed
distribution indexes that updated successfully. It does not disable the broken
source or bypass APT signature checks. Repair that source separately so normal
system updates return to a clean state.

### Host Networking

The installer configures the local `incusbr0` (or `lxdbr0` for LXD) bridge so a
Coder guest can reach package registries without exposing an Internet-facing
PeakUI port. On UFW it
adds persistent bridge input and forwarding rules; on firewalld it places the
local bridge in the trusted zone; and when Docker's `DOCKER-USER` chain exists,
it adds bridge forwarding rules plus a systemd or OpenRC boot hook. This handles
the common "guest reaches its gateway but cannot reach the Internet" condition
on Debian/Ubuntu/Mint, Fedora/RHEL-family, openSUSE, Arch, Alpine, Void, and
Gentoo hosts. The guest prefers IPv4 during bootstrap for home networks with
advertised but unusable IPv6.

The instance is a trusted local development environment. Its bridge rules let
the guest contact the host and the Internet. Do not run untrusted workloads in
the shared Coder instance; create a separate restricted Incus profile instead.

When diagnosing a registry issue, distinguish the guest resolver from Docker's
daemon resolver. Check both instead of retrying an image pull blindly:

```bash
sg incus-admin -c 'incus exec peakui-coder -- resolvectl status eth0'
sg incus-admin -c 'incus exec peakui-coder -- cat /etc/docker/daemon.json'
sg incus-admin -c 'incus exec peakui-coder -- docker pull hello-world'
```

If a pull reaches a registry and returns `401`, `404`, or an image-specific
manifest error, DNS is working; update that project's image reference or its
registry authentication instead. Do not replace `/etc/resolv.conf` or weaken
the Incus security profile as a response.

To return to Docker Coder deliberately:

```bash
PEAKUI_CODER_BACKEND=docker ./scripts/install.sh
```

## Directories And Sessions

The workspace router starts one Coder runtime per selected absolute directory.
This permits `/workspace` and `/workspace/vision-proxy` concurrently, even
though a single Coder daemon rejects nested workspace registrations. Each runtime
has its own persistent `QWEN_HOME`; `/workspace` keeps the existing
`/root/.qwen` data. New runtimes copy model settings and historical project
transcripts without copying debug caches. The session-to-directory map is
persisted under `/var/lib/peakui/coder-router`. A valid missing absolute
directory such as `/workspace/data` is created in the persistent guest root
when selected. Existing sessions remain bound to their original directory. The
managed CODER.md is refreshed when a runtime starts after an update.

The instance root persists all directories, including `/workspace`, `/apps`,
tool caches, and SSH/Coder state. The agent can install
packages, start systemd services, build projects, and use nested `docker` and
`docker compose`. PeakUI streams downloads from the authenticated Coder daemon
in bounded windows, so file and ZIP size is not capped or buffered wholly in
the app. GitHub imports use a private daemon endpoint and do not expose the
installation token in shell history or agent transcripts.

The Coder Preview popup controls Chromium in this same persistent guest.
`http://127.0.0.1:5173`, port 80, and any other guest-local address resolve
there, without publishing the application's port on the host. The guest and
host can run unrelated services on the same port. Public and private HTTP(S)
sites are also reachable when the guest network allows them. Pages keep their
normal root paths, cookies, CSP, redirects, assets and WebSockets because
Chromium navigates to the original URL directly, including sites that forbid
iframe embedding.

The authenticated `POST /api/coder/browser` endpoint checks coding-session
ownership and forwards browser actions over the private Coder API. The popup
shows frames from that browser; **Log** and **Vision** inspect its current page.
Browser profiles live in `/var/lib/peakui/browser` inside the guest and survive
restarts. No public port 4173 or extra Preview hostname is needed for this
popup. The older signed proxy routes are retained for compatibility only.
See [Coder Browser](coder-browser.md) for controls, verification and limits.

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
