import { describe, expect, it } from 'vitest'
import {
  aggregateFolderTree,
  buildKnowledgeBaseTreeSummary,
  flattenFolderTree,
  getAllDescendantFileIds,
  getParentFolder,
  isFolderPrefix,
  listFolderImmediateChildren,
  normalizeFolderPath,
  type KbFolderDocSummary,
} from './kb-folders'

const doc = (overrides: Partial<KbFolderDocSummary> = {}): KbFolderDocSummary => ({
  id: overrides.id ?? 'doc',
  filename: overrides.filename ?? 'file.md',
  sourcePath: overrides.sourcePath ?? null,
  kind: overrides.kind ?? 'text',
  size: overrides.size ?? 100,
  status: overrides.status ?? 'ready',
  ragMode: overrides.ragMode ?? 'semantic',
  createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00Z'),
  indexedAt: overrides.indexedAt ?? new Date('2026-01-01T00:00:00Z'),
})

describe('normalizeFolderPath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizeFolderPath('a\\b\\c')).toBe('a/b/c')
  })

  it('strips leading and trailing slashes', () => {
    expect(normalizeFolderPath('/projects/alpha/')).toBe('projects/alpha')
  })

  it('collapses repeated slashes', () => {
    expect(normalizeFolderPath('a//b///c')).toBe('a/b/c')
  })

  it('returns "" for empty / null / undefined', () => {
    expect(normalizeFolderPath('')).toBe('')
    expect(normalizeFolderPath(null)).toBe('')
    expect(normalizeFolderPath(undefined)).toBe('')
  })

  it('trims whitespace', () => {
    expect(normalizeFolderPath('  projects/alpha  ')).toBe('projects/alpha')
  })
})

describe('isFolderPrefix', () => {
  it('returns true for an exact match', () => {
    expect(isFolderPrefix('projects/alpha', 'projects/alpha')).toBe(true)
  })

  it('returns true for nested children', () => {
    expect(isFolderPrefix('projects/alpha', 'projects/alpha/x.md')).toBe(true)
  })

  it('returns false when the prefix is not at a segment boundary', () => {
    expect(isFolderPrefix('alpha', 'alpha-old/x.md')).toBe(false)
  })

  it('returns true for an empty folder (matches everything)', () => {
    expect(isFolderPrefix('', 'a/b/c.md')).toBe(true)
    expect(isFolderPrefix('', null)).toBe(true)
  })

  it('returns false for a non-empty folder with a null sourcePath', () => {
    expect(isFolderPrefix('projects', null)).toBe(false)
  })
})

describe('getParentFolder', () => {
  it('returns the parent for nested paths', () => {
    expect(getParentFolder('a/b/c.md')).toBe('a/b')
  })

  it('returns "" for root-level files', () => {
    expect(getParentFolder('x.md')).toBe('')
    expect(getParentFolder(null)).toBe('')
  })
})

