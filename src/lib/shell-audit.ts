import { prisma } from './prisma'
import type { ShellExecutionMode, ShellExecutionTarget } from './shell-execution'

export interface CreateShellAuditInput {
  userId: string
  sessionId?: string
  messageId?: string
  command: string
  description?: string
  cwd?: string
  target: ShellExecutionTarget
  approvalMode: ShellExecutionMode
  status: string
  autoApproved?: boolean
  approvalRequired?: boolean
  timeoutMs: number
  outputLimitBytes: number
  allowedRoots?: string[]
  allowedEnvVars?: string[]
}

export async function createShellAudit(input: CreateShellAuditInput): Promise<string | null> {
  try {
    const record = await prisma.shellCommandAudit.create({
      data: {
        userId: input.userId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        command: input.command,
        description: input.description,
        cwd: input.cwd,
        target: input.target,
        approvalMode: input.approvalMode,
        status: input.status,
        autoApproved: Boolean(input.autoApproved),
        approvalRequired: Boolean(input.approvalRequired),
        timeoutMs: input.timeoutMs,
        outputLimitBytes: input.outputLimitBytes,
        allowedRoots: (input.allowedRoots || []).join('\n'),
        allowedEnvVars: (input.allowedEnvVars || []).join('\n'),
      },
      select: { id: true },
    })

    return record.id
  } catch (error) {
    console.error('[shell-audit] Failed to create audit record:', error)
    return null
  }
}

export async function updateShellAudit(
  auditId: string | undefined,
  userId: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (!auditId) return

  try {
    await prisma.shellCommandAudit.updateMany({
      where: { id: auditId, userId },
      data,
    })
  } catch (error) {
    console.error('[shell-audit] Failed to update audit record:', error)
  }
}
