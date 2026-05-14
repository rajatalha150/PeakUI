import { NextResponse } from 'next/server'
import { getCurrentUserIdWithPermissions } from '@/lib/request-auth'
import { checkTorProxyStatus, getDirectIp, getStealthInfo } from '@/lib/uwaf-pool'

export async function GET(request: Request) {
  const userId = await getCurrentUserIdWithPermissions(['openclaw.use', 'openclaw.uwaf'])
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [torStatus, directIp, stealthInfo] = await Promise.all([
    checkTorProxyStatus(),
    getDirectIp().catch(() => 'unavailable'),
    getStealthInfo().catch(() => null),
  ])

  return NextResponse.json({
    directIp,
    torReachable: torStatus.reachable,
    torError: torStatus.error,
    torExitIp: stealthInfo?.ip,
    torExitCountry: stealthInfo?.country,
  })
}
