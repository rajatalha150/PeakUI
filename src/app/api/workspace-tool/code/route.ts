import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import {
  buildWorkspaceToolCodeApprovalPayload,
  prepareWorkspaceToolCodeExecutionRequest,
  runWorkspaceToolCodeExecution,
  type WorkspaceToolCodeExecutionRequest,
} from '@/lib/workspace-tool-code-execution'
import { DEFAULT_SETTINGS, normalizeWorkspaceToolCodeExecutionMode, normalizeWorkspaceToolHostAccessMode } from '@/lib/settings'
import { verifyWorkspaceToolApprovalToken } from '@/lib/workspace-tool-tool-approvals'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use', 'workspace-tool.code'], {
    forbiddenMessage: 'WorkSpaces code execution is not granted for this account.',
    actionRequired: 'Grant the WorkSpaces code execution permission in Settings -> User Management before enabling the code sandbox for this user.',
  })
  if ('response' in access) return access.response
  const userId = access.userId

  try {
    const body = await request.json()
    const approvalToken = typeof body?.approvalToken === 'string' ? body.approvalToken : undefined
    const signal = request.signal
    const codeRequest: WorkspaceToolCodeExecutionRequest = {
      runtime: body?.runtime,
      code: typeof body?.code === 'string' ? body.code : '',
      filename: typeof body?.filename === 'string' ? body.filename : undefined,
      workspacePath: typeof body?.workspacePath === 'string' ? body.workspacePath : undefined,
      args: Array.isArray(body?.args) ? body.args : undefined,
      sessionId: typeof body?.sessionId === 'string' ? body.sessionId : '',
    }

    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: {
        workspaceToolCodeExecutionMode: true,
        workspaceToolHostAccessMode: true,
      },
    })

    const mode = normalizeWorkspaceToolCodeExecutionMode(
      settings?.workspaceToolCodeExecutionMode ?? DEFAULT_SETTINGS.workspaceToolCodeExecutionMode
    )
    const hostMode = normalizeWorkspaceToolHostAccessMode(
      settings?.workspaceToolHostAccessMode ?? DEFAULT_SETTINGS.workspaceToolHostAccessMode
    )
    const prepared = prepareWorkspaceToolCodeExecutionRequest(codeRequest, {
      workspaceToolCodeExecutionMode: mode,
      workspaceToolHostAccessMode: hostMode,
    })

    if (mode === 'ask-first' && hostMode !== 'auto-approve') {
      if (!approvalToken) {
        return NextResponse.json({ error: 'Code execution blocked: Missing approval token' }, { status: 403 })
      }

      const approvalCheck = verifyWorkspaceToolApprovalToken(approvalToken, {
        userId,
        tool: 'code',
        action: prepared.runtime,
        requestPayload: buildWorkspaceToolCodeApprovalPayload(prepared),
      })

      if (!approvalCheck.valid) {
        return NextResponse.json({ error: `Code execution blocked: ${approvalCheck.reason}` }, { status: 403 })
      }
    }

    // Pass abort signal to code execution
    const result = await runWorkspaceToolCodeExecution(codeRequest, {
      workspaceToolCodeExecutionMode: mode,
      workspaceToolHostAccessMode: hostMode,
    }, signal)

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ error: 'Request aborted' }, { status: 499 })
    }
    const message = error instanceof Error ? error.message : 'Code execution failed'
    const status = message.includes('blocked') || message.includes('disabled')
      ? 403
      : 400

    return NextResponse.json({ error: message }, { status })
  }
}
