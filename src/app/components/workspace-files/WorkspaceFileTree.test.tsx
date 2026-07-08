import { describe, expect, it } from 'vitest'
import { flattenTreeRows } from './WorkspaceFileTree'
import type { WorkspaceFileEntry } from '@/lib/workspace-files-types'

describe('flattenTreeRows', () => {
  const rootEntries: WorkspaceFileEntry[] = [
    { name: 'BOOT.md', path: 'BOOT.md', kind: 'file', size: 100, modifiedAt: '2026-01-01T00:00:00Z' },
    { name: 'docs', path: 'docs', kind: 'directory', modifiedAt: '2026-01-01T00:00:00Z' },
    { name: 'src', path: 'src', kind: 'directory', modifiedAt: '2026-01-01T00:00:00Z' },
  ]
  const rootEntriesByDirectory = new Map<string, WorkspaceFileEntry[]>([['', rootEntries]])

  it('returns nothing when the cwd has no entries', () => {
    const rows = flattenTreeRows({
      cwd: 'missing',
      rootEntriesByDirectory: new Map(),
    })
    expect(rows).toEqual([])
  })

  it('renders all top-level entries at the workspace root', () => {
    const rows = flattenTreeRows({
      cwd: '',
      rootEntriesByDirectory,
    })
    expect(rows.map(r => r.path)).toEqual(['BOOT.md', 'docs', 'src'])
    expect(rows[0]).toMatchObject({ kind: 'file', depth: 0 })
    expect(rows[1]).toMatchObject({ kind: 'directory', depth: 0, hasChildren: true })
  })

  it('renders the children of cwd directly', () => {
    const docsEntries: WorkspaceFileEntry[] = [
      { name: 'README.md', path: 'docs/README.md', kind: 'file', size: 50 },
      { name: 'nested', path: 'docs/nested', kind: 'directory' },
    ]
    const map = new Map<string, WorkspaceFileEntry[]>([
      ['', rootEntries],
      ['docs', docsEntries],
    ])
    const rows = flattenTreeRows({
      cwd: 'docs',
      rootEntriesByDirectory: map,
    })
    expect(rows.map(r => r.path)).toEqual(['docs/README.md', 'docs/nested'])
    expect(rows[0]).toMatchObject({ kind: 'file', depth: 0 })
    expect(rows[1]).toMatchObject({ kind: 'directory', depth: 0, hasChildren: true })
  })

  it('renders only the children of cwd when cwd is not the workspace root', () => {
    // Explorer-style: when you're inside "docs", the tree shows what is in
    // docs — not the "docs" row itself. The breadcrumb/back-button convey
    // "you're inside docs".
    const docsEntries: WorkspaceFileEntry[] = [
      { name: 'README.md', path: 'docs/README.md', kind: 'file', size: 50 },
      { name: 'nested', path: 'docs/nested', kind: 'directory' },
    ]
    const map = new Map<string, WorkspaceFileEntry[]>([['', rootEntries], ['docs', docsEntries]])
    const rows = flattenTreeRows({
      cwd: 'docs',
      rootEntriesByDirectory: map,
    })
    expect(rows.map(r => r.path)).toEqual(['docs/README.md', 'docs/nested'])
  })

  it('preserves a stable path order across cwd changes', () => {
    const a = flattenTreeRows({
      cwd: 'docs',
      rootEntriesByDirectory: new Map<string, WorkspaceFileEntry[]>([
        ['', rootEntries],
        ['docs', [
          { name: 'a.md', path: 'docs/a.md', kind: 'file' as const },
          { name: 'b.md', path: 'docs/b.md', kind: 'file' as const },
        ]],
      ]),
    })
    const b = flattenTreeRows({
      cwd: 'docs',
      rootEntriesByDirectory: new Map<string, WorkspaceFileEntry[]>([
        ['', rootEntries],
        ['docs', [
          { name: 'a.md', path: 'docs/a.md', kind: 'file' as const },
          { name: 'b.md', path: 'docs/b.md', kind: 'file' as const },
        ]],
      ]),
    })
    expect(a.map(r => r.path)).toEqual(b.map(r => r.path))
  })

  it('filters to selectable kinds', () => {
    const rows = flattenTreeRows({
      cwd: '',
      rootEntriesByDirectory,
      selectableKinds: ['directory'],
    })
    expect(rows.map(r => r.path)).toEqual(['docs', 'src'])
    expect(rows.every(r => r.kind === 'directory')).toBe(true)
  })
})
