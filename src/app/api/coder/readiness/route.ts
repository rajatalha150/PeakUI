/**
 * GET /api/coder/readiness — deeper-than-process-health readiness for the
 * Coding surface (Phase 7).
 *
 * Process liveness (the container is up) says nothing about whether the coding
 * stack can actually do work. This probes the two things the Coding UI depends
 * on beyond the app process itself: the database (which stores sessions and the
 * daemon-session binding) and the Qwen Code daemon (which runs the agent).
 *
 * It is intentionally separate from `/api/health` (which covers the chat/Ollama
 * side) and from the daemon's own `/health` pass-through (which only reports the
 * daemon's self-assessment, not the app's ability to reach it).
 */

import { NextResponse } from 'next/server'
import { requireCurrentAuthWithPermissions } from '@/lib/request-auth'
import type { PermissionKey } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { getCoderDaemonBaseUrl, getCoderDaemonToken } from '@/lib/coder-gateway'

const REQUIRED: PermissionKey[] = ['workspace-tool.use']

export async function GET() {
  const auth = await requireCurrentAuthWithPermissions(REQUIRED, {
    forbiddenMessage: 'WorkSpaces access is not granted for this account.',
    actionRequired:
      'Grant the WorkSpaces permission in Settings -> User Management before using the Coding environment.',
  })
  if ('response' in auth) return auth.response

  const checks: Record<string, { ok: boolean; error?: string }> = {}

  try {
    await prisma.$queryRaw`SELECT 1`
    checks.db = { ok: true }
  } catch (e) {
    checks.db = { ok: false, error: e instanceof Error ? e.message : 'DB unreachable' }
  }

  try {
    const token = getCoderDaemonToken()
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4000)
    const res = await fetch(`${getCoderDaemonBaseUrl()}/health`, { headers, signal: controller.signal })
    clearTimeout(timeout)
    checks.daemon = { ok: res.ok, ...(res.ok ? {} : { error: `daemon /health → ${res.status}` }) }
  } catch (e) {
    checks.daemon = { ok: false, error: e instanceof Error ? e.message : 'Daemon unreachable' }
  }

  const ok = Object.values(checks).every(c => c.ok)
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 })
}
