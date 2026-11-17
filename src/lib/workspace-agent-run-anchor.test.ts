import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { deliverDocumentToWorkspace } from './workspace-document-delivery'
import type { WorkspaceToolRequest } from './workspace-tool-tools'
import { executeWorkspaceTool, setWorkspaceToolTransport } from './workspace-tool-dispatch'
import { getWorkspaceToolWorkspaceHostRoot } from './workspace-tool-workspace'

/**
 * Workspace anchoring regression: the daemon must steer shell and filesystem
 * writes into the SELECTED workspace, never the shared parent root — files at
 * the parent root exist on disk but are invisible in the user's file tree.
 * Document tools must additionally deliver the generated file into the
 * selected workspace, not only create a Canvas artifact.
 */

const RUN = { chatId: 'chat-1', messageId: 'msg-1', workspaceRelativePath: 'users/u1/workspaces/default-2', workspaceId: 'ws-1' }

let posted: Array<{ path: string; body: Record<string, unknown> }> = []

function tool(name: string, request: Record<string, unknown>): WorkspaceToolRequest {
  return { name, request } as unknown as WorkspaceToolRequest
}

beforeEach(() => {
  posted = []
  setWorkspaceToolTransport(async (_token, path, body) => {
    posted.push({ path, body })
    return { ok: true, status: 200, data: { ok: true } }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('executeWorkspaceTool — workspace anchoring', () => {
  it('defaults shell cwd to the selected workspace container path', async () => {
    await executeWorkspaceTool('t', tool('shell', { command: 'mkdir report && touch report/a.md' }), RUN)
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
      `${getWorkspaceToolWorkspaceHostRoot()}/users/u1/workspaces/default-2/reports/out.csv`,
    )
  })

  it('keeps an absolute filesystem path untouched', async () => {
    await executeWorkspaceTool('t', tool('filesystem', { action: 'write', path: '/home/user/.peakui/workspace/users/u1/workspaces/default-2/reports/out.csv', content: 'a,b' }), RUN)
    const call = posted.find(c => c.path === '/api/workspace-tool/filesystem')
      ?? posted.find(c => c.path === '/api/workspace-tool/filesystem/request')
    expect(String(call!.body.path)).toBe('/home/user/.peakui/workspace/users/u1/workspaces/default-2/reports/out.csv')
  })

  it('does not anchor when no workspace is selected', async () => {
    await executeWorkspaceTool('t', tool('shell', { command: 'pwd' }), { chatId: 'c', messageId: 'm' })
    const execute = posted.find(call => call.path === '/api/workspace-tool/shell/execute')
      ?? posted.find(call => call.path === '/api/workspace-tool/shell/request')
    expect(execute!.body.cwd).toBeUndefined()
  })

  it('forwards workspaceId to document tools so delivery targets the selected workspace', async () => {
    await executeWorkspaceTool('t', tool('pdf_document', { title: 'Report', content: 'x' }), RUN)
    const call = posted.find(c => c.path === '/api/workspace-tool/pdf-document')
    expect(call).toBeTruthy()
    expect(call!.body.workspaceId).toBe('ws-1')
    expect(call!.body.sessionId).toBe('chat-1')
  })

  it('forwards workspaceId to every document tool', async () => {
    for (const name of ['word_document', 'workbook_document', 'csv_document', 'markdown_document', 'slides_document', 'archive_document', 'calendar_document', 'email_document', 'mermaid_document']) {
      posted = []
      await executeWorkspaceTool('t', tool(name, { title: 'Report' }), RUN)
      const call = posted.find(c => c.body.workspaceId === 'ws-1')
      expect(call, name).toBeTruthy()
    }
  })

  it('defaults tax_return folder to ragFolderPath when omitted by the model', async () => {
    await executeWorkspaceTool('t', tool('tax_return', { action: 'compute', taxYear: 2025 }), {
      ...RUN,
      ragFolderPath: 'taxes/2025',
    })
    const call = posted.find(c => c.path === '/api/workspace-tool/tax')
    expect(call).toBeTruthy()
    expect(call!.body.folder).toBe('taxes/2025')
    expect(call!.body.sessionId).toBe('chat-1')
  })

  it('preserves explicit tax_return folder when provided by the model', async () => {
    await executeWorkspaceTool('t', tool('tax_return', { action: 'compute', folder: 'taxes/2024' }), {
      ...RUN,
      ragFolderPath: 'taxes/2025',
    })
    const call = posted.find(c => c.path === '/api/workspace-tool/tax')
    expect(call).toBeTruthy()
    expect(call!.body.folder).toBe('taxes/2024')
  })
})

describe('deliverDocumentToWorkspace', () => {
  it('reports a clean error when workspace resolution fails', async () => {
    const result = await deliverDocumentToWorkspace({
      userId: 'u1', sessionId: 's1', workspaceId: 'missing-ws',
      filename: 'test.pdf', bytes: Buffer.from('x'),
    })
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})
