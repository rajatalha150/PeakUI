# Open Claw Host Executor

Open Claw shell commands normally run inside the PeakUI app container. If you want shell commands to use the host machine's own `PATH`, installed tools, and local CLI setup, run the optional host executor outside Docker and switch Open Claw shell target to `Host`.

If `Host` is selected but the executor is not configured or reachable, Open Claw falls back to the normal container shell and labels the actual execution target in the approval dialog and shell output. This keeps ordinary commands working while making it clear that host-only paths and tools still require the daemon.

## What it does

- Listens on `127.0.0.1` by default
- Requires a shared bearer token
- Executes commands on the host machine, not in the container
- Enforces:
  - explicit approvals when configured
  - approved working-directory roots
  - allowlisted host environment variables
  - per-command timeout caps
  - output-size caps
- Every shell request/result is audited in the database
- Falls back to the container shell when Host is selected but unavailable

## Start it

Set a token that both the app container and the host daemon can read:

```bash
export OPENCLAW_HOST_EXECUTOR_TOKEN='replace-this-with-a-long-random-token'
```

Optional overrides:

```bash
export OPENCLAW_HOST_EXECUTOR_BIND='127.0.0.1'
export OPENCLAW_HOST_EXECUTOR_PORT='4318'
export OPENCLAW_HOST_EXECUTOR_URL='http://127.0.0.1:4318'
export OPENCLAW_HOST_EXECUTOR_SHELL='/bin/bash'
```

Start the daemon on the host:

```bash
npm run openclaw:host-executor
```

Then restart the PeakUI app container so it picks up `OPENCLAW_HOST_EXECUTOR_URL` and `OPENCLAW_HOST_EXECUTOR_TOKEN`.

With Docker Compose, put the same token in the shell environment used to start Compose:

```bash
export OPENCLAW_HOST_EXECUTOR_TOKEN='replace-this-with-a-long-random-token'
docker compose up -d --build
```

## Configure Open Claw

In Settings:

1. Set `Shell Target` to `Host`
2. Keep `Shell Approval Mode` on `Ask First` initially
3. Set `Host Shell Allowed Roots`
4. Set `Host Shell Allowed Env Vars`
5. Review timeout and output caps

The host executor is optional. Container shell remains available even without this daemon, but it sees the container filesystem and container-installed tools.

## Important limitation

The host executor constrains the command's working directory and inherited environment, but it is not a full OS sandbox. If you allow an arbitrary host shell command and approve it, that command still has the normal power of the host user account running the daemon.
