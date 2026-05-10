import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/request-auth'
import { getRagHealthSnapshot, markStaleProcessingDocuments } from '@/lib/rag-health'

export async function GET() {
  try {
    const userId = await getCurrentUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    await markStaleProcessingDocuments(userId)
    const snapshot = await getRagHealthSnapshot(userId)
    return NextResponse.json(snapshot)
  } catch (error) {
    console.error('RAG health error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
