import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUserIdWithPermission } from '@/lib/request-auth'
import {
  buildOpenClawCodeApprovalPayload,
  prepareOpenClawCodeExecutionRequest,
  runOpenClawCodeExecution,
  type OpenClawCodeExecutionRequest,
} from '@/lib/openclaw-code-execution'
import { normalizeOpenClawCodeExecutionMode } from '@/lib/settings'
import { verifyOpenClawApprovalToken } from '@/lib/openclaw-tool-approvals'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserIdWithPermission('openclaw.use')
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const approvalToken = typeof body?.approvalToken === 'string' ? body.approvalToken : undefined
    const signal = request.signal
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

    if (mode === 'ask-first') {
      if (!approvalToken) {
        return NextResponse.json({ error: 'Code execution blocked: Missing approval token' }, { status: 403 })
      }

      const approvalCheck = verifyOpenClawApprovalToken(approvalToken, {
        userId,
        tool: 'code',
        action: prepared.runtime,
        requestPayload: buildOpenClawCodeApprovalPayload(prepared),
      })

      if (!approvalCheck.valid) {
        return NextResponse.json({ error: `Code execution blocked: ${approvalCheck.reason}` }, { status: 403 })
      }
    }

    // Pass abort signal to code execution
    const result = await runOpenClawCodeExecution(codeRequest, {
      openClawCodeExecutionMode: mode,
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
