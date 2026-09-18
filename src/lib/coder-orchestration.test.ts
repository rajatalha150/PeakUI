import { describe, expect, it } from 'vitest'
import {
  buildWriterSubagentCreateBody,
  buildWriterSubagentUpdateBody,
  CODER_WRITER_AGENT_NAME,
  CODER_WRITER_AGENT_SCOPE,
  CODER_WRITER_TOOLS,
  toDaemonModelSelector,
} from './coder-orchestration'

describe('toDaemonModelSelector', () => {
  it('qualifies a bare model id with the openai auth type', () => {
    expect(toDaemonModelSelector('deepseek-v4.1-flash:cloud')).toBe('openai:deepseek-v4.1-flash:cloud')
  })

  it('passes through an explicit authType:model-id selector', () => {
    expect(toDaemonModelSelector('anthropic:claude-3-5')).toBe('anthropic:claude-3-5')
  })

  it('returns empty for a blank id', () => {
    expect(toDaemonModelSelector('')).toBe('')
    expect(toDaemonModelSelector('   ')).toBe('')
  })
})

describe('buildWriterSubagentCreateBody', () => {
  it('pins the writer to the chosen model and restricts its tools', () => {
    const body = buildWriterSubagentCreateBody('deepseek-v4-pro:0813-cloud')
    expect(body.name).toBe(CODER_WRITER_AGENT_NAME)
    expect(body.scope).toBe('global')
    expect(body.model).toBe('openai:deepseek-v4-pro:0813-cloud')
    expect(body.tools).toEqual([...CODER_WRITER_TOOLS])
    // It must be a WRITE-capable, not read-only/browse-capable, toolset.
    expect(body.tools).toContain('WriteFile')
    expect(body.tools).toContain('Edit')
    expect(body.tools).not.toContain('WebFetch')
    expect(body.tools).not.toContain('WebSearch')
    expect(body.systemPrompt).toMatch(/write or edit/i)
  })

  it('always uses the same fixed agent name so create/update/delete agree', () => {
    expect(buildWriterSubagentCreateBody('m1').name).toBe(CODER_WRITER_AGENT_NAME)
    expect(buildWriterSubagentCreateBody('m2').name).toBe(CODER_WRITER_AGENT_NAME)
  })
})

describe('buildWriterSubagentUpdateBody', () => {
  it('mirrors the create body fields minus name/scope (update route shape)', () => {
    const create = buildWriterSubagentCreateBody('muse-glimmer:latest')
    const update = buildWriterSubagentUpdateBody('muse-glimmer:latest')
    expect(update.model).toBe(create.model)
    expect(update.tools).toEqual(create.tools)
    expect(update.description).toBe(create.description)
    expect(update.systemPrompt).toBe(create.systemPrompt)
    // The update route identifies the agent by URL path + scope query, not body.
    expect(update).not.toHaveProperty('name')
    expect(update).not.toHaveProperty('scope')
  })
})

describe('writer agent identity', () => {
  it('uses the global scope for a user-level (not project-level) agent', () => {
    expect(CODER_WRITER_AGENT_SCOPE).toBe('global')
  })
})
