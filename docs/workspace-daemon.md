# WorkSpaces Runtime Daemon

PeakUI WorkSpaces uses a dedicated `workspace-daemon` service for background
runtime work. This gives the main WorkSpaces surface the same process boundary
and restart behavior as Coding's daemon without moving the authenticated UI or
interactive request gateway out of PeakUI.

Provider keys entered in the browser are removed from the queued request body
and stored as AES-256-GCM ciphertext derived from `JWT_SECRET`. This keeps a
durable run usable after the tab closes without leaving the provider key in
plain text in the queue table or event log. Rotating `JWT_SECRET` invalidates
queued encrypted credentials, so rotate during a maintenance window and let
old runs finish first.

```text
Browser / WorkSpaces UI
        |
        v
PeakUI app  ---- authenticated status ---->  workspace-daemon
    |                                             |
    |-- API, sessions, files, chat                |-- heartbeats
    |-- Postgres-backed history                   |-- schedules
    |-- tool permissions                           |-- URL/file monitors
        |-- unattended runs
        |-- interactive agent runs
        \________________ PostgreSQL ______________/
```

## What the daemon owns

- Heartbeat, cron schedule, URL monitor, and file monitor polling.
- Queued unattended Ollama runs and their durable execution records.
- Interactive WorkSpaces turns, including model rounds, tool execution, status,
  and the final session write. Each turn is a PostgreSQL-backed job with an
  event log, so a dropped browser stream is only a dropped view. Each model
  round also records the model-aware context budget after server-side summary
  and trim decisions, allowing the UI to replay the exact context state after
  a refresh. Model output is coalesced into small event chunks while it is
  generated, so the browser can render a live answer instead of waiting for
  the entire turn to finish.
- Fair dispatch for interactive work. The daemon starts a small bounded batch
  without waiting for those model calls to finish, admits at most one active
  run per user, and keeps the scheduler free for automation and new work.
  Interactive dispatch and monitor/schedule polling use separate lanes, so a
  slow monitor cannot delay a newly queued chat turn.
- A health/status endpoint used by the WorkSpaces automation panel.
- A PostgreSQL advisory lease so only one daemon processes due work, even if a
  deployment is accidentally started twice.

The browser is not the worker. Opening WorkSpaces starts no hidden polling loop,
and closing the tab does not stop configured automation or an active queued
turn. The Next.js process is the authenticated API gateway; the daemon calls it
with a short-lived user token so all existing permission and path checks remain
in force.

## Deployment

Both Compose files include the service automatically:

```sh
docker compose ps workspace-daemon
docker compose logs -f workspace-daemon
```

The daemon runs `prisma migrate deploy` before opening its health port. This
is deliberate: the app and daemon are recreated together during an update, so
the daemon must be able to start safely even when the app has not yet reached
its own migration step. Prisma's migration lock makes this safe when both
processes start at the same time.

After an update, verify both the service and schema before opening a long
WorkSpaces run:

```sh
docker compose ps workspace-daemon
docker compose exec workspace-daemon npx prisma migrate status
curl -fsS http://127.0.0.1:4320/health
```

The health endpoint only confirms that the daemon process is listening. A
successful `prisma migrate status` confirms that its database is ready for
durable runs and event replay.

The service listens only on an internal host/Compose address. Its status route
requires `WORKSPACE_DAEMON_TOKEN` when a token is configured. The installer adds
that token to an existing `.env` if it is missing; fresh installs generate it.
The app and daemon must share the same value.
The daemon also needs `JWT_SECRET` and `WORKSPACE_APP_URL` so it can call the
authenticated app routes from its own container. Compose supplies both:
`http://127.0.0.1:3000` on Linux host networking and `http://app:3000` on
Windows Docker Desktop.

Linux host networking uses `http://127.0.0.1:4320`. Windows Docker Desktop uses
`http://workspace-daemon:4320` on the private Compose network. Override
`WORKSPACE_DAEMON_URL` only when changing the deployment topology.

### Runtime controls

Fresh installers write conservative defaults to `.env`; Compose also supplies
the same defaults when upgrading an older installation that does not yet have
these entries.

| Variable | Default | Purpose |
|---|---:|---|
| `WORKSPACE_DAEMON_INTERVAL_MS` | `5000` | How often the daemon looks for queued work. It is a dispatch interval, not a model timeout. |
| `WORKSPACE_DAEMON_CONCURRENCY` | `2` | Maximum simultaneous WorkSpaces runs, clamped to 1–4. One user receives at most one active slot. |
| `WORKSPACE_RUN_EVENT_RETENTION_DAYS` | `7` | Retention period for replay-only frames from terminal runs, clamped to 1–90 days. |

