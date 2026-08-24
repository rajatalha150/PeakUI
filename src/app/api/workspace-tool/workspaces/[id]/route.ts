import { NextRequest, NextResponse } from 'next/server'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import {
  getWorkspaceToolWorkspaceContext,
  updateWorkspaceToolWorkspace,
} from '@/lib/workspace-tool-project-workspaces'

interface RouteContext {
  params: Promise<{ id: string }>
}

export const runtime = 'nodejs'

export async function GET(
  _request: NextRequest,
  ctx: RouteContext,
) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use'], {
    forbiddenMessage: 'WorkSpaces access is not granted for this account.',
    actionRequired: 'Grant the WorkSpaces permission in Settings -> User Management before loading workspace details for this user.',
  })
  if ('response' in access) return access.response

  try {
    const { id } = await ctx.params
    const workspace = await getWorkspaceToolWorkspaceContext(access.userId, id)
    return NextResponse.json(workspace)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load workspace'
    return NextResponse.json(
      { error: message, code: message === 'Workspace not found' ? 'workspace_not_found' : 'workspace_load_failed' },
      { status: message === 'Workspace not found' ? 404 : 500 },
    )
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext,
) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use'], {
    forbiddenMessage: 'WorkSpaces access is not granted for this account.',
    actionRequired: 'Grant the WorkSpaces permission in Settings -> User Management before updating workspace details for this user.',
  })
  if ('response' in access) return access.response

  try {
    const { id } = await ctx.params
    const body = await request.json()
    const workspace = await updateWorkspaceToolWorkspace(access.userId, id, {
      ...(typeof body?.name === 'string' ? { name: body.name } : {}),
      ...(typeof body?.description === 'string' ? { description: body.description } : {}),
      ...(typeof body?.autoGitBackup === 'boolean' ? { autoGitBackup: body.autoGitBackup } : {}),
    })
    return NextResponse.json({ workspace })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update workspace'
    return NextResponse.json(
      { error: message, code: message === 'Workspace not found' ? 'workspace_not_found' : 'workspace_update_failed' },
      { status: message === 'Workspace not found' ? 404 : 500 },
    )
  }
}
