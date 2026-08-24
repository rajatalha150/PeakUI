import { describe, expect, it } from 'vitest'
import { extractWorkspaceToolRequest, stripAllToolTags } from './workspace-tool-tools'

/**
 * Foreign model-native tool-call formats. Local GGUF models (Qwen, Gemma,
 * Llama, Mistral, GLM, Anthropic-style) often emit their own native syntax
 * instead of the custom <workspace_tool> wrapper. The parser must normalize
 * them to the same request shape so the per-tool validation runs unchanged.
 */

describe('extractWorkspaceToolRequest — foreign tool-call formats', () => {
  it('parses Qwen/Hermes <tool_call>{"name","arguments"}', () => {
    const input = '<tool_call>{"name":"web","arguments":{"query":"palantir stock"}}</tool_call>'
    const { request } = extractWorkspaceToolRequest(input)
    expect(request?.name).toBe('web')
    if (request?.name !== 'web') throw new Error('expected web')
    expect(request.request.query).toBe('palantir stock')
  })

  it('tolerates a missing </tool_call> close tag (truncated mid-stream)', () => {
    const input = '<tool_call>{"name":"web","arguments":{"query":"palantir stock"}}'
    const { request } = extractWorkspaceToolRequest(input)
    expect(request?.name).toBe('web')
    if (request?.name !== 'web') throw new Error('expected web')
    expect(request.request.query).toBe('palantir stock')
  })

  it('parses Anthropic <invoke name><parameter>', () => {
    const input = '<invoke name="web"><parameter name="query">palantir stock</parameter></invoke>'
    const { request } = extractWorkspaceToolRequest(input)
    expect(request?.name).toBe('web')
    if (request?.name !== 'web') throw new Error('expected web')
    expect(request.request.query).toBe('palantir stock')
  })

  it('parses Anthropic <invoke> nested inside <function_calls>', () => {
    const input = '<function_calls><invoke name="shell"><parameter name="command">pwd</parameter></invoke></function_calls>'
    const { request } = extractWorkspaceToolRequest(input)
    expect(request?.name).toBe('shell')
    if (request?.name !== 'shell') throw new Error('expected shell')
    expect(request.request.command).toBe('pwd')
  })

  it('parses Llama-3 <|python_tag|>NAME.call(k=v)', () => {
    const input = '<|python_tag|>web.call(query="palantir stock")'
    const { request } = extractWorkspaceToolRequest(input)
    expect(request?.name).toBe('web')
    if (request?.name !== 'web') throw new Error('expected web')
    expect(request.request.query).toBe('palantir stock')
  })

  it('parses Llama-3 .call with a numeric kwarg', () => {
    const input = '<|python_tag|>filesystem.call(action="read", path="/tmp/x", depth=2)'
    const { request } = extractWorkspaceToolRequest(input)
    expect(request?.name).toBe('filesystem')
    if (request?.name !== 'filesystem') throw new Error('expected filesystem')
    expect(request.request.action).toBe('read')
    expect(request.request.path).toBe('/tmp/x')
  })

  it('parses Mistral [TOOL_CALLS] [{"name","arguments"}]', () => {
    const input = '[TOOL_CALLS] [{"name":"web","arguments":{"query":"palantir stock"}}]'
    const { request } = extractWorkspaceToolRequest(input)
    expect(request?.name).toBe('web')
    if (request?.name !== 'web') throw new Error('expected web')
    expect(request.request.query).toBe('palantir stock')
  })

  it('parses Gemma 4 <|tool_call>call:NAME{json}', () => {
    const input = '<|tool_call>call:web{"query":"palantir stock"}<tool_call|>'
    const { request } = extractWorkspaceToolRequest(input)
    expect(request?.name).toBe('web')
    if (request?.name !== 'web') throw new Error('expected web')
    expect(request.request.query).toBe('palantir stock')
  })

  it('parses GLM <tool_call>NAME<arg_key>/<arg_value>', () => {
    const input = '<tool_call>web\n<arg_key>query</arg_key>\n<arg_value>palantir stock</arg_value></tool_call>'
    const { request } = extractWorkspaceToolRequest(input)
    expect(request?.name).toBe('web')
    if (request?.name !== 'web') throw new Error('expected web')
    expect(request.request.query).toBe('palantir stock')
  })

  it('parses Qwen3.5 XML <function=name><parameter=k>v</parameter>', () => {
    const input = '<function=web><parameter=query>palantir stock</parameter></function>'
    const { request } = extractWorkspaceToolRequest(input)
    expect(request?.name).toBe('web')
    if (request?.name !== 'web') throw new Error('expected web')
    expect(request.request.query).toBe('palantir stock')
  })

  it('parses Qwen3.5 XML attribute form <function name="web">', () => {
    const input = '<function name="shell"><parameter name="command">pwd</parameter></function>'
    const { request } = extractWorkspaceToolRequest(input)
    expect(request?.name).toBe('shell')
    if (request?.name !== 'shell') throw new Error('expected shell')
    expect(request.request.command).toBe('pwd')
  })

  it('parses Mistral v11+ named [TOOL_CALLS]name{json}', () => {
    const input = '[TOOL_CALLS]web{"query":"palantir stock"}'
    const { request } = extractWorkspaceToolRequest(input)
    expect(request?.name).toBe('web')
    if (request?.name !== 'web') throw new Error('expected web')
    expect(request.request.query).toBe('palantir stock')
  })

  it('parses Mistral [TOOL_CALLS]name[ARGS]{json}', () => {
    const input = '[TOOL_CALLS]web[ARGS]{"query":"palantir stock"}'
    const { request } = extractWorkspaceToolRequest(input)
    expect(request?.name).toBe('web')
    if (request?.name !== 'web') throw new Error('expected web')
    expect(request.request.query).toBe('palantir stock')
  })

  it('rejects a foreign call with an unknown tool name', () => {
    const input = '<tool_call>{"name":"not_a_real_tool","arguments":{"x":1}}</tool_call>'
    const { request } = extractWorkspaceToolRequest(input)
    expect(request).toBeUndefined()
  })

  it('rejects a foreign call whose args fail per-tool validation', () => {
    // web requires a non-empty query; an empty one must not dispatch.
    const input = '<tool_call>{"name":"web","arguments":{"query":""}}</tool_call>'
    const { request } = extractWorkspaceToolRequest(input)
    expect(request).toBeUndefined()
  })

  it('still prefers the native <workspace_tool> wrapper when both are present', () => {
    const input = '<workspace_tool name="web">{"query":"native wins"}</workspace_tool>'
    const { request } = extractWorkspaceToolRequest(input)
    expect(request?.name).toBe('web')
    if (request?.name !== 'web') throw new Error('expected web')
    expect(request.request.query).toBe('native wins')
  })
})

