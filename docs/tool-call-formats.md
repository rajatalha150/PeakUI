# Tool-Call Formats

PeakUI's tool-call parser (`src/lib/workspace-tool-tools.ts`) accepts the
custom `<workspace_tool>` wrapper **and** the native tool-call syntax of the
most common local model families. This matters because local GGUF models
(Qwen, Gemma, Llama, Mistral, GLM, and Anthropic-style) often emit their own
native format instead of the custom wrapper — and the old parser rejected all
of them, which was the single biggest source of tool-call failures on local
models.

Every format below is normalized to the same internal request shape, so the
per-tool payload validation runs identically regardless of which syntax the
model emitted. Missing closing tags and brackets are tolerated: models
truncate mid-stream, and a half-emitted call still parses.

## The canonical wrapper

The custom wrapper is always accepted and is what the system prompt teaches:

```xml
<workspace_tool name="web">{"query":"palantir stock"}</workspace_tool>
```

## Model-native formats

| Format | Syntax | Model family |
|---|---|---|
| Qwen / Hermes | `<tool_call>{"name":"web","arguments":{"query":"x"}}</tool_call>` | Qwen, Hermes |
| Anthropic | `<invoke name="web"><parameter name="query">x</parameter></invoke>` | Anthropic SDK (also nested in `<function_calls>`) |
| Llama-3 | `<\|python_tag\|>web.call(query="x")` | Llama-3 built-in tools |
| Mistral array | `[TOOL_CALLS] [{"name":"web","arguments":{"query":"x"}}]` | Mistral v0.3 / Nemo / Small |
| Mistral named | `[TOOL_CALLS]web{"query":"x"}` | Mistral v11+ / Magistral |
| Mistral ARGS | `[TOOL_CALLS]web[ARGS]{"query":"x"}` | Ministral / Mistral Large 3 |
| Gemma 4 | `<\|tool_call>call:web{"query":"x"}<tool_call\|>` | Gemma 4 |
| GLM 4.5-4.7 | `<tool_call>web\n<arg_key>query</arg_key>\n<arg_value>x</arg_value></tool_call>` | GLM |
| Qwen3.5 XML | `<function=web><parameter=query>x</parameter></function>` | Qwen3.5 |
| Qwen3.5 XML (attr) | `<function name="web"><parameter name="query">x</parameter></function>` | Qwen3.5 / MiniCPM-5 / MiniMax-M2 |

## How it works

1. `findToolBlock` first looks for the canonical `<workspace_tool>` wrapper and
   the legacy `<unified_browser>` tag.
2. If neither is present, `findForeignToolBlock` scans for each model-native
   format in turn and normalizes the first match to
   `{ toolName, rawBlock, rawJson }`.
3. The tool name is validated against `WORKSPACE_TOOL_NAMES` — an unknown name
   is rejected, so prose that merely *mentions* a tool-call syntax is never
   promoted to a real call.
4. The normalized JSON runs through the same per-tool validation as a native
   wrapper (required fields, action enums, template values, placeholder
   rejection), so a foreign call with invalid arguments is dropped exactly like
   a malformed native one.

## Visible-text hygiene

`stripAllToolTags` strips every format above from the user-visible transcript,
so raw tool-call markup never leaks into the chat. This includes the closing
tokens (`</tool_call>`, `<tool_call|>`, `</function>`, `[ARGS]`, etc.) that
would otherwise appear as stray text.

## Adding a new format

Add a branch to `findForeignToolBlock` in `src/lib/workspace-tool-tools.ts`
that returns `{ toolName, rawBlock, rawJson }`, and add the matching strip
regex to `stripAllToolTags`. Add a test in
`src/lib/workspace-tool-foreign-formats.test.ts` covering the parse, the
truncation tolerance, and the visible-text strip.

## Related

- [Tool Workflows](tool-workflows.md) — per-tool payload contracts and examples.
- [Capability Inventory](capability-inventory.md) — the tool list and dispatch.
