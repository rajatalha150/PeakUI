/**
 * GET /api/openclaw/memory
 * Returns recent memory context (today + yesterday) for injection into WorkSpaces sessions
 */

import { NextResponse } from 'next/server'
import { loadRecentMemory, buildMemoryContext, loadLongTermMemory } from '@/lib/memory'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'

export async function GET() {
  const access = await requireCurrentAuthWithPermissions(['openclaw.use'], {
    forbiddenMessage: 'WorkSpaces access is not granted for this account.',
    actionRequired: 'Grant the WorkSpaces permission in Settings -> User Management before loading WorkSpaces memory for this user.',
  })
  if ('response' in access) return access.response

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
