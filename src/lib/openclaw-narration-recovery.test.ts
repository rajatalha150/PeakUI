import { describe, expect, it } from 'vitest'

import {
  buildOpenClawToolRequestFromNarration,
  synthesizeToolCallFromNarration,
  type NarrationRecovery,
} from './openclaw-narration-recovery'

const ALLOWED = ['/srv/data', '/var/lib/peakui']

describe('synthesizeToolCallFromNarration — filesystem', () => {
  it('matches the canonical "Inspecting path metadata" pattern', () => {
    const r = synthesizeToolCallFromNarration(
      'Inspecting path metadata: /home/raza/Downloads/camera-planner-windows-main.zip',
    )
    expect(r).not.toBeNull()
    expect(r?.toolName).toBe('filesystem')
    expect(r?.args).toEqual({ action: 'stat', path: '/home/raza/Downloads/camera-planner-windows-main.zip' })
  })

  it('matches "Let me stat <path>" with a stat verb', () => {
    const r = synthesizeToolCallFromNarration('Let me stat /home/raza/Downloads/foo.txt now.')
    expect(r?.toolName).toBe('filesystem')
    expect((r?.args as { action: string }).action).toBe('stat')
  })

  it('matches "reading <path>" as a read action', () => {
    const r = synthesizeToolCallFromNarration("I'll start by reading /home/raza/Downloads/foo.txt.")
    expect((r?.args as { action: string }).action).toBe('read')
  })

  it('matches "listing <path>" as a list action', () => {
    const r = synthesizeToolCallFromNarration('listing /home/raza/Downloads contents.')
    expect((r?.args as { action: string }).action).toBe('list')
  })

  it('rejects paths outside /home, /tmp, or allowedPaths', () => {
    const r = synthesizeToolCallFromNarration('Inspecting path metadata: /etc/passwd')
    expect(r).toBeNull()
  })

  it('accepts paths under allowedPaths', () => {
    const r = synthesizeToolCallFromNarration(
      'Inspecting path metadata: /srv/data/file.bin',
      { allowedPaths: ALLOWED },
    )
    expect(r?.args).toEqual({ action: 'stat', path: '/srv/data/file.bin' })
  })

  it('rejects relative paths', () => {
    const r = synthesizeToolCallFromNarration('Inspecting path metadata: ~/Downloads/foo.zip')
    expect(r).toBeNull()
  })

  it('strips trailing punctuation from the captured path', () => {
    const r = synthesizeToolCallFromNarration(
      'Inspecting path metadata: /home/raza/Downloads/foo.zip.',
    )
    expect((r?.args as { path: string }).path).toBe('/home/raza/Downloads/foo.zip')
  })
})

describe('synthesizeToolCallFromNarration — shell', () => {
  it('matches a back-quoted command after "running"', () => {
    const r = synthesizeToolCallFromNarration("Running `df -h` to check disk usage.")
    expect(r?.toolName).toBe('shell')
    expect((r?.args as { command: string }).command).toBe('df -h')
  })

  it('matches a back-quoted command after "executing"', () => {
    const r = synthesizeToolCallFromNarration("Now executing `ls -la /home/raza`.")
    expect((r?.args as { command: string }).command).toBe('ls -la /home/raza')
  })

  it('rejects shell metacharacters', () => {
    const r = synthesizeToolCallFromNarration("Running `rm -rf /; cat /etc/passwd`.")
    expect(r).toBeNull()
  })

  it('falls back to a trailing-token pattern when no backticks', () => {
    const r = synthesizeToolCallFromNarration('running du -sh /home/raza/Downloads')
    expect((r?.args as { command: string }).command).toBe('du -sh /home/raza/Downloads')
  })

  it('does not synthesize a multi-line command', () => {
    const r = synthesizeToolCallFromNarration('Running `ls; rm -rf /`')
    expect(r).toBeNull()
  })
})

describe('synthesizeToolCallFromNarration — code', () => {
  it('matches a fenced python block after a narration cue', () => {
    const r = synthesizeToolCallFromNarration(
      'Running this script:\n\n```python\nprint("hi")\n```\n',
    )
    expect(r?.toolName).toBe('code')
    expect((r?.args as { code: string; language: string }).code).toContain('print("hi")')
    expect((r?.args as { language: string }).language).toBe('python')
  })

  it('matches a fenced javascript block', () => {
    const r = synthesizeToolCallFromNarration('```javascript\nconsole.log(1)\n```')
    expect((r?.args as { language: string }).language).toBe('javascript')
  })
})

