'use client'

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { File, Folder } from 'lucide-react'
import VirtualizedList from '../VirtualizedList'
import type { WorkspaceFileEntry } from '@/lib/workspace-files-types'
import { humanFileSize, joinPath, parentPath } from './file-display'

/**
 * Flat row model for the virtualized list. Each row is either a file or a
 * directory at the current cwd only — no inline expansion / nested depth.
 */
export type WorkspaceTreeRow =
  | {
      kind: 'directory'
      path: string
      name: string
      depth: number
      hasChildren: boolean
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
  /** Directory listings keyed by absolute path. Root is ''. */
  rootEntriesByDirectory: ReadonlyMap<string, WorkspaceFileEntry[]>
  /** Optional filter: only render rows whose kind is in this set. */
  selectableKinds?: ReadonlyArray<'file' | 'directory'>
}

/**
 * Explorer-style single-folder view: only render entries inside `cwd`.
 * Inline expansion is removed so the tree never creates nested scroll regions.
 */
export function flattenTreeRows({
  cwd,
  rootEntriesByDirectory,
  selectableKinds,
}: FlattenOptions): WorkspaceTreeRow[] {
  const rows: WorkspaceTreeRow[] = []
  const entries = rootEntriesByDirectory.get(cwd) ?? []
  for (const entry of entries) {
    const path = entry.path || joinPath(cwd, entry.name)
    if (selectableKinds && !selectableKinds.includes(entry.kind)) continue
    if (entry.kind === 'directory') {
      rows.push({
        kind: 'directory',
        path,
        name: entry.name,
        depth: 0,
        hasChildren: true,
        ...(entry.modifiedAt ? { modifiedAt: entry.modifiedAt } : {}),
      })
    } else {
      rows.push({
        kind: 'file',
        path,
        name: entry.name,
        depth: 0,
        ...(entry.size !== undefined ? { size: entry.size } : {}),
        ...(entry.modifiedAt ? { modifiedAt: entry.modifiedAt } : {}),
      })
    }
  }
  return rows
}

export interface WorkspaceFileTreeProps {
  /** Current working directory (empty string = root). */
  cwd: string
  /** All known directory entries keyed by absolute path. Root is ''. */
  rootEntriesByDirectory: Map<string, WorkspaceFileEntry[]>
  selectedPaths: Set<string>
  /** Called when the user activates (clicks or presses Enter on) a file row. */
  onActivateFile: (path: string) => void
  /** Called when the user clicks a directory row — change cwd into it. */
  onEnterDirectory: (path: string) => void
  /** Called when a row's selection state changes (single-click). */
  onSelectRow: (path: string, modifiers: { shift: boolean; meta: boolean }) => void
  /**
   * Called whenever the list of visible row paths (in render order) changes.
   * The parent uses this to implement shift-range selection and Cmd+A.
   */
  onVisiblePathsChange?: (paths: string[]) => void
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
   * If set, only rows whose kind is in this list are clickable for selection.
   * Used by the Move dialog to display directories-only.
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
  onActivate,
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
  onActivate: () => void
  onContextMenu: ((event: React.MouseEvent) => void) | undefined
  onRenameChange: ((value: string) => void) | undefined
  onRenameCommit: ((newName: string) => void) | undefined
  onRenameCancel: (() => void) | undefined
  onRenameStart: (() => void) | undefined
}) {
  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      if (isRenaming) return
      onSelect({ shift: event.shiftKey, meta: event.metaKey || event.ctrlKey })
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

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '0 8px',
    paddingLeft: 10,
    height: ROW_HEIGHT,
    cursor: 'pointer',
    background: selected ? 'var(--accent-soft, rgba(99,102,241,0.18))' : 'transparent',
    color: 'var(--text-primary)',
    fontSize: '0.78rem',
    borderRadius: 4,
    userSelect: 'none',
  }

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (isRenaming) return
      if (event.key === 'F2') {
        event.preventDefault()
        onRenameStart?.()
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        if (row.kind === 'directory') onEnter()
        else onActivate()
      }
    },
    [isRenaming, onRenameStart, row.kind, onEnter, onActivate]
  )

  return (
    <div
      role="treeitem"
      aria-level={1}
      aria-selected={selected}
      tabIndex={0}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
      title={showPathOnHover ? row.path : undefined}
      style={rowStyle}
    >
      {row.kind === 'directory' ? (
        <Folder size={13} color="var(--accent-color, #6366f1)" style={{ flexShrink: 0 }} />
      ) : (
        <File size={12} color="var(--text-secondary)" style={{ flexShrink: 0 }} />
      )}
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
      {!isRenaming && row.kind === 'file' && row.size !== undefined && (
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
  selectedPaths,
  onActivateFile,
  onEnterDirectory,
  onSelectRow,
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
    () => flattenTreeRows({ cwd, rootEntriesByDirectory, selectableKinds }),
    [cwd, rootEntriesByDirectory, selectableKinds]
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
      onEnterDirectory(row.path)
    },
    [onEnterDirectory]
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

  const handleContextMenu = useCallback(
    (row: WorkspaceTreeRow) => (event: React.MouseEvent) => {
      if (!onContextMenu) return
      onContextMenu(row.path, row.kind, event.clientX, event.clientY)
    },
    [onContextMenu]
  )

  const handleRenameStart = useCallback(
    (row: WorkspaceTreeRow) => () => {
      document.dispatchEvent(new CustomEvent('workspace-files:request-rename', { detail: { path: row.path, name: row.name } }))
    },
    []
  )

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
            key={`${row.path}:${row.name}`}
            row={row}
            selected={selectedPaths.has(row.path)}
            showPathOnHover={showPathOnHover}
            isRenaming={renameTargetPath === row.path}
            renameValue={renameTargetPath === row.path ? renameValue ?? row.name : ''}
            onSelect={handleSelect(row)}
            onEnter={handleEnter(row)}
            onActivate={handleActivate(row)}
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
