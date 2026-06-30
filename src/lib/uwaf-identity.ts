import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import {
  buildStealthFingerprint,
  type StealthFingerprint,
} from './uwaf-fingerprint'
import type { BrowserMode } from './uwaf-pool'
import type { BrowserContext, Cookie } from 'playwright-core'

/**
 * First-party identity layer for direct browsing (Option C of the web-trust
 * plan). A returning user in `direct` mode should look like the same person
 * across browsing sessions — same UA, same locale, same timezone, same
 * cookies — so the trust signal a returning visitor carries survives.
 *
 * Records are persisted to `/var/lib/peakui/identity/<userId>/<sessionId>/<mode>/`
 * and reused across reconnections.
 */

export interface IdentityRecord {
  userId: string
  sessionId: string
  mode: BrowserMode
  fingerprintSeedKey: string
  createdAt: number
  cookieJarPath: string
  localStoragePath: string
  viewport: { width: number; height: number }
  locale: string
  timezone: string
}

const IDENTITY_ROOT = process.env.PEAKUI_IDENTITY_ROOT || '/var/lib/peakui/identity'

function identityDir(record: Pick<IdentityRecord, 'userId' | 'sessionId' | 'mode'>): string {
  return path.join(IDENTITY_ROOT, record.userId, record.sessionId, record.mode)
}

function cookieJarPath(record: Pick<IdentityRecord, 'userId' | 'sessionId' | 'mode'>): string {
  return path.join(identityDir(record), 'cookies.json')
}

function localStoragePath(record: Pick<IdentityRecord, 'userId' | 'sessionId' | 'mode'>): string {
  return path.join(identityDir(record), 'local-storage.json')
}

function seedKey(userId: string, sessionId: string): string {
  return `${userId}:${sessionId}`
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

async function loadIdentity(
  userId: string,
  sessionId: string,
  mode: BrowserMode,
): Promise<IdentityRecord | null> {
  const seedKeyValue = seedKey(userId, sessionId)
  const dir = path.join(IDENTITY_ROOT, userId, sessionId, mode)
  const metaPath = path.join(dir, 'identity.json')
  if (!(await exists(metaPath))) return null
  try {
    const raw = await readFile(metaPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<IdentityRecord>
    if (
      typeof parsed.userId === 'string' &&
      typeof parsed.sessionId === 'string' &&
      typeof parsed.fingerprintSeedKey === 'string' &&
      parsed.viewport && typeof parsed.viewport.width === 'number'
    ) {
      return {
        userId,
        sessionId,
        mode,
        fingerprintSeedKey: parsed.fingerprintSeedKey || seedKeyValue,
        createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
        cookieJarPath: parsed.cookieJarPath || cookieJarPath({ userId, sessionId, mode }),
        localStoragePath: parsed.localStoragePath || localStoragePath({ userId, sessionId, mode }),
        viewport: parsed.viewport,
        locale: typeof parsed.locale === 'string' ? parsed.locale : 'en-US',
        timezone: typeof parsed.timezone === 'string' ? parsed.timezone : 'UTC',
      }
    }
  } catch {
    // Corrupted identity file — treat as missing.
  }
  return null
}

async function saveIdentity(record: IdentityRecord): Promise<void> {
  const dir = identityDir(record)
  await mkdir(dir, { recursive: true })
  const metaPath = path.join(dir, 'identity.json')
  const meta = {
    fingerprintSeedKey: record.fingerprintSeedKey,
    createdAt: record.createdAt,
    cookieJarPath: record.cookieJarPath,
    localStoragePath: record.localStoragePath,
    viewport: record.viewport,
    locale: record.locale,
    timezone: record.timezone,
  }
  await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8')
}

export async function getOrCreateIdentity(
  userId: string,
  sessionId: string,
  mode: BrowserMode,
): Promise<IdentityRecord> {
  const existing = await loadIdentity(userId, sessionId, mode)
  if (existing) return existing
  const fingerprint = buildStealthFingerprint('normal', seedKey(userId, sessionId))
  const record: IdentityRecord = {
    userId,
    sessionId,
    mode,
    fingerprintSeedKey: seedKey(userId, sessionId),
    createdAt: Date.now(),
    cookieJarPath: cookieJarPath({ userId, sessionId, mode }),
    localStoragePath: localStoragePath({ userId, sessionId, mode }),
    viewport: fingerprint.viewport,
    locale: fingerprint.locale,
    timezone: fingerprint.timezoneId,
  }
  await saveIdentity(record).catch(() => {/* best-effort */})
  return record
}

export async function deleteIdentity(
  userId: string,
  sessionId: string,
  mode: BrowserMode,
): Promise<void> {
  const dir = identityDir({ userId, sessionId, mode })
  const { rm } = await import('node:fs/promises')
  await rm(dir, { recursive: true, force: true }).catch(() => {/* ignore */})
}

/** Load persisted cookies for the given identity. Returns [] when no jar. */
export async function loadCookies(record: IdentityRecord): Promise<Cookie[]> {
  if (!(await exists(record.cookieJarPath))) return []
  try {
    const raw = await readFile(record.cookieJarPath, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as Cookie[]
  } catch {
    // Treat corrupted cookie jars as empty.
  }
  return []
}

/** Persist cookies for the given identity. Best-effort. */
export async function saveCookies(record: IdentityRecord, cookies: Cookie[]): Promise<void> {
  try {
    await mkdir(path.dirname(record.cookieJarPath), { recursive: true })
    await writeFile(record.cookieJarPath, JSON.stringify(cookies, null, 2), 'utf8')
  } catch {
    /* best-effort */
  }
}

/** Best-effort apply of identity to a Playwright context. */
export async function applyIdentityToContext(
  context: BrowserContext,
  record: IdentityRecord,
): Promise<void> {
  const cookies = await loadCookies(record)
  if (cookies.length > 0) {
    try {
      await context.addCookies(cookies)
    } catch {
      /* ignore — context might be closed */
    }
  }
  await context.addInitScript(({ config }) => {
    try {
      Object.defineProperty(Intl.DateTimeFormat().resolvedOptions(), 'timeZone', {
        configurable: true,
        get: () => config.timezone,
      })
    } catch {
      /* ignore */
    }
  }, { config: { timezone: record.timezone } })
}

/** Build a `StealthFingerprint` from an identity record (for live-browser). */
export function identityToFingerprint(record: IdentityRecord): StealthFingerprint {
  return buildStealthFingerprint('normal', record.fingerprintSeedKey)
}

export const __test__ = { identityDir, cookieJarPath, localStoragePath, seedKey, IDENTITY_ROOT }