describe('synthesizeToolCallFromNarration — web', () => {
  it('matches "Let me search for <query>"', () => {
    const r = synthesizeToolCallFromNarration(
      'Let me search for the latest Next.js 16 release notes',
    )
    expect(r?.toolName).toBe('web')
    expect((r?.args as { query: string }).query).toBe('the latest Next.js 16 release notes')
  })

  it('matches "looking up <query>"', () => {
    const r = synthesizeToolCallFromNarration('Looking up how to fix Docker buildx cache errors.')
    expect((r?.args as { query: string }).query).toMatch(/how to fix Docker buildx cache errors/)
  })

  it('rejects very short queries', () => {
    const r = synthesizeToolCallFromNarration('Looking up a.')
    expect(r).toBeNull()
  })
})

describe('synthesizeToolCallFromNarration — fetch_summarize', () => {
  it('matches "fetching <url>"', () => {
    const r = synthesizeToolCallFromNarration(
      'Fetching https://example.com/article for the summary.',
    )
    expect(r?.toolName).toBe('fetch_summarize')
    expect((r?.args as { url: string }).url).toBe('https://example.com/article')
  })

  it('rejects non-http URLs', () => {
    const r = synthesizeToolCallFromNarration('Fetching file:///etc/passwd for the summary.')
    expect(r).toBeNull()
  })
})

describe('synthesizeToolCallFromNarration — unified_browser', () => {
  it('matches "navigating to <url>"', () => {
    const r = synthesizeToolCallFromNarration(
      'Navigating to https://example.com now to inspect the listing.',
    )
    expect(r?.toolName).toBe('unified_browser')
    expect((r?.args as { url: string }).url).toBe('https://example.com')
  })

  it('matches "opening <url> in browser"', () => {
    const r = synthesizeToolCallFromNarration(
      'opening https://example.org/page in browser',
    )
    expect((r?.args as { url: string }).url).toBe('https://example.org/page')
  })

  it('promotes a bare domain in "open <domain>" narration (no scheme)', () => {
    const r = synthesizeToolCallFromNarration("I'll open stockanalysis.com for the PLTR forecast.")
    expect(r?.toolName).toBe('unified_browser')
    expect((r?.args as { url: string }).url).toBe('https://stockanalysis.com')
  })

  it('promotes a bare domain with a path in narration', () => {
    const r = synthesizeToolCallFromNarration('Now open marketbeat.com/stocks/NASDAQ/PLTR/forecast/')
    expect(r?.toolName).toBe('unified_browser')
    expect((r?.args as { url: string }).url).toBe('https://marketbeat.com/stocks/NASDAQ/PLTR/forecast/')
  })

  it('does not promote a non-domain token after an open verb', () => {
    const r = synthesizeToolCallFromNarration('Let me check the latest numbers now.')
    expect(r).toBeNull()
  })
})

