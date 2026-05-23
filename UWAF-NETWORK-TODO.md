# UWAF / Network / Browser Infrastructure TODO

This file tracks targeted improvements for the Unified Web Agent Framework, stealth/Tor browsing, live-browser transport, and the broader Open Claw network stack.

## Current Baseline
- Headed Chromium per UWAF session under `Xvfb`
- `x11vnc` bridged through authenticated WebSocket endpoints
- Direct mode and Stealth mode (`Tor` via SOCKS5 proxy)
- Tor sidecar (`peterdavehello/tor-socks-proxy`)
- Shared `unified_browser` tool with evidence-driven result validation
- Fail-closed stealth mode when Tor is unavailable
- Live browser user takeover / resume flow
- SSRF protections and binary download blocking

## 1. Stealth / Tor Hardening

### Circuit and identity management
- [ ] Add explicit Tor circuit rotation controls for stealth sessions
- [ ] Support per-session `NEWNYM` / identity refresh before sensitive browsing phases
- [ ] Add cooldown and backoff rules around identity rotation to avoid thrashing Tor
- [ ] Surface “identity age” and last rotation time in the Network Hub
- [ ] Detect when multiple stealth sessions accidentally share a long-lived browser identity

### Proxy integrity and leak prevention
- [x] Add explicit DNS leak verification for stealth sessions
- [x] Verify WebRTC, UDP, and proxy bypass paths are disabled at runtime, not just by config intent
- [x] Add a preflight that confirms outbound IP, DNS resolver behavior, and Tor exit alignment before first stealth navigation
- [ ] Add `.onion` resolution checks that fail early with precise diagnostics
- [ ] Add guardrails that block direct-mode fallback anywhere inside stealth execution paths

### Fingerprint hardening
- [ ] Replace the tiny static stealth UA pool with broader, versioned desktop fingerprints
- [ ] Randomize additional fingerprint surfaces per session: language, timezone strategy, platform hints, hardware concurrency, device memory, viewport presets
- [ ] Normalize stealth/browser feature exposure to reduce obviously automated combinations
- [ ] Add bot-fingerprint regression checks against known detection pages
- [ ] Separate “normal stealth” and “high-stealth” profiles with different tradeoffs

### Search and entry-point resiliency
- [ ] Add multiple stealth-safe search providers instead of relying mainly on Ahmia
- [ ] Detect search-engine degradation and rotate to alternative providers automatically
- [ ] Add provider scoring based on uptime, latency, anti-bot frequency, and result usefulness
- [ ] Keep a curated set of known-good `.onion` entry points and mirrors where appropriate

## 2. Browser Reliability and Session Robustness

### Session lifecycle
- [ ] Add explicit max-concurrency controls for live UWAF sessions
- [ ] Add session admission control when CPU/RAM/display slots are exhausted
- [ ] Add more aggressive cleanup for orphaned `Xvfb`, `x11vnc`, and Chromium child processes
- [ ] Track session startup failures by stage: display allocation, VNC bind, Chromium launch, first page open
- [ ] Add “session recovery” paths that preserve user-visible context after a browser crash where possible

### Navigation and automation robustness
- [ ] Add retry policies per action type (`open`, `search`, `click`, `submit`) with semantic safeguards
- [ ] Add better popup/download/interstitial handling so sessions do not silently stall
- [ ] Detect blank pages, broken renderer states, and modal dead-ends earlier
- [ ] Snapshot stronger page-state evidence before/after actions to prove whether the action actually changed the page
- [ ] Improve handling for pages that mutate heavily after hydration or infinite-scroll content

### Resource controls
- [ ] Add memory/CPU budgeting per browser session and surface warnings in the UI
- [ ] Add browser pool pressure metrics and eviction logic based on resource use, not just TTL
- [ ] Add adaptive page-loading strategies for constrained GPUs/CPUs
- [ ] Limit pathological pages that open too many tabs, workers, or network requests

## 3. Live Browser / noVNC Transport

### Transport resilience
- [ ] Add reconnect/resume semantics for transient VNC websocket failures
- [ ] Distinguish auth/setup failures from VNC bridge transport failures in the control channel
- [ ] Add heartbeat and latency telemetry for control and VNC sockets
- [ ] Add stale-session detection when the control socket is alive but Chromium/VNC is dead
- [ ] Reduce race conditions between AI actions and user takeover/resume transitions

