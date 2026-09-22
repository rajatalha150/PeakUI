import { describe, expect, it } from 'vitest'
import { isSafeGitBranch } from './coder-projects'

describe('isSafeGitBranch', () => {
  it('accepts normal Git branch names', () => {
    expect(isSafeGitBranch('main')).toBe(true)
    expect(isSafeGitBranch('feature/preview-window')).toBe(true)
    expect(isSafeGitBranch('release-2026.09')).toBe(true)
  })

  it('rejects Git revision syntax and unsafe path-like values', () => {
    for (const value of ['', '-c', '../main', 'feature/../main', 'main@{1}', 'branch.', 'branch/', 'a b']) {
      expect(isSafeGitBranch(value)).toBe(false)
    }
  })
})
