'use client'

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
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
  /** Optional filter: only render rows whose kind is in this set. */
  selectableKinds?: ReadonlyArray<'file' | 'directory'>
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
  selectableKinds,
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
      // The server returns entry.path as workspace-relative. Prefer it so the
      // client never drifts from the canonical path, especially when cwd or
      // inline expansion state could otherwise recompute a different prefix.
      const path = entry.path || joinPath(absoluteDir, entry.name)
      // Apply the optional kind filter — used by the Move dialog (directories only).
      if (selectableKinds && !selectableKinds.includes(entry.kind)) continue
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
  /**
   * Optional alternative handler invoked on a directory row single-click
   * instead of onEnterDirectory. Used by the Move dialog: clicking a folder
   * here means "select this as destination", not "navigate into it".
   */
  onActivateDirectory?: (path: string) => void
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
  /** Optional right-click handler. Suppresses the native menu. */
  onContextMenu?: (path: string, kind: 'file' | 'directory', x: number, y: number) => void
  /** Path of the row currently in rename mode (renders an input instead of a span). */
  renameTargetPath?: string | null
  /** Initial value for the rename input. */
  renameValue?: string
  onRenameChange?: (value: string) => void
  onRenameCommit?: (newName: string) => void
  onRenameCancel?: () => void
  /**
   * If set, only rows whose kind is in this list are clickable for selection
   * and the directory-chevron expansion control is hidden. Used by the Move
   * dialog to display directories-only.
   */
  selectableKinds?: ReadonlyArray<'file' | 'directory'>
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
  isRenaming,
  renameValue,
  onSelect,
  onEnter,
  onToggle,
  onActivate,
  onRequestChildren,
  onContextMenu,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onRenameStart,
}: {
  row: WorkspaceTreeRow
  selected: boolean
  showPathOnHover: boolean
  isRenaming: boolean
  renameValue: string
  onSelect: (modifiers: { shift: boolean; meta: boolean }) => void
  onEnter: () => void
  onToggle: () => void
  onActivate: () => void
  onRequestChildren: () => void
  onContextMenu: ((event: React.MouseEvent) => void) | undefined
  onRenameChange: ((value: string) => void) | undefined
  onRenameCommit: ((newName: string) => void) | undefined
  onRenameCancel: (() => void) | undefined
  onRenameStart: (() => void) | undefined
}) {
  const indent = 8 + row.depth * 14

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      // Don't change selection while renaming — that would yank focus.
      if (isRenaming) return
      onSelect({ shift: event.shiftKey, meta: event.metaKey || event.ctrlKey })
      // For directories, single click ALSO enters the folder. This is the
      // Explorer-like behavior. Hold shift/ctrl to multi-select.
      if (row.kind === 'directory' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
        onEnter()
      }
    },
    [onSelect, onEnter, row.kind, isRenaming]
  )

  const handleDoubleClick = useCallback(() => {
    if (isRenaming) return
    onActivate()
  }, [onActivate, isRenaming])

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if (!onContextMenu) return
      event.preventDefault()
      onContextMenu(event)
    },
    [onContextMenu]
  )

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
        onContextMenu={handleContextMenu}
        onKeyDown={event => {
          if (isRenaming) return
          if (event.key === 'F2') {
            event.preventDefault()
            onRenameStart?.()
            return
          }
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
        {isRenaming ? (
          <RenameInput
            initialValue={renameValue}
            onChange={onRenameChange}
            onCommit={onRenameCommit}
            onCancel={onRenameCancel}
          />
        ) : (
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.name}
          </span>
        )}
        {!isRenaming && row.hasChildren && row.childCount > 0 && (
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
      onContextMenu={handleContextMenu}
      onKeyDown={event => {
        if (isRenaming) return
        if (event.key === 'F2') {
          event.preventDefault()
          onRenameStart?.()
          return
        }
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
      {isRenaming ? (
        <RenameInput
          initialValue={renameValue}
          onChange={onRenameChange}
          onCommit={onRenameCommit}
          onCancel={onRenameCancel}
        />
      ) : (
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.name}
        </span>
      )}
      {!isRenaming && row.size !== undefined && (
        <span style={{ fontSize: '0.66rem', color: 'var(--text-secondary)' }}>{humanFileSize(row.size)}</span>
      )}
    </div>
  )
}

function RenameInput({
  initialValue,
  onChange,
  onCommit,
  onCancel,
}: {
  initialValue: string
  onChange?: (value: string) => void
  onCommit?: (newName: string) => void
  onCancel?: () => void
}) {
  // Local state seeded from initialValue on mount. The parent re-keys the
  // input (via a parent re-mount) when a different row enters rename mode,
  // so we don't need to re-sync from props here.
  const [value, setValue] = useState(initialValue)
  return (
    <input
      autoFocus
      value={value}
      onClick={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onChange={event => {
        setValue(event.target.value)
        onChange?.(event.target.value)
      }}
      onBlur={() => onCancel?.()}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.stopPropagation()
          const trimmed = value.trim()
          if (trimmed && onCommit) onCommit(trimmed)
          else onCancel?.()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onCancel?.()
        }
      }}
      aria-label="Rename"
      style={{
        flex: 1,
        minWidth: 0,
        height: 20,
        padding: '0 4px',
        fontSize: '0.78rem',
        fontFamily: 'inherit',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        border: '1px solid var(--accent-color, #6366f1)',
        borderRadius: 3,
        outline: 'none',
      }}
    />
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
  onActivateDirectory,
  onToggleDirectory,
  onSelectRow,
  onRequestChildren,
  onActivateRow,
  onVisiblePathsChange,
  onContextMenu,
  renameTargetPath,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  selectableKinds,
  loadingRoot,
  height = '100%',
  showPathOnHover = true,
  emptyMessage = 'Empty workspace',
}: WorkspaceFileTreeProps) {
  const rows = useMemo(
    () => flattenTreeRows({ cwd, expanded, loadingChildren, childrenByDirectory, rootEntriesByDirectory, selectableKinds }),
    [cwd, expanded, loadingChildren, childrenByDirectory, rootEntriesByDirectory, selectableKinds]
  )

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
      if (row.kind !== 'directory') return
      if (onActivateDirectory) onActivateDirectory(row.path)
      else onEnterDirectory(row.path)
    },
    [onEnterDirectory, onActivateDirectory]
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

  const handleContextMenu = useCallback(
    (row: WorkspaceTreeRow) => (event: React.MouseEvent) => {
      if (!onContextMenu) return
      onContextMenu(row.path, row.kind, event.clientX, event.clientY)
    },
    [onContextMenu]
  )

  const handleRenameStart = useCallback(
    (row: WorkspaceTreeRow) => () => {
      // Defer to the parent by clearing the rename-target path; the panel
      // will set it and re-render the row with the input. The parent
      // exposes this via onRenameChange's first call; here we just signal.
      // We use a custom event on the document for this loose coupling so we
      // don't have to thread yet another prop.
      document.dispatchEvent(new CustomEvent('workspace-files:request-rename', { detail: { path: row.path, name: row.name } }))
    },
    []
  )

  useEffect(() => {
    // Whenever expanded set changes to include a directory whose children we
    // haven't fetched yet, request them. Skip when we're in directory-only
    // mode (the Move dialog doesn't need lazy-loaded children).
    if (selectableKinds && selectableKinds.length === 1 && selectableKinds[0] === 'directory') return
    for (const path of expanded) {
      if (!childrenByDirectory.has(path)) {
        onRequestChildren(path)
      }
    }
  }, [expanded, childrenByDirectory, onRequestChildren, selectableKinds])

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
            isRenaming={renameTargetPath === row.path}
            renameValue={renameTargetPath === row.path ? renameValue ?? row.name : ''}
            onSelect={handleSelect(row)}
            onEnter={handleEnter(row)}
            onToggle={handleToggle(row)}
            onActivate={handleActivate(row)}
            onRequestChildren={handleRequestChildren(row)}
            onContextMenu={onContextMenu ? handleContextMenu(row) : undefined}
            onRenameChange={renameTargetPath === row.path ? onRenameChange : undefined}
            onRenameCommit={renameTargetPath === row.path ? onRenameCommit : undefined}
            onRenameCancel={renameTargetPath === row.path ? onRenameCancel : undefined}
            onRenameStart={handleRenameStart(row)}
          />
        )}
        estimateItemHeight={ROW_HEIGHT}
        overscanPx={400}
      />
    </div>
  )
}

export default memo(WorkspaceFileTreeImpl)