/**
 * POST /api/workspace-tool/session-summary
 * Generate and save a session summary when a WorkSpaces session ends
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserSettings } from '@/lib/settings'
import {
  saveSessionSummaryForUser,
  generateSessionSummaryPrompt,
  parseGeneratedSummary,
  appendToDailyMemoryForUser,
  type SessionSummary,
} from '@/lib/memory'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use'], {
    forbiddenMessage: 'WorkSpaces access is not granted for this account.',
    actionRequired: 'Grant the WorkSpaces permission in Settings -> User Management before generating WorkSpaces session summaries for this user.',
  })
  if ('response' in access) return access.response
  const userId = access.userId

  try {
    const body = await request.json()
    const { sessionId, title, messages, objective, apiKey } = body as {
      sessionId: string
      title: string
      messages: Array<{ role: string; content: string }>
      objective?: string
      apiKey?: string
    }

    if (!sessionId || !title || !messages) {
      return NextResponse.json(
        { error: 'Missing required fields: sessionId, title, messages' },
        { status: 400 }
      )
    }

    // Verify the session belongs to this user before writing anything.
    const owningSession = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    })
    if (!owningSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Generate summary using the model
    const summaryPrompt = generateSessionSummaryPrompt(title, messages, objective)

    const settings = await getUserSettings(userId)

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
      })

      if (!response.ok) {
        throw new Error(`Provider generate failed: ${response.status}`)
      }

      const data = await response.json()
      summaryText = data.choices?.[0]?.message?.content || ''
    }

    // Parse the generated summary
    const parsed = parseGeneratedSummary(summaryText)

    // Create session summary object
    const sessionSummary: Partial<SessionSummary> = {
      sessionId,
      title,
      objective: parsed.objective || objective || '',
      outcome: parsed.outcome || '',
      keyFindings: parsed.keyFindings || [],
      nextSteps: parsed.nextSteps || [],
      createdAt: new Date().toISOString(),
    }

    // Save to memory directory (scoped to this user)
    await saveSessionSummaryForUser(userId, sessionSummary as SessionSummary)

    // Update the chat session in database
    const summaryTextFull = [
      parsed.objective ? `Objective: ${parsed.objective}` : '',
      parsed.outcome ? `Outcome: ${parsed.outcome}` : '',
      parsed.keyFindings?.length ? `Key Findings:\n${parsed.keyFindings.map(f => `- ${f}`).join('\n')}` : '',
      parsed.nextSteps?.length ? `Next Steps:\n${parsed.nextSteps.map(s => `- ${s}`).join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')

    await prisma.chatSession.update({
      where: { id: sessionId },
      data: { summary: summaryTextFull },
    })

    // Append to daily memory log (scoped to this user)
    const today = new Date().toISOString().split('T')[0]
    await appendToDailyMemoryForUser(userId, today, {
      sessionId,
      title,
      mode: 'workspace-tool',
      summary: parsed.outcome || 'Session completed',
      timestamp: new Date().toISOString(),
    })

    return NextResponse.json({
      success: true,
      summary: sessionSummary,
    })
  } catch (error) {
    console.error('[session-summary] Error generating summary:', error)
    return NextResponse.json(
      { error: 'Failed to generate session summary' },
      { status: 500 }
    )
  }
}
