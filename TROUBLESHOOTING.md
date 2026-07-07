# Troubleshooting

Common issues and their fixes, grouped by area. If something here doesn't
match what you see, run `docker compose logs app` first — most symptoms
have an entry near the bottom of the log.

## Containers

### `peakui-app-1` exits immediately

Check the log:

```bash
docker compose logs app
```

Common causes:

- **Database not reachable.** PeakUI exits when `DATABASE_URL` is wrong or
  the `db` service isn't healthy. Run `docker compose ps db` and verify
  `STATUS` shows `(healthy)`. Re-run `docker compose up -d db` if not.
- **Prisma client out of date.** After `git pull` that touches
  `prisma/schema.prisma`, run `docker compose build --no-cache app` so the
  generated client is rebuilt.

### `host.docker.internal` not reachable (Windows / macOS)

The Ollama host defaults to `http://host.docker.internal:11434` on Windows /
macOS Docker Desktop. If Ollama is on a different host or port, set
`OLLAMA_HOST` in `.env` and re-run `docker compose up -d`.

### Port 3000 already in use

Either free the port, or change the host-side mapping in `docker-compose.yml`:

```yaml
ports:
  - "127.0.0.1:8080:3000"
```

`network_mode: host` ignores `ports` entirely; switch to `docker-compose.windows.yml`
(bridge mode) if you need to remap.

## Ollama

### Model fails to load with "context length too large"

Lower the **Context Window** in Settings → Generation, or enable **Use Ollama
default context** so Ollama chooses the model's native value. **Exclusive
Ollama Switching** (also in Settings) unloads other models before starting
the selected one and is the safest way to avoid OOM on small GPUs. Exclusive
switching is automatically skipped when **Use Ollama Cloud API** is enabled,
because the cloud endpoint does not expose the local `/api/ps` running-models
endpoint.

### "Ollama returned 401 while listing running models" with cloud mode enabled

The local `/api/ps` endpoint is not available on Ollama Cloud. Update to the
latest version — PeakUI now skips `/api/ps` probes and exclusive-model
unloading when **Use Ollama Cloud API** is enabled. Also verify the API key is
saved: the Settings UI shows a masked key, and the `/api/settings` response
redacts it so it is never accidentally overwritten by the browser.

### Settings shows the local Ollama URL while cloud mode is enabled

The status label now shows `ollama.com` when cloud mode is active. If you
still see the local host URL after enabling the toggle, refresh Settings and
re-save; the display updates from the saved `ollamaUseCloudApi` flag.

### Ollama Cloud model list is empty or different from local

Ollama Cloud lists models tied to your cloud account, not the local `ollama`
instance. A non-empty local model count is expected when cloud mode is off.

### Pull is slow or times out

Confirm outbound HTTPS to `registry.ollama.ai` works from the Ollama host.
On a Linux server with IPv6 issues, force IPv4: `curl -4 https://ollama.com`.

## WorkSpaces

### Tools are missing or greyed out

Account permission is missing. Open **Settings** inside WorkSpaces and check
the **Tool permissions** panel — it reports which capability is blocked and
why. An admin needs to grant the corresponding permission
(`openclaw.shell`, `openclaw.filesystem`, `openclaw.code`, etc.) in
User Management.

### Shell commands fail with "outside approved roots"

The host executor restricts commands to the `OPENCLAW_HOST_WORKSPACE_DIR`
plus any additional roots configured in Settings → **Host shell roots**.
Add the path you need or switch the shell target back to **container**.

### Code sandbox returns "workspace not selected"

Each named workspace has its own sandbox path. Pick the right workspace
in the workspace selector (top bar → Workspace modes) before invoking
the code tool.

## Knowledge Base

### "Embedding model not configured"

Set an embedding model in Settings → **Embedding Model**. `nomic-embed-text`
is a safe default (`ollama pull nomic-embed-text`).

### Documents stuck in "pending"

Run `docker compose logs app | grep -i rag` to see the indexer errors.
Common causes:

- The file is larger than the configured chunk size; reduce chunk size in
  Settings or upload smaller files.
- The OCR fallback (page rasterization) failed because `tesseract` is
  missing. The container image includes both `tesseract` and `poppler-utils`
  by default; check your custom image if you've forked the Dockerfile.

## Canvas

### Artifact download is corrupt

