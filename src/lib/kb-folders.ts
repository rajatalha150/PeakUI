// Pure helpers for the derived KB folder tree.
//
// Folders are NOT stored as first-class entities; they are computed from each
// Document's `sourcePath` (a slash-joined relative path like "projects/alpha/report.md").
// This file is shared by:
//   - the chat-completion tree summary injected as a system message,
//   - the OneDrive-style browser in KnowledgeBase.tsx,
//   - the "Folders" popover in both composer top bars,
//   - the cascade-delete collector on the DELETE /api/rag route.
//
// Functions in this file are pure and side-effect free. The server-only
// `loadTreeSummary` lives in `./kb-folders-server`.

import { detectFileKind } from './file-shared'

export interface KbFolderDocSummary {
  id: string
  filename: string
  sourcePath: string | null
  kind: string | null
  size: number
  status: string
  ragMode: string | null
  createdAt: Date | string
  indexedAt: Date | string | null
}

export interface KbFolderNode {
  /** Leaf segment (e.g. "alpha"). Root has the sentinel name "/". */
  name: string
  /** Full slash-joined path. Root has path "". */
  path: string
  /** 0 for root, otherwise number of segments in `path`. */
  depth: number
  /** Number of files that are *directly* in this folder (i.e. their sourcePath
   *  equals this folder's `path` or is "path/<file>"). */
  directFileCount: number
  /** Number of files in this folder + every descendant. */
  recursiveFileCount: number
  /** Sum of file sizes for direct children only. */
  directSize: number
  /** Sum of file sizes for direct + nested children. */
  recursiveSize: number
  children: KbFolderNode[]
}

export interface FlattenedFolder {
  type: 'folder'
  path: string
  name: string
  depth: number
  recursiveFileCount: number
  recursiveSize: number
}

export interface ImmediateChildren {
  folders: KbFolderNode[]
  files: KbFolderDocSummary[]
}

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

export function normalizeFolderPath(value: string | null | undefined): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/+/g, '/')
    .trim()
}

/**
 * Strict prefix match. `isFolderPrefix('alpha', 'alpha-old/x.md')` is false.
 * An empty `folder` matches everything (including null sourcePath).
 */
export function isFolderPrefix(
  folder: string,
  sourcePath: string | null | undefined,
): boolean {
  const f = normalizeFolderPath(folder)
  const s = normalizeFolderPath(sourcePath ?? '')
  if (f === '') return true
  if (s === '') return false
  if (s === f) return true
  return s.startsWith(`${f}/`)
}

/**
 * The folder that a given `sourcePath` lives in. For "projects/alpha/x.md" this
 * returns "projects/alpha". For a root-level file ("x.md" or null) returns "".
 */
export function getParentFolder(sourcePath: string | null | undefined): string {
  const s = normalizeFolderPath(sourcePath)
  if (s === '') return ''
  const lastSlash = s.lastIndexOf('/')
  return lastSlash === -1 ? '' : s.slice(0, lastSlash)
}

// ---------------------------------------------------------------------------
// Tree aggregation
// ---------------------------------------------------------------------------

const ROOT_NAME = '/'

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

function makeRoot(): KbFolderNode {
  return {
    name: ROOT_NAME,
    path: '',
    depth: 0,
    directFileCount: 0,
    recursiveFileCount: 0,
    directSize: 0,
    recursiveSize: 0,
    children: [],
  }
}

function ensureFolder(root: KbFolderNode, folderPath: string): KbFolderNode {
  // Walk from root. If folderPath is empty, return root unchanged.
  if (folderPath === '') return root
  const segments = folderPath.split('/')
  let cursor = root
  let acc = ''
  for (const seg of segments) {
    if (!seg) continue
    acc = acc === '' ? seg : `${acc}/${seg}`
    let child = cursor.children.find(node => node.name === seg)
    if (!child) {
      child = {
        name: seg,
        path: acc,
        depth: cursor.depth + 1,
        directFileCount: 0,
        recursiveFileCount: 0,
        directSize: 0,
        recursiveSize: 0,
        children: [],
      }
      cursor.children.push(child)
    }
    cursor = child
  }
  return cursor
}

/**
 * Build a folder tree from a list of document summaries. Root-level files
 * (no sourcePath, or sourcePath that contains no slashes) contribute to the
 * root's `directFileCount` but do not create a child folder.
 */
export function aggregateFolderTree(docs: KbFolderDocSummary[]): KbFolderNode {
  const root = makeRoot()

  for (const doc of docs) {
    const path = normalizeFolderPath(doc.sourcePath)
    const parent = ensureFolder(root, getParentFolder(path))
    parent.directFileCount += 1
    parent.directSize += doc.size ?? 0
  }

  // Bottom-up pass: recursive counts and sizes include direct children PLUS
  // everything under each descendant. Sort children once rollup is done.
  const rollup = (node: KbFolderNode) => {
    for (const child of node.children) {
      rollup(child)
    }
    let count = node.directFileCount
    let size = node.directSize
    for (const child of node.children) {
      count += child.recursiveFileCount
      size += child.recursiveSize
    }
    node.recursiveFileCount = count
    node.recursiveSize = size
  }
  for (const child of root.children) {
    rollup(child)
  }
  // Root recursive counts and sizes include direct children + every descendant
  // (i.e. the whole tree).
  let rootCount = root.directFileCount
  let rootSize = root.directSize
  for (const child of root.children) {
    rootCount += child.recursiveFileCount
    rootSize += child.recursiveSize
  }
  root.recursiveFileCount = rootCount
  root.recursiveSize = rootSize

  const sortRecursive = (node: KbFolderNode) => {
    node.children.sort((a, b) => compareNames(a.name, b.name))
    node.children.forEach(sortRecursive)
  }
  sortRecursive(root)

  return root
}

