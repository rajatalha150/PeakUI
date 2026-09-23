# Session intelligence maintenance notes

## Boundaries

- `tool-registry.ts` defines tool names, labels and recognized result prefixes for storage, analytics and compaction. Tool-specific execution and validation remain in their existing handlers.
- `conversation-turns.ts` counts visible user turns, excluding hidden tool output and recovery nudges.
- `context-engine.ts` calculates an **effective input budget**, reserving room for a response, tool schemas/images, and accounting variance before declaring pressure. It prepares at 60%, compacts at 72%, rebuilds at 80%, and treats 90% of usable input as an emergency guard. These percentages are intentionally not percentages of a provider's advertised window.
- `message-trim.ts` preserves the active request and accepts an effective input budget from the context engine. Its 80% reserve remains the conservative fallback for surfaces that do not yet use model-aware budgeting. The final provider request is checked after RAG; Ollama retries are checked against each smaller context. Token counts are estimates, not model-specific tokenizer guarantees.
- `session-intelligence.ts` builds structured working memory with a 3,200-character cap. The legacy `summaryTargetTokens` setting remains an early input-token trigger, while model-aware pressure and old turns now also trigger summarization.
- `ContextEvent`, `ContextEpisode`, and `ContextSnapshot` form the Postgres context ledger. Events are hash-versioned rather than rewritten during streaming, episodes cite source ordinal ranges, and snapshots are versioned checkpoints. `ChatSession.messages` remains intact for backwards compatibility.
- `context-ledger.ts` appends events after every session save and retrieves relevant completed episodes only once a request reaches prepare pressure. Retrieval is source-linked and has a lexical fallback for installations without pgvector; future pgvector retrieval must preserve the same source-range contract.
- `memory.ts` scopes persisted memory by user. `atomic-file.ts` serializes cooperating writers across processes and atomically replaces complete files. All future memory read-modify-write paths must use the same lock helper.
- The summary endpoint generates from the stored transcript, then conditionally updates the database against the original transcript, title and summary. Publication is serialized per user. Database and filesystem writes are not one distributed transaction: a disk error can leave the database updated while a memory file remains older; retry summary generation after resolving the disk failure.
- Workspace rendering is separated from controller state, agent-loop execution, tool execution and shared helpers under `src/app/components/workspace/`. The view's props derive from the controller return type to prevent duplicated interface drift.

## Verification

Run `npm test`, `npx tsc --noEmit`, and `npm run build`. Persistence tests use temporary directories and include concurrent daily writes, summary replacement without collateral deletion, and user isolation. Context tests cover pressure thresholds, hidden tool chains, source ranges, system overhead and impossible budgets.

## Web gateway rollout

PeakUI ships a loopback-only SearXNG instance with Compose as its no-key search
baseline. `SEARXNG_URL` defaults to that private service on Linux/macOS and to
the Compose service on Windows. Brave and Google keys are optional, parallel
search providers; when two providers are available, results are deduplicated
and interleaved so one index cannot monopolize the evidence set. Do not expose
the bundled SearXNG port publicly without adding a reverse proxy and rate limit.

For larger deployments, `BROWSER_CDP_URL` may point to a managed Chrome CDP
service. It is an optional operator credential, never a user requirement; when
unset, rendered-page fetching uses the bundled UWAF Chromium pool and then an
isolated local fallback. Treat the endpoint as a secret because it can embed a
provider token.

## Deferred after scope was closed

Further split the large workspace controller/view into feature-specific components, replace repetitive tool-dispatch branches with typed handlers, and add browser-level lifecycle tests. This change is a session-intelligence hardening pass, not a complete security or dependency audit of the application.