If you downloaded a `.pptx`, `.zip`, `.eml`, or `.pdf` from Canvas and the
file opens as raw base64 text, you hit the legacy bug where binary types
were served un-decoded. Update to **v0.13.0 or later** — every binary type
now goes through `/api/canvas/artifacts/<id>/download` and is decoded
correctly.

### Source artifact is missing for an existing artifact

Source artifacts (the JSON / `.mmd` siblings for source-editable binary
artifacts) are created from v0.6.0 onward. Artifacts created before that
upgrade do not have one. Re-render or upload a new version to generate
the source sibling.

## Workspace Files Panel

### Files I uploaded via the panel appear in chat immediately but my
### co-worker in another browser tab doesn't see them

The panel subscribes to `/api/openclaw/workspaces/[id]/events` on mount.
If a tab has been open for a long time, the subscription may have been
silently disconnected by an aggressive proxy. Close and reopen the tab;
the client reconnects with exponential backoff (500 ms → 5 s) on a
transient failure.

### Drag-and-drop upload rejects everything with "Too many files"

The cap is **100 files per request**. Drop them in batches, or use the
shell / filesystem tools for large migrations.

### Bulk download zip stops at 500 MB

The cap is intentional — anything larger should be split or downloaded
file-by-file via **Download zip** with a curated path list. Adjust
`MAX_ZIP_BYTES` in `src/app/api/openclaw/workspaces/[id]/files/zip/route.ts`
only if you know what you're doing (it can OOM the Node process).

### Editor shows "File changed on server"

Another tab, the model, or a shell command wrote the file after you
opened it. Choose **Reload** to discard your edits and pull the new
content, **Overwrite** to force-save your version, or **Save as copy**
to write `<filename>.edited.ext` next to the original without touching
the conflict.

### Right-click menu doesn't appear

Some browsers suppress `contextmenu` events inside shadow DOM. If you're
embedding PeakUI in an iframe, set `sandbox="allow-same-origin allow-scripts"`
and ensure the iframe has focus. From a regular tab, the menu should
appear on right-click on any row.

## Browser / UWAF

### "Tor proxy unreachable" in stealth mode

The Tor sidecar (`peakui-tor-proxy-1`) takes 30-60 s to bootstrap on first
run. Wait for `docker compose logs tor-proxy` to show
`Bootstrapped 100% (done)`. The app also probes `localhost:9050` (Linux
host-mode) and `tor-proxy:9150` (Windows bridge mode) and caches the first
working endpoint, so switching between host and bridge deploys doesn't
need a config change.

### "Direct mode works but stealth mode finds nothing"

Stealth search is restricted to the approved onion-search catalog. If a
catalog engine is down, rotate to another by setting
`UWAF_STEALTH_PROVIDER_<NAME>_{HOME_URL,QUERY_URL}` env vars, or pick a
different engine from the Network Hub panel.

From v0.16.0 onward, if every stealth/direct attempt returns no useful
results the browser search automatically falls back to the public-web search
layer (Brave / SearXNG / Bing / DuckDuckGo) so the session still gets
results. Check `docker compose logs app | grep -i "public-web fallback"` to
confirm the fallback fired.

### "Browser fetch is slow on the second request to the same host"

`fetchAsReadableText` now reuses the managed UWAF pool instead of launching
a fresh Chromium context for every page. The first request to a host warms
the pool; subsequent requests on the same host skip the launch overhead. If
the pool is unavailable (headless/CI), the route falls back to an ephemeral
browser with a 5 s navigation timeout.

### Web search returns 429 or "provider rate limited"

PeakUI now applies per-provider cooldowns after failures: 2 s after the
first failure, 8 s after the second, 32 s after the third. Paid providers
(Brave, Google, SearXNG with API key) recover independently from free
providers. Wait a few seconds and retry, or add a paid provider in
Settings.

## SSRF / Redirect Safety

### "URL not allowed" for a public site that should work

The public-web guard blocks private IP ranges, `localhost`, `127.0.0.1`,
`.internal` hosts, and any redirect chain that lands on one of those. If
you intentionally run services on `.internal` hostnames, set
`PEAKUI_ALLOW_INTERNAL_HOSTS=true` in `.env` and restart.

## Database

### "Migration pending" after upgrade

```bash
docker compose exec app npx prisma migrate deploy
```

`prisma db push` is fine for development but never use `prisma migrate reset`
on a real database — it deletes every row.