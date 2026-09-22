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
import { requireCoderAccess } from '@/lib/coder-access'
import { prisma } from '@/lib/prisma'
import { getCoderDaemonBaseUrl, getCoderDaemonToken } from '@/lib/coder-gateway'

export async function GET() {
  const auth = await requireCoderAccess()
  if ('response' in auth) return auth.response

  const checks: Record<string, { ok: boolean; error?: string }> = {}

  try {
    await prisma.$queryRaw`SELECT 1`
    checks.db = { ok: true }
  } catch {
    checks.db = { ok: false, error: 'DB unreachable' }
  }

  try {
    const token = getCoderDaemonToken()
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(`${getCoderDaemonBaseUrl()}/health`, { headers, signal: AbortSignal.timeout(4000) })
    const data = await res.json().catch(() => null)
    const healthy = res.ok && data?.status === 'ok'
    checks.daemon = { ok: healthy, ...(healthy ? {} : { error: 'Daemon health check failed' }) }
  } catch {
    checks.daemon = { ok: false, error: 'Daemon unreachable' }
  }

  const ok = Object.values(checks).every(c => c.ok)
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 })
}
