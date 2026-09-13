/**
 * POST /api/workspace-tool/session-summary
 * Generate and save a session summary when a WorkSpaces session ends
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { join } from 'node:path'
import { prisma } from '@/lib/prisma'
import { getUserSettings } from '@/lib/settings'
import {
  saveSessionSummaryForUser,
  generateSessionSummaryPrompt,
  parseGeneratedSummary,
  appendToDailyMemoryForUser,
  type SessionSummary,
  ensureUserMemoryDir,
  getUserMemoryDir,
} from '@/lib/memory'
import { withFileLock } from '@/lib/atomic-file'
import { parseStoredChatMessages } from '@/lib/chat-sessions'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'

const summaryRequest = z.object({
  sessionId: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/),
  objective: z.string().trim().max(2000).optional(),
  apiKey: z.string().max(4096).optional(),
})

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use'], {
    forbiddenMessage: 'WorkSpaces access is not granted for this account.',
    actionRequired: 'Grant the WorkSpaces permission in Settings -> User Management before generating WorkSpaces session summaries for this user.',
  })
  if ('response' in access) return access.response
  const userId = access.userId

  try {
    const validated = summaryRequest.safeParse(await request.json().catch(() => null))
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Invalid session summary request' },
        { status: 400 }
      )
    }
    const { sessionId, objective, apiKey } = validated.data
    const settings = await getUserSettings(userId)
    if (!settings.workspaceToolSessionSummariesEnabled) {
      return NextResponse.json({ success: true, skipped: true, reason: 'summaries_disabled' })
    }

    // The database transcript is authoritative. Do not summarize a client-
    // supplied transcript: it may be stale, incomplete, or contain fields that
    // storage normalization intentionally rejected.
    const owningSession = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true, title: true, messages: true, summary: true },
    })
    if (!owningSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const transcriptSnapshot = owningSession.messages
    const storedMessages = parseStoredChatMessages(transcriptSnapshot)

    // Generate summary using only visible messages from the stored transcript.
    const summaryPrompt = generateSessionSummaryPrompt(owningSession.title, storedMessages, objective)

    const provider = settings.workspaceToolProvider || 'ollama'
    const model = settings.workspaceToolModel || ''
    const baseUrl = settings.workspaceToolBaseUrl || ''

    let summaryText = ''

    if (provider === 'ollama') {
      const ollamaHost = settings.ollamaUseCloudApi
        ? 'https://ollama.com'
        : settings.ollamaHost || 'http://127.0.0.1:11434'
      const ollamaApiKey = settings.ollamaUseCloudApi ? settings.ollamaApiKey || '' : ''
      const response = await fetch(`${ollamaHost}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(ollamaApiKey.trim() ? { Authorization: 'Bearer ' + ollamaApiKey.trim() } : {}),
        },
        body: JSON.stringify({
          model: model || 'gemma4:latest',
          prompt: summaryPrompt,
          stream: false,
          options: {
            temperature: 0.3,
            num_predict: 500,
          },
        }),
        signal: AbortSignal.timeout(120_000),
      })

      if (!response.ok) {
        throw new Error(`Ollama generate failed: ${response.status}`)
      }

      const data = await response.json()
      summaryText = data.response || ''
    } else {
      // OpenAI-compatible provider
      const url = baseUrl || 'https://router.huggingface.co/v1'
      const authToken = typeof apiKey === 'string' && apiKey.trim()
        ? apiKey.trim()
        : process.env.HUGGING_FACE_API_KEY || ''
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (authToken) {
        headers.Authorization = `Bearer ${authToken}`
      }
      const response = await fetch(`${url}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: model || 'Qwen/Qwen2.5-72B-Instruct',
          messages: [{ role: 'user', content: summaryPrompt }],
          max_tokens: 500,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(120_000),
      })

      if (!response.ok) {
        throw new Error(`Provider generate failed: ${response.status}`)
      }

      const data = await response.json()
      summaryText = data.choices?.[0]?.message?.content || ''
    }

    // Parse the generated summary
    if (typeof summaryText !== 'string' || summaryText.length > 32_000) {
      throw new Error('Invalid model summary response')
    }
    const parsed = parseGeneratedSummary(summaryText)
    if (!parsed.objective || !parsed.outcome) {
      return NextResponse.json({ error: 'Model returned an incomplete summary' }, { status: 502 })
    }

    // Create session summary object
    const sessionSummary: SessionSummary = {
      sessionId,
      title: owningSession.title,
      objective: parsed.objective || objective || '',
      outcome: parsed.outcome || '',
      keyFindings: parsed.keyFindings || [],
      nextSteps: parsed.nextSteps || [],
      createdAt: new Date().toISOString(),
    }

    // Update the chat session in database
    const summaryTextFull = [
      parsed.objective ? `Objective: ${parsed.objective}` : '',
      parsed.outcome ? `Outcome: ${parsed.outcome}` : '',
      parsed.keyFindings?.length ? `Key Findings:\n${parsed.keyFindings.map(f => `- ${f}`).join('\n')}` : '',
      parsed.nextSteps?.length ? `Next Steps:\n${parsed.nextSteps.map(s => `- ${s}`).join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')

    await ensureUserMemoryDir(userId)
    return await withFileLock(join(getUserMemoryDir(userId), 'summary-commit'), async () => {
    // Compare and write in ONE database statement. Serialize memory publication
    // as well, so an older generator cannot overwrite a newer published result.
    const updated = await prisma.chatSession.updateMany({
      where: { id: sessionId, userId, title: owningSession.title, messages: transcriptSnapshot, summary: owningSession.summary },
      data: { summary: summaryTextFull },
    })
    if (updated.count !== 1) {
      return NextResponse.json({ success: true, skipped: true, reason: 'stale_transcript' })
    }
    await saveSessionSummaryForUser(userId, sessionSummary)

    // Append to daily memory log (scoped to this user)
    const today = new Date().toISOString().split('T')[0]
    await appendToDailyMemoryForUser(userId, today, {
      sessionId,
      title: owningSession.title,
      mode: 'workspace-tool',
      summary: parsed.outcome || 'Session completed',
      timestamp: new Date().toISOString(),
    })

    return NextResponse.json({
      success: true,
      summary: sessionSummary,
    })
    })
  } catch (error) {
    console.error('[session-summary] Error generating summary:', error)
    return NextResponse.json(
      { error: 'Failed to generate session summary' },
      { status: 500 }
    )
  }
}