Increase concurrency only after confirming the host has enough RAM for the
selected models and tool workloads. The saved chat transcript is permanent;
event retention only removes old reconnect telemetry.

## Recovery behavior

The daemon runs one tick immediately after acquiring its lease and then polls
every five seconds by default. If it crashes, Compose restarts it. Due schedules, queued
interactive turns, event frames, and final transcripts remain in PostgreSQL, so
the next healthy daemon picks them up. A stale running lease is returned to the
queue after twenty minutes. The event endpoint replays from a sequence cursor
and sends heartbeat frames during long model calls, so refreshing the page does
not lose already-produced output or get mistaken for a dead stream by a reverse
proxy.

The progress stream uses explicit lifecycle phases instead of one generic
loading message. A normal turn can report queued, context preparation,
knowledge-base or web research, model loading, model planning, tool selection,
tool execution, result review, context compaction, finalization, approval
waiting, retrying, and completion. These phases are informational telemetry;
the daemon remains authoritative for whether a run is actually running or
finished.

The file panel's event stream also performs an authoritative tree invalidation
when a browser reconnects. This prevents a dropped SSE connection from leaving
the explorer permanently stale even though the underlying workspace files are
persistent.

## Context accounting

WorkSpaces does not assume one fixed context size for every model. The request
pipeline resolves the selected model's native Ollama context when available,
accepts context capacity reported by compatible provider catalogs, and falls
back to the configured context setting when a provider reports no capacity.
Before each model call it reserves room for the answer, tool schemas/images,
and accounting variance. Pressure thresholds are applied to the usable input
budget: prepare at about 60%, compact at 72%, rebuild at 80%, and emergency
trim at 90%.

The server emits a `context_usage` frame containing the selected model, sent
token estimate, effective window, usable input budget, remaining capacity,
pressure tier, and resulting context health. The daemon persists this frame in
`WorkspaceAgentRunEvent`; the browser consumes it live and replays it during a
reconnect. The idle session endpoint remains an explicitly estimated snapshot
until the next model round supplies a provider-aware event.

## Boundaries

Interactive WorkSpaces turns are queued through `/api/workspace-tool/runs` and
read through `/api/workspace-tool/runs/:id/events`. The browser can disconnect
and reconnect without cancelling the run. The daemon executes the existing
chat, shell, filesystem, code, browser, document, web, and data-tool routes
server-side, then finalizes the session directly in PostgreSQL.

Each WorkSpaces run also includes a validated `client_viewport` value
(`mobile`, `tablet`, or `desktop`). The daemon forwards it with the durable
chat request, so a reconnect or event-stream retry does not lose the device
context. The chat completion layer uses the value only for WorkSpaces and asks
the model to keep narrow-screen responses compact: lead with the result, prefer
bullets and short sections, avoid wide tables, and wrap long commands, URLs,
and filenames. Desktop requests receive no additional presentation instruction.
The renderer backs this up with responsive wrapping and touch scrolling for
code, data, tables, and images.

An explicit **Stop** still cancels the durable run. A tool that genuinely needs
human approval is recorded as `approval_required` rather than being silently
approved by a background process; the run posts a clear waiting message and can
be retried after the user approves or changes the relevant setting. This is the
intentional boundary between persistence and permission escalation.

## Failure safety and replay

The daemon persists a checkpoint immediately before every real tool execution
and saves the cleaned conversation after the tool result is recorded. If the
daemon or host disappears while a tool may have been running, PeakUI does not
blindly replay that action. The recovered run stops with an actionable message
that identifies the uncertain step, so the user can inspect the workspace and
retry only when safe. This protects writes, submissions, generated artifacts,
and browser actions from accidental duplicates.

Model/network calls that fail while PeakUI itself restarts are re-queued only
when the run was not cancelled. Stop is durable: the worker checks it between
model and tool rounds, terminal status cannot be overwritten by retry or normal
completion, and the session receives a saved stop message. A browser refresh
only replays the daemon event log and then reads the authoritative saved
session; it never executes the same tool loop locally.

For bounded storage and context, individual durable tool results are limited to
24,000 characters with an explicit truncation note. Use the artifact or a
narrower follow-up query when the full raw payload is needed.
