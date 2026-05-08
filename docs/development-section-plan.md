# Development Section Implementation Plan

## Purpose

The Development section will turn ViewLlama from a local chat studio into a local development control room. It will contain three dedicated work areas:

- Code Interpreter
- Virtual Machines
- Docker Containers

Open Claw already provides an initial tool-execution layer inside the main app: approval-aware shell commands, approved filesystem access, a managed Python/Node sandbox, and controlled browser actions. The Development section should build on those primitives, but move them into a dedicated worker architecture with stronger isolation, richer environment controls, and section-specific agents.

Each area should have its own environment, its own UI surface, and its own designated AI agent. The agents can share the same underlying Ollama chat infrastructure at first, but each must have a separate system prompt, tool allowlist, memory scope, audit log, and approval policy.

## Research Summary

The safest architecture is to keep the Next.js app focused on UI, authentication, persistence, and streaming chat while moving host-level operations into a separate Development Worker.

Key research points:

- Docker Engine exposes a documented API and Docker's SDK page lists Node.js support through `dockerode`, which fits the current TypeScript stack.
- Docker socket access is effectively host-level power. Docker's security docs warn that access to the daemon can become root-equivalent, so the main web app should not directly mount or expose `/var/run/docker.sock`.
- Docker Compose should be treated as a project-level abstraction for multi-container stacks, not just individual containers.
- libvirt provides stable VM lifecycle concepts and APIs for defining, starting, stopping, inspecting, and deleting virtual machines.
- QEMU's QMP protocol is JSON-based and useful for lower-level VM control, but libvirt should be the first integration layer because it gives a higher-level management model.
- Jupyter kernels are independent language-specific execution processes. For ViewLlama, the safer initial implementation is to run interpreter sessions inside controlled containers rather than inside the app process.
- Incus is a strong alternative control plane because it can manage both system containers and virtual machines, but adopting it would make ViewLlama depend on an additional host platform.

Research references:

- Docker Engine API: https://docs.docker.com/reference/api/engine/
- Docker SDKs: https://docs.docker.com/reference/api/engine/sdk/
- Docker daemon security: https://docs.docker.com/engine/security/
- Docker socket security: https://docs.docker.com/engine/security/https/
- Docker Compose file reference: https://docs.docker.com/reference/compose-file/
- libvirt API concepts: https://libvirt.org/api.html
- libvirt VM lifecycle: https://wiki.libvirt.org/VM_lifecycle.html
- QEMU QMP specification: https://www.qemu.org/docs/master/interop/qmp-spec.html
- Jupyter kernels: https://docs.jupyter.org/en/stable/projects/kernels.html
- Incus instances: https://linuxcontainers.org/incus/docs/main/explanation/instances/
- Proxmox VE API viewer: https://pve.proxmox.com/pve-docs/api-viewer/

## Product Shape

The existing sidebar already has a Development group with:

- Code Interpreter
- Virtual Machines
- Docker Containers

Each section should use a consistent two-zone layout:

- Left rail: section-specific AI conversations, task history, and "New Task".
- Main surface: live environment state, controls, terminal/log panels, files, metrics, and action approvals.

The general chat and Knowledge Base stay separate. Development agents can optionally use RAG later, but their first version should rely on explicit environment state and action logs.

## Shared Architecture

### Components

1. Next.js App
   - Owns auth, routing, settings, UI, and streaming responses.
   - Stores Development messages, environment metadata, and audit logs in Postgres.
   - Calls the Development Worker through local HTTP or Unix socket with a shared token.

2. Development Worker
   - Runs as a separate process or container.
   - Holds all host-level permissions.
   - Talks to Docker Engine, libvirt/QEMU, filesystem sandboxes, and shell tools.
   - Enforces resource limits, operation allowlists, and action timeouts.

3. Agent Runtime
   - Uses one designated agent profile per section.
   - Converts model intent into tool calls.
   - Streams progress events back to the UI.
   - Requires approval for destructive or privilege-expanding actions.

4. Postgres
   - Persists chats, actions, environment state snapshots, approvals, run outputs, and artifacts.

### Why a Separate Worker

Host management is powerful. Docker, VM, and code execution actions can affect the machine running ViewLlama. The Development Worker creates a safer boundary:

- The browser never calls host tooling directly.
- The Next.js app does not need Docker or libvirt sockets mounted into it.
- Dangerous operations can be blocked centrally.
- Worker permissions can be enabled one capability at a time.
- The same API can later support remote workers.

### Proposed Data Models

Initial Prisma models should be added only when implementation begins, but the likely shape is:

- `DevelopmentThread`
  - `id`, `userId`, `section`, `title`, `createdAt`, `updatedAt`
  - `section`: `code`, `vm`, or `docker`