describe('synthesizeToolCallFromNarration — unified_browser page-name recovery', () => {
  const WHALESTREAM_PRIOR = {
    name: 'unified_browser' as const,
    request: {
      action: 'open',
      url: 'https://www.whalestream.com/market-data/top-options-flow?flow=all',
    },
  }
  const UNUSUAL_WHALES_PRIOR = {
    name: 'unified_browser' as const,
    request: { action: 'open', url: 'https://unusualwhales.com/dashboard' },
  }
  const HOLDINGS_PRIOR = {
    name: 'unified_browser' as const,
    request: { action: 'open', url: 'https://www.holdingschannel.com/' },
  }

  it('recovers "the dark pool flow page" on WhaleStream (the user bug case)', () => {
    const r = synthesizeToolCallFromNarration(
      'I can continue. I was waiting for each page result to come back before calling the next tool. The last tool result just arrived, so I\'ll proceed to the dark pool flow page now.',
      { lastSuccessfulToolRequest: WHALESTREAM_PRIOR },
    )
    expect(r?.toolName).toBe('unified_browser')
    expect((r?.args as { url: string }).url).toBe(
      'https://www.whalestream.com/market-data/top-dark-pool-flow',
    )
    expect(r?.matchedPattern).toBe('unified_browser.pageName')
  })

  it('recovers "open the SPY market tracker" on WhaleStream', () => {
    const r = synthesizeToolCallFromNarration(
      'Now opening the SPY market tracker to pull the OI table.',
      { lastSuccessfulToolRequest: WHALESTREAM_PRIOR },
    )
    expect((r?.args as { url: string }).url).toBe(
      'https://www.whalestream.com/market-tracker/SPY',
    )
  })

  it('recovers "the top options flow" on WhaleStream', () => {
    const r = synthesizeToolCallFromNarration(
      'Going back to the top options flow to compare.',
      { lastSuccessfulToolRequest: WHALESTREAM_PRIOR },
    )
    expect((r?.args as { url: string }).url).toBe(
      'https://www.whalestream.com/market-data/top-options-flow',
    )
  })

  it('recovers "the META institutions page" on Unusual Whales', () => {
    const r = synthesizeToolCallFromNarration(
      'Let me check the META institutions page for recent 13F changes.',
      { lastSuccessfulToolRequest: UNUSUAL_WHALES_PRIOR },
    )
    expect((r?.args as { url: string }).url).toBe(
      'https://unusualwhales.com/stock/META/institutions',
    )
  })

  it('recovers "the META overview" on Unusual Whales', () => {
    const r = synthesizeToolCallFromNarration(
      'Opening the META overview tab now.',
      { lastSuccessfulToolRequest: UNUSUAL_WHALES_PRIOR },
    )
    expect((r?.args as { url: string }).url).toBe(
      'https://unusualwhales.com/stock/META/overview',
    )
  })

  it('recovers "the NVDA institutional ownership" on HoldingsChannel', () => {
    const r = synthesizeToolCallFromNarration(
      'Pulling the NVDA institutional ownership page to see top holders.',
      { lastSuccessfulToolRequest: HOLDINGS_PRIOR },
    )
    expect((r?.args as { url: string }).url).toBe(
      'https://www.holdingschannel.com/institutional/holders-of-nvda/',
    )
  })

  it('returns null when the last successful tool was not unified_browser', () => {
    const r = synthesizeToolCallFromNarration(
      'I\'ll proceed to the dark pool flow page now.',
      {
        lastSuccessfulToolRequest: {
          name: 'web',
          request: { query: 'something else', description: '' },
        },
      },
    )
    // Should not synthesize a unified_browser call when the prior context
    // is the wrong tool. (May be null, or may match another synthesizer —
    // we only assert it's not a pageName recovery for the wrong context.)
    expect(
      r === null || r.matchedPattern !== 'unified_browser.pageName',
    ).toBe(true)
  })

  it('returns null when the page name is not in any known catalog entry', () => {
    const r = synthesizeToolCallFromNarration(
      'I\'ll proceed to the mastodon page now.',
      { lastSuccessfulToolRequest: WHALESTREAM_PRIOR },
    )
    expect(r).toBeNull()
  })

  it('returns null when the prior URL is from a site not in the catalog', () => {
    const r = synthesizeToolCallFromNarration(
      'I\'ll proceed to the dark pool flow page now.',
      {
        lastSuccessfulToolRequest: {
          name: 'unified_browser',
          request: { action: 'open', url: 'https://example.com/random' },
        },
      },
    )
    expect(r).toBeNull()
  })

  it('buildOpenClawToolRequestFromNarration maps the pageName recovery to action=open', () => {
    const r = synthesizeToolCallFromNarration(
      'proceed to the dark pool flow page now.',
      { lastSuccessfulToolRequest: WHALESTREAM_PRIOR },
    )
    expect(r).not.toBeNull()
    const req = buildOpenClawToolRequestFromNarration(r!)
    expect(req?.name).toBe('unified_browser')
    expect((req?.request as { action: string; url: string }).action).toBe('open')
    expect((req?.request as { url: string }).url).toBe(
      'https://www.whalestream.com/market-data/top-dark-pool-flow',
    )
  })
})

describe('synthesizeToolCallFromNarration — tax_return', () => {
  it('matches "generating tax return for 2024"', () => {
    const r = synthesizeToolCallFromNarration('Generating tax return for 2024 now.')
    expect(r?.toolName).toBe('tax_return')
    expect(r?.args).toEqual({ action: 'generate', taxYear: '2024' })
  })

  it('rejects non-4-digit years', () => {
    const r = synthesizeToolCallFromNarration('Generating tax return for 24 now.')
    expect(r).toBeNull()
  })
})

