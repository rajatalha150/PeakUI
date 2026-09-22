import { describe, expect, it } from 'vitest'
import { buildVerificationRecord, isMutatingTool, isVerificationStale } from './coder-verification'

describe('isMutatingTool', () => {
  it('treats known read-only tools as non-mutating', () => {
    expect(isMutatingTool('read_file')).toBe(false)
    expect(isMutatingTool('list_directory')).toBe(false)
    expect(isMutatingTool('glob')).toBe(false)
    expect(isMutatingTool('web_search')).toBe(false)
  })

  it('treats write/edit tools as mutating', () => {
    expect(isMutatingTool('write_file')).toBe(true)
    expect(isMutatingTool('edit_file')).toBe(true)
    expect(isMutatingTool('apply_patch')).toBe(true)
  })

  it('defaults to mutating for unknown or absent tool names (never under-mark)', () => {
    expect(isMutatingTool('some_new_tool')).toBe(true)
    expect(isMutatingTool(undefined)).toBe(true)
    expect(isMutatingTool('')).toBe(true)
  })
})

describe('isVerificationStale', () => {
  const record = buildVerificationRecord({
    id: 'r1',
    command: 'npm test',
    cwd: '/workspace',
    exitCode: 0,
    startedAt: 1000,
    output: '12 passed',
    mutation: 3,
  })

  it('is fresh when the workspace has not changed since the run', () => {
    expect(isVerificationStale(record, 3)).toBe(false)
    expect(isVerificationStale(record, 2)).toBe(true)
  })

  it('is stale once the mutation counter advances past the captured value', () => {
    expect(isVerificationStale(record, 4)).toBe(true)
    expect(isVerificationStale(record, 100)).toBe(true)
  })
})

describe('buildVerificationRecord', () => {
  it('copies fields and defaults finishedAt to now', () => {
    const before = Date.now()
    const record = buildVerificationRecord({
      id: 'r2',
      command: 'npm run build',
      cwd: '/workspace',
      exitCode: null,
      startedAt: 500,
      output: '',
      mutation: 0,
    })
    expect(record.id).toBe('r2')
    expect(record.command).toBe('npm run build')
    expect(record.cwd).toBe('/workspace')
    expect(record.exitCode).toBeNull()
    expect(record.startedAt).toBe(500)
    expect(record.finishedAt).toBeGreaterThanOrEqual(before)
    expect(record.output).toBe('')
    expect(record.mutation).toBe(0)
  })
})
