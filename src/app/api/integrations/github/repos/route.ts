import { NextRequest, NextResponse } from 'next/server'
import { requireCoderAccess } from '@/lib/coder-access'
import { repositoriesForConnection } from '@/lib/coder-projects'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const access = await requireCoderAccess(req)
  if ('response' in access) return access.response
  try {
    const { repositories } = await repositoriesForConnection(access.userId)
    return NextResponse.json({ repositories: repositories.map(repo => ({ id: String(repo.id), fullName: repo.full_name, name: repo.name, private: repo.private, defaultBranch: repo.default_branch })) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load GitHub repositories.' }, { status: 502 })
  }
}