export function flattenFolderTree(root: KbFolderNode): FlattenedFolder[] {
  const out: FlattenedFolder[] = []
  const walk = (node: KbFolderNode) => {
    if (node.path !== '') {
      out.push({
        type: 'folder',
        path: node.path,
        name: node.name,
        depth: node.depth,
        recursiveFileCount: node.recursiveFileCount,
        recursiveSize: node.recursiveSize,
      })
    }
    for (const child of node.children) {
      walk(child)
    }
  }
  for (const child of root.children) {
    walk(child)
  }
  return out
}

function findFolderNode(root: KbFolderNode, folderPath: string): KbFolderNode | null {
  if (folderPath === '') return root
  const segments = folderPath.split('/')
  let cursor = root
  for (const seg of segments) {
    if (!seg) continue
    const next = cursor.children.find(node => node.name === seg)
    if (!next) return null
    cursor = next
  }
  return cursor
}

/**
 * Public lookup of a folder node by its full path. Returns `null` if the
 * path is not present in the tree. Use `''` to get the root.
 */
export function findFolderInTree(root: KbFolderNode, folderPath: string): KbFolderNode | null {
  return findFolderNode(root, folderPath)
}

export function listFolderImmediateChildren(
  root: KbFolderNode,
  folderPath: string,
  docs: KbFolderDocSummary[],
): ImmediateChildren {
  const node = findFolderNode(root, folderPath)
  if (!node) return { folders: [], files: [] }
  const files = docs.filter(doc => {
    const path = normalizeFolderPath(doc.sourcePath)
    if (path === '') {
      // Root-level file belongs to root only.
      return folderPath === ''
    }
    const parent = getParentFolder(path)
    return parent === folderPath
  })
  return {
    folders: [...node.children].sort((a, b) => compareNames(a.name, b.name)),
    files,
  }
}

/**
 * Files at or under `folderPath`. Used by the cascade-delete collector to
 * resolve a folder-level delete into a list of doc ids.
 */
export function getAllDescendantFileIds(
  root: KbFolderNode,
  folderPath: string,
  docs: KbFolderDocSummary[],
): string[] {
  if (folderPath === '') {
    return docs.map(doc => doc.id)
  }
  return docs
    .filter(doc => isFolderPrefix(folderPath, doc.sourcePath))
    .map(doc => doc.id)
}

// ---------------------------------------------------------------------------
// Tree summary text (system prompt)
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return value >= 10 || unit === 0
    ? `${Math.round(value)} ${units[unit]}`
    : `${value.toFixed(1)} ${units[unit]}`
}

interface TreeSummaryOptions {
  maxChars?: number
  maxDepth?: number
}

export function buildKnowledgeBaseTreeSummary(
  docs: KbFolderDocSummary[],
  options: TreeSummaryOptions = {},
): string {
  const maxChars = options.maxChars ?? 2500
  const maxDepth = options.maxDepth ?? 10

  if (docs.length === 0) return ''

  const root = aggregateFolderTree(docs)
  const totalCount = root.recursiveFileCount
  const totalSize = root.recursiveSize

  const lines: string[] = []
  const folderCount = (() => {
    let n = 0
    const walk = (node: KbFolderNode) => {
      for (const child of node.children) {
        n += 1
        walk(child)
      }
    }
    for (const child of root.children) {
      n += 1
      walk(child)
    }
    return n
  })()

  lines.push(
    `Knowledge Base folder structure (${totalCount} files in ${folderCount} folders, ${formatSize(totalSize)}):`,
  )

  const indent = (depth: number) => '  '.repeat(depth)

  const renderFolder = (node: KbFolderNode, depth: number) => {
    if (depth > maxDepth) {
      lines.push(`${indent(depth - 1)}  …`)
      return
    }
    lines.push(
      `${indent(depth)}📁 ${node.name}/         (${node.recursiveFileCount} files, ${formatSize(node.recursiveSize)})`,
    )
    for (const child of node.children) {
      renderFolder(child, depth + 1)
    }
  }

  for (const child of root.children) {
    renderFolder(child, 0)
  }

  if (root.directFileCount > 0) {
    const rootFiles = [...docs]
      .filter(doc => {
        const p = normalizeFolderPath(doc.sourcePath)
        return p === '' || !p.includes('/')
      })
      .sort((a, b) => {
        const aDate = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime()
        const bDate = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime()
        return bDate - aDate
      })
      .slice(0, 50)
    lines.push(`${indent(0)}📄 (root)            (${root.directFileCount} files, ${formatSize(root.directSize)})`)
    for (const file of rootFiles) {
      lines.push(`${indent(1)}- ${file.filename} (${formatSize(file.size)})`)
    }
    if (root.directFileCount > rootFiles.length) {
      lines.push(`${indent(1)}- …and ${root.directFileCount - rootFiles.length} more root files`)
    }
  }

  lines.push('')
  lines.push('Use folder:<path> in your queries to scope a lookup to one folder.')
  lines.push('Use file:<filename> or ext:<ext> for narrower retrieval.')

  const text = lines.join('\n')
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`
}

// ---------------------------------------------------------------------------
// Server-only summary loader lives in `./kb-folders-server` so the rest of this
// file stays safe to import from client components.
