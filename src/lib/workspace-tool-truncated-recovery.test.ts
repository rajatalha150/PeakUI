import { describe, expect, it } from 'vitest'
import { extractWorkspaceToolRequest } from './workspace-tool-tools'

/**
 * Regression: kimi-k3 via ollama.com cuts generation mid-tool-call.
 *
 * Real case (Nov 8, run ab4732af): kimi streamed
 *   <workspace_tool name="code">{"runtime":"python","filename":"read_prior_workbooks.py","code":"import openpyxl\n...print('ERR', f, e)\n","description":"Inspect prior outreach workbooks to see what was already delivered"
 * and the stream ENDED — no closing }, no </workspace_tool>, no done frame.
 * The parser found no block, the daemon saw "no tool, no prose", and the run
 * finished with "The server completed the run without a final assistant
 * message." The UI then showed the raw "<workspace" fragment as the answer.
 */
describe('truncated workspace_tool stream recovery (kimi-k3 cut mid-JSON)', () => {
  it('recovers a tool call cut mid-string-value at a comma boundary', () => {
    const cut = '<workspace_tool name="web">{"query":"nyc heavy construction contractors outreach","description":"Find company contact pages for the outreach list","maxRes'
    const { request, cleanedContent } = extractWorkspaceToolRequest(cut)
    expect(request?.name).toBe('web')
    if (request?.name !== 'web') throw new Error('expected web')
    // The intact fields made it through; the half-written one is dropped.
    expect(request.request.query).toBe('nyc heavy construction contractors outreach')
    expect(cleanedContent).not.toContain('<workspace_tool')
  })

  it('recovers when only the first key/value pair survived', () => {
    const cut = '<workspace_tool name="shell">{"command":"ls -la /workspace'
    const { request } = extractWorkspaceToolRequest(cut)
    expect(request?.name).toBe('shell')
    if (request?.name !== 'shell') throw new Error('expected shell')
    expect(request.request.command).toBe('ls -la /workspace')
  })

  it('recovers the real kimi code-call shape from run ab4732af', () => {
    const cut = `<workspace_tool name="code">{"runtime":"python","filename":"read_prior.py","code":"import openpyxl\\nwb = openpyxl.load_workbook(f)\\nprint(ws.title)","description":"Inspect prior outreach workbooks`
    const { request } = extractWorkspaceToolRequest(cut)
    expect(request?.name).toBe('code')
    if (request?.name !== 'code') throw new Error('expected code')
    const req = request.request as unknown as Record<string, unknown>
    expect(req.runtime).toBe('python')
    expect(req.filename).toBe('read_prior.py')
  })

  it('does NOT fire on prose that merely mentions the tag', () => {
    const prose = 'You asked me to use <workspace_tool name="web"> earlier, but the syntax in my message body should stay prose. Here is the actual answer with no tool call.'
    const { request } = extractWorkspaceToolRequest(prose)
    expect(request?.name).toBeUndefined()
  })

  it('full intact calls still parse identically (no behavior change)', () => {
    const intact = '<workspace_tool name="web">{"query":"nyc utility companies","description":"x"}</workspace_tool>'
    const { request } = extractWorkspaceToolRequest(intact)
    expect(request?.name).toBe('web')
    if (request?.name !== 'web') throw new Error('expected web')
    expect(request.request.query).toBe('nyc utility companies')
  })
})
