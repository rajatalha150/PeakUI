/**
 * GET /api/workspace-tool/session/[id]/context — live context-usage snapshot.
 *
 * The WorkSpaces surface drives the model directly (no daemon), so there is no
 * native `/context-usage` probe to mirror. Instead this computes the same
 * budget the chat pipeline already applies every turn — `estimateMessageTokens`
 * over the stored transcript + `buildContextBudget` against the user's
 * configured `contextLength` — and returns it in the same shape the Coder meter
 * consumes, so the UI can render an identical "tokens / window (tier)" pill.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/request-auth'
import { getChatSessionById } from '@/lib/chat-sessions'
import { getUserSettings } from '@/lib/settings'
import { estimateMessageTokens } from '@/lib/message-trim'
import { buildContextBudget } from '@/lib/context-engine'
import { formatWorkspaceContextUsage, type WorkspaceContextUsage } from '@/lib/workspace-context-usage'

export const runtime = 'nodejs'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getCurrentUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await context.params
    if (!id) return NextResponse.json({ error: 'Session ID required' }, { status: 400 })

    const session = await getChatSessionById(userId, id)
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (session.surface !== 'workspace-tool') {
      return NextResponse.json({ error: 'Context usage is only available for WorkSpaces sessions' }, { status: 400 })
    }

    const settings = await getUserSettings(userId)
    const totalTokens = estimateMessageTokens(session.messages)
    const budget = buildContextBudget({
      provider: settings.workspaceToolProvider,
      model: settings.workspaceToolModel,
      contextWindow: settings.contextLength,
    }, totalTokens)

    const usage: WorkspaceContextUsage = {
      model: settings.workspaceToolModel || settings.workspaceToolProvider || 'local',
      totalTokens,
      contextWindow: budget.contextWindow,
      occupancy: budget.occupancy,
      tier: budget.pressure,
    }

    return NextResponse.json({ usage, label: formatWorkspaceContextUsage(usage) })
  } catch (error) {
    console.error('WorkSpaces context usage failed:', error)
    return NextResponse.json({ error: 'Unable to read context usage' }, { status: 500 })
  }
}
