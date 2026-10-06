# PeakUI Operations And Update Guide

This runbook is the canonical maintenance guide for a deployed PeakUI system.
Keep the checkout on its intended branch, use the installer as the normal
update path, and back up persistent data before changes that affect the host,
database, or Incus runtime.

Fresh installs use `main`. Existing Linux/macOS checkouts retain their
selected branch; to move a deployment from the older `trimmer` or `coder-lxd`
branch to the public release, back up first and run the installer once with
`PEAKUI_REF=main` (and `PEAKUI_CODER_BACKEND=lxd` if using the persistent guest).
This changes the application checkout, not the guest filesystem or database.

## What Updates What

| Component | Supported update path | Persistent data |
|---|---|---|
| PeakUI app, API, UI, Prisma client, Docker Coder | `./scripts/install.sh` | Postgres and named Docker volumes |
| Persistent Linux Coder | `PEAKUI_CODER_BACKEND=lxd ./scripts/install.sh` | Incus guest root, Coder state, projects, caches, services |
| PeakUI dependencies | A committed `package-lock.json` plus the installer image rebuild | Never run a broad `npm update` on a deployed checkout |
| Docker images | Installer rebuilds PeakUI images; use Compose pulls only for externally maintained services | Docker volumes are retained |
| Incus and guest OS tools | Persistent-Coder installer for Incus; guest packages are managed inside the guest | Incus storage pool and guest root |
| Host OS, Docker Engine, kernel, GPU driver | Host distribution's package manager and reboot policy | Host-owned; outside PeakUI's Compose lifecycle |

## Regular PeakUI Update

Run this from the existing checkout. It fetches the branch currently checked
out, rebuilds the application, applies schema startup work, and keeps `.env`
values intact.

```bash
cd /path/to/PeakUI
./scripts/install.sh
```

For the persistent Incus Coder backend:

```bash
cd /path/to/PeakUI
PEAKUI_CODER_BACKEND=lxd ./scripts/install.sh
```

Do not run `git pull`, `npm update`, or `docker compose down -v` as a substitute
for this workflow. The installer intentionally retains the Postgres and Coder
volumes, while `down -v` removes them.

After the command completes, verify the stack:

```bash
docker compose ps
curl -fsS http://127.0.0.1:3000/ >/dev/null && echo 'PeakUI is healthy'
```

For persistent Coder, also verify the complete guest rather than only its
daemon:

```bash
sg incus-admin -c 'incus list peakui-coder'
sg incus-admin -c 'incus exec peakui-coder -- systemctl is-active peakui-coder docker'
sg incus-admin -c 'incus exec peakui-coder -- docker run --rm hello-world'
```

`hello-world` is deliberate: it proves the nested OCI runtime works, not just
that the Docker daemon can start.

Also confirm that the guest can build and pull through Docker's resolver:

```bash
sg incus-admin -c 'incus exec peakui-coder -- cat /etc/docker/daemon.json'
sg incus-admin -c 'incus exec peakui-coder -- docker pull hello-world'
sg incus-admin -c 'incus exec peakui-coder -- docker buildx version'
```

PeakUI supplies `1.1.1.1` and `8.8.8.8` as Docker daemon resolvers only when
`/etc/docker/daemon.json` has no existing `dns` setting. This protects image
pulls from transient bridge-DNS failures while respecting a managed private DNS
configuration. Set `PEAKUI_DOCKER_DNS` before a persistent-Coder installation
to use organization-specific resolver IPs.

## Back Up Before Risky Changes

Use the application backup controls for normal database/content recovery. For
the persistent Coder backend, also export the complete guest and database as
one consistent set:

```bash
cd /path/to/PeakUI
./scripts/coder-lxd/backup.sh /path/on/another-disk/peakui-backups
```

Keep backup directories off the disk that hosts PeakUI. Check the generated
`SHA256SUMS` before deleting older backups. Test restoration on a separate host
or maintenance instance before relying on a new backup strategy.

## Host Updates

PeakUI does not update the host operating system automatically. Schedule host
updates separately, preferably after a backup and during a quiet period:

```bash
sudo apt update
sudo apt upgrade
sudo reboot
```

