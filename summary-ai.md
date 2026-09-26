# Summary for Review — Large-file explorer downloads

Scoped summary of one fix, written so a reviewing AI can verify it without
re-reading the whole project. The problem, the change, the test evidence, and
the specific things to check.

## Problem

Downloading a large build artifact (e.g. an 80.8 MB APK) from the Coding
explorer returned only **64 KB**. Root cause: the download route called the
daemon's `GET /file/bytes` **without** a `maxBytes` param, hitting the daemon's
`DEFAULT_FILE_BYTES_MAX_BYTES = 64 * 1024` default (its hard cap is
`MAX_READ_BYTES = 256 * 1024`). The file was silently truncated at the ceiling;
no error was surfaced, so the truncated download looked like a complete file.

## Change

Stream large downloads **directly from the shared Docker volume**, bypassing the
daemon's size ceiling entirely. The app and the coder container already mount the
same volumes; the fix reads the file from the app's own mount and streams it,
falling back to windowed daemon reads only for paths outside a mapped root.

### Files

- **`src/lib/coder-download.ts`** (new)
  - `HOST_WORKSPACE_ROOTS` maps daemon paths to the app's mount of the same
    volume: `/workspace` → `CODER_WORKSPACE_HOST_ROOT` (`/coder-workspace`) and
    `/apps` → `CODER_APPS_HOST_ROOT` (`/coder-apps`).
  - `hostPathForWorkspaceFile(daemonPath)` — maps a daemon path to its host path
    under a mapped root, with a containment re-check (rejects traversal/relative
    paths and anything outside the mapped roots; returns `null` for unmapped).
  - `streamLocalDownload(hostPath, filename)` — `stat`s the file, then
    `Readable.toWeb(createReadStream(...))` into a `Response` with correct
    `Content-Length`, `Content-Type: application/octet-stream`, and a
    `Content-Disposition` attachment header.
  - `sanitizeDownloadFilename(name)` — strips quotes, backslashes, and control
    chars; falls back to `"download"` for an empty name.
  - `readDaemonFileWindowed(daemonPath)` — fallback for unmapped roots: loops
    `proxyToCoderDaemon('/file/bytes?path=…&offset=N&maxBytes=262144')`,
    base64-decodes and concatenates each chunk, and stops on `truncated: false`,
    `returnedBytes <= 0`, or `offset >= sizeBytes`.
- **`src/app/api/coder/file-actions/route.ts`** — the download handler now tries
  `hostPathForWorkspaceFile` → `streamLocalDownload` first; for a null mapping it
  falls back to `readDaemonFileWindowed`. Archive downloads use `readLocalFile` /
  `readDaemonFileWindowed` wrapped in `new Uint8Array(data)`.
- **`docker-compose.yml`** — app service gains `CODER_WORKSPACE_HOST_ROOT` and
  `CODER_APPS_HOST_ROOT` envs, and mounts `coder_apps:/coder-apps:rw` so `/apps`
  is covered the same as `/workspace`.
- **`src/lib/coder-download.test.ts`** (new) — 11 tests.

## Test evidence

- `src/lib/coder-download.test.ts` covers: path mapping (both roots, root
  itself, `null` for `/etc/passwd`), filename sanitization, full-file streaming
  with correct headers/body, rejection of a non-regular/missing file, windowed
  reassembly across three truncated chunks, and a non-2xx daemon response.
- Full suite at the time of the fix: **1026 passing / 96 files**; `npx tsc
  --noEmit` clean. Services rebuilt and redeployed so the fix is live.

## Things a reviewer should double-check

1. **Path containment** — `hostPathForWorkspaceFile` must resolve the candidate
   to a path that stays under the mapped root after joining (no `..` escape, no
   absolute-path escape). Verify a symlink inside a mapped root can't point the
   read outside it, or note that the daemon workspace containment remains the
   final authority.
2. **The `/apps` mapping is real** — confirm `docker-compose.yml` mounts
   `coder_apps` into the app and that the coder container mounts the *same*
   volume at `/apps`, so the app's `/coder-apps/…` is the identical bytes the
   daemon would serve from `/apps/…`.
3. **Fallback correctness** — `readDaemonFileWindowed` must pass `maxBytes=262144`
   explicitly (that's what defeats the 64 KiB default) and advance `offset` by the
   *returned* byte count, not the requested count.
4. **Streaming is truly chunked** — `streamLocalDownload` returns a
   `ReadableStream` (not a fully-buffered `Buffer`), so an 80 MB artifact does not
   balloon memory in the app container.
5. **No regression for the old path** — archives and any unmapped future root
   still work via the windowed fallback; confirm the `new Uint8Array(...)` wrap
   satisfies the `BodyInit` type at the route call sites.

## Rollback

`git revert` the commit (or remove `coder-download.ts` and restore the previous
route) and rebuild the app image. The compose mount/env additions are additive
and harmless to leave in place. No volume reset, no `docker compose down -v`.