### User takeover experience
- [ ] Show stronger user-facing state for `AI active`, `user active`, `auto-resume pending`, and `browser unhealthy`
- [ ] Add explicit “pause AI but keep observing” vs “full user takeover” modes
- [ ] Add safer handling for CAPTCHA/login/MFA flows so resumed automation re-reads the latest page before acting
- [ ] Add user action audit markers so the model can tell what changed during takeover

### Rendering quality and efficiency
- [ ] Tune VNC compression/quality settings for lower bandwidth and lower latency
- [ ] Add adaptive quality based on connection health and viewport size
- [ ] Consider a more efficient remote-display path if VNC becomes the limiting factor under load

## 4. Observability, Auditing, and Diagnostics

### Structured telemetry
- [x] Add structured logs for each browser action with session id, mode, target, timing, and semantic result
- [x] Track Tor-specific diagnostics separately from generic browser failures
- [x] Add counters for anti-bot hits, login walls, search failures, proxy failures, and session crashes
- [ ] Track median launch time, page-open time, search success rate, and takeover frequency

### Debuggability
- [ ] Add a server-side “browser trace bundle” option for failed sessions: logs, recent URLs, page title timeline, JS errors, network errors
- [ ] Add a lightweight admin diagnostics panel for current UWAF/Tor/live-browser health
- [ ] Expose direct explanations for common failure classes in the UI instead of generic browser errors
- [ ] Add a dry-run / smoke-test route that validates the full stealth stack end-to-end

## 5. Safety and Isolation

### Session isolation
- [ ] Ensure direct and stealth sessions never reuse the same browser context or storage state
- [ ] Add stronger storage/cookie/cache isolation across sessions and modes
- [ ] Add policy controls for clipboard, downloads, and external protocol handlers
- [ ] Add outbound allow/deny policy hooks for domains, schemes, and file types

### Write / submission controls
- [ ] Expand approval policy granularity for browser actions beyond submit/research batch
- [ ] Add higher-friction approval for account creation, purchases, destructive form actions, and uploads
- [ ] Add stronger request summaries before approval for multi-step browser actions

## 6. Search and Research Quality

### Better source gathering
- [ ] Add query reformulation loops for stealth research, not just direct-mode search heuristics
- [ ] Add breadth/depth strategies per task type: fact lookup vs marketplace scan vs forum research
- [ ] Add duplicate-result collapsing and canonicalization across search engines and mirrors
- [ ] Improve extraction on hostile/noisy pages with stronger fallback heuristics

### Evidence and citations
- [ ] Distinguish live-observed facts from model background knowledge more explicitly in tool results
- [ ] Preserve more provenance metadata: fetch path, redirect chain, tab index, and observation timestamp
- [ ] Add stronger confidence labeling when stealth results are thin or unstable

## 7. Testing and Failure Injection

### Automated tests
- [ ] Add integration tests for direct mode, stealth mode, `.onion` blocking in direct mode, and fail-closed Tor behavior
- [ ] Add tests for approval-gated flows, takeover/resume, and multi-tab operations
- [ ] Add regression tests for anti-bot/login detection heuristics
- [ ] Add tests for browser session cleanup and process reaping

### Chaos / failure injection
- [ ] Simulate Tor proxy outages, slow exits, DNS failures, and mid-session disconnects
- [ ] Simulate Chromium crashes and VNC bridge failures during active sessions
- [ ] Simulate high-latency / low-bandwidth live-browser conditions

## 8. Infrastructure / Deployment

### Container and runtime
- [ ] Revisit `network_mode: host` and document whether a more isolated deployment shape is viable without breaking Ollama/Tor access
- [ ] Add explicit healthchecks for the app, Tor proxy, and live-browser bridge ports
- [ ] Add restart policy and readiness semantics around Tor dependency timing
- [ ] Document production sizing guidance for concurrent live browser sessions
- [ ] Document reverse-proxy websocket requirements for both control and VNC paths

### Secrets and configuration
- [ ] Add validation for all UWAF/Tor/live-browser env vars at startup
- [ ] Add explicit config docs for stealth-safe defaults and high-capacity deployments

## Suggested Priority Order

### Phase A — Reliability First
1. Structured action/session telemetry
2. Stealth preflight validation and leak checks
3. Session cleanup / crash recovery
4. Live browser reconnect and stale-session detection

### Phase B — Stealth Hardening
5. Tor circuit rotation / identity controls
6. Better fingerprint diversification
7. Multi-provider stealth search fallback

### Phase C — Scale and Quality
8. Resource budgeting and concurrency controls
9. Better research/query strategies
10. Admin diagnostics and trace bundles

### Phase D — Proof
11. Integration tests
12. Failure injection / chaos testing
