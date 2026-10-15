import crypto from 'node:crypto'
import { prisma } from './prisma'
import { signToken } from './auth'
import { extractWorkspaceToolRequest, buildWorkspaceToolRequestFromNativeCall, type WorkspaceToolRequest } from './workspace-tool-tools'
import { finalizeChatSession, type StoredChatMessage } from './chat-sessions'
import { getWorkspaceToolWorkspaceContext } from './workspace-tool-project-workspaces'

type JsonRecord = Record<string, unknown>

const DEFAULT_APP_URL = 'http://127.0.0.1:3000'
const MAX_TOOL_ROUNDS = 100
const RUN_TIMEOUT_MS = 15 * 60 * 1000

function encryptionKey() {
  const secret = process.env.JWT_SECRET?.trim()
  if (!secret) throw new Error('JWT_SECRET is required to persist a WorkSpaces run.')
  return crypto.createHash('sha256').update(`peakui-workspace-run:${secret}`).digest()
}

function encryptSecrets(secrets: JsonRecord) {
  if (Object.keys(secrets).length === 0) return null
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(secrets), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`
}

function decryptSecrets(value: string | null) {
  if (!value) return {}
  const [version, ivValue, tagValue, ciphertextValue] = value.split(':')
  if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) throw new Error('Invalid persisted WorkSpaces credentials.')
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
  const parsed = JSON.parse(plaintext) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid persisted WorkSpaces credentials.')
  return parsed as JsonRecord
}

export interface QueueWorkspaceAgentRunInput {
  userId: string
  chatRequest: JsonRecord
  persistedMessages: unknown[]
  title?: string
  idempotencyKey?: string
}

export interface WorkspaceAgentRunStatus {
  id: string
  chatId: string
  workspaceId: string | null
  status: string
  model: string
  error: string | null
  createdAt: string
  startedAt: string | null
  heartbeatAt: string | null
  completedAt: string | null
}

function preview(value: string, max = 800) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`
}

function appUrl() {
  return (process.env.WORKSPACE_APP_URL || DEFAULT_APP_URL).trim().replace(/\/+$/, '')
}

function eventPayload(input: JsonRecord) {
  return JSON.stringify(input)
}

function isTransientAppUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return message.includes('fetch failed')
    || message.includes('econnrefused')
    || message.includes('ehostunreach')
    || message.includes('socket hang up')
    || message.includes('und_err_connect')
}

async function appendRunEvent(runId: string, sequence: number, payload: JsonRecord) {
  await prisma.workspaceAgentRunEvent.create({
    data: { runId, sequence, payload: eventPayload(payload) },
  })
}

async function setRunStatus(runId: string, status: string, extra: JsonRecord = {}) {
  await prisma.workspaceAgentRun.update({
    where: { id: runId },
    data: {
      status,
      heartbeatAt: new Date(),
      ...(status === 'running' ? { startedAt: new Date() } : {}),
      ...(status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'waiting_approval'
        ? { completedAt: new Date() }
        : {}),
      ...(typeof extra.error === 'string' ? { error: extra.error } : {}),
      ...(typeof extra.model === 'string' ? { model: extra.model } : {}),
      ...(typeof extra.assistantJson === 'string' ? { assistantJson: extra.assistantJson } : {}),
    },
  })
}

export async function queueWorkspaceAgentRun(input: QueueWorkspaceAgentRunInput) {
  const request = { ...input.chatRequest }
  const secrets: JsonRecord = {}
  for (const key of ['api_key', 'apiKey']) {
    if (typeof request[key] === 'string' && request[key].trim()) secrets[key] = request[key]
    delete request[key]
  }

  const chatId = typeof request.chat_id === 'string' ? request.chat_id.trim() : ''
  if (!chatId) throw new Error('A WorkSpaces chat id is required.')

  return prisma.workspaceAgentRun.create({
    data: {
      userId: input.userId,
      chatId,
      idempotencyKey: input.idempotencyKey?.trim() || null,
      workspaceId: typeof request.workspace_id === 'string' ? request.workspace_id.trim() || null : null,
      requestJson: JSON.stringify(request),
      secretsCiphertext: encryptSecrets(secrets),
      persistedJson: JSON.stringify(Array.isArray(input.persistedMessages) ? input.persistedMessages : []),
      status: 'queued',
      model: typeof request.model === 'string' ? request.model : '',
    },
  })
}

