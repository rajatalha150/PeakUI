import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { requireCoderAccess } from '@/lib/coder-access'
import { githubAppConfiguration } from '@/lib/github-app'

export const runtime = 'nodejs'

const CONNECT_COOKIE = 'peakui_github_connect'

export async function GET(req: NextRequest) {
  const access = await requireCoderAccess(req)
  if ('response' in access) return access.response
  // Installation is a user-visible navigation, but it still establishes a
  // callback capability cookie. Do not let a third-party page initiate it.
  if (req.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: 'Cross-site GitHub connection refused.' }, { status: 403 })
  }
  const config = githubAppConfiguration()
  if (!config.configured) return NextResponse.json({ error: 'GitHub App is not configured. Set GITHUB_APP_ID, GITHUB_APP_SLUG, and GITHUB_APP_PRIVATE_KEY.' }, { status: 503 })

  const nonce = randomUUID()
  const install = new URL(`https://github.com/apps/${encodeURIComponent(config.slug)}/installations/new`)
  const response = NextResponse.redirect(install)
  response.cookies.set(CONNECT_COOKIE, `${access.userId}.${nonce}`, {
    httpOnly: true, sameSite: 'lax', secure: req.nextUrl.protocol === 'https:', path: '/api/integrations/github', maxAge: 15 * 60,
  })
  return response
}
