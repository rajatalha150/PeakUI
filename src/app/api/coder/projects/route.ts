import { NextRequest, NextResponse } from 'next/server'
import { requireCoderAccess } from '@/lib/coder-access'
import { importGitHubProject, listProjectsForUser } from '@/lib/coder-projects'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const access = await requireCoderAccess(req)
  if ('response' in access) return access.response
  return NextResponse.json({ projects: await listProjectsForUser(access.userId) })
}

export async function POST(req: NextRequest) {
  const access = await requireCoderAccess(req)
  if ('response' in access) return access.response
  const body = await req.json().catch(() => ({})) as { repositoryId?: unknown; branch?: unknown }
  try {
    const project = await importGitHubProject(access.userId, typeof body.repositoryId === 'string' ? body.repositoryId : '', typeof body.branch === 'string' ? body.branch : undefined)
    return NextResponse.json({ project }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not import project.' }, { status: 400 })
  }
}
