import { describe, expect, it } from 'vitest'
import { buildOpenClawSystemPrompt } from './openclaw-prompt'

const baseContext = {
  provider: 'ollama' as const,
  model: 'gemma4:latest',
  internetToolEnabled: false,
  shellEnabled: true,
  shellTarget: 'container' as const,
  filesystemEnabled: true,
  allowedFilesystemPaths: ['/tmp'],
  filesystemWriteEnabled: true,
  writableFilesystemPaths: ['/tmp'],
  codeExecutionEnabled: true,
  browserMode: 'deny' as const,
  uwafBrowserMode: 'deny' as const,
  workspace: {
    name: 'default',
    relativePath: 'users/u1/workspaces/default',
    hostPath: '/tmp/peakui-openclaw-workspace/users/u1/workspaces/default',
    bootInstructions: '',
    toolsInstructions: '',
    skillTemplates: [],
  },
}

describe('buildOpenClawSystemPrompt', () => {
  it('keeps full tool instructions by default', () => {
    const prompt = buildOpenClawSystemPrompt(baseContext)
    expect(prompt).toContain('SHELL EXECUTION CAPABILITY')
    expect(prompt).toContain('FILESYSTEM CAPABILITY')
    expect(prompt).toContain('Use this exact format')
  })

  it('uses compact notes in compact mode for idle queries', () => {
    const prompt = buildOpenClawSystemPrompt({
      ...baseContext,
      latestUserQuery: 'hello',
      toolManifestMode: 'compact',
    })
    expect(prompt).toContain('SHELL EXECUTION: available')
    expect(prompt).toContain('FILESYSTEM: available')
    expect(prompt).not.toContain('SHELL EXECUTION CAPABILITY')
    expect(prompt).not.toContain('FILESYSTEM CAPABILITY')
    expect(prompt).not.toContain('PDF DOCUMENT CAPABILITY')
  })

  it('expands full instructions in compact mode when the query signals shell intent', () => {
    const prompt = buildOpenClawSystemPrompt({
      ...baseContext,
      latestUserQuery: 'run git status',
      toolManifestMode: 'compact',
    })
    expect(prompt).toContain('SHELL EXECUTION CAPABILITY')
    expect(prompt).toContain('Use this exact format')
  })

  it('includes document capability examples when the query signals document intent', () => {
    const prompt = buildOpenClawSystemPrompt({
      ...baseContext,
      latestUserQuery: 'create a pdf report',
      toolManifestMode: 'compact',
    })
    expect(prompt).toContain('PDF DOCUMENT CAPABILITY')
  })
})
