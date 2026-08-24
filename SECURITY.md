# Security Policy

PeakUI is a powerful self-hosted tool. Please read this document before deploying or contributing.

## Supported Versions

Only the latest commit on the `main` branch is actively supported with security updates. We recommend staying up to date and using tagged releases once they are available.

## Reporting a Vulnerability

If you discover a security vulnerability in PeakUI, please email **info@peakservices-inc.com** with:

- A clear description of the issue
- Steps to reproduce, if applicable
- The version or commit hash affected
- Your suggested fix, if any

We will acknowledge receipt within 5 business days and work with you on a coordinated disclosure.

## Security Model

PeakUI includes capabilities that can affect the host system:

- **Shell execution** — runs commands inside the app container or through an optional host executor.
- **Filesystem access** — reads and writes files inside approved mounted roots.
- **Code sandbox** — executes Python/Node scripts in a workspace-scoped environment.
- **Browser automation** — fetches public pages and, in stealth mode, routes through Tor.
- **Tax/PDF document handling** — can extract sensitive financial and personal data from uploads.

These capabilities are layered behind:

1. **Authentication** — JWT-based auth with per-user accounts.
2. **Permissions** — per-user capability grants managed by admins.
3. **Personal settings** — each user can enable/disable tool categories.
4. **Approval tokens** — destructive or interactive actions require explicit approval.
5. **Host executor hardening** — optional executor enforces approved roots, env allowlists, timeouts, and output caps.
6. **Network guardrails** — SSRF protections, Tor preflight checks, and private-address blocks.

## Deployment Hardening

- Change all default passwords and generate a strong `JWT_SECRET` before exposing PeakUI to a network.
- Run behind HTTPS in any multi-user or network-exposed deployment.
- Mount only the directories WorkSpaces actually needs.
- Keep the host executor token secret and rotate it regularly.
- Review the [`.env.example`](.env.example) file for required and optional variables.

## Responsible Use

PeakUI is intended for legitimate local automation, research, and productivity. Do not use it to:

- Attack, scan, or abuse third-party services or infrastructure
- Harvest data in violation of terms of service or privacy laws
- Distribute malware or harmful content
- Evade security controls on systems you do not own or authorize

## Security-Related Configuration

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Signing secret for session tokens |
| `WORKSPACE_TOOL_HOST_EXECUTOR_TOKEN` | Shared secret for optional host command executor |
| `TOR_PROXY_URL` | SOCKS proxy for UWAF stealth browsing |

---

PeakUI is built by Muhammad Talha Raza and owned by Peak Services INC.
