import { NextRequest, NextResponse } from 'next/server'
import { requireCoderAccess } from '@/lib/coder-access'
import { prisma } from '@/lib/prisma'
import { githubAppConfiguration } from '@/lib/github-app'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const access = await requireCoderAccess(req)
  if ('response' in access) return access.response
  const connection = await prisma.gitHubConnection.findFirst({
    where: { userId: access.userId }, orderBy: { updatedAt: 'desc' },
    select: { id: true, githubLogin: true, accountType: true, installationId: true, createdAt: true, updatedAt: true },
  })
  return NextResponse.json({ ...githubAppConfiguration(), connection })
}

export async function DELETE(req: NextRequest) {
  const access = await requireCoderAccess(req)
  if ('response' in access) return access.response
  await prisma.gitHubConnection.deleteMany({ where: { userId: access.userId } })
  return NextResponse.json({ ok: true })
}
