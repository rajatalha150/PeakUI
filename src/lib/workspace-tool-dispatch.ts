/**
 * Pure tool dispatcher for WorkSpaces durable runs.
 *
 * Extracted from `workspace-agent-run.ts` so the workspace-anchoring rules
 * (shell cwd, filesystem path prefixing, document-tool workspaceId forwarding)
 * are unit-testable without importing the whole daemon module (which pulls in
 * Prisma/DB state). The dispatcher itself only talks to the app API through
 * `callAppApi`/`callApprovedTool`, which live here too and are injected via a
 * module-level setter so tests can stub the transport without touching
 * `global.fetch`.
 */

import type { WorkspaceToolRequest } from './workspace-tool-tools'
import { getWorkspaceToolWorkspaceContainerRoot, getWorkspaceToolWorkspaceHostRoot } from './workspace-tool-workspace'

type JsonRecord = Record<string, unknown>

export interface WorkspaceToolRunTarget {
  chatId: string
  messageId: string
  workspaceRelativePath?: string
  workspaceId?: string | null
  ragFolderPath?: string | null
}

export type AppApiCall = (token: string, path: string, body: JsonRecord) => Promise<{ ok: boolean; status: number; data: JsonRecord }>

let appApi: AppApiCall = async () => ({ ok: false, status: 500, data: { error: 'transport not configured' } })

/** Wire the real transport (from workspace-agent-run.ts) at daemon boot. */
export function setWorkspaceToolTransport(call: AppApiCall) {
  appApi = call
}

async function callApprovedTool(
  token: string,
  requestPath: string,
  executePath: string,
  request: JsonRecord,
  run: { chatId: string; messageId: string },
) {
  const payload = { ...request, sessionId: run.chatId, messageId: run.messageId }
  const decision = await appApi(token, requestPath, payload)
  if (!decision.ok || (decision.data as JsonRecord).requiresApproval) {
    const data = decision.data as JsonRecord
    return {
      ok: false,
      data: { error: data.error || data.reason || 'This tool requires approval while the tab is closed. Reopen the session and approve it.', code: 'approval_required' },
    }
  }
  if ((decision.data as JsonRecord).autoApproved === true) {
    const approvalToken = typeof (decision.data as JsonRecord).approvalToken === 'string'
      ? { approvalToken: (decision.data as JsonRecord).approvalToken }
      : {}
    return appApi(token, executePath, { ...payload, ...approvalToken })
  }
  return decision
}

