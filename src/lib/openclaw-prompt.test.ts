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

  it('includes the workspace files GUI panel section when workspace context is provided', () => {
    const prompt = buildOpenClawSystemPrompt(baseContext)
    expect(prompt).toContain('WORKSPACE FILES GUI PANEL')
    expect(prompt).toContain('workspace-relative')
    expect(prompt).toContain('events stream')
  })

  it('omits the workspace files GUI panel section when no workspace context is provided', () => {
    const { workspace, ...rest } = baseContext
    void workspace
    const prompt = buildOpenClawSystemPrompt(rest)
    expect(prompt).not.toContain('WORKSPACE FILES GUI PANEL')
  })

  it('includes rule (7) forbidding bare action narration', () => {
    const prompt = buildOpenClawSystemPrompt(baseContext)
    expect(prompt).toContain('NEVER end a message with bare action narration')
    expect(prompt).toContain('(7)')
  })

  it('includes rule (8) forbidding off-topic pivot', () => {
    const prompt = buildOpenClawSystemPrompt(baseContext)
    expect(prompt).toContain('(8)')
    expect(prompt).toContain("Stay on the user")
    expect(prompt).toContain('do not pivot to an unrelated topic')
  })

  it('includes the RECOVERY BEHAVIOR block describing auto-recovery', () => {
    const prompt = buildOpenClawSystemPrompt(baseContext)
    expect(prompt).toContain('RECOVERY BEHAVIOR:')
    expect(prompt).toContain('auto-recover by inferring a tool call from your prose')
  })

  it('routes plain searches to the web tool and reserves unified_browser for nav/JS/forms/login', () => {
    const prompt = buildOpenClawSystemPrompt({
      ...baseContext,
      uwafBrowserMode: 'direct',
      internetToolEnabled: true,
    })
    // The old, wrong rule must be gone.
    expect(prompt).not.toContain('prefer unified_browser over the background web tool')
    // The new rule must be present and must explicitly say `web` is preferred for plain searches.
    expect(prompt).toContain('prefer the lightweight `web` tool')
    // And it must enumerate the legitimate unified_browser use cases so we don't regress them.
    expect(prompt).toContain('Reserve `unified_browser` for')
    expect(prompt).toContain('step-by-step navigation')
    expect(prompt).toContain('JS-heavy pages')
    expect(prompt).toContain('form interaction or login')
  })
})
