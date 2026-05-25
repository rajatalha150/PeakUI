/**
 * POST /api/openclaw/session-summary
 * Generate and save a session summary when an Open Claw session ends
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  saveSessionSummary,
  generateSessionSummaryPrompt,
  parseGeneratedSummary,
  appendToDailyMemory,
  type SessionSummary,
} from '@/lib/memory'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['openclaw.use'], {
    forbiddenMessage: 'OpenClaw access is not granted for this account.',
    actionRequired: 'Grant the OpenClaw permission in Settings -> User Management before generating WorkSpaces session summaries for this user.',
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

    // Generate summary using the model
    const summaryPrompt = generateSessionSummaryPrompt(title, messages, objective)

    // Get user settings for model selection
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
    })

    const provider = settings?.openClawProvider || 'ollama'
    const model = settings?.openClawModel || ''
    const baseUrl = settings?.openClawBaseUrl || ''

    let summaryText = ''

    if (provider === 'ollama') {
      const ollamaHost = settings?.ollamaHost || 'http://127.0.0.1:11434'
      const response = await fetch(`${ollamaHost}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model || 'gemma2:2b',
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

    // Save to memory directory
    await saveSessionSummary(sessionSummary as SessionSummary)

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

    // Append to daily memory log
    const today = new Date().toISOString().split('T')[0]
    await appendToDailyMemory(today, {
      sessionId,
      title,
      mode: 'openclaw',
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
