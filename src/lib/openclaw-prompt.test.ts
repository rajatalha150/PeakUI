import { describe, expect, it } from 'vitest'
import { buildOpenClawSystemPrompt, buildUwafStealthTemplatesBlock } from './openclaw-prompt'

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
    hostPath: '~/.peakui/workspace/users/u1/workspaces/default',
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
      promptTier: 'compact',
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
      promptTier: 'compact',
    })
    expect(prompt).toContain('SHELL EXECUTION CAPABILITY')
    expect(prompt).toContain('Use this exact format')
  })

  it('includes document capability examples when the query signals document intent', () => {
    const prompt = buildOpenClawSystemPrompt({
      ...baseContext,
      latestUserQuery: 'create a pdf report',
      promptTier: 'compact',
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

describe('buildOpenClawSystemPrompt — graduated prompt tiers', () => {
  it('minimal tier drops verbose core-protocol rules but keeps the protocol and rules 1-3', () => {
    const prompt = buildOpenClawSystemPrompt({
      ...baseContext,
      promptTier: 'minimal',
      latestUserQuery: 'hello',
    })
    expect(prompt).toContain('TOOL CALL PROTOCOL')
    expect(prompt).toContain('(1)')
    expect(prompt).toContain('(3)')
    expect(prompt).not.toContain('(4)')
    expect(prompt).not.toContain('(7)')
    expect(prompt).not.toContain('(9)')
    expect(prompt).not.toContain('RECOVERY BEHAVIOR:')
    expect(prompt).not.toContain('CLEAR-GOAL SINGLE-SHOT MODE:')
    expect(prompt).not.toContain('NO FAKE STACK PIVOTS:')
  })

  it('minimal tier keeps one-line tool notes even when the query signals tool intent', () => {
    const prompt = buildOpenClawSystemPrompt({
      ...baseContext,
      promptTier: 'minimal',
      latestUserQuery: 'run git status',
    })
    expect(prompt).toContain('SHELL EXECUTION: available')
    expect(prompt).not.toContain('SHELL EXECUTION CAPABILITY')
  })

  it('minimal tier omits document capability examples even on document intent', () => {
    const prompt = buildOpenClawSystemPrompt({
      ...baseContext,
      promptTier: 'minimal',
      latestUserQuery: 'create a pdf report',
    })
    expect(prompt).not.toContain('PDF DOCUMENT CAPABILITY')
  })

  it('full tier includes all document capability examples regardless of query', () => {
    const prompt = buildOpenClawSystemPrompt({
      ...baseContext,
      promptTier: 'full',
      latestUserQuery: 'hello',
    })
    expect(prompt).toContain('PDF DOCUMENT CAPABILITY')
  })

  it('standard tier keeps full tool sections but gates document examples on query', () => {
    const prompt = buildOpenClawSystemPrompt({
      ...baseContext,
      promptTier: 'standard',
      latestUserQuery: 'hello',
    })
    expect(prompt).toContain('SHELL EXECUTION CAPABILITY')
    expect(prompt).not.toContain('PDF DOCUMENT CAPABILITY')
  })
})

describe('buildUwafStealthTemplatesBlock', () => {
  it('returns a non-empty block in stealth mode', () => {
    const block = buildUwafStealthTemplatesBlock()
    expect(block.length).toBeGreaterThan(0)
    expect(block).toContain('Stealth query templates')
  })

  it('includes all six template categories', () => {
    const block = buildUwafStealthTemplatesBlock()
    expect(block).toContain('Journalism:')
    expect(block).toContain('Leaks & archives:')
    expect(block).toContain('Conspiracies & suppressed:')
    expect(block).toContain('Underground communities:')
    expect(block).toContain('OSINT & threat intel:')
    expect(block).toContain('General dark-web research:')
  })

  it('renders each template as a quoted string (starts and ends with a double quote)', () => {
    const block = buildUwafStealthTemplatesBlock()
    // Pull out a few canonical templates and assert they are quoted.
    expect(block).toContain('"leaked government documents archive onion"')
    expect(block).toContain('"ransomware leak site"')
    expect(block).toContain('"exclusive invite-only forum onion"')
    expect(block).toContain('"dark web footprint search company"')
  })

  it('ends with the do-not-invent-phrasings reminder', () => {
    const block = buildUwafStealthTemplatesBlock()
    expect(block).toContain('Do not invent new query phrasings when a template matches')
  })
})

describe('buildOpenClawSystemPrompt — stealth templates block wiring', () => {
  function promptWithStealthMode(overrides: Partial<typeof baseContext> = {}) {
    return buildOpenClawSystemPrompt({
      ...baseContext,
      ...overrides,
      uwafBrowserMode: 'stealth',
      internetToolEnabled: true,
    })
  }

  it('includes the stealth templates block when mode is stealth', () => {
    const prompt = promptWithStealthMode()
    expect(prompt).toContain('Stealth query templates')
    expect(prompt).toContain('"leaked government documents archive onion"')
  })

  it('omits the stealth templates block when mode is direct', () => {
    const prompt = buildOpenClawSystemPrompt({
      ...baseContext,
      uwafBrowserMode: 'direct',
      internetToolEnabled: true,
    })
    expect(prompt).not.toContain('Stealth query templates')
  })

  it('omits the stealth templates block when UWAF is denied', () => {
    const prompt = buildOpenClawSystemPrompt({
      ...baseContext,
      uwafBrowserMode: 'deny',
      internetToolEnabled: true,
    })
    expect(prompt).not.toContain('Stealth query templates')
  })
})

describe('buildOpenClawSystemPrompt — tool format hygiene', () => {
  it('explicitly tells the model to NOT use other SDK tool-call formats', () => {
    const prompt = buildOpenClawSystemPrompt(baseContext)
    // The prompt must mention each well-known hallucinated format so
    // the model recognizes them as rejected and avoids emitting them.
    expect(prompt).toContain('<tool_call>')
    expect(prompt).toContain('<function_calls>')
    expect(prompt).toContain('<invoke')
    expect(prompt).toContain('<parameter')
    expect(prompt).toContain('<|tool_call|>')
    expect(prompt).toContain('<|im_start|>')
    expect(prompt).toContain('<|end_of_turn|>')
  })
})