describe('aggregateFolderTree', () => {
  it('returns a root with 0 counts when given no docs', () => {
    const root = aggregateFolderTree([])
    expect(root.path).toBe('')
    expect(root.children).toEqual([])
    expect(root.directFileCount).toBe(0)
    expect(root.recursiveFileCount).toBe(0)
  })

  it('counts a root-level file (no sourcePath)', () => {
    const root = aggregateFolderTree([doc({ id: '1', sourcePath: null })])
    expect(root.directFileCount).toBe(1)
    expect(root.children).toEqual([])
  })

  it('builds a 2-level folder hierarchy for a nested file', () => {
    const root = aggregateFolderTree([doc({ id: '1', sourcePath: 'projects/alpha/x.md' })])
    expect(root.children).toHaveLength(1)
    const projects = root.children[0]
    expect(projects.name).toBe('projects')
    expect(projects.path).toBe('projects')
    expect(projects.children).toHaveLength(1)
    const alpha = projects.children[0]
    expect(alpha.name).toBe('alpha')
    expect(alpha.path).toBe('projects/alpha')
    expect(alpha.directFileCount).toBe(1)
    expect(projects.recursiveFileCount).toBe(1)
    expect(projects.directFileCount).toBe(0)
  })

  it('rolls up recursive counts and sizes through the tree', () => {
    const root = aggregateFolderTree([
      doc({ id: '1', sourcePath: 'a/x.md', size: 100 }),
      doc({ id: '2', sourcePath: 'a/b/y.md', size: 200 }),
      doc({ id: '3', sourcePath: 'a/b/c/z.md', size: 400 }),
    ])
    const a = root.children.find(n => n.name === 'a')!
    expect(a.directFileCount).toBe(1)
    expect(a.directSize).toBe(100)
    expect(a.recursiveFileCount).toBe(3)
    expect(a.recursiveSize).toBe(700)

    const b = a.children.find(n => n.name === 'b')!
    expect(b.directFileCount).toBe(1)
    expect(b.recursiveFileCount).toBe(2)
    expect(b.recursiveSize).toBe(600)

    const c = b.children.find(n => n.name === 'c')!
    expect(c.directFileCount).toBe(1)
    expect(c.recursiveFileCount).toBe(1)
    expect(c.recursiveSize).toBe(400)
  })

  it('sorts children by name (case-insensitive, locale-aware)', () => {
    const root = aggregateFolderTree([
      doc({ id: '1', sourcePath: 'Beta/x.md' }),
      doc({ id: '2', sourcePath: 'alpha/x.md' }),
      doc({ id: '3', sourcePath: 'gamma/x.md' }),
    ])
    expect(root.children.map(n => n.name)).toEqual(['alpha', 'Beta', 'gamma'])
  })

  it('counts duplicate filenames in the same folder', () => {
    const root = aggregateFolderTree([
      doc({ id: '1', sourcePath: 'a/x.md' }),
      doc({ id: '2', sourcePath: 'a/x.md' }),
    ])
    const a = root.children[0]
    expect(a.directFileCount).toBe(2)
  })

  it('routes a mix of null and nested sourcePaths correctly', () => {
    const root = aggregateFolderTree([
      doc({ id: '1', sourcePath: null }),
      doc({ id: '2', sourcePath: 'a/x.md' }),
    ])
    expect(root.directFileCount).toBe(1)
    expect(root.children[0].directFileCount).toBe(1)
  })

  it('total size matches sum of leaf sizes', () => {
    const root = aggregateFolderTree([
      doc({ id: '1', sourcePath: 'a/x.md', size: 50 }),
      doc({ id: '2', sourcePath: 'a/b/y.md', size: 75 }),
    ])
    expect(root.recursiveSize).toBe(125)
  })
})

describe('listFolderImmediateChildren', () => {
  const docs = [
    doc({ id: '1', sourcePath: null }),
    doc({ id: '2', sourcePath: 'a/x.md' }),
    doc({ id: '3', sourcePath: 'a/b/y.md' }),
    doc({ id: '4', sourcePath: 'a/b/c/z.md' }),
  ]

  it('returns direct subfolders and direct files for the root', () => {
    const root = aggregateFolderTree(docs)
    const { folders, files } = listFolderImmediateChildren(root, '', docs)
    expect(folders.map(f => f.name)).toEqual(['a'])
    expect(files.map(f => f.id)).toEqual(['1'])
  })

  it('returns direct subfolders and direct files for a nested folder', () => {
    const root = aggregateFolderTree(docs)
    const { folders, files } = listFolderImmediateChildren(root, 'a', docs)
    expect(folders.map(f => f.name)).toEqual(['b'])
    expect(files.map(f => f.id)).toEqual(['2'])
  })

  it('returns files only for a leaf folder', () => {
    const root = aggregateFolderTree(docs)
    const { folders, files } = listFolderImmediateChildren(root, 'a/b/c', docs)
    expect(folders).toEqual([])
    expect(files.map(f => f.id)).toEqual(['4'])
  })

  it('returns empty arrays for a non-existent path (no throw)', () => {
    const root = aggregateFolderTree(docs)
    const { folders, files } = listFolderImmediateChildren(root, 'does/not/exist', docs)
    expect(folders).toEqual([])
    expect(files).toEqual([])
  })
})

