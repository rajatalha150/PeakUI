import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('uwaf-identity', () => {
  let rootDir: string
  let originalRoot: string | undefined

  beforeEach(async () => {
    rootDir = await mkdtemp(`${tmpdir()}/uwaf-identity-test-`)
    originalRoot = process.env.PEAKUI_IDENTITY_ROOT
    process.env.PEAKUI_IDENTITY_ROOT = rootDir
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true }).catch(() => {})
    if (originalRoot === undefined) {
      delete process.env.PEAKUI_IDENTITY_ROOT
    } else {
      process.env.PEAKUI_IDENTITY_ROOT = originalRoot
    }
    vi.resetModules()
  })

  it('creates a new identity when none exists', async () => {
    const mod = await import('./uwaf-identity')
    const record = await mod.getOrCreateIdentity('user-A', 'sess-1', 'direct')
    expect(record.userId).toBe('user-A')
    expect(record.sessionId).toBe('sess-1')
    expect(record.mode).toBe('direct')
    expect(record.fingerprintSeedKey).toBe('user-A:sess-1')
    expect(record.viewport.width).toBeGreaterThan(0)
  })

  it('returns the same identity on subsequent calls (idempotent)', async () => {
    const mod = await import('./uwaf-identity')
    const first = await mod.getOrCreateIdentity('user-B', 'sess-1', 'direct')
    const second = await mod.getOrCreateIdentity('user-B', 'sess-1', 'direct')
    expect(second.fingerprintSeedKey).toBe(first.fingerprintSeedKey)
    expect(second.viewport).toEqual(first.viewport)
  })

  it('stores distinct identities per (userId, sessionId, mode)', async () => {
    const mod = await import('./uwaf-identity')
    const direct = await mod.getOrCreateIdentity('user-C', 'sess-1', 'direct')
    const stealth = await mod.getOrCreateIdentity('user-C', 'sess-1', 'stealth')
    expect(direct.cookieJarPath).not.toBe(stealth.cookieJarPath)
  })

  it('round-trips cookies through disk', async () => {
    const mod = await import('./uwaf-identity')
    const record = await mod.getOrCreateIdentity('user-D', 'sess-1', 'direct')
    const cookies = [
      { name: 'session', value: 'abc123', domain: '.example.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' as const },
    ]
    await mod.saveCookies(record, cookies)
    const loaded = await mod.loadCookies(record)
    expect(loaded).toEqual(cookies)
  })

  it('returns empty cookies when the jar does not exist', async () => {
    const mod = await import('./uwaf-identity')
    const record = await mod.getOrCreateIdentity('user-E', 'sess-1', 'direct')
    const loaded = await mod.loadCookies(record)
    expect(loaded).toEqual([])
  })

  it('treats a corrupted cookie jar as empty (graceful)', async () => {
    const mod = await import('./uwaf-identity')
    const record = await mod.getOrCreateIdentity('user-F', 'sess-1', 'direct')
    await writeFile(record.cookieJarPath, 'not json', 'utf8')
    const loaded = await mod.loadCookies(record)
    expect(loaded).toEqual([])
  })

  it('identityToFingerprint is deterministic for the same seed', async () => {
    const mod = await import('./uwaf-identity')
    const record = await mod.getOrCreateIdentity('user-G', 'sess-1', 'direct')
    const a = mod.identityToFingerprint(record)
    const b = mod.identityToFingerprint(record)
    expect(a.userAgent).toBe(b.userAgent)
    expect(a.viewport).toEqual(b.viewport)
    expect(a.locale).toBe(b.locale)
    expect(a.timezoneId).toBe(b.timezoneId)
  })

  it('deleteIdentity removes the directory', async () => {
    const mod = await import('./uwaf-identity')
    const record = await mod.getOrCreateIdentity('user-H', 'sess-1', 'direct')
    await mod.saveCookies(record, [{ name: 'x', value: '1', domain: '.example.com', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' as const }])
    await mod.deleteIdentity(record.userId, record.sessionId, record.mode)
    // After delete, getOrCreateIdentity returns a fresh record.
    const recreated = await mod.getOrCreateIdentity('user-H', 'sess-1', 'direct')
    const loaded = await mod.loadCookies(recreated)
    expect(loaded).toEqual([])
  })
})