- `DevelopmentMessage`
  - `id`, `threadId`, `role`, `content`, `toolCalls`, `createdAt`

- `DevelopmentAction`
  - `id`, `userId`, `section`, `threadId`, `tool`, `status`, `input`, `output`, `error`, `requiresApproval`, `approvedAt`, `createdAt`

- `CodeWorkspace`
  - `id`, `userId`, `threadId`, `name`, `runtime`, `status`, `lastRunAt`, `artifactPath`

- `CodeRun`
  - `id`, `workspaceId`, `language`, `command`, `stdout`, `stderr`, `exitCode`, `durationMs`, `createdAt`

- `VmInstance`
  - `id`, `userId`, `providerId`, `name`, `template`, `cpu`, `memoryMb`, `diskGb`, `state`, `ipAddress`, `createdAt`, `updatedAt`

- `DockerResource`
  - `id`, `userId`, `resourceType`, `dockerId`, `name`, `image`, `state`, `metadata`, `updatedAt`

These models keep ViewLlama's database as the source of user intent and audit history while the worker remains the source of live host state.

### Proposed API Surface

Route handlers should stay thin and call shared server helpers.

- `GET /api/development/threads?section=code`
- `POST /api/development/threads`
- `GET /api/development/actions?section=docker`
- `POST /api/development/agent`
- `POST /api/development/approvals/:id`

Code Interpreter:

- `GET /api/development/code/workspaces`
- `POST /api/development/code/workspaces`
- `POST /api/development/code/run`
- `GET /api/development/code/artifacts/:id`

Virtual Machines:

- `GET /api/development/vms`
- `POST /api/development/vms`
- `POST /api/development/vms/:id/start`
- `POST /api/development/vms/:id/stop`
- `POST /api/development/vms/:id/snapshot`
- `GET /api/development/vms/:id/console`

Docker Containers:

- `GET /api/development/docker/containers`
- `GET /api/development/docker/images`
- `GET /api/development/docker/compose-projects`
- `POST /api/development/docker/containers/:id/start`
- `POST /api/development/docker/containers/:id/stop`
- `GET /api/development/docker/containers/:id/logs`
- `POST /api/development/docker/containers/:id/exec`

## Designated AI Agents

### Code Interpreter Agent

Goal: turn natural language into safe code execution, analysis, generated files, and artifacts.

Initial tools:

- Create workspace
- Read workspace files
- Write workspace files
- Run Python
- Run Node.js
- Run shell command from a limited allowlist
- Install package with approval
- Save artifact
- Explain run result

System behavior:

- Prefer small, inspectable scripts.
- Show stdout, stderr, exit code, duration, and generated files.
- Ask for approval before network access, package install, long-running jobs, or host file access.
- Never run commands outside the workspace.

### Virtual Machine Agent

Goal: help users create, inspect, start, stop, troubleshoot, and document local VMs.

Initial tools:

- List VMs
- Inspect VM
- Create VM from template
- Start VM
- Graceful shutdown
- Force stop with approval
- Snapshot
- Restore snapshot with approval
- Open console
- Read VM metrics

System behavior:

- Treat every VM as a durable environment.
- Explain resource impact before create/start operations.
- Ask for approval before delete, restore, disk resize, host mount, or network bridge changes.
- Keep a per-VM action timeline.

### Docker Agent

Goal: help users understand and manage containers, images, volumes, networks, and compose projects.

Initial tools:

- List containers
- Inspect container
- Start/stop/restart container
- Read logs
- Exec command with approval
- List images
- Pull image with approval
- List volumes and networks
- Bring compose project up/down with approval

System behavior:

- Default to read-only inspection.
- Flag risky operations before execution.
- Ask for approval before removing containers, pruning, mounting host paths, changing ports, or running privileged containers.
- Preserve compose project boundaries where possible.

## Section Plans

### 1. Code Interpreter

#### Primary Environment

Use controlled Docker-based sandboxes. Each code workspace maps to a directory managed by the Development Worker. Runs happen in short-lived containers with:

- Non-root user
- CPU and memory limits
- Execution timeout
- Workspace mounted read/write
- Network disabled by default
- Artifact output directory

Start with Python because it unlocks data analysis, scripting, file processing, charts, and quick automation. Add Node.js next because the app itself is TypeScript/React.

#### UI Plan

Main surface:

- Workspace selector
- File list
- Code editor or command input
- Run output panel
- Artifact gallery
- Environment details: runtime, limits, last run, package state

Left rail:

- Code Interpreter chat threads
- Recent workspaces
- New analysis task

#### Implementation Steps

