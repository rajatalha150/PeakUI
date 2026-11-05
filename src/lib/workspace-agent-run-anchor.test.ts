import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { executeWorkspaceTool } from './workspace-agent-run'
import type { WorkspaceToolRequest } from './workspace-tool-tools'

/**
 * Workspace anchoring regression: the daemon must steer shell and filesystem
 * writes into the SELECTED workspace, never the shared parent root — files at
 * the parent root exist on disk but are invisible in the user's file tree.
 */

const RUN = { chatId: 'chat-1', messageId: 'msg-1', workspaceRelativePath: 'users/u1/workspaces/default-2' }

let posted: Array<{ path: string; body: Record<string, unknown> }> = []

function tool(name: string, request: Record<string, unknown>): WorkspaceToolRequest {
  return { name, request } as unknown as WorkspaceToolRequest
}

beforeEach(() => {
  posted = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    posted.push({ path: String(url).replace('http://127.0.0.1:3000', ''), body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('executeWorkspaceTool — workspace anchoring', () => {
  it('defaults shell cwd to the selected workspace container path', async () => {
    await executeWorkspaceTool('t', tool('shell', { command: 'mkdir report && touch report/a.md' }), RUN)
    expect(posted.length).toBeGreaterThan(0)
    const execute = posted.find(call => call.path === '/api/workspace-tool/shell/execute')
      ?? posted.find(call => call.path === '/api/workspace-tool/shell/request')
    expect(execute).toBeTruthy()
    expect(String(execute!.body.cwd)).toBe('/mnt/workspace-tool/workspace/users/u1/workspaces/default-2')
  })

  it('keeps an explicit shell cwd from the model', async () => {
    await executeWorkspaceTool('t', tool('shell', { command: 'ls', cwd: '/tmp' }), RUN)
    const execute = posted.find(call => call.path === '/api/workspace-tool/shell/execute')
      ?? posted.find(call => call.path === '/api/workspace-tool/shell/request')
    expect(String(execute!.body.cwd)).toBe('/tmp')
  })

  it('anchors a bare relative filesystem write path into the selected workspace', async () => {
    await executeWorkspaceTool('t', tool('filesystem', { action: 'write', path: 'reports/out.csv', content: 'a,b' }), RUN)
    const call = posted.find(c => c.path === '/api/workspace-tool/filesystem')
      ?? posted.find(c => c.path === '/api/workspace-tool/filesystem/request')
    expect(String(call!.body.path)).toBe(
      '/home/raza/.peakui/workspace/users/u1/workspaces/default-2/reports/out.csv',
    )
  })

  it('keeps an absolute filesystem path untouched', async () => {
    await executeWorkspaceTool('t', tool('filesystem', { action: 'write', path: '/home/raza/.peakui/workspace/users/u1/workspaces/default-2/reports/out.csv', content: 'a,b' }), RUN)
    const call = posted.find(c => c.path === '/api/workspace-tool/filesystem')
      ?? posted.find(c => c.path === '/api/workspace-tool/filesystem/request')
    expect(String(call!.body.path)).toBe('/home/raza/.peakui/workspace/users/u1/workspaces/default-2/reports/out.csv')
  })

  it('does not anchor when no workspace is selected', async () => {
    await executeWorkspaceTool('t', tool('shell', { command: 'pwd' }), { chatId: 'c', messageId: 'm' })
    const execute = posted.find(call => call.path === '/api/workspace-tool/shell/execute')
      ?? posted.find(call => call.path === '/api/workspace-tool/shell/request')
    expect(execute!.body.cwd).toBeUndefined()
  })
})
