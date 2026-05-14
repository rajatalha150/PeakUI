/**
 * GET /api/openclaw/memory
 * Returns recent memory context (today + yesterday) for injection into Open Claw sessions
 */

import { NextResponse } from 'next/server'
import { loadRecentMemory, buildMemoryContext, loadLongTermMemory } from '@/lib/memory'
import { getCurrentUserIdWithPermission } from '@/lib/request-auth'

export async function GET() {
  const userId = await getCurrentUserIdWithPermission('openclaw.use')
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const recentMemories = await loadRecentMemory(2)
    const memoryContext = buildMemoryContext(recentMemories)
    const longTermMemory = await loadLongTermMemory()

    return NextResponse.json({
      memoryContext: memoryContext || null,
      longTermMemory: longTermMemory || null,
      hasRecentMemory: recentMemories.length > 0,
      hasLongTermMemory: longTermMemory.length > 0,
    })
  } catch (error) {
    console.error('[memory] Error loading memory:', error)
    return NextResponse.json(
      { error: 'Failed to load memory' },
      { status: 500 }
    )
  }
}
