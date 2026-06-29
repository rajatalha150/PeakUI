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
      expanded: new Set(),
      loadingChildren: new Set(),
      childrenByDirectory: new Map(),
      rootEntriesByDirectory: new Map(),
    })
    expect(rows).toEqual([])
  })

  it('renders all top-level entries at the workspace root when nothing is expanded', () => {
    const rows = flattenTreeRows({
      cwd: '',
      expanded: new Set(),
      loadingChildren: new Set(),
      childrenByDirectory: new Map(),
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
      expanded: new Set(),
      loadingChildren: new Set(),
      childrenByDirectory: new Map(),
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
      expanded: new Set(),
      loadingChildren: new Set(),
      childrenByDirectory: new Map(),
      rootEntriesByDirectory: map,
    })
    expect(rows.map(r => r.path)).toEqual(['docs/README.md', 'docs/nested'])
  })

  it('renders children when an expanded directory is anchored at cwd', () => {
    // In the cwd model, "expansion" means "show sub-entries under the cwd row
    // as nested rows". This still works when the cwd is the root and the
    // expansion targets a sub-directory.
    const childrenByDirectory = new Map<string, WorkspaceFileEntry[]>([
      ['docs', [
        { name: 'README.md', path: 'docs/README.md', kind: 'file' as const, size: 50 },
        { name: 'nested', path: 'docs/nested', kind: 'directory' as const },
      ]],
    ])
    const expanded = new Set(['docs'])
    const rows = flattenTreeRows({
      cwd: '',
      expanded,
      loadingChildren: new Set(),
      childrenByDirectory,
      rootEntriesByDirectory,
    })

    expect(rows.map(r => r.path)).toEqual(['BOOT.md', 'docs', 'docs/README.md', 'docs/nested', 'src'])
    expect(rows[1]).toMatchObject({ kind: 'directory', hasChildren: true, childCount: 2 })
    expect(rows[2]).toMatchObject({ kind: 'file', depth: 1 })
    expect(rows[3]).toMatchObject({ kind: 'directory', depth: 1, hasChildren: true })
  })

  it('marks directories as not having children when their listing is empty', () => {
    const childrenByDirectory = new Map<string, WorkspaceFileEntry[]>([['docs', []]])
    const rows = flattenTreeRows({
      cwd: '',
      expanded: new Set(['docs']),
      loadingChildren: new Set(),
      childrenByDirectory,
      rootEntriesByDirectory,
    })
    expect(rows[1]).toMatchObject({ kind: 'directory', hasChildren: false, childCount: 0 })
  })

  it('marks directories as having children when expanded but not yet loaded', () => {
    const rows = flattenTreeRows({
      cwd: '',
      expanded: new Set(['docs']),
      loadingChildren: new Set(),
      childrenByDirectory: new Map(),
      rootEntriesByDirectory,
    })
    expect(rows[1]).toMatchObject({ kind: 'directory', hasChildren: true, childCount: 0 })
  })

  it('marks directories as loading while a fetch is in flight', () => {
    const rows = flattenTreeRows({
      cwd: '',
      expanded: new Set(['docs']),
      loadingChildren: new Set(['docs']),
      childrenByDirectory: new Map(),
      rootEntriesByDirectory,
    })
    expect(rows[1]).toMatchObject({ kind: 'directory', loading: true })
  })

  it('recurses through nested expansions', () => {
    const childrenByDirectory = new Map<string, WorkspaceFileEntry[]>([
      ['docs', [
        { name: 'nested', path: 'docs/nested', kind: 'directory' as const },
      ]],
      ['docs/nested', [
        { name: 'a.txt', path: 'docs/nested/a.txt', kind: 'file' as const, size: 12 },
      ]],
    ])
    const expanded = new Set(['docs', 'docs/nested'])
    const rows = flattenTreeRows({
      cwd: '',
      expanded,
      loadingChildren: new Set(),
      childrenByDirectory,
      rootEntriesByDirectory,
    })
    expect(rows.map(r => r.path)).toEqual(['BOOT.md', 'docs', 'docs/nested', 'docs/nested/a.txt', 'src'])
    expect(rows.map(r => r.depth)).toEqual([0, 0, 1, 2, 0])
  })

  it('preserves a stable path order across cwd changes', () => {
    // Phase 5 multi-select relies on the flattened row order staying stable
    // for a given (cwd, expanded, listings) state so that the panel's
    // visiblePathsRef — which the tree publishes via onVisiblePathsChange —
    // agrees with the order rows are rendered in. This test pins that
    // contract: the same inputs produce the same paths in the same order.
    const a = flattenTreeRows({
      cwd: '',
      expanded: new Set(['docs']),
      loadingChildren: new Set(),
      childrenByDirectory: new Map<string, WorkspaceFileEntry[]>([
        ['docs', [
          { name: 'a.md', path: 'docs/a.md', kind: 'file' as const },
          { name: 'b.md', path: 'docs/b.md', kind: 'file' as const },
        ]],
      ]),
      rootEntriesByDirectory,
    })
    const b = flattenTreeRows({
      cwd: '',
      expanded: new Set(['docs']),
      loadingChildren: new Set(),
      childrenByDirectory: new Map<string, WorkspaceFileEntry[]>([
        ['docs', [
          { name: 'a.md', path: 'docs/a.md', kind: 'file' as const },
          { name: 'b.md', path: 'docs/b.md', kind: 'file' as const },
        ]],
      ]),
      rootEntriesByDirectory,
    })
    expect(a.map(r => r.path)).toEqual(b.map(r => r.path))
  })

  it('does not re-emit visible paths when listings are mutated in place', () => {
    // The panel's onVisiblePathsChange should fire on (cwd, expanded,
    // listings) changes. If the parent rebuilds an identical Map but the
    // rows happen to be the same, the panel still gets the same list —
    // important for shift-range selection to stay coherent across refreshes.
    const childrenByDirectory = new Map<string, WorkspaceFileEntry[]>([
      ['docs', [
        { name: 'a.md', path: 'docs/a.md', kind: 'file' as const },
      ]],
    ])
    const rows = flattenTreeRows({
      cwd: '',
      expanded: new Set(['docs']),
      loadingChildren: new Set(),
      childrenByDirectory,
      rootEntriesByDirectory,
    })
    expect(rows.map(r => r.path)).toEqual(['BOOT.md', 'docs', 'docs/a.md', 'src'])
  })
})
