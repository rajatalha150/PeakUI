import { describe, expect, it } from 'vitest'
import { siblingWorkspacePath } from './coder-new-session'

describe('siblingWorkspacePath', () => {
  it('creates a sibling of the active project, including trailing-slash paths', () => {
    expect(siblingWorkspacePath('/workspaces/ai-shell', 'new-directory')).toBe('/workspaces/new-directory')
    expect(siblingWorkspacePath('/workspace/project/', 'new app')).toBe('/workspace/new app')
    expect(siblingWorkspacePath('/workspace', 'project')).toBe('/project')
    expect(siblingWorkspacePath('/', 'project')).toBe('/project')
  })

  it('rejects traversal, separators, empty names, and encoded path tricks', () => {
    for (const name of ['', ' ', '.', '..', '../other', 'nested/project', 'nested\\project', 'bad%2Fname', 'bad\nname']) {
      expect(siblingWorkspacePath('/workspaces/ai-shell', name)).toBeNull()
    }
    expect(siblingWorkspacePath('workspaces/ai-shell', 'project')).toBeNull()
    expect(siblingWorkspacePath('/workspaces/../ai-shell', 'project')).toBeNull()
  })
})
