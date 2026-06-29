'use client'

import { memo, useCallback, useEffect, useMemo } from 'react'
import { ChevronRight, File, Folder, Loader2 } from 'lucide-react'
import VirtualizedList from '../VirtualizedList'
import type {
  WorkspaceFileEntry,
} from '@/lib/workspace-files-types'
import { humanFileSize, joinPath, parentPath } from './file-display'

/**
 * Flat row model for the virtualized list. Each row is either a file or a
 * directory at a given depth, given the current cwd + expansion state.
 */
export type WorkspaceTreeRow =
  | {
      kind: 'directory'
      path: string
      name: string
      depth: number
      loading: boolean
      hasChildren: boolean
      childCount: number
      modifiedAt?: string
    }
  | {
      kind: 'file'
      path: string
      name: string
      depth: number
      size?: number
      modifiedAt?: string
    }

interface FlattenOptions {
  /** The "current working directory" the tree is rooted at. */
  cwd: string
  /** When a directory at cwd is expanded inline, its children render under it. */
  expanded: ReadonlySet<string>
  loadingChildren: ReadonlySet<string>
  childrenByDirectory: ReadonlyMap<string, WorkspaceFileEntry[]>
  /** Tree of all known entries — keyed by directory path. The root is keyed ''. */
  rootEntriesByDirectory: ReadonlyMap<string, WorkspaceFileEntry[]>
}

/**
 * Flatten the directory tree rooted at `cwd` into a virtualized list of rows.
 * Entries inside `cwd` are always shown. Sub-directories that are in
 * `expanded` also have their children rendered recursively. We do NOT
 * auto-expand on click — clicking a directory is a navigation event handled
 * by the parent (it changes cwd).
 */
export function flattenTreeRows({
  cwd,
  expanded,
  loadingChildren,
  childrenByDirectory,
  rootEntriesByDirectory,
}: FlattenOptions): WorkspaceTreeRow[] {
  const rows: WorkspaceTreeRow[] = []

  function walk(absoluteDir: string, displayDepth: number): void {
    // When we're walking at cwd, read from the root listing. When we recurse
    // into an expanded sub-directory, read from the lazy-loaded children
    // cache. This separation is what keeps cwd navigation independent from
    // inline expansion.
    const entries =
      absoluteDir === cwd
        ? rootEntriesByDirectory.get(absoluteDir) ?? []
        : childrenByDirectory.get(absoluteDir) ?? []
    for (const entry of entries) {
      const path = joinPath(absoluteDir, entry.name)
      if (entry.kind === 'directory') {
        const isExpanded = expanded.has(path)
        const isLoading = loadingChildren.has(path)
        const knownChildren = childrenByDirectory.get(path)
        const hasChildren = isExpanded
          ? knownChildren === undefined
            ? true
            : knownChildren.length > 0
          : true
        rows.push({
          kind: 'directory',
          path,
          name: entry.name,
          depth: displayDepth,
          loading: isLoading,
          hasChildren,
          childCount: knownChildren?.length ?? 0,
          ...(entry.modifiedAt ? { modifiedAt: entry.modifiedAt } : {}),
        })
        if (isExpanded && knownChildren) {
          walk(path, displayDepth + 1)
        }
      } else {
        rows.push({
          kind: 'file',
          path,
          name: entry.name,
          depth: displayDepth,
          ...(entry.size !== undefined ? { size: entry.size } : {}),
          ...(entry.modifiedAt ? { modifiedAt: entry.modifiedAt } : {}),
        })
      }
    }
  }

  walk(cwd, 0)
  return rows
}

