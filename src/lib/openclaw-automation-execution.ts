import crypto from 'node:crypto'
import { prisma } from './prisma'
import { getUserSettings } from './settings'
import { getModelCapacityProfile } from './model-context'
import { buildOpenClawSystemPrompt } from './openclaw-prompt'
import { unloadOtherOllamaModels } from './ollama-control'
import { buildOllamaKeepAlive } from './ollama-keepalive'
import { getOpenClawWorkspaceContext } from './openclaw-project-workspaces'
import { buildMemoryContext, loadLongTermMemory, loadRecentMemory } from './memory'
import { collapseSystemMessages } from './message-trim'
import {
  finalizeChatSession,
  parseStoredChatMessages,
  serializeStoredChatMessages,
  upsertChatSession,
  type StoredChatMessage,
} from './chat-sessions'

export interface QueueAutomationExecutionInput {
  userId: string
  sourceKind: string
  sourceId?: string | null
  sessionId?: string | null
  workspaceId?: string | null
  title: string
  prompt: string
  deliveryMode?: 'background-run'
}

interface OllamaChatResponse {
  message?: {
    content?: unknown
  }
}

function previewText(value: string, maxLength = 280) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}...`
}

function buildAutomationUserMessage(run: {
  id: string
  sourceKind: string
  title: string
  prompt: string
}): StoredChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [
      `[Automation trigger: ${run.title}]`,
      run.prompt.trim(),
    ].join('\n\n'),
    meta: {
      automation: true,
      executionRunId: run.id,
      sourceKind: run.sourceKind,
    },
  }
}

function normalizeConversationForAutomation(messages: StoredChatMessage[]) {
  return messages
    .filter(message => !message.hidden)
    .filter(message => message.role === 'user' || message.role === 'assistant' || message.role === 'system')
    .slice(-12)
    .map(message => ({
      role: message.role,
      content: message.content,
    }))
    .filter(message => message.content.trim().length > 0)
}

async function callOllamaForAutomation(options: {
  baseUrl: string
  model: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  temperature: number
  useModelDefaultTemperature: boolean
  contextLength: number
  useModelDefaultContext: boolean
  keepAlive?: string
}) {
  const ollamaOptions: Record<string, number> = {}
  if (!options.useModelDefaultTemperature) {
    ollamaOptions.temperature = options.temperature
  }
  if (!options.useModelDefaultContext) {
    ollamaOptions.num_ctx = options.contextLength
  }

  const response = await fetch(`${options.baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options.model,
      // Unattended runs stack several system messages (system prompt, automation
      // context, memory, long-term memory). Some model chat templates reject any
      // system message that is not first, so collapse them into one leading
      // system message before sending.
      messages: collapseSystemMessages(options.messages),
      stream: false,
      ...(options.keepAlive ? { keep_alive: options.keepAlive } : {}),
      options: ollamaOptions,
    }),
    signal: AbortSignal.timeout(120000),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Ollama returned ${response.status} for unattended automation execution.`)
  }

  const data = await response.json().catch(() => ({})) as OllamaChatResponse
  const content = typeof data.message?.content === 'string' ? data.message.content.trim() : ''
  if (!content) {
    throw new Error('Ollama unattended automation run returned an empty response.')
  }
  return content
}

async function createAutomationExecutionNotification(userId: string, input: {
  kind: 'automation_run_succeeded' | 'automation_run_failed' | 'automation_run_skipped'
  title: string
  message: string
  sessionId?: string | null
  sourceKind?: string | null
  sourceId?: string | null
}) {
  await prisma.automationNotification.create({
    data: {
      userId,
      kind: input.kind,
      title: input.title,
      message: input.message,
      sessionId: input.sessionId ?? null,
      sourceKind: input.sourceKind ?? null,
      sourceId: input.sourceId ?? null,
    },
  })
}

async function createAutomationExecutionEvent(userId: string, input: {
  kind: string
  title: string
  message: string
  status: string
  sourceKind?: string | null
  sourceId?: string | null
}) {
  await prisma.automationEvent.create({
    data: {
      userId,
      kind: input.kind,
      title: input.title,
      message: input.message,
      status: input.status,
      sourceKind: input.sourceKind ?? null,
      sourceId: input.sourceId ?? null,
    },
  })
}

async function ensureAutomationSession(userId: string, requestedSessionId: string | null | undefined, title: string) {
  if (requestedSessionId) {
    const existing = await prisma.chatSession.findFirst({
      where: { id: requestedSessionId, userId, surface: 'openclaw' },
    })
    if (existing) return existing
  }

  const created = await upsertChatSession(userId, {
    title: `Automation · ${title}`.slice(0, 80),
    messages: [],
    surface: 'openclaw',
  })

  return prisma.chatSession.findUniqueOrThrow({ where: { id: created.session.id } })
}

export async function queueAutomationExecution(input: QueueAutomationExecutionInput) {
  return prisma.automationExecutionRun.create({
    data: {
      userId: input.userId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId ?? null,
      deliveryMode: 'background-run',
      sessionId: input.sessionId ?? null,
      workspaceId: input.workspaceId ?? null,
      title: input.title.trim(),
      prompt: input.prompt.trim(),
      provider: 'ollama',
      model: '',
      status: 'queued',
    },
  })
}

async function markRunSkipped(runId: string, error: string) {
  await prisma.automationExecutionRun.update({
    where: { id: runId },
    data: {
      status: 'skipped',
      error,
      completedAt: new Date(),
    },
  })
}

async function executeAutomationRun(runId: string) {
  const run = await prisma.automationExecutionRun.findUnique({ where: { id: runId } })
  if (!run) return

  const settings = await getUserSettings(run.userId)
  const resolvedModel = settings.openClawAutomationExecutionModel.trim()
    || (settings.openClawProvider === 'ollama' ? settings.openClawModel.trim() : '')

  if (!settings.openClawAutomationExecutionEnabled) {
    await markRunSkipped(run.id, 'Unattended model execution is disabled in personal settings.')
    return
  }

  if (!resolvedModel) {
    await markRunSkipped(run.id, 'No unattended automation model is configured in Settings.')
    return
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const recentRunCount = await prisma.automationExecutionRun.count({
    where: {
      userId: run.userId,
      createdAt: { gte: oneHourAgo },
      status: { in: ['queued', 'running', 'succeeded'] },
    },
  })

  if (recentRunCount > settings.openClawAutomationExecutionMaxRunsPerHour) {
    const error = `Skipped unattended run because the ${settings.openClawAutomationExecutionMaxRunsPerHour}/hour execution budget was reached.`
    await markRunSkipped(run.id, error)
    await createAutomationExecutionNotification(run.userId, {
      kind: 'automation_run_skipped',
      title: `Automation run skipped: ${run.title}`,
      message: error,
      sessionId: run.sessionId,
      sourceKind: run.sourceKind,
      sourceId: run.sourceId,
    })
    await createAutomationExecutionEvent(run.userId, {
      kind: 'automation_run_skipped',
      title: `Automation run skipped: ${run.title}`,
      message: error,
      status: 'skipped',
      sourceKind: run.sourceKind,
      sourceId: run.sourceId,
    })
    return
  }

  try {
    const session = await ensureAutomationSession(run.userId, run.sessionId, run.title)
    const sessionMessages = parseStoredChatMessages(session.messages)
    const userTriggerMessage = buildAutomationUserMessage(run)
    const preAssistantMessages = [...sessionMessages, userTriggerMessage]

    const workspaceContext = settings.openClawAutomationExecutionAttachWorkspace && run.workspaceId
      ? await getOpenClawWorkspaceContext(run.userId, run.workspaceId).catch(() => null)
      : null

    const [recentMemories, longTermMemory] = settings.openClawAutomationExecutionAttachMemory
      ? await Promise.all([loadRecentMemory(2), loadLongTermMemory()])
      : [[], '']
    const memoryContext = settings.openClawAutomationExecutionAttachMemory
      ? buildMemoryContext(recentMemories)
      : ''

    const capacityProfile = await getModelCapacityProfile(resolvedModel, 'ollama', settings.ollamaHost).catch(() => null)
    const systemPrompt = buildOpenClawSystemPrompt({
      provider: 'ollama',
      model: resolvedModel,
      promptTier: settings.openClawPromptTier === 'auto'
        ? (capacityProfile?.promptTier ?? 'full')
        : settings.openClawPromptTier,
      persona: {
        name: settings.openClawPersonaName,
        tone: settings.openClawPersonaTone,
        expertise: settings.openClawPersonaExpertise,
        boundaries: settings.openClawPersonaBoundaries,
        operatingInstructions: settings.openClawPersonaOperatingInstructions,
      },
      userProfile: {
        name: settings.openClawUserProfileName,
        role: settings.openClawUserProfileRole,
        preferences: settings.openClawUserProfilePreferences,
        context: settings.openClawUserProfileContext,
      },
      workspace: workspaceContext
        ? {
            name: workspaceContext.workspace.name,
            relativePath: workspaceContext.workspace.relativePath,
            hostPath: workspaceContext.workspace.hostPath,
            bootInstructions: workspaceContext.bootInstructions,
            toolsInstructions: workspaceContext.toolsInstructions,
            skillTemplates: workspaceContext.skillTemplates,
          }
        : undefined,
      internetToolEnabled: false,
      shellEnabled: false,
      filesystemEnabled: false,
      filesystemWriteEnabled: false,
      codeExecutionEnabled: false,
      browserMode: 'deny',
      uwafBrowserMode: 'deny',
    })

    const conversation = normalizeConversationForAutomation(preAssistantMessages)
    const automationContext = [
      `This is an unattended WorkSpaces automation run triggered in the background.`,
      `Execution source: ${run.sourceKind}.`,
      `Execution title: ${run.title}.`,
      'There is no user waiting live for this reply. Produce a concrete, task-forward result and continue the thread as if you are posting an autonomous update.',
      'Do not request tool usage in this unattended mode. Work only with the supplied thread, workspace, and memory context.',
      'If the trigger is underspecified, make a reasonable assumption and state it briefly instead of stalling.',
    ].join('\n')

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      { role: 'system', content: automationContext },
      ...(memoryContext ? [{ role: 'system' as const, content: memoryContext }] : []),
      ...(longTermMemory.trim() ? [{ role: 'system' as const, content: `Long-term memory:\n${longTermMemory.trim()}` }] : []),
      ...conversation.map(message => ({
        role: message.role as 'system' | 'user' | 'assistant',
        content: message.content,
      })),
    ]

    if (settings.exclusiveOllamaModels) {
      await unloadOtherOllamaModels(settings.ollamaHost, resolvedModel)
    }

    const content = await callOllamaForAutomation({
      baseUrl: settings.ollamaHost,
      model: resolvedModel,
      messages,
      temperature: settings.temperature,
      useModelDefaultTemperature: settings.ollamaUseModelDefaultTemperature,
      contextLength: settings.contextLength,
      useModelDefaultContext: settings.ollamaUseModelDefaultContext,
      keepAlive: buildOllamaKeepAlive(settings, resolvedModel),
    })

    await prisma.chatSession.update({
      where: { id: session.id },
      data: {
        messages: serializeStoredChatMessages(preAssistantMessages),
        updatedAt: new Date(),
      },
    })

    const assistantMessageId = crypto.randomUUID()
    await finalizeChatSession(run.userId, {
      chatId: session.id,
      surface: 'openclaw',
      messageId: assistantMessageId,
      message: {
        id: assistantMessageId,
        role: 'assistant',
        content,
        meta: {
          automation: true,
          executionRunId: run.id,
          sourceKind: run.sourceKind,
        },
      },
    })

    await prisma.automationExecutionRun.update({
      where: { id: run.id },
      data: {
        model: resolvedModel,
        status: 'succeeded',
        resultPreview: previewText(content),
        sessionId: session.id,
        completedAt: new Date(),
      },
    })

    await createAutomationExecutionNotification(run.userId, {
      kind: 'automation_run_succeeded',
      title: `Automation run complete: ${run.title}`,
      message: previewText(content, 400),
      sessionId: session.id,
      sourceKind: run.sourceKind,
      sourceId: run.sourceId,
    })
    await createAutomationExecutionEvent(run.userId, {
      kind: 'automation_run_succeeded',
      title: `Automation run complete: ${run.title}`,
      message: previewText(content, 400),
      status: 'succeeded',
      sourceKind: run.sourceKind,
      sourceId: run.sourceId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await prisma.automationExecutionRun.update({
      where: { id: run.id },
      data: {
        model: resolvedModel,
        status: 'failed',
        error: message,
        completedAt: new Date(),
      },
    })
    await createAutomationExecutionNotification(run.userId, {
      kind: 'automation_run_failed',
      title: `Automation run failed: ${run.title}`,
      message,
      sessionId: run.sessionId,
      sourceKind: run.sourceKind,
      sourceId: run.sourceId,
    })
    await createAutomationExecutionEvent(run.userId, {
      kind: 'automation_run_failed',
      title: `Automation run failed: ${run.title}`,
      message,
      status: 'failed',
      sourceKind: run.sourceKind,
      sourceId: run.sourceId,
    })
  }
}

export async function processQueuedAutomationRuns(limit = 3) {
  const queuedRuns = await prisma.automationExecutionRun.findMany({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })

  for (const queuedRun of queuedRuns) {
    const claimed = await prisma.automationExecutionRun.updateMany({
      where: { id: queuedRun.id, status: 'queued' },
      data: {
        status: 'running',
        startedAt: new Date(),
        error: null,
      },
    })

    if (claimed.count === 0) continue
    await executeAutomationRun(queuedRun.id)
  }
}