describe('stripAllToolTags — foreign tool-call formats', () => {
  it('strips a Qwen <tool_call> block from visible text', () => {
    const input = 'Before\n<tool_call>{"name":"web","arguments":{"query":"x"}}</tool_call>\nAfter'
    const cleaned = stripAllToolTags(input)
    expect(cleaned).not.toContain('<tool_call>')
    expect(cleaned).toContain('Before')
    expect(cleaned).toContain('After')
  })

  it('strips a Gemma <|tool_call> block', () => {
    const input = 'Before\n<|tool_call>call:web{"query":"x"}<tool_call|>\nAfter'
    const cleaned = stripAllToolTags(input)
    expect(cleaned).not.toContain('<|tool_call>')
    expect(cleaned).toContain('Before')
    expect(cleaned).toContain('After')
  })

  it('strips a Llama-3 <|python_tag|> call', () => {
    const input = 'Before\n<|python_tag|>web.call(query="x")\nAfter'
    const cleaned = stripAllToolTags(input)
    expect(cleaned).not.toContain('<|python_tag|>')
    expect(cleaned).toContain('Before')
    expect(cleaned).toContain('After')
  })

  it('strips a Mistral [TOOL_CALLS] block', () => {
    const input = 'Before\n[TOOL_CALLS] [{"name":"web","arguments":{"query":"x"}}]\nAfter'
    const cleaned = stripAllToolTags(input)
    expect(cleaned).not.toContain('[TOOL_CALLS]')
    expect(cleaned).toContain('Before')
    expect(cleaned).toContain('After')
  })
})
