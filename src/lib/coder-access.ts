import { NextResponse } from 'next/server'
import { requireCurrentAuthWithPermissions } from './request-auth'

/** A shared root shell is an administrator capability, not a tenant sandbox. */
export async function requireCoderAccess(request?: Request) {
  const access = await requireCurrentAuthWithPermissions(['workspace-tool.use'])
  if ('response' in access) return access
  if (access.auth.user.role !== 'ADMIN') {
    return { response: NextResponse.json({
      error: 'The shared coding runtime requires administrator access. Isolated user runtimes are not configured.',
      code: 'coder_admin_required',
    }, { status: 403 }) }
  }
  if (request && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin')
    let sameOrigin = request.headers.get('sec-fetch-site') !== 'cross-site'
    if (origin) {
      try {
        sameOrigin = sameOrigin && new URL(origin).host === (request.headers.get('host') || new URL(request.url).host)
      } catch { sameOrigin = false }
    }
    if (!sameOrigin) {
      return { response: NextResponse.json({ error: 'Cross-origin coding mutation refused.', code: 'invalid_origin' }, { status: 403 }) }
    }
  }
  return access
}
