import { NextResponse } from 'next/server'
import { getCurrentUserIdWithPermissions } from '@/lib/request-auth'
import { checkTorProxyStatus, getDirectIp, getStealthInfo, runStealthPreflight } from '@/lib/uwaf-pool'
import { getUwafMetricsSnapshot } from '@/lib/uwaf-telemetry'
import { getDefaultStealthProfile } from '@/lib/uwaf-fingerprint'
import { getCuratedStealthEntryPoints, getPreferredSearchProviderLabel, getSearchProviderSnapshot } from '@/lib/uwaf-search-providers'

export async function GET() {
  const userId = await getCurrentUserIdWithPermissions(['openclaw.use', 'openclaw.uwaf'])
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const profile = getDefaultStealthProfile()
  const [torStatus, directIp, stealthInfo, stealthPreflight] = await Promise.all([
    checkTorProxyStatus(profile),
    getDirectIp().catch(() => 'unavailable'),
    getStealthInfo(profile).catch(() => null),
    runStealthPreflight({ profile }).catch(() => null),
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
    stealthFingerprintId: stealthPreflight?.fingerprintId,
    stealthProfile: stealthPreflight?.profile || profile,
    stealthFingerprintRegressionPassed: stealthPreflight?.fingerprintRegressionPassed,
    stealthFingerprintRegressionWarnings: stealthPreflight?.fingerprintRegressionWarnings || [],
    stealthFingerprintDetectors: stealthPreflight?.fingerprintDetectors || [],
    stealthWarnings: stealthPreflight?.warnings || [],
    stealthSearchEngine: getPreferredSearchProviderLabel('stealth', '', profile),
    stealthSearchProviders: getSearchProviderSnapshot('stealth'),
    stealthCuratedEntryPoints: getCuratedStealthEntryPoints(),
    onionReady: stealthPreflight?.ok === true,
    metrics: getUwafMetricsSnapshot(),
  })
}
