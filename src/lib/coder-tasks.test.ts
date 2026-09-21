import { describe, expect, it } from 'vitest'
import { buildDefaultTasks, detectPackageManager, parseShellResult } from './coder-tasks'

describe('detectPackageManager', () => {
  it('detects each package manager from its lockfile', () => {
    expect(detectPackageManager(['package-lock.json', 'src'])).toBe('npm')
    expect(detectPackageManager(['yarn.lock'])).toBe('yarn')
    expect(detectPackageManager(['pnpm-lock.yaml'])).toBe('pnpm')
    expect(detectPackageManager(['bun.lockb'])).toBe('bun')
    expect(detectPackageManager(['bun.lock'])).toBe('bun')
  })

  it('defaults to npm when no lockfile is present', () => {
    expect(detectPackageManager([])).toBe('npm')
    expect(detectPackageManager(['src', 'README.md'])).toBe('npm')
  })
})

describe('buildDefaultTasks', () => {
  it('builds install/build/test/run for npm', () => {
    expect(buildDefaultTasks('npm')).toEqual([
      { id: 'install', label: 'Install', command: 'npm install' },
      { id: 'build', label: 'Build', command: 'npm run build' },
      { id: 'test', label: 'Test', command: 'npm test' },
      { id: 'run', label: 'Run', command: 'npm run dev' },
    ])
  })

  it('uses pnpm commands for pnpm', () => {
    const tasks = buildDefaultTasks('pnpm')
    expect(tasks[0].command).toBe('pnpm install')
    expect(tasks[2].command).toBe('pnpm test')
  })
})

describe('parseShellResult', () => {
  it('parses output and exit code', () => {
    expect(parseShellResult({ output: 'ok\n', exitCode: 0 })).toEqual({
      result: { output: 'ok\n', exitCode: 0 },
    })
  })

  it('defaults missing output and exit code', () => {
    expect(parseShellResult({})).toEqual({ result: { output: '', exitCode: null } })
  })

  it('rejects a non-object payload', () => {
    expect(parseShellResult(null)).toHaveProperty('error')
    expect(parseShellResult('nope')).toHaveProperty('error')
  })
})