export async function getWorkspaceAgentRun(userId: string, runId: string) {
  return prisma.workspaceAgentRun.findFirst({ where: { id: runId, userId } })
}

export async function getWorkspaceAgentRunByIdempotencyKey(userId: string, key: string) {
  return prisma.workspaceAgentRun.findFirst({ where: { userId, idempotencyKey: key } })
}

export async function listWorkspaceAgentRuns(userId: string, chatId?: string) {
  return prisma.workspaceAgentRun.findMany({
    where: { userId, ...(chatId ? { chatId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
}

export async function getWorkspaceAgentRunEvents(userId: string, runId: string, after = 0) {
  const run = await getWorkspaceAgentRun(userId, runId)
  if (!run) return null
  const events = await prisma.workspaceAgentRunEvent.findMany({
    where: { runId, sequence: { gt: Math.max(0, after) } },
    orderBy: { sequence: 'asc' },
  })
  return { run, events }
}

function userMessage(content: string): StoredChatMessage {
  return { id: crypto.randomUUID(), role: 'user', content, hidden: true, createdAt: new Date().toISOString() }
}

function assistantMessage(content: string, id: string, thinking = ''): StoredChatMessage {
  return {
    id,
    role: 'assistant',
    content,
    ...(thinking ? { thinking } : {}),
    createdAt: new Date().toISOString(),
  }
}

function stripTransientAttachmentData(messages: StoredChatMessage[]) {
  return messages.map(message => ({
    ...message,
    ...(Array.isArray((message as unknown as JsonRecord).images)
      ? {
          images: ((message as unknown as JsonRecord).images as unknown[]).map(image => {
            if (!image || typeof image !== 'object') return image
            const metadata = { ...(image as JsonRecord) }
            delete metadata.data
            return metadata
          }),
        }
      : {}),
    ...(Array.isArray((message as unknown as JsonRecord).attachments)
      ? {
          attachments: ((message as unknown as JsonRecord).attachments as unknown[]).map(attachment => {
            if (!attachment || typeof attachment !== 'object') return attachment
            const value = attachment as JsonRecord
            return {
              ...value,
              ...(Array.isArray(value.pageImages)
                ? { pageImages: (value.pageImages as unknown[]).map(page => {
                    if (!page || typeof page !== 'object') return page
                    const metadata = { ...(page as JsonRecord) }
                    delete metadata.data
                    return metadata
                  }) }
                : {}),
            }
          }),
        }
      : {}),
  }))
}

function asToolResult(name: string, data: unknown, ok: boolean) {
  const encoded = JSON.stringify(data, null, 2)
  return `Tool: ${name}\nStatus: ${ok ? 'success' : 'failed'}\n${encoded.slice(0, 240_000)}`
}

async function userToken(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error('WorkSpaces run owner no longer exists.')
  return signToken({ userId: user.id, username: user.username, role: user.role, tokenVersion: user.tokenVersion })
}

async function callAppApi(token: string, path: string, body: JsonRecord) {
  const response = await fetch(`${appUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `auth_token=${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  const data = await response.json().catch(async () => ({ error: await response.text().catch(() => '') }))
  return { ok: response.ok, status: response.status, data }
}

async function callApprovedTool(token: string, requestPath: string, executePath: string, request: JsonRecord, run: { chatId: string; messageId: string }) {
  const payload = { ...request, sessionId: run.chatId, messageId: run.messageId }
  const decision = await callAppApi(token, requestPath, payload)
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
    return callAppApi(token, executePath, { ...payload, ...approvalToken })
  }
  return decision
}

async function executeWorkspaceTool(token: string, request: WorkspaceToolRequest, run: { chatId: string; messageId: string; workspaceRelativePath?: string }) {
  const originalBody = request.request as unknown as JsonRecord
  const body = { ...originalBody }
  switch (request.name) {
    case 'web': return callAppApi(token, '/api/web/context', { query: body.query })
    case 'filesystem': {
      if (body.action === 'write' || body.action === 'append' || body.action === 'mkdir') {
        return callApprovedTool(token, '/api/workspace-tool/filesystem/request', '/api/workspace-tool/filesystem', body, run)
      }
      return callAppApi(token, '/api/workspace-tool/filesystem', body)
    }
    case 'shell': return callApprovedTool(token, '/api/workspace-tool/shell/request', '/api/workspace-tool/shell/execute', body, run)
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
      return callAppApi(token, '/api/workspace-tool/browser', { ...body, sessionId: run.chatId })
    }
    case 'unified_browser': {
      if (body.action === 'submit' || body.action === 'research_batch') {
        return callApprovedTool(token, '/api/workspace-tool/uwaf-browser/request', '/api/workspace-tool/uwaf-browser', body, run)
      }
      if (body.action === 'wait_for_user') return { ok: false, data: { error: 'Human browser assistance requires the browser to remain open.', code: 'human_assistance_required' } }
      return callAppApi(token, '/api/workspace-tool/uwaf-browser', { ...body, sessionId: run.chatId })
    }
    case 'fetch_summarize': return callAppApi(token, '/api/workspace-tool/fetch-summarize', body)
    case 'image_generation': return callAppApi(token, '/api/image-gen/generate', { ...body, sessionId: run.chatId, messageId: run.messageId })
    case 'notes_search':
    case 'notes_save': return callAppApi(token, '/api/workspace-tool/notes', { action: request.name === 'notes_search' ? 'search' : 'save', ...body })
    case 'http_request': return callAppApi(token, '/api/workspace-tool/http-request', body)
    case 'spreadsheet_query':
    case 'calendar_query': return callAppApi(token, '/api/workspace-tool/data-query', { action: request.name === 'spreadsheet_query' ? 'spreadsheet' : 'calendar', ...body })
    case 'tax_return': return callAppApi(token, '/api/workspace-tool/tax', { ...body, sessionId: run.chatId, messageId: run.messageId })
    case 'pdf_document': return callAppApi(token, '/api/workspace-tool/pdf-document', { ...body, sessionId: run.chatId, messageId: run.messageId })
    case 'workbook_document': return callAppApi(token, '/api/workspace-tool/workbook-document', { ...body, sessionId: run.chatId, messageId: run.messageId })
    case 'word_document': return callAppApi(token, '/api/workspace-tool/word-document', { ...body, sessionId: run.chatId, messageId: run.messageId })
    case 'csv_document': return callAppApi(token, '/api/workspace-tool/csv-document', { ...body, sessionId: run.chatId, messageId: run.messageId })
    case 'email_document': return callAppApi(token, '/api/workspace-tool/email-document', { ...body, sessionId: run.chatId, messageId: run.messageId })
    case 'markdown_document': return callAppApi(token, '/api/workspace-tool/markdown-document', { ...body, sessionId: run.chatId, messageId: run.messageId })
    case 'slides_document': return callAppApi(token, '/api/workspace-tool/slides-document', { ...body, sessionId: run.chatId, messageId: run.messageId })
    case 'archive_document': return callAppApi(token, '/api/workspace-tool/archive-document', { ...body, sessionId: run.chatId, messageId: run.messageId })
    case 'calendar_document': return callAppApi(token, '/api/workspace-tool/calendar-document', { ...body, sessionId: run.chatId, messageId: run.messageId })
    case 'mermaid_document': return callAppApi(token, '/api/workspace-tool/mermaid-document', { ...body, sessionId: run.chatId, messageId: run.messageId })
    default: return { ok: false, status: 400, data: { error: `Unsupported WorkSpaces tool: ${(request as { name: string }).name}` } }
  }
}

async function readModelRound(token: string, request: JsonRecord, runId: string, sequence: { value: number }) {
  const response = await fetch(`${appUrl()}/api/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `auth_token=${token}` },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
  })
  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => '')
    throw new Error(body || `Model request failed with HTTP ${response.status}.`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let thinking = ''
  let finalFrame: JsonRecord = {}
  let nativeCalls: Array<{ name: string; args: JsonRecord }> = []
  const statusFrames: JsonRecord[] = []

  const consume = (line: string) => {
    let frame: JsonRecord
    try { frame = JSON.parse(line) as JsonRecord } catch { return }
    if (typeof frame.error === 'string' && frame.error.trim()) throw new Error(frame.error)
    if (typeof frame.status === 'string' || frame.context_usage !== undefined) {
      statusFrames.push(frame)
    }
    if (Array.isArray(frame.native_tool_calls)) {
      nativeCalls = frame.native_tool_calls.filter((item): item is { name: string; args: JsonRecord } => {
        if (!item || typeof item !== 'object') return false
        const candidate = item as JsonRecord
        return typeof candidate.name === 'string' && Boolean(candidate.args && typeof candidate.args === 'object')
      })
    }
    const message = frame.message && typeof frame.message === 'object' ? frame.message as JsonRecord : null
    if (typeof message?.content === 'string') content += message.content
    if (typeof message?.thinking === 'string') thinking += message.thinking
    if (frame.done === true) finalFrame = frame
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index = buffer.indexOf('\n')
    while (index !== -1) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line) consume(line)
      index = buffer.indexOf('\n')
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) consume(buffer.trim())
  for (const frame of statusFrames) await appendRunEvent(runId, ++sequence.value, frame)
  return { content, thinking, nativeCalls, finalFrame }
}

async function executeRun(runId: string) {
  const run = await prisma.workspaceAgentRun.findUnique({ where: { id: runId } })
  if (!run || run.status !== 'queued') return

  const claimed = await prisma.workspaceAgentRun.updateMany({ where: { id: runId, status: 'queued' }, data: { status: 'running', startedAt: new Date(), heartbeatAt: new Date() } })
  if (claimed.count !== 1) return

  const seq = { value: 0 }
  try {
    const lastEvent = await prisma.workspaceAgentRunEvent.findFirst({
      where: { runId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    })
    seq.value = lastEvent?.sequence ?? 0
    const request = { ...JSON.parse(run.requestJson) as JsonRecord, ...decryptSecrets(run.secretsCiphertext) }
    const persisted = JSON.parse(run.persistedJson) as StoredChatMessage[]
    const token = await userToken(run.userId)
    const workspaceContext = run.workspaceId
      ? await getWorkspaceToolWorkspaceContext(run.userId, run.workspaceId).catch(() => null)
      : null
    const maxRounds = Math.min(MAX_TOOL_ROUNDS, Math.max(1, Number((await prisma.userSettings.findUnique({ where: { userId: run.userId }, select: { workspaceToolMaxToolRoundsPerTurn: true } }))?.workspaceToolMaxToolRoundsPerTurn || 100)))
    const conversation = Array.isArray(request.messages) ? [...request.messages] as JsonRecord[] : []
    const savedMessages = Array.isArray(persisted) ? [...persisted] : []
    let finalContent = ''
    let finalThinking = ''
    const finalId = typeof request.id === 'string' && request.id ? request.id : crypto.randomUUID()

    for (let round = 0; round < maxRounds; round += 1) {
      const currentRun = await prisma.workspaceAgentRun.findUnique({ where: { id: runId }, select: { status: true } })
      if (currentRun?.status === 'cancelled') return
      await prisma.workspaceAgentRun.update({ where: { id: runId }, data: { heartbeatAt: new Date() } })
      const roundRequest = { ...request, messages: conversation, id: finalId }
      await appendRunEvent(runId, ++seq.value, {
        status: 'model',
        model: typeof request.model === 'string' ? request.model : '',
        round: round + 1,
      })
      const response = await readModelRound(token, roundRequest, runId, seq)
      const afterModelRun = await prisma.workspaceAgentRun.findUnique({ where: { id: runId }, select: { status: true } })
      if (afterModelRun?.status === 'cancelled') return
      const nativeRequest = response.nativeCalls.length > 0
        ? buildWorkspaceToolRequestFromNativeCall(response.nativeCalls[0].name, response.nativeCalls[0].args)
        : null
      const parsed = extractWorkspaceToolRequest(response.content)
      const tool = nativeRequest || parsed.request
      const cleaned = parsed.cleanedContent || response.content
      finalContent = cleaned.trim()
      finalThinking = response.thinking

      if (!tool) break

      await appendRunEvent(runId, ++seq.value, {
        status: tool.name === 'shell' ? 'tool-shell' : tool.name === 'code' ? 'tool-code' : tool.name === 'filesystem' ? 'tool-filesystem' : tool.name.includes('browser') ? 'tool-browser' : 'web-search',
        tool: tool.name,
        summary: preview(JSON.stringify(tool.request)),
      })

      const toolMessageId = crypto.randomUUID()
      const result = await executeWorkspaceTool(token, tool, {
        chatId: run.chatId,
        messageId: toolMessageId,
        workspaceRelativePath: workspaceContext?.workspace.relativePath,
      })
      const afterToolRun = await prisma.workspaceAgentRun.findUnique({ where: { id: runId }, select: { status: true } })
      if (afterToolRun?.status === 'cancelled') return
      const resultText = asToolResult(tool.name, result.data, result.ok)
      const toolAssistant: JsonRecord = { role: 'assistant', content: response.content, hidden: true, id: toolMessageId }
      const toolResult: JsonRecord = { role: 'user', content: resultText, hidden: true }
      conversation.push(toolAssistant, toolResult)
      savedMessages.push({ ...assistantMessage(response.content, toolMessageId, response.thinking), hidden: true }, userMessage(resultText))
      finalContent = ''
      if (!result.ok && (result.data as JsonRecord).code === 'approval_required') {
        finalContent = `The ${tool.name} step is waiting for approval. Reopen this session and approve it to continue.`
        break
      }
    }

    if (!finalContent.trim()) finalContent = 'The WorkSpaces run finished without a final assistant message.'
    const assistant = assistantMessage(finalContent, finalId, finalThinking)
    const finalFrame = { message: { content: finalContent, ...(finalThinking ? { thinking: finalThinking } : {}) }, done: true, id: finalId }
    await appendRunEvent(runId, ++seq.value, finalFrame)
    await finalizeChatSession(run.userId, {
      chatId: run.chatId,
      surface: 'workspace-tool',
      messageId: assistant.id,
      message: assistant,
      messages: stripTransientAttachmentData(savedMessages),
    })
    const waitingForApproval = finalContent.includes('is waiting for approval.')
    await setRunStatus(runId, waitingForApproval ? 'waiting_approval' : 'succeeded', { model: typeof request.model === 'string' ? request.model : '', assistantJson: JSON.stringify(assistant) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (isTransientAppUnavailable(error)) {
      await appendRunEvent(runId, ++seq.value, { status: 'retrying', id: run.chatId, summary: 'PeakUI app is restarting; the daemon will retry this run.' })
      await prisma.workspaceAgentRun.update({
        where: { id: runId },
        data: { status: 'queued', startedAt: null, heartbeatAt: null, error: message },
      })
      return
    }
    await appendRunEvent(runId, ++seq.value, { error: message, id: run.chatId })
    try {
      const failedRun = await prisma.workspaceAgentRun.findUnique({ where: { id: runId } })
      if (failedRun) {
        const persisted = JSON.parse(failedRun.persistedJson) as StoredChatMessage[]
        const assistant = assistantMessage(`**Server WorkSpaces run failed:** ${message}`, crypto.randomUUID())
        await finalizeChatSession(failedRun.userId, {
          chatId: failedRun.chatId,
          surface: 'workspace-tool',
          messageId: assistant.id,
          message: assistant,
          messages: stripTransientAttachmentData(Array.isArray(persisted) ? persisted : []),
        })
      }
    } catch (persistError) {
      console.error('[workspace-agent-run] failed to persist error message:', persistError)
    }
    await setRunStatus(runId, 'failed', { error: message })
  }
}

export async function processQueuedWorkspaceAgentRuns() {
  const staleAt = new Date(Date.now() - 20 * 60 * 1000)
  await prisma.workspaceAgentRun.updateMany({ where: { status: 'running', heartbeatAt: { lt: staleAt } }, data: { status: 'queued', startedAt: null, heartbeatAt: null, error: null } })
  const queued = await prisma.workspaceAgentRun.findMany({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' }, take: 1, select: { id: true } })
  if (queued[0]) await executeRun(queued[0].id)
}

export function toWorkspaceAgentRunStatus(run: { id: string; chatId: string; workspaceId: string | null; status: string; model: string; error: string | null; createdAt: Date; startedAt: Date | null; heartbeatAt: Date | null; completedAt: Date | null }): WorkspaceAgentRunStatus {
  return {
    id: run.id,
    chatId: run.chatId,
    workspaceId: run.workspaceId,
    status: run.status,
    model: run.model,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    heartbeatAt: run.heartbeatAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
  }
}