export interface WorkspaceFileTreeProps {
  /** Current working directory (empty string = root). */
  cwd: string
  /** All known directory entries keyed by absolute path. Root is ''. */
  rootEntriesByDirectory: Map<string, WorkspaceFileEntry[]>
  expanded: Set<string>
  loadingChildren: Set<string>
  childrenByDirectory: Map<string, WorkspaceFileEntry[]>
  selectedPaths: Set<string>
  /** Called when the user activates (clicks or presses Enter on) a file row. */
  onActivateFile: (path: string) => void
  /** Called when the user clicks a directory row — change cwd into it. */
  onEnterDirectory: (path: string) => void
  /** Called when the user toggles a directory's inline expansion. */
  onToggleDirectory: (path: string) => void
  /** Called when a row's selection state changes (single-click). */
  onSelectRow: (path: string, modifiers: { shift: boolean; meta: boolean }) => void
  /**
   * Called whenever the list of visible row paths (in render order) changes.
   * The parent uses this to implement shift-range selection and Cmd+A.
   */
  onVisiblePathsChange?: (paths: string[]) => void
  /** Called when a directory is expanded for the first time. */
  onRequestChildren: (path: string) => void
  /** Called when the user double-clicks a row. */
  onActivateRow: (path: string, kind: 'file' | 'directory') => void
  /** True when the top-level listing is loading. */
  loadingRoot?: boolean
  /** Optional height for the scroll viewport; falls back to 100% of parent. */
  height?: number | string
  /** Show debug info (path on hover, etc.). */
  showPathOnHover?: boolean
  emptyMessage?: string
}

const ROW_HEIGHT = 26

function TreeRowImpl({
  row,
  selected,
  showPathOnHover,
  onSelect,
  onEnter,
  onToggle,
  onActivate,
  onRequestChildren,
}: {
  row: WorkspaceTreeRow
  selected: boolean
  showPathOnHover: boolean
  onSelect: (modifiers: { shift: boolean; meta: boolean }) => void
  onEnter: () => void
  onToggle: () => void
  onActivate: () => void
  onRequestChildren: () => void
}) {
  const indent = 8 + row.depth * 14

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      onSelect({ shift: event.shiftKey, meta: event.metaKey || event.ctrlKey })
      // For directories, single click ALSO enters the folder. This is the
      // Explorer-like behavior. Hold shift/ctrl to multi-select.
      if (row.kind === 'directory' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
        onEnter()
      }
    },
    [onSelect, onEnter, row.kind]
  )

  const handleDoubleClick = useCallback(() => onActivate(), [onActivate])

  if (row.kind === 'directory') {
    return (
      <div
        role="treeitem"
        aria-level={row.depth + 1}
        aria-expanded={row.hasChildren}
        aria-selected={selected}
        tabIndex={0}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onEnter()
          }
        }}
        title={showPathOnHover ? row.path : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '0 8px',
          paddingLeft: indent,
          height: ROW_HEIGHT,
          cursor: 'pointer',
          background: selected
            ? 'var(--accent-soft, rgba(99,102,241,0.18))'
            : 'transparent',
          color: 'var(--text-primary)',
          fontSize: '0.78rem',
          borderRadius: 4,
          userSelect: 'none',
        }}
      >
        <button
          type="button"
          aria-label="Expand inline"
          onClick={event => {
            event.stopPropagation()
            if (!row.hasChildren) onRequestChildren()
            onToggle()
          }}
          style={{
            width: 16,
            height: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: 0,
            flexShrink: 0,
          }}
        >
          {row.loading ? (
            <Loader2 size={10} className="spin" />
          ) : (
            <ChevronRight size={10} />
          )}
        </button>
        <Folder size={13} color="var(--accent-color, #6366f1)" style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.name}
        </span>
        {row.hasChildren && row.childCount > 0 && (
          <span style={{ fontSize: '0.66rem', color: 'var(--text-secondary)' }}>{row.childCount}</span>
        )}
      </div>
    )
  }

  return (
    <div
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selected}
      tabIndex={0}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onActivate()
        }
      }}
      title={showPathOnHover ? row.path : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 8px',
        paddingLeft: indent + 18,
        height: ROW_HEIGHT,
        cursor: 'pointer',
        background: selected ? 'var(--accent-soft, rgba(99,102,241,0.18))' : 'transparent',
        color: 'var(--text-primary)',
        fontSize: '0.78rem',
        borderRadius: 4,
        userSelect: 'none',
      }}
    >
      <File size={12} color="var(--text-secondary)" style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.name}
      </span>
      {row.size !== undefined && (
        <span style={{ fontSize: '0.66rem', color: 'var(--text-secondary)' }}>{humanFileSize(row.size)}</span>
      )}
    </div>
  )
}

