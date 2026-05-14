import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUserIdWithPermission } from '@/lib/request-auth'
import {
  buildOpenClawCodeApprovalPayload,
  prepareOpenClawCodeExecutionRequest,
  type OpenClawCodeExecutionRequest,
} from '@/lib/openclaw-code-execution'
import { normalizeOpenClawCodeExecutionMode } from '@/lib/settings'
import { createOpenClawApprovalToken } from '@/lib/openclaw-tool-approvals'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserIdWithPermission('openclaw.use')
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const codeRequest: OpenClawCodeExecutionRequest = {
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
        openClawCodeExecutionMode: true,
      },
    })

    const mode = normalizeOpenClawCodeExecutionMode(settings?.openClawCodeExecutionMode)
    const prepared = prepareOpenClawCodeExecutionRequest(codeRequest, {
      openClawCodeExecutionMode: mode,
    })

    if (mode === 'deny') {
      return NextResponse.json({
        allowed: false,
        reason: 'Code execution sandbox is disabled',
      })
    }

    if (mode === 'auto-approve') {
      return NextResponse.json({
        allowed: true,
        autoApproved: true,
        runtime: prepared.runtime,
        workingDirectory: prepared.hostWorkspacePath,
        scriptPath: `${prepared.hostWorkspacePath}/${prepared.filename}`,
      })
    }

    return NextResponse.json({
      allowed: true,
      requiresApproval: true,
      runtime: prepared.runtime,
      workingDirectory: prepared.hostWorkspacePath,
      scriptPath: `${prepared.hostWorkspacePath}/${prepared.filename}`,
      approvalToken: createOpenClawApprovalToken({
        userId,
        tool: 'code',
        action: prepared.runtime,
        requestPayload: buildOpenClawCodeApprovalPayload(prepared),
      }),
      description: `Run ${prepared.runtime} code in ${prepared.hostWorkspacePath}`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to process code execution request'
    const status = message.includes('disabled') ? 403 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