describe('synthesizeToolCallFromNarration — document regeneration', () => {
  it('returns null without lastSuccessfulToolRequest', () => {
    const r = synthesizeToolCallFromNarration('Regenerate the same PDF again.')
    expect(r).toBeNull()
  })

  it('returns null when lastSuccessfulToolRequest is not a document tool', () => {
    const r = synthesizeToolCallFromNarration(
      'Regenerate the same shell command again.',
      { lastSuccessfulToolRequest: { name: 'shell', request: { command: 'ls' } } },
    )
    expect(r).toBeNull()
  })

  it('resubmits the prior pdf_document request when narration says regenerate', () => {
    const prior = {
      name: 'pdf_document',
      request: { title: 'Release notes', sections: [] },
    }
    const r = synthesizeToolCallFromNarration(
      'Please regenerate that PDF.',
      { lastSuccessfulToolRequest: prior },
    )
    expect(r?.toolName).toBe('pdf_document')
    expect(r?.matchedPattern).toBe('document.regenerate')
    expect((r?.args as { __resubmit: unknown }).__resubmit).toEqual(prior.request)
  })

  it('matches "render the same thing again" for mermaid_document', () => {
    const r = synthesizeToolCallFromNarration(
      'render the same diagram again',
      {
        lastSuccessfulToolRequest: {
          name: 'mermaid_document',
          request: { title: 'flow', diagram: 'graph TD; A-->B' },
        },
      },
    )
    expect(r?.toolName).toBe('mermaid_document')
  })
})

describe('synthesizeToolCallFromNarration — edge cases', () => {
  it('returns null for empty input', () => {
    expect(synthesizeToolCallFromNarration('')).toBeNull()
    expect(synthesizeToolCallFromNarration('   ')).toBeNull()
  })

  // Trailing-question rejection happens at the runtime layer in
  // detectMissingToolIntent (which gates synthesis); the synthesizer itself
  // stays permissive so it can be reused by other call sites later.

  it('strips a complete tool block before evaluating', () => {
    // The wrapper is present, so detectMissingToolIntent would not fire — but if
    // some residual content remained, the synthesizer should ignore the wrapper
    // body entirely.
    const r = synthesizeToolCallFromNarration(
      '<openclaw_tool name="filesystem">{"action":"stat","path":"/home/raza/x"}</openclaw_tool>',
    )
    expect(r).toBeNull()
  })

  it('returns null when no pattern matches', () => {
    expect(synthesizeToolCallFromNarration('Here is the final answer to your question.')).toBeNull()
  })
})

describe('buildOpenClawToolRequestFromNarration', () => {
  it('builds a filesystem stat request', () => {
    const recovery: NarrationRecovery = {
      toolName: 'filesystem',
      args: { action: 'stat', path: '/home/raza/x' },
      matchedPattern: 'filesystem.stat',
    }
    const req = buildOpenClawToolRequestFromNarration(recovery)
    expect(req).toEqual({
      name: 'filesystem',
      request: { action: 'stat', path: '/home/raza/x' },
    })
  })

  it('builds a shell request with description', () => {
    const recovery: NarrationRecovery = {
      toolName: 'shell',
      args: { command: 'df -h', description: 'auto-recovered from prose narration' },
      matchedPattern: 'shell.backtick',
    }
    const req = buildOpenClawToolRequestFromNarration(recovery)
    expect(req?.name).toBe('shell')
    expect((req?.request as { command: string }).command).toBe('df -h')
  })

  it('builds a code request and maps python → python runtime', () => {
    const recovery: NarrationRecovery = {
      toolName: 'code',
      args: { language: 'python', code: 'print(1)' },
      matchedPattern: 'code.python',
    }
    const req = buildOpenClawToolRequestFromNarration(recovery)
    expect(req?.name).toBe('code')
    expect((req?.request as { runtime: string }).runtime).toBe('python')
  })

  it('builds a code request and maps javascript → node runtime', () => {
    const recovery: NarrationRecovery = {
      toolName: 'code',
      args: { language: 'javascript', code: 'console.log(1)' },
      matchedPattern: 'code.javascript',
    }
    const req = buildOpenClawToolRequestFromNarration(recovery)
    expect((req?.request as { runtime: string }).runtime).toBe('node')
  })

  it('builds a document regenerate request', () => {
    const resubmit = { title: 'x', sections: [] }
    const recovery: NarrationRecovery = {
      toolName: 'pdf_document',
      args: { __resubmit: resubmit },
      matchedPattern: 'document.regenerate',
    }
    const req = buildOpenClawToolRequestFromNarration(recovery)
    expect(req?.name).toBe('pdf_document')
    expect((req?.request as { title: string }).title).toBe('x')
  })

  it('returns null for an unknown tool name', () => {
    const recovery: NarrationRecovery = {
      toolName: 'made_up_tool',
      args: {},
      matchedPattern: 'junk',
    }
    expect(buildOpenClawToolRequestFromNarration(recovery)).toBeNull()
  })

  it('returns null for filesystem with a missing path', () => {
    const recovery: NarrationRecovery = {
      toolName: 'filesystem',
      args: { action: 'stat' },
      matchedPattern: 'filesystem.stat',
    }
    expect(buildOpenClawToolRequestFromNarration(recovery)).toBeNull()
  })
})
