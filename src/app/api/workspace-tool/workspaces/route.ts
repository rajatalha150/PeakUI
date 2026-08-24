import { NextRequest, NextResponse } from 'next/server'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import {
  createWorkspaceToolWorkspace,
  ensureDefaultWorkspaceToolWorkspace,
  listWorkspaceToolWorkspaces,
} from '@/lib/workspace-tool-project-workspaces'

export const runtime = 'nodejs'

export async function GET() {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use'], {
    forbiddenMessage: 'WorkSpaces access is not granted for this account.',
    actionRequired: 'Grant the WorkSpaces permission in Settings -> User Management before loading workspace definitions for this user.',
  })
  if ('response' in access) return access.response

  try {
    await ensureDefaultWorkspaceToolWorkspace(access.userId)
    const workspaces = await listWorkspaceToolWorkspaces(access.userId)
    return NextResponse.json({ workspaces })
  } catch (error) {
    console.error('[workspace-tool/workspaces] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to load workspaces', code: 'workspace_list_failed' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use'], {
    forbiddenMessage: 'WorkSpaces access is not granted for this account.',
    actionRequired: 'Grant the WorkSpaces permission in Settings -> User Management before creating workspaces for this user.',
  })
  if ('response' in access) return access.response

  try {
    const body = await request.json()
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const description = typeof body?.description === 'string' ? body.description : ''
    const autoGitBackup = body?.autoGitBackup === true

    if (!name) {
      return NextResponse.json(
        { error: 'Workspace name is required', code: 'workspace_name_required' },
        { status: 400 },
      )
    }

    const workspace = await createWorkspaceToolWorkspace(access.userId, {
      name,
      description,
      autoGitBackup,
    })
    return NextResponse.json({ workspace }, { status: 201 })
  } catch (error) {
    console.error('[workspace-tool/workspaces] POST error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to create workspace',
        code: 'workspace_create_failed',
      },
      { status: 500 },
    )
  }
}
