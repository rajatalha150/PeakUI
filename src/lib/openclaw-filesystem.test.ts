import { describe, expect, it } from 'vitest'
import {
  buildOpenClawFilesystemAccessStatus,
  diagnoseOpenClawFilesystemRequest,
  parseAllowedOpenClawPaths,
  type OpenClawFilesystemAccessSettings,
} from './openclaw-filesystem'

const baseSettings: OpenClawFilesystemAccessSettings = {
  openClawFileAccessMode: 'read-only',
  openClawAllowedPaths: '/home\n/tmp',
  openClawFileWriteMode: 'ask-first',
  openClawWritablePaths: '/tmp/peakui-openclaw-workspace',
}

describe('OpenClaw filesystem guardrails', () => {
  it('normalizes approved paths and removes duplicates', () => {
    expect(parseAllowedOpenClawPaths('/tmp\n/tmp/\n/home')).toEqual(['/tmp', '/home'])
  })

  it('diagnoses disabled read access', () => {
    const diagnostic = diagnoseOpenClawFilesystemRequest(
      { action: 'list', path: '/home' },
      { ...baseSettings, openClawFileAccessMode: 'deny' }
    )

    expect(diagnostic.allowed).toBe(false)
    expect(diagnostic.code).toBe('filesystem_read_disabled')
    expect(diagnostic.actionRequired).toContain('Filesystem Access')
  })

  it('diagnoses missing approved read roots', () => {
    const diagnostic = diagnoseOpenClawFilesystemRequest(
      { action: 'list', path: '/home' },
      { ...baseSettings, openClawAllowedPaths: '' }
    )

    expect(diagnostic.allowed).toBe(false)
    expect(diagnostic.code).toBe('no_approved_read_roots')
  })

  it('diagnoses paths outside approved roots before execution', () => {
    const diagnostic = diagnoseOpenClawFilesystemRequest(
      { action: 'read', path: '/var/log/syslog' },
      baseSettings
    )

    expect(diagnostic.allowed).toBe(false)
    expect(diagnostic.code).toBe('outside_approved_read_roots')
  })

  it('diagnoses missing approval tokens for ask-first writes', () => {
    const diagnostic = diagnoseOpenClawFilesystemRequest(
      { action: 'write', path: '/tmp/peakui-openclaw-workspace/notes.txt', content: 'hello' },
      baseSettings
    )

    expect(diagnostic.allowed).toBe(false)
    expect(diagnostic.code).toBe('missing_approval_token')
  })

  it('reports status warnings when modes are enabled without approved roots', () => {
    const status = buildOpenClawFilesystemAccessStatus({
      ...baseSettings,
      openClawAllowedPaths: '',
      openClawWritablePaths: '',
    })

    expect(status.readReady).toBe(false)
    expect(status.writeReady).toBe(false)
    expect(status.warnings.length).toBeGreaterThanOrEqual(2)
  })
})
