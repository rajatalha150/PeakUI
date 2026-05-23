import { NextResponse } from 'next/server'
import { getCurrentUserIdWithPermissions } from '@/lib/request-auth'
import { checkTorProxyStatus, getDirectIp, getStealthInfo, runStealthPreflight } from '@/lib/uwaf-pool'
import { getUwafMetricsSnapshot } from '@/lib/uwaf-telemetry'

export async function GET() {
  const userId = await getCurrentUserIdWithPermissions(['openclaw.use', 'openclaw.uwaf'])
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [torStatus, directIp, stealthInfo, stealthPreflight] = await Promise.all([
    checkTorProxyStatus(),
    getDirectIp().catch(() => 'unavailable'),
    getStealthInfo().catch(() => null),
    runStealthPreflight().catch(() => null),
  ])

  return NextResponse.json({
    directIp,
    torReachable: torStatus.reachable,
    torIsReady: stealthInfo?.isTor === true,
    torError: torStatus.error,
    torExitIp: stealthInfo?.ip,
    torExitCountry: stealthInfo?.country,
    stealthPreflightOk: stealthPreflight?.ok === true,
    stealthPreflightCheckedAt: stealthPreflight?.checkedAt,
    stealthPreflightError: stealthPreflight?.error,
    stealthExitDiffersFromDirect: stealthPreflight?.exitDiffersFromDirect,
    stealthDnsLeakVerified: stealthPreflight?.dnsLeakVerified,
    stealthDnsLeakDetected: stealthPreflight?.dnsLeakDetected,
    stealthDnsResolverIps: stealthPreflight?.dnsResolverIps,
    stealthWebrtcExposed: stealthPreflight?.webrtcExposed,
    stealthUdpLeakProtected: stealthPreflight?.udpLeakProtected,
    stealthRuntimeProtectionVerified: stealthPreflight?.runtimeProtectionVerified,
    stealthWarnings: stealthPreflight?.warnings || [],
    stealthSearchEngine: 'Ahmia',
    onionReady: torStatus.reachable,
    metrics: getUwafMetricsSnapshot(),
  })
}
