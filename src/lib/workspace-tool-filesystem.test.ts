import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceToolFilesystemAccessStatus,
  diagnoseWorkspaceToolFilesystemRequest,
  parseAllowedWorkspaceToolPaths,
  type WorkspaceToolFilesystemAccessSettings,
} from './workspace-tool-filesystem'

const baseSettings: WorkspaceToolFilesystemAccessSettings = {
  workspaceToolFileAccessMode: 'read-only',
  workspaceToolAllowedPaths: '/home\n/tmp',
  workspaceToolFileWriteMode: 'ask-first',
  workspaceToolWritablePaths: '~/.peakui/workspace',
}

describe('WorkspaceTool filesystem guardrails', () => {
  it('normalizes approved paths and removes duplicates', () => {
    expect(parseAllowedWorkspaceToolPaths('/tmp\n/tmp/\n/home')).toEqual(['/tmp', '/home'])
  })

  it('diagnoses disabled read access', () => {
    const diagnostic = diagnoseWorkspaceToolFilesystemRequest(
      { action: 'list', path: '/home' },
      { ...baseSettings, workspaceToolFileAccessMode: 'deny' }
    )

    expect(diagnostic.allowed).toBe(false)
    expect(diagnostic.code).toBe('filesystem_read_disabled')
    expect(diagnostic.actionRequired).toContain('Filesystem Access')
  })

  it('diagnoses missing approved read roots', () => {
    const diagnostic = diagnoseWorkspaceToolFilesystemRequest(
      { action: 'list', path: '/home' },
      { ...baseSettings, workspaceToolAllowedPaths: '' }
    )

    expect(diagnostic.allowed).toBe(false)
    expect(diagnostic.code).toBe('no_approved_read_roots')
  })

  it('diagnoses paths outside approved roots before execution', () => {
    const diagnostic = diagnoseWorkspaceToolFilesystemRequest(
      { action: 'read', path: '/var/log/syslog' },
      baseSettings
    )

    expect(diagnostic.allowed).toBe(false)
    expect(diagnostic.code).toBe('outside_approved_read_roots')
  })

  it('diagnoses missing approval tokens for ask-first writes', () => {
    const diagnostic = diagnoseWorkspaceToolFilesystemRequest(
      { action: 'write', path: '~/.peakui/workspace/notes.txt', content: 'hello' },
      baseSettings
    )

    expect(diagnostic.allowed).toBe(false)
    expect(diagnostic.code).toBe('missing_approval_token')
  })

  it('reports status warnings when modes are enabled without approved roots', () => {
    const status = buildWorkspaceToolFilesystemAccessStatus({
      ...baseSettings,
      workspaceToolAllowedPaths: '',
      workspaceToolWritablePaths: '',
    })

    expect(status.readReady).toBe(false)
    expect(status.writeReady).toBe(false)
    expect(status.warnings.length).toBeGreaterThanOrEqual(2)
  })
})