1. Add Development shared models and API helpers.
2. Add `CodeInterpreterPanel` client component.
3. Add worker endpoints for workspace create/list/delete.
4. Add worker endpoint for code runs.
5. Add streaming run output.
6. Persist `CodeRun` records.
7. Add artifact download/view support.
8. Add agent tools for workspace and run operations.
9. Add approval gate for package installs and network-enabled runs.

#### MVP Definition

- User can create a workspace.
- User can ask the Code Interpreter Agent to write and run Python.
- Output streams into the UI.
- Files and artifacts persist.
- Runs are limited and auditable.

#### Later Improvements

- Notebook-like cells.
- Charts and table previews.
- Package cache per workspace.
- Multiple runtimes: Python, Node.js, shell, maybe R.
- Optional Jupyter kernel mode for richer stateful execution.

### 2. Virtual Machines

#### Primary Environment

Use a host Development Worker with libvirt and QEMU/KVM. The worker should manage VM templates, cloud-init config, snapshots, metrics, and console sessions. ViewLlama should not build VM XML directly in the browser or main app.

Recommended initial templates:

- Ubuntu Server LTS
- Debian stable
- Lightweight developer image with SSH and basic tools

#### UI Plan

Main surface:

- VM cards with state, CPU, memory, disk, IP, uptime
- VM detail drawer/page
- Start, shutdown, restart, snapshot actions
- Console/terminal panel
- Metrics strip
- Snapshot timeline
- Agent action log

Left rail:

- VM-specific chats
- Global VM operator chat
- Recent VMs
- New VM task

#### Implementation Steps

1. Add worker capability detection for KVM/libvirt.
2. Add read-only VM inventory endpoint.
3. Add `VirtualMachinesPanel` with cards and detail view.
4. Add VM lifecycle actions: start and graceful shutdown.
5. Add template-based create flow.
6. Add console access.
7. Add snapshots.
8. Add VM Agent tools.
9. Add approval gates for destructive actions.

#### MVP Definition

- User can see VMs and their state.
- User can start and gracefully stop a VM.
- User can create one VM from a fixed template.
- User can open a console or connection instructions.
- VM Agent can explain state and perform approved lifecycle actions.

#### Later Improvements

- Template builder.
- Cloud-init editor.
- Network profiles.
- Port forwarding.
- Snapshot compare and restore.
- VM-to-chat context import.
- Multi-host VM workers.

### 3. Docker Containers

#### Primary Environment

Use Docker Engine API through the Development Worker. The worker can use `dockerode` or the official Docker Node SDK when it is mature enough for the needed operations. Compose projects can initially be managed through the `docker compose` CLI from the worker, while container-level operations use the Engine API.

#### UI Plan

Main surface:

- Container list with state, image, ports, health, CPU/memory
- Container inspector
- Logs panel
- Exec terminal with approval
- Image list
- Volume/network list
- Compose project list

Left rail:

- Docker Agent chats
- Container-specific chats
- Recent compose projects
- New container task

#### Implementation Steps

1. Add worker Docker capability check.
2. Add read-only endpoints for containers, images, networks, and volumes.
3. Add `DockerContainersPanel`.
4. Add container logs streaming.
5. Add start/stop/restart actions.
6. Add exec action with approval.
7. Add compose project discovery.
8. Add compose up/down with approval.
9. Add Docker Agent tools.

#### MVP Definition

- User can list containers and inspect details.
- User can stream logs.
- User can start/stop/restart selected containers.
- Docker Agent can answer questions about current container state.
- Destructive actions require approval.

#### Later Improvements

- Compose editor.
- Container resource graphs.
- Image vulnerability or metadata display.
- Volume browser with guardrails.
- Network map.
- One-click troubleshooting bundles.

## Safety and Approval Model

All three sections need a shared action classification system.

Read-only actions:

- Listing resources
- Inspecting metadata
- Reading logs
- Reading metrics

Low-risk actions:

- Starting known resources
- Graceful shutdown
- Running code without network inside a sandbox

Approval-required actions:

- Deleting resources
- Force stopping resources
- Restoring snapshots
- Running privileged containers
- Mounting host paths
- Exposing ports
- Pulling images
- Installing packages
- Enabling network access for code runs
- Running arbitrary exec commands in containers or VMs

Blocked by default:

- Mounting `/`, `/home`, `/root`, `/var/run/docker.sock`, or SSH keys into sandboxes
- Running Docker-in-Docker from Code Interpreter
- Privileged containers created by the Code Interpreter Agent
- VM definitions with arbitrary host passthrough
- Unbounded CPU, memory, disk, or network usage

## Implementation Phases

### Phase 0: Planning and Foundation