describe('buildKnowledgeBaseTreeSummary', () => {
  it('returns "" for an empty document list', () => {
    expect(buildKnowledgeBaseTreeSummary([])).toBe('')
  })

  it('includes a header line with totals', () => {
    const out = buildKnowledgeBaseTreeSummary([
      doc({ id: '1', sourcePath: 'a/x.md', size: 1000 }),
      doc({ id: '2', sourcePath: 'a/b/y.md', size: 2000 }),
    ])
    expect(out).toMatch(/Knowledge Base folder structure \(2 files in 2 folders, .* KB\):/)
  })

  it('renders root files under a 📄 (root) line', () => {
    const out = buildKnowledgeBaseTreeSummary([doc({ id: '1', sourcePath: null })])
    expect(out).toMatch(/📄 \(root\)/)
  })

  it('includes the user-facing hint about folder: and file: directives', () => {
    const out = buildKnowledgeBaseTreeSummary([doc({ id: '1', sourcePath: 'a/x.md' })])
    expect(out).toContain('Use folder:<path>')
    expect(out).toContain('file:<filename>')
  })

  it('truncates beyond maxChars', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      doc({ id: `d${i}`, sourcePath: `folder-${i}/file-${i}.md`, size: 1024 }),
    )
    const out = buildKnowledgeBaseTreeSummary(many, { maxChars: 200 })
    expect(out.length).toBeLessThanOrEqual(200)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('flattenFolderTree', () => {
  it('returns folders in DFS pre-order, excluding the root', () => {
    const root = aggregateFolderTree([
      doc({ id: '1', sourcePath: 'a/x.md' }),
      doc({ id: '2', sourcePath: 'a/b/y.md' }),
      doc({ id: '3', sourcePath: 'c/z.md' }),
    ])
    const flat = flattenFolderTree(root)
    expect(flat.map(f => f.path)).toEqual(['a', 'a/b', 'c'])
  })

  it('returns the correct depth on each node', () => {
    const root = aggregateFolderTree([doc({ id: '1', sourcePath: 'a/b/c/x.md' })])
    const flat = flattenFolderTree(root)
    expect(flat[0]).toMatchObject({ name: 'a', depth: 1 })
    expect(flat[1]).toMatchObject({ name: 'b', depth: 2 })
    expect(flat[2]).toMatchObject({ name: 'c', depth: 3 })
  })
})

describe('getAllDescendantFileIds', () => {
  const docs = [
    doc({ id: '1', sourcePath: 'a/x.md' }),
    doc({ id: '2', sourcePath: 'a/b/y.md' }),
    doc({ id: '3', sourcePath: 'c/z.md' }),
  ]

  it('returns every id when the folder is root', () => {
    const root = aggregateFolderTree(docs)
    expect(getAllDescendantFileIds(root, '', docs).sort()).toEqual(['1', '2', '3'])
  })

  it('returns only nested ids for a subtree', () => {
    const root = aggregateFolderTree(docs)
    expect(getAllDescendantFileIds(root, 'a', docs).sort()).toEqual(['1', '2'])
  })

  it('returns only matching ids for a leaf', () => {
    const root = aggregateFolderTree(docs)
    expect(getAllDescendantFileIds(root, 'a/b', docs)).toEqual(['2'])
  })

  it('returns [] for a path that does not match any doc', () => {
    const root = aggregateFolderTree(docs)
    expect(getAllDescendantFileIds(root, 'no/such/folder', docs)).toEqual([])
  })
})
