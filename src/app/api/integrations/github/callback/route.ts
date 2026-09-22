import { NextRequest, NextResponse } from 'next/server'
import { requireCoderAccess } from '@/lib/coder-access'
import { getGitHubInstallation, githubAppConfiguration } from '@/lib/github-app'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

const CONNECT_COOKIE = 'peakui_github_connect'

export async function GET(req: NextRequest) {
  const access = await requireCoderAccess(req)
  if ('response' in access) return access.response
  const cookie = req.cookies.get(CONNECT_COOKIE)?.value || ''
  const [userId, nonce] = cookie.split('.')
  const installationId = req.nextUrl.searchParams.get('installation_id') || ''
  const redirect = new URL('/coder', req.nextUrl.origin)
  const clear = (response: NextResponse) => {
    response.cookies.set(CONNECT_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: req.nextUrl.protocol === 'https:', path: '/api/integrations/github', maxAge: 0 })
    return response
  }
  if (!userId || !nonce || userId !== access.userId || !/^\d+$/.test(installationId) || !githubAppConfiguration().configured) {
    redirect.searchParams.set('github', 'failed')
    return clear(NextResponse.redirect(redirect))
  }
  try {
    const installation = await getGitHubInstallation(installationId)
    const githubLogin = installation.account?.login
    if (!githubLogin) throw new Error('GitHub installation has no account.')
    const existing = await prisma.gitHubConnection.findUnique({ where: { installationId } })
    if (existing && existing.userId !== access.userId) throw new Error('This GitHub installation is already connected to another PeakUI account.')
    if (existing) {
      await prisma.gitHubConnection.update({ where: { installationId }, data: { githubLogin, accountType: installation.account?.type || 'Unknown' } })
    } else {
      await prisma.gitHubConnection.create({ data: { userId: access.userId, installationId, githubLogin, accountType: installation.account?.type || 'Unknown' } })
    }
    redirect.searchParams.set('github', 'connected')
  } catch {
    redirect.searchParams.set('github', 'failed')
  }
  return clear(NextResponse.redirect(redirect))
}