- Add this plan.
- Decide worker packaging: separate container vs host service.
- Define environment capability flags.
- Add shared Development route namespace.
- Add base Development thread/message/action models.

### Phase 1: Agent and Tool Runtime

- Create per-section agent profiles.
- Add tool registry and typed tool results.
- Add action audit log.
- Add approval UI pattern.
- Add streaming progress events.

### Phase 2: Docker Read-Only Dashboard

Docker should come first because it is also the safest foundation for Code Interpreter sandboxes.

- Add worker Docker connection.
- Build container/image/network/volume inventory.
- Build Docker UI.
- Add Docker Agent read-only tools.

### Phase 3: Code Interpreter MVP

- Build workspace model.
- Run Python in limited containers.
- Stream output.
- Persist files and artifacts.
- Add package install approval.

### Phase 4: Docker Control Actions

- Add start/stop/restart/logs/exec.
- Add compose project discovery.
- Add compose up/down with approval.
- Add risk previews before actions.

### Phase 5: Virtual Machines MVP

- Add libvirt/QEMU worker capability.
- Build VM inventory and cards.
- Add start/shutdown/create-from-template.
- Add console access.
- Add snapshots with approval.

### Phase 6: Hardening and Polish

- Add quotas per user.
- Add background refresh.
- Add action replay and rollback notes.
- Add deeper metrics.
- Add backup/export for environment definitions.
- Add settings page for worker health and capability toggles.

## Recommended Build Order

1. Development Worker foundation.
2. Docker read-only dashboard.
3. Code Interpreter MVP using Docker sandboxes.
4. Docker control actions.
5. Virtual Machines inventory.
6. Virtual Machines lifecycle.
7. Advanced agent workflows across all three sections.

This order reduces risk because Docker visibility comes before Docker control, and Code Interpreter can reuse the worker and sandboxing work.

## Alternative Unified Plan

Alternative: build ViewLlama as a client for external development platforms instead of controlling the local host directly.

### Architecture

- Next.js app stays unchanged as the UI/auth layer.
- A remote or separately installed Development Gateway owns all environment control.
- ViewLlama connects to configured gateways over HTTPS with tokens.
- Each gateway advertises capabilities: `code`, `docker`, `vm`.

### Code Interpreter Alternative

Use a managed Jupyter Kernel Gateway or a remote runner service. ViewLlama sends code cells and receives output, artifacts, and kernel state over WebSocket/SSE.

Pros:

- Rich notebook-like behavior.
- Stateful kernels are easier.
- Less custom execution plumbing.

Cons:

- More moving parts.
- Harder to secure package installs and filesystem access.
- Less aligned with local-only/simple Docker deployment.

### Virtual Machines Alternative

Use Incus, Proxmox, or another external VM platform instead of direct libvirt/QEMU.

Pros:

- Better built-in VM lifecycle, images, snapshots, and remote APIs.
- Easier multi-host support.
- Less low-level VM management code inside ViewLlama.

Cons:

- Requires users to install and maintain another platform.
- UI must handle provider-specific differences.
- Less "it just works on this local machine" than the primary plan.

### Docker Containers Alternative

Use Docker contexts or a remote Docker API endpoint managed outside ViewLlama.

Pros:

- Works with remote Docker hosts.
- Avoids mounting Docker socket into any ViewLlama-owned service.
- Easier to separate permissions by host.

Cons:

- Setup is more complex.
- TLS/cert/token management becomes user-facing.
- Local-first users get more configuration work.

### When to Choose the Alternative

Choose the external gateway plan if the project needs:

- Multi-host support early.
- Stronger separation from the ViewLlama host.
- Enterprise-style access control.
- Existing Proxmox/Incus/Jupyter infrastructure.

For the current local-first product, the primary Development Worker plan is more practical and gives the best path to a useful MVP.

## Open Decisions

- Should the Development Worker run as a Docker container with selected socket mounts, or as a host service installed outside Docker?
- Should Code Interpreter be Python-only for the MVP, or Python plus Node.js?
- Should VM support target Linux/KVM first and document that macOS/Windows need a remote gateway?
- Should every Development section have separate model settings, or use the global chat model initially?
- Should Development threads reuse `ChatSession`, or should they get a separate schema from day one?

## Definition of Done for the First Complete Development Release

- Each Development section has its own UI panel and designated AI.
- Each agent can inspect its environment and explain current state.
- The Docker section can inspect, stream logs, and perform approved lifecycle actions.
- The Code Interpreter can run sandboxed Python and produce artifacts.
- The VM section can list, create from template, start, stop, and snapshot local VMs.
- All high-risk actions require explicit approval.
- All actions are logged with inputs, outputs, status, user, and timestamp.
- The main app remains usable even when Development Worker capabilities are disabled.
