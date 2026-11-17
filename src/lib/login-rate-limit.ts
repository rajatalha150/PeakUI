export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
export const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 10
export const LOGIN_RATE_LIMIT_MAX_IP_ATTEMPTS = 30
const MAX_TRACKED_BUCKETS = 4096

const keyFailureTimestamps = new Map<string, number[]>()
const ipFailureTimestamps = new Map<string, number[]>()

function extractClientIp(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for')
  if (forwardedFor) {
    const firstHop = forwardedFor.split(',')[0]?.trim()
    if (firstHop) return firstHop
  }
  const realIp = req.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp
  return 'local'
}

function extractIpBucketKey(key: string): string | null {
  const sepIndex = key.lastIndexOf(':')
  if (sepIndex <= 0) return null
  return key.slice(0, sepIndex)
}

function pruneBucket(bucket: Map<string, number[]>, bucketKey: string, cutoff: number): number[] {
  const existing = bucket.get(bucketKey)
  if (!existing) return []
  const active = existing.filter(ts => ts > cutoff)
  if (active.length === 0) {
    bucket.delete(bucketKey)
  } else if (active.length !== existing.length) {
    bucket.set(bucketKey, active)
  }
  return active
}

function pruneAllExpired(now: number): void {
  const cutoff = now - LOGIN_RATE_LIMIT_WINDOW_MS
  for (const [k, timestamps] of keyFailureTimestamps.entries()) {
    const active = timestamps.filter(ts => ts > cutoff)
    if (active.length === 0) {
      keyFailureTimestamps.delete(k)
    } else if (active.length !== timestamps.length) {
      keyFailureTimestamps.set(k, active)
    }
  }
  for (const [ip, timestamps] of ipFailureTimestamps.entries()) {
    const active = timestamps.filter(ts => ts > cutoff)
    if (active.length === 0) {
      ipFailureTimestamps.delete(ip)
    } else if (active.length !== timestamps.length) {
      ipFailureTimestamps.set(ip, active)
    }
  }
  // Evict oldest keys if map still exceeds capacity
  while (keyFailureTimestamps.size > MAX_TRACKED_BUCKETS) {
    const oldestKey = keyFailureTimestamps.keys().next().value
    if (oldestKey === undefined) break
    keyFailureTimestamps.delete(oldestKey)
  }
  while (ipFailureTimestamps.size > MAX_TRACKED_BUCKETS) {
    const oldestIp = ipFailureTimestamps.keys().next().value
    if (oldestIp === undefined) break
    ipFailureTimestamps.delete(oldestIp)
  }
}

export function getLoginRateLimitKey(req: Request, username: string): string {
  const ip = extractClientIp(req)
  const normalizedUsername = username.trim().toLowerCase()
  return `${ip}:${normalizedUsername}`
}

export function checkLoginRateLimit(
  key: string,
  now: number = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
  const cutoff = now - LOGIN_RATE_LIMIT_WINDOW_MS
  const activeForKey = pruneBucket(keyFailureTimestamps, key, cutoff)

  let retryAfterMs = 0
  if (activeForKey.length >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
    const oldestInWindow = activeForKey[activeForKey.length - LOGIN_RATE_LIMIT_MAX_ATTEMPTS]
    retryAfterMs = Math.max(retryAfterMs, oldestInWindow + LOGIN_RATE_LIMIT_WINDOW_MS - now)
  }

  const ipKey = extractIpBucketKey(key)
  if (ipKey) {
    const activeForIp = pruneBucket(ipFailureTimestamps, ipKey, cutoff)
    if (activeForIp.length >= LOGIN_RATE_LIMIT_MAX_IP_ATTEMPTS) {
      const oldestIpInWindow = activeForIp[activeForIp.length - LOGIN_RATE_LIMIT_MAX_IP_ATTEMPTS]
      retryAfterMs = Math.max(retryAfterMs, oldestIpInWindow + LOGIN_RATE_LIMIT_WINDOW_MS - now)
    }
  }

  if (retryAfterMs > 0) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    }
  }

  return { allowed: true, retryAfterSeconds: 0 }
}

export function recordLoginFailure(key: string, now: number = Date.now()): void {
  pruneAllExpired(now)

  const cutoff = now - LOGIN_RATE_LIMIT_WINDOW_MS
  const activeForKey = pruneBucket(keyFailureTimestamps, key, cutoff)
  activeForKey.push(now)
  keyFailureTimestamps.set(key, activeForKey)

  const ipKey = extractIpBucketKey(key)
  if (ipKey) {
    const activeForIp = pruneBucket(ipFailureTimestamps, ipKey, cutoff)
    activeForIp.push(now)
    ipFailureTimestamps.set(ipKey, activeForIp)
  }
}

export function clearLoginFailures(key: string): void {
  keyFailureTimestamps.delete(key)
}

export function resetAllLoginRateLimits(): void {
  keyFailureTimestamps.clear()
  ipFailureTimestamps.clear()
}
