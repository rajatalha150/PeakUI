# PeakUI Architecture

This page is the current visual map of PeakUI. Detailed contracts live in the linked subsystem documents.

## System Map

```mermaid
flowchart TB
  Browser[Browser]
  App[PeakUI Next.js app]
  DB[(Postgres)]
  Search[SearXNG]
  Ollama[Ollama or compatible provider]
  Browser --> App
  App --> DB
  App --> Search
  App --> Ollama
  App --> WS[WorkSpaces agent and tools]
  App --> Canvas[Canvas artifacts]
  App --> Coder[Coder gateway]
  Coder --> Runtime[Coder runtime]
```

## Coder Runtimes

```mermaid
flowchart LR
  UI[Coding UI] --> Gateway[Authenticated /api/coder gateway]
  Gateway --> Choice{Backend}
  Choice -->|Docker default| Docker[Coder Docker container]
  Choice -->|Linux persistent| Bridge[Loopback bridge :4171]
  Bridge --> Guest[Incus guest: peakui-coder]
  Guest --> Router[Workspace router]
  Router --> Root[/workspace runtime]
  Router --> Project[Per-project runtime]
```

The browser never receives the Coder daemon token. Gateway authorization binds each daemon session to its PeakUI owner and its selected workspace.

## Preview Flow

```mermaid
flowchart LR
  Agent[Agent starts server] --> GuestPort[Guest app port]
  GuestPort --> Bridge[Private preview bridge :4172]
  Bridge --> PreviewGateway[Signed isolated preview origin :4173]
  PreviewGateway --> PreviewFrame[Preview iframe at real root paths]
  PreviewFrame --> Log[Chromium diagnostics]
  Frame --> Vision[Viewport screenshot review]
```

The browser never uses `p<port>.localhost` directly. That address would resolve on the viewer's device, which breaks remote/LAN use. PeakUI proxies the approved guest port through its own authenticated origin and rewrites root-relative HTML and Vite asset/API paths.

## Persistence Boundaries

| State | Durable location | Recovery behavior |
|---|---|---|
| Users, settings, chats, context ledger, Canvas metadata | Postgres | Survives app/container restart |
| Coder project filesystem, package installs, services, caches, SSH, Coder data | Incus guest root on persistent Coder | Survives guest/app restart and PeakUI updates |
| Live SSE subscription | Browser connection | Reconnects with cursor/epoch resume; 404 from a recreated guest session triggers same-session restoration |
| Preview server | Guest process/service | Auto-discovered when listening; agent can publish `.peakui-preview.json` for an exact URL/device |

## Related Docs

- [Coding environment](coding-environment.md)
- [Persistent Incus/LXD Coder](coder-lxd.md)
- [Operations and updates](operations-and-updates.md)
- [GitHub Coder integration](github-coder-integration.md)