const TreeRow = memo(TreeRowImpl)

function WorkspaceFileTreeImpl({
  cwd,
  rootEntriesByDirectory,
  expanded,
  loadingChildren,
  childrenByDirectory,
  selectedPaths,
  onActivateFile,
  onEnterDirectory,
  onToggleDirectory,
  onSelectRow,
  onRequestChildren,
  onActivateRow,
  onVisiblePathsChange,
  loadingRoot,
  height = '100%',
  showPathOnHover = true,
  emptyMessage = 'Empty workspace',
}: WorkspaceFileTreeProps) {
  const rows = useMemo(
    () => flattenTreeRows({ cwd, expanded, loadingChildren, childrenByDirectory, rootEntriesByDirectory }),
    [cwd, expanded, loadingChildren, childrenByDirectory, rootEntriesByDirectory]
  )

  // Publish the visible row order back to the parent — the panel uses it to
  // implement shift-range selection and Cmd+A across the currently rendered
  // (and expanded) entries.
  useEffect(() => {
    if (!onVisiblePathsChange) return
    onVisiblePathsChange(rows.map(row => row.path))
  }, [rows, onVisiblePathsChange])

  const handleSelect = useCallback(
    (row: WorkspaceTreeRow) => (modifiers: { shift: boolean; meta: boolean }) => {
      onSelectRow(row.path, modifiers)
    },
    [onSelectRow]
  )

  const handleEnter = useCallback(
    (row: WorkspaceTreeRow) => () => {
      if (row.kind === 'directory') onEnterDirectory(row.path)
    },
    [onEnterDirectory]
  )

  const handleToggle = useCallback(
    (row: WorkspaceTreeRow) => () => {
      onToggleDirectory(row.path)
    },
    [onToggleDirectory]
  )

  const handleActivate = useCallback(
    (row: WorkspaceTreeRow) => () => {
      if (row.kind === 'file') {
        onActivateFile(row.path)
      } else {
        // Double-click on a directory navigates into it.
        onEnterDirectory(row.path)
        onActivateRow(row.path, 'directory')
      }
    },
    [onActivateFile, onEnterDirectory, onActivateRow]
  )

  const handleRequestChildren = useCallback(
    (row: WorkspaceTreeRow) => () => {
      onRequestChildren(row.path)
    },
    [onRequestChildren]
  )

  useEffect(() => {
    // Whenever expanded set changes to include a directory whose children we
    // haven't fetched yet, request them.
    for (const path of expanded) {
      if (!childrenByDirectory.has(path)) {
        onRequestChildren(path)
      }
    }
  }, [expanded, childrenByDirectory, onRequestChildren])

  if (loadingRoot && rows.length === 0) {
    return (
      <div style={{ padding: '12px', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>Loading…</div>
    )
  }
  if (!loadingRoot && rows.length === 0) {
    const hint = parentPath(cwd)
    return (
      <div
        style={{
          padding: '12px',
          color: 'var(--text-secondary)',
          fontSize: '0.78rem',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <div>{emptyMessage}</div>
        {hint && (
          <div style={{ fontSize: '0.7rem' }}>
            <button
              type="button"
              onClick={() => onEnterDirectory(hint)}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 0,
                color: 'var(--accent-color, #6366f1)',
                cursor: 'pointer',
                fontSize: '0.7rem',
                textDecoration: 'underline',
              }}
            >
              ← back to {hint || 'root'}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div role="tree" style={{ height, minHeight: 0 }}>
      <VirtualizedList
        items={rows}
        getItemKey={(row, index) => `${row.path}:${index}`}
        renderItem={(row) => (
          <TreeRow
            row={row}
            selected={selectedPaths.has(row.path)}
            showPathOnHover={showPathOnHover}
            onSelect={handleSelect(row)}
            onEnter={handleEnter(row)}
            onToggle={handleToggle(row)}
            onActivate={handleActivate(row)}
            onRequestChildren={handleRequestChildren(row)}
          />
        )}
        estimateItemHeight={ROW_HEIGHT}
        overscanPx={400}
      />
    </div>
  )
}

export default memo(WorkspaceFileTreeImpl)