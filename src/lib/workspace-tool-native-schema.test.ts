import { describe, expect, it } from 'vitest'
import { buildNativeToolsArray, parseNativeToolCalls } from './workspace-tool-native-schema'

describe('buildNativeToolsArray', () => {
  it('builds schemas for the enabled tool set in stable order', () => {
    const tools = buildNativeToolsArray(['shell', 'web', 'image_generation'])
    expect(tools).toHaveLength(3)
    expect(tools[0]).toMatchObject({ type: 'function', function: { name: 'shell' } })
    expect(tools[1]).toMatchObject({ type: 'function', function: { name: 'web' } })
    expect(tools[2]).toMatchObject({ type: 'function', function: { name: 'image_generation' } })
  })

  it('marks the genuinely required fields as required', () => {
    const tools = buildNativeToolsArray(['shell', 'filesystem', 'web', 'code', 'image_generation'])
    const byName = new Map(tools.map(t => [(t as { function: { name: string } }).function.name, t]))
    expect((byName.get('shell') as { function: { parameters: { required: string[] } } }).function.parameters.required).toEqual(['command'])
    expect((byName.get('filesystem') as { function: { parameters: { required: string[] } } }).function.parameters.required).toEqual(['action', 'path'])
    expect((byName.get('web') as { function: { parameters: { required: string[] } } }).function.parameters.required).toEqual(['query'])
    expect((byName.get('code') as { function: { parameters: { required: string[] } } }).function.parameters.required).toEqual(['runtime', 'code'])
    expect((byName.get('image_generation') as { function: { parameters: { required: string[] } } }).function.parameters.required).toEqual(['prompt'])
  })

  it('includes enum constraints for action-typed tools', () => {
    const tools = buildNativeToolsArray(['filesystem'])
    const props = (tools[0] as { function: { parameters: { properties: Record<string, { enum?: string[] }> } } }).function.parameters.properties
    expect(props.action.enum).toContain('list')
    expect(props.action.enum).toContain('write')
  })

  it('skips unknown tool names gracefully', () => {
    // @ts-expect-error - deliberately passing an invalid name
    const tools = buildNativeToolsArray(['not_a_real_tool', 'shell'])
    expect(tools).toHaveLength(1)
    expect((tools[0] as { function: { name: string } }).function.name).toBe('shell')
  })

  it('every registered tool has a schema with a description', () => {
    const all = buildNativeToolsArray([
      'shell', 'filesystem', 'web', 'code', 'browser', 'unified_browser', 'tax_return',
      'pdf_document', 'workbook_document', 'word_document', 'csv_document', 'email_document',
      'markdown_document', 'slides_document', 'archive_document', 'calendar_document',
      'mermaid_document', 'fetch_summarize', 'image_generation',
      'notes_search', 'notes_save', 'http_request',
    ])
    expect(all).toHaveLength(22)
    for (const tool of all) {
      const fn = (tool as { function: { name: string; description: string; parameters: Record<string, unknown> } }).function
      expect(fn.name).toBeTruthy()
      expect(fn.description.length).toBeGreaterThan(20)
      expect(fn.parameters.type).toBe('object')
    }
  })
})

describe('parseNativeToolCalls', () => {
  it('parses object-argument tool calls from an Ollama frame', () => {
    const frame = {
      message: {
        tool_calls: [
          { function: { name: 'web', arguments: { query: 'palantir q2 2026 earnings' } } },
        ],
      },
    }
    const calls = parseNativeToolCalls(frame)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('web')
    expect(calls[0].args).toEqual({ query: 'palantir q2 2026 earnings' })
  })

  it('parses string-serialized arguments', () => {
    const frame = {
      message: {
        tool_calls: [
          { function: { name: 'shell', arguments: JSON.stringify({ command: 'ls -la' }) } },
        ],
      },
    }
    expect(parseNativeToolCalls(frame)).toEqual([{ name: 'shell', args: { command: 'ls -la' } }])
  })

  it('returns empty for frames without tool calls', () => {
    expect(parseNativeToolCalls({ message: { content: 'hello' } })).toEqual([])
    expect(parseNativeToolCalls({})).toEqual([])
    expect(parseNativeToolCalls(null)).toEqual([])
  })

  it('tolerates malformed argument JSON without throwing', () => {
    const frame = {
      message: {
        tool_calls: [
          { function: { name: 'web', arguments: '{not json' } },
        ],
      },
    }
    const calls = parseNativeToolCalls(frame)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('web')
    expect(calls[0].args).toEqual({})
  })
})