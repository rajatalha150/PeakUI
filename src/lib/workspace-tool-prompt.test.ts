import { describe, expect, it } from 'vitest'
import { buildWorkspaceToolSystemPrompt, buildUwafStealthTemplatesBlock } from './workspace-tool-prompt'

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

describe('buildWorkspaceToolSystemPrompt', () => {
  it('keeps full tool instructions by default', () => {
    const prompt = buildWorkspaceToolSystemPrompt(baseContext)
    expect(prompt).toContain('SHELL EXECUTION CAPABILITY')
    expect(prompt).toContain('FILESYSTEM CAPABILITY')
    expect(prompt).toContain('Use this exact format')
  })

  it('uses compact notes in compact mode for idle queries', () => {
    const prompt = buildWorkspaceToolSystemPrompt({
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
    const prompt = buildWorkspaceToolSystemPrompt({
      ...baseContext,
      latestUserQuery: 'run git status',
      promptTier: 'compact',
    })
    expect(prompt).toContain('SHELL EXECUTION CAPABILITY')
    expect(prompt).toContain('Use this exact format')
  })

  it('includes document capability examples when the query signals document intent', () => {
    const prompt = buildWorkspaceToolSystemPrompt({
      ...baseContext,
      latestUserQuery: 'create a pdf report',
      promptTier: 'compact',
    })
    expect(prompt).toContain('PDF DOCUMENT CAPABILITY')
  })

  it('includes the workspace files GUI panel section when workspace context is provided', () => {
    const prompt = buildWorkspaceToolSystemPrompt(baseContext)
    expect(prompt).toContain('WORKSPACE FILES GUI PANEL')
    expect(prompt).toContain('workspace-relative')
    expect(prompt).toContain('events stream')
  })

  it('omits the workspace files GUI panel section when no workspace context is provided', () => {
    const { workspace, ...rest } = baseContext
    void workspace
    const prompt = buildWorkspaceToolSystemPrompt(rest)
    expect(prompt).not.toContain('WORKSPACE FILES GUI PANEL')
  })

  it('includes rule (7) forbidding bare action narration', () => {
    const prompt = buildWorkspaceToolSystemPrompt(baseContext)
    expect(prompt).toContain('NEVER end a message with bare action narration')
    expect(prompt).toContain('(7)')
  })

  it('includes rule (8) forbidding off-topic pivot', () => {
    const prompt = buildWorkspaceToolSystemPrompt(baseContext)
    expect(prompt).toContain('(8)')
    expect(prompt).toContain("Stay on the user")
    expect(prompt).toContain('do not pivot to an unrelated topic')
  })

  it('includes the RECOVERY BEHAVIOR block describing auto-recovery', () => {
    const prompt = buildWorkspaceToolSystemPrompt(baseContext)
    expect(prompt).toContain('RECOVERY BEHAVIOR:')
    expect(prompt).toContain('auto-recover by inferring a tool call from your prose')
  })

  it('routes plain searches to the web tool and reserves unified_browser for nav/JS/forms/login', () => {
    const prompt = buildWorkspaceToolSystemPrompt({
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

  it('includes the always-on TOOL SELECTION routing block in every tier', () => {
    const prompt = buildWorkspaceToolSystemPrompt({
      ...baseContext,
      promptTier: 'minimal',
      latestUserQuery: 'analyze pltr',
    })
    expect(prompt).toContain('TOOL SELECTION')
    expect(prompt).toContain('use the `web` tool')
    expect(prompt).toContain('NEVER use shell with curl/wget')
  })
})

describe('buildWorkspaceToolSystemPrompt — graduated prompt tiers', () => {
  it('minimal tier drops verbose core-protocol rules but keeps the protocol and rules 1-3', () => {
    const prompt = buildWorkspaceToolSystemPrompt({
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
    const prompt = buildWorkspaceToolSystemPrompt({
      ...baseContext,
      promptTier: 'minimal',
      latestUserQuery: 'run git status',
    })
    expect(prompt).toContain('SHELL EXECUTION: available')
    expect(prompt).not.toContain('SHELL EXECUTION CAPABILITY')
  })

  it('minimal tier omits document capability examples even on document intent', () => {
    const prompt = buildWorkspaceToolSystemPrompt({
      ...baseContext,
      promptTier: 'minimal',
      latestUserQuery: 'create a pdf report',
    })
    expect(prompt).not.toContain('PDF DOCUMENT CAPABILITY')
  })

  it('full tier gates document capability examples on query (like standard)', () => {
    const prompt = buildWorkspaceToolSystemPrompt({
      ...baseContext,
      promptTier: 'full',
      latestUserQuery: 'hello',
    })
    expect(prompt).not.toContain('PDF DOCUMENT CAPABILITY')
  })

  it('full tier includes document capability examples when the query signals document intent', () => {
    const prompt = buildWorkspaceToolSystemPrompt({
      ...baseContext,
      promptTier: 'full',
      latestUserQuery: 'create a pdf report',
    })
    expect(prompt).toContain('PDF DOCUMENT CAPABILITY')
  })

  it('standard tier keeps full tool sections but gates document examples on query', () => {
    const prompt = buildWorkspaceToolSystemPrompt({
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

describe('buildWorkspaceToolSystemPrompt — stealth templates block wiring', () => {
  function promptWithStealthMode(overrides: Partial<typeof baseContext> = {}) {
    return buildWorkspaceToolSystemPrompt({
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
    const prompt = buildWorkspaceToolSystemPrompt({
      ...baseContext,
      uwafBrowserMode: 'direct',
      internetToolEnabled: true,
    })
    expect(prompt).not.toContain('Stealth query templates')
  })

  it('omits the stealth templates block when UWAF is denied', () => {
    const prompt = buildWorkspaceToolSystemPrompt({
      ...baseContext,
      uwafBrowserMode: 'deny',
      internetToolEnabled: true,
    })
    expect(prompt).not.toContain('Stealth query templates')
  })
})

describe('buildWorkspaceToolSystemPrompt — always-on tool manifest', () => {
  it('includes exact tool name + JSON signatures even in minimal tier', () => {
    const prompt = buildWorkspaceToolSystemPrompt({
      ...baseContext,
      promptTier: 'minimal',
      latestUserQuery: 'hello',
    })
    expect(prompt).toContain('TOOL MANIFEST')
    // The core tools' exact names and field names must be visible so small
    // models don't hallucinate `browser {"action":"open_url"}` style calls.
    expect(prompt).toContain('shell {"command":"..."')
    expect(prompt).toContain('filesystem {"action":"list|read|stat","path":"..."}')
    expect(prompt).toContain('code {"runtime":"python|node"')
  })

  it('includes document tool signatures so trimmed tiers still know the names', () => {
    const prompt = buildWorkspaceToolSystemPrompt({
      ...baseContext,
      promptTier: 'minimal',
      latestUserQuery: 'hello',
    })
    expect(prompt).toContain('pdf_document {"title":"..."')
    expect(prompt).toContain('workbook_document {"title":"..."')
    expect(prompt).toContain('mermaid_document {"title":"..."')
  })

  it('includes a browser signature with the correct action/url fields when the browser is enabled', () => {
    const prompt = buildWorkspaceToolSystemPrompt({
      ...baseContext,
      promptTier: 'minimal',
      latestUserQuery: 'hello',
      browserMode: 'read-only',
      internetToolEnabled: true,
    })
    expect(prompt).toContain('browser {"action":"open","url":"..."')
    expect(prompt).not.toContain('"action":"open_url"')
  })

  it('includes the manifest even with no shell/filesystem/code/browser enabled (document tools are always active)', () => {
    const prompt = buildWorkspaceToolSystemPrompt({
      provider: 'ollama',
      model: 'gemma4:latest',
    })
    expect(prompt).toContain('TOOL MANIFEST')
    expect(prompt).toContain('pdf_document {"title":"..."')
  })
})

describe('buildWorkspaceToolSystemPrompt — tool format hygiene', () => {
  it('explicitly tells the model to NOT use other SDK tool-call formats', () => {
    const prompt = buildWorkspaceToolSystemPrompt(baseContext)
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
