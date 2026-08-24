# WorkSpaces Host Executor

WorkSpaces shell commands normally run inside the PeakUI app container. If you want shell commands to use the host machine's own `PATH`, installed tools, and local CLI setup, run the optional host executor outside Docker and switch WorkSpaces shell target to `Host`.

If `Host` is selected but the executor is not configured or reachable, WorkSpaces falls back to the normal container shell and labels the actual execution target in the approval dialog and shell output. This keeps ordinary commands working while making it clear that host-only paths and tools still require the daemon.

## What it does

- Listens on `127.0.0.1` by default
- Requires a shared bearer token
- Executes commands on the host machine, not in the container
- Enforces:
  - explicit approvals when configured
  - approved working-directory roots, resolved through real paths before execution
  - allowlisted host environment variables
  - per-command timeout caps
  - output-size caps
- Every shell request/result is audited in the database
- Falls back to the container shell when Host is selected but unavailable

## Start it

Set a token that both the app container and the host daemon can read:

```bash
export WORKSPACE_TOOL_HOST_EXECUTOR_TOKEN='replace-this-with-a-long-random-token'
```

Optional overrides:

```bash
export WORKSPACE_TOOL_HOST_EXECUTOR_BIND='127.0.0.1'
export WORKSPACE_TOOL_HOST_EXECUTOR_PORT='4318'
export WORKSPACE_TOOL_HOST_EXECUTOR_URL='http://127.0.0.1:4318'
export WORKSPACE_TOOL_HOST_EXECUTOR_SHELL='/bin/bash'
```

Start the daemon on the host:

```bash
npm run workspace-tool:host-executor
```

Then restart the PeakUI app container so it picks up `WORKSPACE_TOOL_HOST_EXECUTOR_URL` and `WORKSPACE_TOOL_HOST_EXECUTOR_TOKEN`.

With Docker Compose, put the same token in the shell environment used to start Compose:

```bash
export WORKSPACE_TOOL_HOST_EXECUTOR_TOKEN='replace-this-with-a-long-random-token'
docker compose up -d --build
```

## Configure WorkSpaces

In Settings:

1. Set `Shell Target` to `Host`
2. Keep `Shell Approval Mode` on `Ask First` initially
3. Set `Host Shell Allowed Roots`
4. Set `Host Shell Allowed Env Vars`
5. Review timeout and output caps

The host executor is optional. Container shell remains available even without this daemon, but it sees the container filesystem and container-installed tools.

Settings also includes Host Access presets:

- `Safe Workspace`: host shell starts only inside the managed workspace; filesystem read/write is scoped to the workspace.
- `Home Read + Workspace Write`: filesystem reads are allowed for mounted home/temp roots; writes remain workspace-only.
- `Mounted Host Audit`: reads all mounted host roots and lets host shell commands start from those mounted roots; writes remain workspace-only.

The status card calls `/api/workspace-tool/filesystem` and reports:

- whether the current account has filesystem permission
- mounted host roots and writable roots
- approved read/write roots
- host executor token/reachability
- warnings when access is enabled but no approved roots are configured

Filesystem denials now return structured diagnostics. Common `code` values:

- `permission_denied`: the account lacks the required WorkSpaces filesystem permission
- `no_approved_read_roots`: filesystem read mode is enabled, but no read roots are approved
- `outside_approved_read_roots`: the requested path is not under an approved read root
- `outside_mounted_host_roots`: the requested path is not mounted into the app container
- `missing_approval_token`: a write action was attempted without the ask-first approval token

## Windows host executor

The same daemon works on Windows, but a few details differ:

1. Start the daemon with PowerShell or Command Prompt (not inside WSL or Docker):

   ```powershell
   $env:WORKSPACE_TOOL_HOST_EXECUTOR_TOKEN='replace-this-with-a-long-random-token'
   $env:WORKSPACE_TOOL_HOST_WORKSPACE_DIR='C:\Users\John\peakui-workspace'
   npm run workspace-tool:host-executor
   ```

2. The executor auto-detects Windows and uses `cmd.exe` (or PowerShell if `WORKSPACE_TOOL_HOST_EXECUTOR_SHELL` points to it). It translates container paths such as `/mnt/workspace-tool/workspace/...` back to the matching Windows host path so commands run in the right directory.

3. On Docker Desktop for Windows, the app container reaches the host daemon through `http://host.docker.internal:4318`. Make sure `WORKSPACE_TOOL_HOST_EXECUTOR_URL` in the container environment matches the host bind address. If you bind to `127.0.0.1` inside the host (the default), Docker Desktop's `host.docker.internal` will reach it.

4. Windows signals behave differently than on Linux. The daemon attempts graceful termination and falls back to `SIGKILL`; this is usually mapped to `TerminateProcess` by Node.js, but it may be less reliable than on Linux. Keep timeout and output caps conservative.

5. Windows absolute paths use drive letters. The executor normalizes separators internally, so configure `Host Shell Allowed Roots` with Windows paths (e.g. `C:\Users\John\peakui-workspace`).

## Important limitation

The host executor constrains the command's working directory and inherited environment, but it is not a full OS sandbox. If you allow an arbitrary host shell command and approve it, that command still has the normal power of the host user account running the daemon.
