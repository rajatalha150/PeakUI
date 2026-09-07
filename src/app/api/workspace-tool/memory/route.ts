/**
 * GET /api/workspace-tool/memory
 * Returns recent memory context (today + yesterday) for injection into
 * WorkSpaces sessions. Memory is strictly scoped to the authenticated user
 * and excludes the current session (its transcript is already in context).
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  loadRecentMemoryForUser,
  buildMemoryContext,
  loadLongTermMemoryForUser,
} from '@/lib/memory'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'

export async function GET(req: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use'], {
    forbiddenMessage: 'WorkSpaces access is not granted for this account.',
    actionRequired: 'Grant the WorkSpaces permission in Settings -> User Management before loading WorkSpaces memory for this user.',
  })
  if ('response' in access) return access.response

  try {
    const excludeSessionId = req.nextUrl.searchParams.get('excludeSessionId') || undefined
    const recentMemories = await loadRecentMemoryForUser(access.userId, 2, { excludeSessionId })
    const memoryContext = buildMemoryContext(recentMemories, { currentSessionId: excludeSessionId })
    const longTermMemory = await loadLongTermMemoryForUser(access.userId)

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