export async function executeWorkspaceTool(token: string, request: WorkspaceToolRequest, run: WorkspaceToolRunTarget) {
  const originalBody = request.request as unknown as JsonRecord
  const body = { ...originalBody }
  switch (request.name) {
    case 'web': return appApi(token, '/api/web/context', { query: body.query })
    case 'filesystem': {
      // Anchor filesystem writes into the selected workspace: a bare relative
      // path from the model would otherwise be rejected by the filesystem tool
      // with a suggestion pointing at the SHARED parent root — and files there
      // are invisible in the user's file tree. Prefix relative paths with the
      // active workspace's host path instead.
      if (run.workspaceRelativePath && typeof body.path === 'string' && body.path.trim()
        && !body.path.startsWith('/') && !body.path.startsWith('~') && !/^[A-Za-z]:[\\/]/.test(body.path)) {
        body.path = `${getWorkspaceToolWorkspaceHostRoot()}/${run.workspaceRelativePath.replace(/\/+$/, '')}/${body.path.replace(/^\/+/, '')}`
      }
      if (body.action === 'write' || body.action === 'append' || body.action === 'mkdir') {
        return callApprovedTool(token, '/api/workspace-tool/filesystem/request', '/api/workspace-tool/filesystem', body, run)
      }
      return appApi(token, '/api/workspace-tool/filesystem', body)
    }
    case 'shell': {
      // Anchor shell into the selected workspace: when the model did not pass
      // an explicit cwd, default it to the active workspace's container path so
      // relative commands (mkdir x, touch y, git clone …) land inside the
      // workspace the user has selected — not the shared parent root, where
      // files are invisible in the file tree. The container path is translated
      // back to the host path by the host executor when the target is host.
      if (run.workspaceRelativePath && (typeof body.cwd !== 'string' || !body.cwd.trim())) {
        body.cwd = `${getWorkspaceToolWorkspaceContainerRoot()}/${run.workspaceRelativePath.replace(/^\/+/, '')}`
      }
      return callApprovedTool(token, '/api/workspace-tool/shell/request', '/api/workspace-tool/shell/execute', body, run)
    }
    case 'code': {
      const requestedPath = typeof body.workspacePath === 'string' ? body.workspacePath.trim() : ''
      if (run.workspaceRelativePath && (!requestedPath || (!requestedPath.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(requestedPath)))) {
        body.workspacePath = requestedPath
          ? `${run.workspaceRelativePath.replace(/\/+$/, '')}/${requestedPath.replace(/^\/+/, '')}`
          : run.workspaceRelativePath
      }
      return callApprovedTool(token, '/api/workspace-tool/code/request', '/api/workspace-tool/code', body, run)
    }
    case 'browser': {
      if (body.action === 'submit') return callApprovedTool(token, '/api/workspace-tool/browser/request', '/api/workspace-tool/browser', body, run)
      return appApi(token, '/api/workspace-tool/browser', { ...body, sessionId: run.chatId })
    }
    case 'unified_browser': {
      if (body.action === 'submit' || body.action === 'research_batch') {
        return callApprovedTool(token, '/api/workspace-tool/uwaf-browser/request', '/api/workspace-tool/uwaf-browser', body, run)
      }
      if (body.action === 'wait_for_user') return { ok: false, data: { error: 'Human browser assistance requires the browser to remain open.', code: 'human_assistance_required' } }
      return appApi(token, '/api/workspace-tool/uwaf-browser', { ...body, sessionId: run.chatId })
    }
    case 'fetch_summarize': return appApi(token, '/api/workspace-tool/fetch-summarize', body)
    case 'image_generation': return appApi(token, '/api/image-gen/generate', { ...body, sessionId: run.chatId, messageId: run.messageId })
    case 'notes_search':
    case 'notes_save': return appApi(token, '/api/workspace-tool/notes', { action: request.name === 'notes_search' ? 'search' : 'save', ...body })
    case 'http_request': return appApi(token, '/api/workspace-tool/http-request', body)
    case 'spreadsheet_query':
    case 'calendar_query': return appApi(token, '/api/workspace-tool/data-query', { action: request.name === 'spreadsheet_query' ? 'spreadsheet' : 'calendar', ...body })
    case 'tax_return': {
      const folder = typeof body.folder === 'string' && body.folder.trim()
        ? body.folder.trim()
        : (run.ragFolderPath?.trim() || undefined)
      return appApi(token, '/api/workspace-tool/tax', { ...body, ...(folder ? { folder } : {}), sessionId: run.chatId, messageId: run.messageId, workspaceId: run.workspaceId ?? undefined })
    }
    case 'pdf_document': return appApi(token, '/api/workspace-tool/pdf-document', { ...body, sessionId: run.chatId, messageId: run.messageId, workspaceId: run.workspaceId ?? undefined })
    case 'workbook_document': return appApi(token, '/api/workspace-tool/workbook-document', { ...body, sessionId: run.chatId, messageId: run.messageId, workspaceId: run.workspaceId ?? undefined })
    case 'word_document': return appApi(token, '/api/workspace-tool/word-document', { ...body, sessionId: run.chatId, messageId: run.messageId, workspaceId: run.workspaceId ?? undefined })
    case 'csv_document': return appApi(token, '/api/workspace-tool/csv-document', { ...body, sessionId: run.chatId, messageId: run.messageId, workspaceId: run.workspaceId ?? undefined })
    case 'email_document': return appApi(token, '/api/workspace-tool/email-document', { ...body, sessionId: run.chatId, messageId: run.messageId, workspaceId: run.workspaceId ?? undefined })
    case 'markdown_document': return appApi(token, '/api/workspace-tool/markdown-document', { ...body, sessionId: run.chatId, messageId: run.messageId, workspaceId: run.workspaceId ?? undefined })
    case 'slides_document': return appApi(token, '/api/workspace-tool/slides-document', { ...body, sessionId: run.chatId, messageId: run.messageId, workspaceId: run.workspaceId ?? undefined })
    case 'archive_document': return appApi(token, '/api/workspace-tool/archive-document', { ...body, sessionId: run.chatId, messageId: run.messageId, workspaceId: run.workspaceId ?? undefined })
    case 'calendar_document': return appApi(token, '/api/workspace-tool/calendar-document', { ...body, sessionId: run.chatId, messageId: run.messageId, workspaceId: run.workspaceId ?? undefined })
    case 'mermaid_document': return appApi(token, '/api/workspace-tool/mermaid-document', { ...body, sessionId: run.chatId, messageId: run.messageId, workspaceId: run.workspaceId ?? undefined })
    default: return { ok: false, status: 400, data: { error: `Unsupported WorkSpaces tool: ${(request as { name: string }).name}` } }
  }
}
