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
import { getModelCapacityProfile } from '@/lib/model-context'
import { formatWorkspaceContextUsage, type WorkspaceContextUsage } from '@/lib/workspace-context-usage'

export const runtime = 'nodejs'

// Mirrors chat-completion.ts so the meter reports the SAME window the chat
// pipeline actually runs a turn at, instead of the fixed per-user
// `settings.contextLength`. Without this, the pill never changes when the user
// switches models because `contextLength` is a static config value.
const MIN_CONTEXT_LENGTH = 512
const DEFAULT_OLLAMA_CONTEXT_LENGTH = 8192
function normalizeContextCap(value: string | undefined): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < MIN_CONTEXT_LENGTH) return DEFAULT_OLLAMA_CONTEXT_LENGTH
  return Math.max(MIN_CONTEXT_LENGTH, Math.floor(parsed / MIN_CONTEXT_LENGTH) * MIN_CONTEXT_LENGTH)
}
const LOCAL_OLLAMA_CONTEXT_CAP = normalizeContextCap(process.env.PEAKUI_OLLAMA_CONTEXT_CAP)

export async function GET(
  request: NextRequest,
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
    // The client passes the live picker selection; fall back to the persisted
    // value when absent so the meter still works on first load.
    const requestedModel = request.nextUrl.searchParams.get('model')?.trim() || ''
    const model = requestedModel || settings.workspaceToolModel || settings.workspaceToolProvider || 'local'
    const provider = settings.workspaceToolProvider

    // Resolve the per-model effective context window, matching chat-completion.ts:
    // when Ollama is set to use the model's native default, use the native window
    // from /api/show; otherwise clamp the configured length to the local cap.
    const capacityProfile = provider === 'ollama'
      ? await getModelCapacityProfile(model, provider, settings.ollamaHost).catch(() => null)
      : null
    let contextWindow = settings.contextLength
    if (provider === 'ollama') {
      if (settings.ollamaUseModelDefaultContext && capacityProfile?.nativeContextLength) {
        contextWindow = capacityProfile.nativeContextLength
      } else {
        const hardCap = capacityProfile && !capacityProfile.isCloud
          ? Math.min(LOCAL_OLLAMA_CONTEXT_CAP, capacityProfile.maxContext)
          : LOCAL_OLLAMA_CONTEXT_CAP
        contextWindow = Math.min(settings.contextLength, hardCap)
      }
    }

    const totalTokens = estimateMessageTokens(session.messages)
    const budget = buildContextBudget({
      provider,
      model,
      contextWindow,
    }, totalTokens)

    const usage: WorkspaceContextUsage = {
      model,
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
