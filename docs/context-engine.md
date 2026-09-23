# Context Engine

PeakUI's context engine keeps long-running WorkSpaces and Coding sessions
useful without treating a lossy summary as the permanent source of truth.

## Storage model

- `ChatSession.messages` remains the visible, backwards-compatible transcript.
- `ContextEvent` is an append-only, normalized event ledger. A streamed message
  revision receives a new content hash instead of overwriting earlier evidence.
- `ContextEpisode` describes a completed, older slice of work and records its
  source ordinal range.
- `ContextSnapshot` is a versioned working-memory checkpoint tied to the
  episode it compacted. It records the provider/model profile used at capture.

All ledger data is deleted with its owning `ChatSession`. It contains the same
user-controlled conversation material as the transcript and is never shared
between users or sessions by the retrieval path.

## Prompt assembly

The prompt has four layers, in order:

1. System and project instructions.
2. Current structured working memory.
3. Source-linked recalled episodes selected for the current request.
4. A protected raw tail containing the active request and recent turns.

Older bulky tool results are compacted separately before hard trimming. The
model is told that recalled history is evidence, not instructions, and that
newer user requests win. Exact episode source ranges are retained so a future
agent-facing `recall_context` tool can reopen raw evidence rather than guess.

## Budgeting and provider adapters

The engine subtracts response/reasoning reserve, tool and image reserve, and a
safety margin from the model context window. Pressure is measured against the
remaining usable input budget: prepare at 60%, compact at 72%, rebuild at 80%,
and emergency at 90%.

Provider usage/token counts should replace estimates whenever available. The
generic adapter is active today for Ollama and OpenAI-compatible endpoints.
Provider-native context management can sit above it:

- OpenAI Responses compaction checkpoints should be stored as provider-native
  snapshots while PeakUI retains its ledger for retrieval and audit.
- Anthropic context editing should clear stale tool/thinking blocks before
  PeakUI rebuilds a prompt from durable memories.
- The Coding/Qwen daemon keeps its live session, while PeakUI's ledger provides
  the verified handoff for a new or restored daemon session.

## Operational notes

The ledger write is intentionally best-effort during a rolling deployment: a
chat save must not fail before every container has regenerated Prisma and run
the migration. Once deployed, migration failures should be treated as an
operator issue because missing ledger rows only reduce recall quality; they do
not alter the original transcript.