Use the equivalent supported package-manager commands on non-APT systems. A
kernel, Docker Engine, GPU driver, or Incus upgrade can require a reboot even
when PeakUI itself is healthy.

After the host returns, use the verification commands above and run the normal
PeakUI installer once. This refreshes the app image and confirms its persistent
Coder connection.

### Third-Party Package Sources

Keep `apt update` free of errors. A failing third-party repository can hide new
package metadata even when PeakUI's own installer continues using previously
signed indexes. For example, a missing Cursor signing key is a host
configuration problem, not a PeakUI failure. Repair or disable the affected
repository using that vendor's current signed installation instructions before
performing routine host updates. Do not bypass APT signature verification or
mark an unsigned source as trusted.

## Incus Coder Maintenance

The persistent Linux Coder installer uses Incus stable by default on supported
Debian/Ubuntu-family hosts because modern nested Docker needs current Incus,
runc, and AppArmor behavior. Normal redeploys reuse the verified installed
runtime and do not ask for `sudo` again.

To intentionally check the selected Incus channel for an update:

```bash
cd /path/to/PeakUI
PEAKUI_CODER_BACKEND=lxd PEAKUI_INCUS_REFRESH=1 ./scripts/install.sh
```

This may request `sudo`, update Incus, regenerate the guest security profile,
restart the guest, and verify nested Docker before PeakUI switches back to it.
Avoid this while a long-running agent task, build, or preview service must not
be interrupted.

Useful health commands:

```bash
sg incus-admin -c 'incus version'
sg incus-admin -c 'incus info peakui-coder'
sg incus-admin -c 'incus exec peakui-coder -- df -h'
sg incus-admin -c 'incus exec peakui-coder -- journalctl -u peakui-coder -n 100 --no-pager'
```

Do not expose `/var/lib/incus/unix.socket` to Coder or run the guest as a
privileged container. The guest is intended to be a capable development server
without control over the host or other instances.

## Docker Storage Hygiene

Inspect usage before pruning:

```bash
docker system df
docker builder du
```

After a confirmed backup, it is normally safe to remove unused build cache:

```bash
docker builder prune
```

Use `docker system prune` only after reviewing its prompt. Do not use volume
pruning on a PeakUI host unless every listed volume has been identified and
backed up. In particular, never remove the Postgres, Coder, or project volumes
as routine cleanup.

Inside persistent Coder, check free storage before large Android, native, or
model builds. The managed readiness service protects a reserve, but it cannot
recover data removed by an external host cleanup.

Do not interpret every registry error as a Docker or DNS failure. A successful
`docker pull hello-world` followed by a `401`, `404`, or manifest error for one
specific image means the runtime path is healthy and that project's image tag,
registry access, or image distribution must be corrected. Fix the project
dependency and commit it; repeated daemon restarts cannot repair a retired
image.

## Dependency Policy

Application dependency upgrades are code changes. Make them in a branch, run
tests, commit the updated lockfile, and deploy through the installer. This
keeps each host reproducible and makes rollback possible.

Recommended validation before merging a dependency update:

```bash
npm ci
npm run build
npm test -- --run
```

For high-impact updates, also test an existing chat session, a Coder session,
GitHub import, Preview, a download, and a database backup/export.

## Recovery Principles

1. Preserve the existing checkout, `.env`, Docker volumes, and Incus instance.
2. Capture logs before retrying: `docker compose logs --tail=200 app` and, for
   persistent Coder, `sg incus-admin -c 'incus info --show-log peakui-coder'`.
3. Re-run the installer before changing files manually; it is designed to be
   idempotent and retains rollback data.
4. If Coder provisioning fails, PeakUI restores Docker Coder. Diagnose the
   guest without deleting it, then retry after the underlying host issue is
   fixed.
5. Restore database and Incus guest exports together when recovering a
   persistent-Coder backup set.

## Suggested Cadence

- Weekly: normal PeakUI installer update and a quick health check.
- Monthly: backup verification, host package review, Docker storage review.
- Before large upgrades: create an off-host backup and record the current git
  commit with `git rev-parse HEAD`.
- After any Incus, Docker, kernel, or GPU update: run the full persistent-Coder
  verification block, including the nested Docker probe.
