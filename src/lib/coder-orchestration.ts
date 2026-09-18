/**
 * Multi-model orchestration for the Coding surface.
 *
 * The daemon (Qwen Code) natively supports the three roles the UI exposes:
 *
 *  - **Main** (`coderModel`)        — planner/executor, the session's own model.
 *  - **Vision** (`coderVisionModel`) — the daemon's *vision bridge*: when a
 *    text-only main model receives an image, the daemon transcribes it through
 *    this model and feeds the text back to the main model. Applied via the
 *    daemon's `visionModel` setting (`POST /workspace/settings`, user scope,
 *    `requiresRestart: false`).
 *  - **Writer** (`coderWriterModel`) — a dedicated subagent pinned to a
 *    different model, materialized at `~/.qwen/agents/` (global/user scope) via
 *    the daemon's agent routes. The main model delegates code/file writing to
 *    it (the `agent` tool with `subagent_type: "peakui-writer"`) and reviews
 *    the result.
 *
 * This module owns the *shapes* of those daemon calls — the subagent frontmatter
 * config and the `authType:model-id` selector syntax — so the UI never hand-rolls
 * YAML or guesses the wire format.
 */

/** Fixed name of the writer subagent, shared by materialize + delete. */
export const CODER_WRITER_AGENT_NAME = 'peakui-writer'

/** The writer subagent's tool allowlist: read + write + edit + search + shell. */
export const CODER_WRITER_TOOLS = [
  'ReadFile',
  'ReadManyFiles',
  'WriteFile',
  'Edit',
  'Glob',
  'Grep',
  'ListFiles',
  'Shell',
] as const

/**
 * Auth types the daemon recognizes (AuthType enum). A selector's `authType:`
 * prefix is only meaningful when it is one of these — Ollama model names also
 * contain colons (`name:tag`), so a naive `includes(':')` check would misread a
 * tag as an auth type.
 */
const DAEMON_AUTH_TYPES = new Set([
  'openai',
  'openai-responses',
  'qwen-oauth',
  'gemini',
  'vertex-ai',
  'anthropic',
])

/**
 * The daemon's model-selector syntax is `authType:model-id` (subagent frontmatter
 * and `/model --vision`), distinct from the ACP `model-id(authType)` suffix the
 * session model route uses. Ollama is reached via the `openai` auth type.
 *
 * A selector whose prefix (before the first colon) is a known auth type is
 * passed through verbatim; otherwise the bare id is qualified with `openai:`.
 * (Ollama `name:tag` ids such as `deepseek-v4.1-flash:cloud` are correctly
 * treated as bare ids, since `deepseek-v4.1-flash` is not an auth type.)
 */
export function toDaemonModelSelector(modelId: string): string {
  const trimmed = modelId.trim()
  if (!trimmed) return ''
  const colon = trimmed.indexOf(':')
  if (colon > 0 && DAEMON_AUTH_TYPES.has(trimmed.slice(0, colon))) {
    return trimmed
  }
  return `openai:${trimmed}`
}

/** Body for `POST /workspace/agents` that creates the writer subagent. */
export function buildWriterSubagentCreateBody(modelId: string): {
  name: string
  description: string
  systemPrompt: string
  model: string
  tools: string[]
  scope: 'global'
  color: string
} {
  return {
    name: CODER_WRITER_AGENT_NAME,
    description:
      'Writes code and files exactly as instructed by the main agent, then reports the files written and their paths.',
    systemPrompt:
      'You are the writing specialist. Write or edit code and files exactly as the main agent instructs: the files to create or modify, their paths, and the content. Make the requested changes precisely; do not plan, do not run the app, and do not browse. When done, report each file you wrote or changed and its absolute path so the main agent can review your work.',
    model: toDaemonModelSelector(modelId),
    tools: [...CODER_WRITER_TOOLS],
    scope: 'global',
    color: 'blue',
  }
}

/** Body for `POST /workspace/agents/:name?scope=global` that updates the writer. */
export function buildWriterSubagentUpdateBody(modelId: string): {
  description: string
  systemPrompt: string
  model: string
  tools: string[]
} {
  const create = buildWriterSubagentCreateBody(modelId)
  return {
    description: create.description,
    systemPrompt: create.systemPrompt,
    model: create.model,
    tools: create.tools,
  }
}

/** The `scope` query value for the global (user-level) writer subagent. */
export const CODER_WRITER_AGENT_SCOPE = 'global'
