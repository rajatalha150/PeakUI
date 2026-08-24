'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckSquare, ChevronDown, ChevronUp, Copy, Download, Folder, Loader2, RefreshCw, Square, Trash2, X } from 'lucide-react'
import WorkspaceFileTree from './workspace-files/WorkspaceFileTree'
import { WorkspaceFilePreviewModal } from './workspace-files/WorkspaceFilePreview'
import WorkspaceBreadcrumb from './workspace-files/WorkspaceBreadcrumb'
import WorkspaceFileUpload from './workspace-files/WorkspaceFileUpload'
import WorkspaceConfirmDialog from './workspace-files/WorkspaceConfirmDialog'
import WorkspaceFileContextMenu, {
  type WorkspaceContextMenuAction,
} from './workspace-files/WorkspaceFileContextMenu'
import WorkspaceMoveDialog from './workspace-files/WorkspaceMoveDialog'
import {
  deleteWorkspacePath,
  downloadWorkspaceFile,
  downloadWorkspaceZipBlob,
  listWorkspaceTree,
  readWorkspaceFile,
  renameWorkspacePath,
  subscribeWorkspaceEvents,
  uploadWorkspaceFiles,
  type WorkspaceFilesError,
} from '@/lib/workspace-files-client'
import type {
  WorkspaceEvent,
  WorkspaceFileContent,
  WorkspaceFileEntry,
  WorkspaceTreeResponse,
} from '@/lib/workspace-files-types'
import { fileBaseName, joinPath, parentPath } from './workspace-files/file-display'
import { panelIconButtonStyle } from './panelIconButton'

export interface WorkspaceFilesPanelProps {
  workspaceId: string | null
  workspaceName: string
  /**
   * Controlled expand state. When true the panel body renders; when false
   * only the header is shown. The parent (WorkspaceToolWorkspace) owns this
   * state and enforces the "max 2 expanded" accordion rule.
   */
  isExpanded: boolean
  /** Toggle handler wired up by the parent to flip `isExpanded`. */
  onToggleExpand: () => void
  onError?: (error: WorkspaceFilesError) => void
}

const MAX_FILE_CONTENT_BYTES = 5_000_000

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  overflow: 'hidden',
  borderTop: '1px solid var(--border-color)',
  background: 'var(--bg-primary)',
  /* create a local stacking context so fixed menus render above sibling panels */
  isolation: 'isolate',
}

const treeScrollStyle: React.CSSProperties = {
  maxHeight: 180,
  overflowY: 'auto',
  overflowX: 'hidden',
}

const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  borderTop: '1px solid var(--border-color)',
  background: 'var(--bg-primary)',
  flexShrink: 0,
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  gap: 8,
}

const headerLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontWeight: 600,
  fontSize: '0.82rem',
  color: 'var(--text-primary)',
}

const headerMetaStyle: React.CSSProperties = {
  fontSize: '0.74rem',
  color: 'var(--text-secondary)',
}

const errorStyle: React.CSSProperties = {
  padding: '6px 10px',
  margin: '6px 12px',
  borderRadius: 6,
  background: 'rgba(239, 68, 68, 0.12)',
  color: 'var(--text-primary)',
  fontSize: '0.74rem',
  border: '1px solid rgba(239, 68, 68, 0.3)',
}

const noticeStyle: React.CSSProperties = {
  padding: '6px 10px',
  margin: '6px 12px',
  borderRadius: 6,
  background: 'rgba(99, 102, 241, 0.12)',
  color: 'var(--text-primary)',
  fontSize: '0.74rem',
  border: '1px solid rgba(99, 102, 241, 0.3)',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

const placeholderStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: '0.74rem',
  color: 'var(--text-secondary)',
}

const workspaceMetaStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: '0.7rem',
  color: 'var(--text-secondary)',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  borderBottom: '1px solid var(--border-color)',
}

const iconBtnBase: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 6,
  border: '1px solid var(--border-color)',
  background: 'var(--bg-secondary)',
  color: 'var(--text-secondary)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  padding: 0,
}

interface ConfirmDeleteState {
  paths: string[]
  /** True when at least one path targets a directory — enables recursive removal. */
  recursive: boolean
}

/**
 * The Workspace Files side-rail panel. Renders only the tree + breadcrumb +
 * summary; clicking a file opens a full-size modal preview, and clicking a
 * folder navigates into it (Explorer-style with a back button). Multi-select
 * powers bulk download-as-zip, bulk delete, and copy-paths.
 */
export default function WorkspaceFilesPanel({
  workspaceId,
  workspaceName,
  isExpanded,
  onToggleExpand,
  onError,
}: WorkspaceFilesPanelProps) {
  // The "current directory" the tree is rooted at. Empty string = workspace root.
  const [cwd, setCwd] = useState<string>('')
  // Active file preview (modal). When non-null, the full-size modal renders.
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  const [activeFileContent, setActiveFileContent] = useState<WorkspaceFileContent | null>(null)
  const [activeFileLoading, setActiveFileLoading] = useState(false)
  const [activeFileError, setActiveFileError] = useState<string | null>(null)

  // Tree state — entries keyed by absolute directory path. Root is keyed ''.
  const [rootEntriesByDirectory, setRootEntriesByDirectory] = useState<Map<string, WorkspaceFileEntry[]>>(new Map())
  const [loadingCwd, setLoadingCwd] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Phase 5 multi-select state.
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [anchorPath, setAnchorPath] = useState<string | null>(null)

  // Phase 4 confirmation dialog state. When non-null, the confirm dialog renders.
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDeleteState | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)
  const [busyZip, setBusyZip] = useState(false)

  // Phase 6 rename/move/context-menu state.
  const [contextMenu, setContextMenu] = useState<{
    path: string
    kind: 'file' | 'directory'
    x: number
    y: number
  } | null>(null)
  const [renameTarget, setRenameTarget] = useState<{ path: string; initialName: string } | null>(null)
  const [renameValue, setRenameValue] = useState<string>('')
  const [moveTarget, setMoveTarget] = useState<{ path: string; kind: 'file' | 'directory' } | null>(null)
  const [busyMove, setBusyMove] = useState(false)

  // Transient "operation running" notice (e.g. "Uploaded 3 files"). Cleared on
  // the next interaction; lives long enough to be noticed after a fade.
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const lastLoadedWorkspaceIdRef = useRef<string | null>(null)
  const visiblePathsRef = useRef<string[]>([])

  // Phase 7 SSE subscription bookkeeping.
  const subscriptionRef = useRef<AbortController | null>(null)
  const pendingRefetchesRef = useRef<Set<string>>(new Set())
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cwdRef = useRef<string>('')
  const activeFilePathRef = useRef<string | null>(null)

  useEffect(() => () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    subscriptionRef.current?.abort()
  }, [])



  // When the workspace changes, all per-workspace state is reset.
  useEffect(() => {
    if (workspaceId && lastLoadedWorkspaceIdRef.current !== workspaceId) {
      setRootEntriesByDirectory(new Map())
      setCwd('')
      setActiveFilePath(null)
      setActiveFileContent(null)
      setActiveFileError(null)
      setError(null)
      setSelectedPaths(new Set())
      setAnchorPath(null)
      setConfirmDelete(null)
      setContextMenu(null)
      setRenameTarget(null)
      setRenameValue('')
      setMoveTarget(null)
      setNotice(null)
      pendingRefetchesRef.current.clear()
    }
  }, [workspaceId])

  // Cwd navigation clears the selection — handled inside navigateCwd() to
  // avoid the set-state-in-effect lint rule. (Resetting selection when the
  // current directory changes is the canonical intent of "navigate".)

  const flashNotice = useCallback((message: string) => {
    setNotice(message)
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = setTimeout(() => setNotice(null), 3500)
  }, [])

  /** Load the listing at `path` and store it in rootEntriesByDirectory. */
  const loadDirectory = useCallback(
    async (path: string): Promise<WorkspaceTreeResponse | null> => {
      if (!workspaceId) return null
      const data = await listWorkspaceTree(workspaceId, { path, depth: 0 })
      setRootEntriesByDirectory(prev => {
        const next = new Map(prev)
        next.set(path, data.entries)
        return next
      })
      return data
    },
    [workspaceId]
  )

  /** Load the cwd listing — also tracks loading state + errors. */
  const refreshCwd = useCallback(async () => {
    if (!workspaceId) return
    setLoadingCwd(true)
    setError(null)
    try {
      await loadDirectory(cwd)
      lastLoadedWorkspaceIdRef.current = workspaceId
    } catch (err) {
      const e = err as WorkspaceFilesError
      setError(e.message || 'Failed to load workspace files')
      onError?.(e)
    } finally {
      setLoadingCwd(false)
    }
  }, [workspaceId, cwd, loadDirectory, onError])

  // Load the cwd listing when the panel becomes visible, when the workspace
  // changes, or when the user navigates to a directory we haven't cached yet.
  /* eslint-disable react-hooks/set-state-in-effect -- canonical "load on prop change" effect; refreshCwd sets the in-flight flag and runs the fetch asynchronously */
  useEffect(() => {
    if (!isExpanded || !workspaceId) return
    if (rootEntriesByDirectory.has(cwd)) return
    void refreshCwd()
  }, [isExpanded, workspaceId, cwd, rootEntriesByDirectory, refreshCwd])
  /* eslint-enable react-hooks/set-state-in-effect */

  const requestChildren = useCallback(
    async (path: string) => {
      if (!workspaceId) return
      if (rootEntriesByDirectory.has(path)) return
      try {
        const data = await listWorkspaceTree(workspaceId, { path, depth: 0 })
        setRootEntriesByDirectory(prev => {
          const next = new Map(prev)
          next.set(path, data.entries)
          return next
        })
      } catch (err) {
        const e = err as WorkspaceFilesError
        setError(e.message || `Failed to list ${path}`)
        onError?.(e)
      }
    },
    [workspaceId, rootEntriesByDirectory, onError]
  )

  const handleSelectRow = useCallback(
    (path: string, modifiers: { shift: boolean; meta: boolean }) => {
      const visible = visiblePathsRef.current
      if (modifiers.shift) {
        const anchor = anchorPath ?? path
        const anchorIndex = visible.indexOf(anchor)
        const pathIndex = visible.indexOf(path)
        if (anchorIndex === -1 || pathIndex === -1) {
          setSelectedPaths(new Set([path]))
          setAnchorPath(path)
          return
        }
        const [start, end] = anchorIndex < pathIndex
          ? [anchorIndex, pathIndex]
          : [pathIndex, anchorIndex]
        const next = new Set<string>()
        for (let i = start; i <= end; i += 1) {
          const candidate = visible[i]
          if (candidate !== undefined) next.add(candidate)
        }
        setSelectedPaths(next)
        return
      }
      if (modifiers.meta) {
        setSelectedPaths(prev => {
          const next = new Set(prev)
          if (next.has(path)) next.delete(path)
          else next.add(path)
          return next
        })
        setAnchorPath(path)
        return
      }
      // Plain click: single-select; clicking an already-selected item
      // deselects so the user can clear by clicking again.
      setSelectedPaths(prev => {
        if (prev.size === 1 && prev.has(path)) return new Set()
        return new Set([path])
      })
      setAnchorPath(path)
    },
    [anchorPath]
  )

  // Cmd/Ctrl+A while the panel area is focused selects all currently visible
  // paths. The Cmd+A shortcut is intercepted at the document level so the
  // tree doesn't have to manage it.
  useEffect(() => {
    if (!workspaceId) return
    function onKey(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey
      if (!meta || event.key.toLowerCase() !== 'a') return
      const target = event.target as HTMLElement | null
      if (!target || !target.closest('[data-workspace-files-panel]')) return
      const visible = visiblePathsRef.current
      if (visible.length === 0) return
      event.preventDefault()
      setSelectedPaths(new Set(visible))
      setAnchorPath(visible[visible.length - 1] ?? null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [workspaceId])

  const handleActivateFile = useCallback((path: string) => {
    setActiveFilePath(path)
    setActiveFileError(null)
  }, [])

  /** Navigate to a new cwd. Centralizes the "leaving this view means the
   *  selection is stale" reset so we don't run a separate effect. */
  const navigateCwd = useCallback((path: string) => {
    setCwd(prev => {
      if (prev === path) return prev
      // Drop the selection as a side-effect of navigation, avoiding a
      // set-state-in-effect lint error.
      setSelectedPaths(new Set())
      setAnchorPath(null)
      return path
    })
  }, [])

  const handleActivateRow = useCallback(() => {
    // Double-click on a file → onActivateFile already fired; double-click on
    // a directory → onEnterDirectory already fired. Nothing else for now.
  }, [])

  // Pre-warm parent directories for the breadcrumb path so navigation feels
  // instant: when entering a folder, ensure its parent listing is cached.
  const handleEnterDirectory = useCallback(
    (path: string) => {
      navigateCwd(path)
      if (!rootEntriesByDirectory.has(path)) {
        void requestChildren(path)
      }
    },
    [navigateCwd, rootEntriesByDirectory, requestChildren]
  )

  const handleBreadcrumbNavigate = useCallback((path: string) => {
    navigateCwd(path)
  }, [navigateCwd])

  const handleClosePreview = useCallback(() => {
    setActiveFilePath(null)
    setActiveFileContent(null)
    setActiveFileError(null)
  }, [])

  const requestActiveContent = useCallback(
    async (path: string) => {
      if (!workspaceId) return
      setActiveFileLoading(true)
      setActiveFileError(null)
      try {
        const content = await readWorkspaceFile(workspaceId, path)
        setActiveFileContent(content)
        setActiveFilePath(path)
      } catch (err) {
        const e = err as WorkspaceFilesError
        setActiveFileError(e.message || `Failed to read ${path}`)
        setActiveFileContent(null)
      } finally {
        setActiveFileLoading(false)
      }
    },
    [workspaceId]
  )

  const handleEditorSaved = useCallback(() => {
    // Editor saved — refresh cwd so the size/mtime update in the tree,
    // and reload the active file content so Preview mode reflects the
    // saved version.
    if (cwd) {
      void loadDirectory(cwd).catch(() => {/* surface elsewhere */})
    }
    if (activeFilePath) {
      void requestActiveContent(activeFilePath)
    }
  }, [cwd, activeFilePath, loadDirectory, requestActiveContent])

  const handleUpload = useCallback(
    async (inputs: { file: File; targetPath: string }[]) => {
      if (!workspaceId) return
      try {
        const response = await uploadWorkspaceFiles(
          workspaceId,
          inputs.map(f => ({ path: f.targetPath, file: f.file }))
        )
        flashNotice(`Uploaded ${response.uploaded.length} file${response.uploaded.length === 1 ? '' : 's'}`)
        await loadDirectory(cwd).catch(() => {/* surfaced elsewhere */})
      } catch (err) {
        const e = err as WorkspaceFilesError
        setError(e.message || 'Upload failed')
        onError?.(e)
      }
    },
    [workspaceId, cwd, loadDirectory, onError, flashNotice]
  )

  const handleCopyPaths = useCallback(async () => {
    if (selectedPaths.size === 0) return
    const lines = Array.from(selectedPaths).sort().join('\n')
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(lines)
      } else {
        // Fallback for non-secure-context browsers.
        const ta = document.createElement('textarea')
        ta.value = lines
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      flashNotice(`Copied ${selectedPaths.size} path${selectedPaths.size === 1 ? '' : 's'} to clipboard`)
      setSelectedPaths(new Set())
    } catch (err) {
      const e = err as Error
      setError(e.message || 'Failed to copy paths')
    }
  }, [selectedPaths, flashNotice])

  const handleDownloadZip = useCallback(async () => {
    if (!workspaceId || selectedPaths.size === 0) return
    setBusyZip(true)
    try {
      const paths = Array.from(selectedPaths).sort()
      const blob = await downloadWorkspaceZipBlob(workspaceId, paths)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'workspace-files.zip'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 5_000)
      flashNotice(`Downloaded ${paths.length} item${paths.length === 1 ? '' : 's'} as zip`)
    } catch (err) {
      const e = err as WorkspaceFilesError
      setError(e.message || 'Failed to download zip')
      onError?.(e)
    } finally {
      setBusyZip(false)
    }
  }, [workspaceId, selectedPaths, onError, flashNotice])

  const handleDownloadOne = useCallback(
    async (path: string) => {
      if (!workspaceId) return
      try {
        const response = await downloadWorkspaceFile(workspaceId, path)
        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const baseName = path.split('/').pop() ?? path
        a.download = baseName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 5_000)
      } catch (err) {
        const e = err as WorkspaceFilesError
        setError(e.message || `Failed to download ${path}`)
        onError?.(e)
      }
    },
    [workspaceId, onError]
  )

  const handleAskDelete = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return
      // Determine if any selected path is a directory in the cwd listing.
      // (We only check cwd; sub-directory selections are also recursive.)
      const cwdEntries = rootEntriesByDirectory.get(cwd) ?? []
      const recursive = paths.some(p => cwdEntries.some(e => e.path === p && e.kind === 'directory'))
      setConfirmDelete({ paths: [...paths].sort(), recursive })
    },
    [rootEntriesByDirectory, cwd]
  )

  const handleConfirmDelete = useCallback(async () => {
    if (!workspaceId || !confirmDelete) return
    setBusyDelete(true)
    try {
      // Walk each path; directories get recursive=true so the server
      // removes their contents too. Files are non-recursive.
      for (const target of confirmDelete.paths) {
        const isDirectory = confirmDelete.recursive && (
          target === cwd ||
          (rootEntriesByDirectory.get('') ?? []).some(e => e.path === target && e.kind === 'directory') ||
          (rootEntriesByDirectory.get(cwd) ?? []).some(e => e.path === target && e.kind === 'directory')
        )
        await deleteWorkspacePath(workspaceId, target, isDirectory)
      }
      flashNotice(
        `Deleted ${confirmDelete.paths.length} item${confirmDelete.paths.length === 1 ? '' : 's'}`
      )
      setSelectedPaths(new Set())
      setConfirmDelete(null)
      await loadDirectory(cwd).catch(() => {/* surfaced elsewhere */})
    } catch (err) {
      const e = err as WorkspaceFilesError
      setError(e.message || 'Delete failed')
      onError?.(e)
    } finally {
      setBusyDelete(false)
    }
  }, [
    workspaceId,
    confirmDelete,
    cwd,
    rootEntriesByDirectory,
    loadDirectory,
    onError,
    flashNotice,
  ])

  // Phase 6 — single-path copy, rename, move handlers.

  const handleCopyOne = useCallback(
    async (path: string) => {
      if (!workspaceId) return
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(path)
        } else {
          const ta = document.createElement('textarea')
          ta.value = path
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
        }
        flashNotice(`Copied ${path} to clipboard`)
      } catch (err) {
        const e = err as Error
        setError(e.message || 'Failed to copy path')
      }
    },
    [workspaceId, flashNotice]
  )

  const enterRenameMode = useCallback((path: string) => {
    setRenameTarget({ path, initialName: fileBaseName(path) })
    setRenameValue(fileBaseName(path))
    setSelectedPaths(new Set([path]))
  }, [])

  const handleRenameChange = useCallback((value: string) => {
    setRenameValue(value)
  }, [])

  const handleRenameCommit = useCallback(
    async (newName: string) => {
      if (!workspaceId || !renameTarget) return
      const fromPath = renameTarget.path
      const trimmed = newName.trim()
      if (!trimmed) {
        setRenameTarget(null)
        return
      }
      if (trimmed === renameTarget.initialName) {
        setRenameTarget(null)
        return
      }
      const parent = parentPath(fromPath)
      const toPath = joinPath(parent, trimmed)
      setBusyMove(true)
      try {
        await renameWorkspacePath(workspaceId, { action: 'rename', from: fromPath, to: toPath })
        flashNotice(`Renamed to ${trimmed}`)
        setRenameTarget(null)
        // Refresh both the source parent and the (possibly different) new
        // parent so the tree reflects both ends of the move.
        await loadDirectory(parent || '').catch(() => {/* surfaced elsewhere */})
        if (parent !== (parentPath(toPath) || '') && parentPath(toPath)) {
          await loadDirectory(parentPath(toPath)).catch(() => {/* surfaced elsewhere */})
        }
        // If the renamed file was the active preview, update the active path.
        if (activeFilePath === fromPath) {
          setActiveFilePath(toPath)
        }
      } catch (err) {
        const e = err as WorkspaceFilesError
        setError(e.message || 'Rename failed')
        onError?.(e)
      } finally {
        setBusyMove(false)
      }
    },
    [workspaceId, renameTarget, activeFilePath, loadDirectory, onError, flashNotice]
  )

  const handleRenameCancel = useCallback(() => {
    setRenameTarget(null)
    setRenameValue('')
  }, [])

  // Listen for F2 → rename requests dispatched by the tree's custom event
  // (the tree fires `workspace-files:request-rename` when a row's onRename
  // is called, so we don't need a new prop wired through). We also expose
  // an explicit enterRename helper that the context menu's "Rename" item
  // calls directly.
  useEffect(() => {
    function onRequestRename(event: Event) {
      const detail = (event as CustomEvent<{ path: string; name: string }>).detail
      if (detail?.path) enterRenameMode(detail.path)
    }
    document.addEventListener('workspace-files:request-rename', onRequestRename)
    return () => {
      document.removeEventListener('workspace-files:request-rename', onRequestRename)
    }
  }, [enterRenameMode])

  const handleContextMenuPick = useCallback(
    (path: string, kind: 'file' | 'directory') => (action: WorkspaceContextMenuAction) => {
      setContextMenu(null)
      switch (action) {
        case 'open':
          if (kind === 'file') handleActivateFile(path)
          break
        case 'rename':
          enterRenameMode(path)
          break
        case 'copy-path':
          void handleCopyOne(path)
          break
        case 'download':
          if (kind === 'file') void handleDownloadOne(path)
          break
        case 'move':
          setMoveTarget({ path, kind })
          break
        case 'delete':
          handleAskDelete([path])
          break
      }
    },
    [handleActivateFile, enterRenameMode, handleCopyOne, handleDownloadOne, handleAskDelete]
  )

  const handleMoveCommit = useCallback(
    async (destinationDir: string) => {
      if (!workspaceId || !moveTarget) return
      const fromPath = moveTarget.path
      const toPath = joinPath(destinationDir, fileBaseName(fromPath))
      if (toPath === fromPath) {
        setMoveTarget(null)
        return
      }
      setBusyMove(true)
      try {
        await renameWorkspacePath(workspaceId, { action: 'move', from: fromPath, to: toPath })
        flashNotice(`Moved to ${destinationDir || '/'}`)
        setMoveTarget(null)
        // Refresh both source and destination parents so the tree reflects both ends.
        const fromParent = parentPath(fromPath) || ''
        const toParent = destinationDir
        await loadDirectory(fromParent).catch(() => {/* surfaced elsewhere */})
        if (toParent !== fromParent) {
          await loadDirectory(toParent).catch(() => {/* surfaced elsewhere */})
        }
        if (activeFilePath === fromPath) {
          setActiveFilePath(toPath)
        }
      } catch (err) {
        const e = err as WorkspaceFilesError
        setError(e.message || 'Move failed')
        onError?.(e)
      } finally {
        setBusyMove(false)
      }
    },
    [workspaceId, moveTarget, activeFilePath, loadDirectory, onError, flashNotice]
  )

  // Phase 7 — SSE-driven live updates. The events route is created by this
  // phase; on every workspace change we re-subscribe.
  useEffect(() => {
    if (!workspaceId) return
    // Debounced refetch helper shared by every event kind.
    const enqueueRefetch = (dir: string) => {
      pendingRefetchesRef.current.add(dir)
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(() => {
        const dirs = Array.from(pendingRefetchesRef.current)
        pendingRefetchesRef.current.clear()
        for (const d of dirs) {
          void loadDirectory(d).catch(() => {/* surfaced elsewhere */})
        }
      }, 150)
    }
    const onEvent = (event: WorkspaceEvent) => {
      if (event.kind === 'tree.invalidated') {
        // Refresh root and current cwd.
        enqueueRefetch('')
        const cwdNow = cwdRef.current
        if (cwdNow) enqueueRefetch(cwdNow)
        return
      }
      if (!event.path) return
      const parent = parentPath(event.path)
      enqueueRefetch(parent || '')
      if (event.kind === 'file.created' || event.kind === 'file.modified') {
        if (activeFilePathRef.current === event.path) {
          void requestActiveContent(event.path)
        }
      } else if (event.kind === 'file.deleted') {
        if (activeFilePathRef.current === event.path) {
          setActiveFilePath(null)
          setActiveFileContent(null)
          setActiveFileError(null)
        }
      }
    }
    const controller = subscribeWorkspaceEvents(
      workspaceId,
      onEvent,
      // onError is silently ignored — the client has built-in reconnect
      // with backoff, so transient failures are recovered automatically.
      undefined
    )
    subscriptionRef.current = controller
    return () => {
      controller.abort()
      if (subscriptionRef.current === controller) {
        subscriptionRef.current = null
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
    // We deliberately do NOT include `cwd`/`activeFilePath` in deps; the SSE
    // handler reads them through refs so we don't resubscribe on every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  // Mirror cwd + activeFilePath into refs so the SSE onEvent handler can
  // read the current value without re-subscribing on every change.
  useEffect(() => { cwdRef.current = cwd }, [cwd])
  useEffect(() => { activeFilePathRef.current = activeFilePath }, [activeFilePath])

  const hasSelection = selectedPaths.size > 0

  const summary = useMemo(() => {
    const entries = rootEntriesByDirectory.get(cwd) ?? []
    if (!entries.length && !loadingCwd) return ''
    const fileCount = entries.filter(e => e.kind === 'file').length
    const dirCount = entries.filter(e => e.kind === 'directory').length
    return `${dirCount} folder${dirCount !== 1 ? 's' : ''}, ${fileCount} file${fileCount !== 1 ? 's' : ''}`
  }, [rootEntriesByDirectory, cwd, loadingCwd])

  const cwdParent = useMemo(() => (cwd ? parentPath(cwd) : null), [cwd])
  const canGoUp = cwdParent !== null

  const overSizeError = useMemo(() => {
    if (!activeFileContent) return null
    if (activeFileContent.size > MAX_FILE_CONTENT_BYTES) {
      return `File is ${(activeFileContent.size / 1024 / 1024).toFixed(1)} MB — inline preview is limited to ${(MAX_FILE_CONTENT_BYTES / 1024 / 1024).toFixed(0)} MB. Use Download to view it.`
    }
    return null
  }, [activeFileContent])

  return (
    <div data-workspace-files-panel style={sectionStyle}>
      <div style={headerStyle}>
        <div style={headerLabelStyle}>
          <Folder size={14} />
          <span>Workspace Files</span>
          {summary && <span style={headerMetaStyle}>{summary}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            onClick={() => void refreshCwd()}
            disabled={loadingCwd || !workspaceId}
            title="Refresh"
            aria-label="Refresh workspace files"
            style={panelIconButtonStyle('workspaceFiles', { loading: loadingCwd })}
          >
            <RefreshCw size={12} />
          </button>
          <button
            type="button"
            onClick={onToggleExpand}
            title={isExpanded ? 'Collapse Workspace Files' : 'Expand Workspace Files'}
            aria-label={isExpanded ? 'Collapse Workspace Files' : 'Expand Workspace Files'}
            style={panelIconButtonStyle('workspaceFiles')}
          >
            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <>
          {workspaceId && (
            <div style={workspaceMetaStyle}>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>{workspaceName}</strong>
              </div>
              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.66rem' }}>
                <span title="Workspace root" style={{ opacity: 0.7 }}>{cwd || '/'}</span>
              </div>
            </div>
          )}
          {error && (
            <div style={errorStyle}>
              <X size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              {error}
            </div>
          )}
          {notice && (
            <div style={noticeStyle}>
              <CheckSquare size={11} />
              {notice}
            </div>
          )}
          {!workspaceId && (
            <div style={placeholderStyle}>Select a workspace to load files.</div>
          )}
          {workspaceId && (
            <>
              <WorkspaceBreadcrumb path={cwd} onNavigate={handleBreadcrumbNavigate} />
              <div style={treeScrollStyle}>
                <WorkspaceFileTree
                  cwd={cwd}
                  rootEntriesByDirectory={rootEntriesByDirectory}
                  selectedPaths={selectedPaths}
                  renameTargetPath={renameTarget?.path ?? null}
                  renameValue={renameValue}
                  onRenameChange={handleRenameChange}
                  onRenameCommit={handleRenameCommit}
                  onRenameCancel={handleRenameCancel}
                  onVisiblePathsChange={paths => {
                    visiblePathsRef.current = paths
                  }}
                  onActivateFile={handleActivateFile}
                  onEnterDirectory={handleEnterDirectory}
                  onSelectRow={handleSelectRow}
                  onActivateRow={handleActivateRow}
                  onContextMenu={(path, kind, x, y) =>
                    setContextMenu({ path, kind, x, y })
                  }
                  loadingRoot={loadingCwd && rootEntriesByDirectory.size === 0}
                  height="100%"
                />
              </div>

              {hasSelection && (
                <div
                  data-workspace-files-selection
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
                    borderTop: '1px solid var(--border-color)',
                    background: 'var(--bg-secondary)',
                    fontSize: '0.74rem',
                  }}
                >
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                    {selectedPaths.size} selected
                  </span>
                  <div style={{ flex: 1 }} />
                  <button
                    type="button"
                    onClick={() => void handleCopyPaths()}
                    title="Copy paths to clipboard"
                    aria-label="Copy paths to clipboard"
                    style={iconBtnBase}
                  >
                    <Copy size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadZip()}
                    disabled={busyZip}
                    title="Download selection as zip"
                    aria-label="Download selection as zip"
                    style={iconBtnBase}
                  >
                    {busyZip ? <Loader2 size={12} className="spin" /> : <Download size={12} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAskDelete(Array.from(selectedPaths))}
                    disabled={busyDelete}
                    title="Delete selection"
                    aria-label="Delete selection"
                    style={{
                      ...iconBtnBase,
                      color: 'var(--text-primary)',
                      background: 'rgba(239, 68, 68, 0.16)',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPaths(new Set())}
                    title="Clear selection"
                    aria-label="Clear selection"
                    style={iconBtnBase}
                  >
                    <Square size={12} />
                  </button>
                </div>
              )}

              <div style={footerStyle}>
                <WorkspaceFileUpload cwd={cwd} disabled={loadingCwd} onUpload={handleUpload} />
                {activeFilePath && (
                  <button
                    type="button"
                    onClick={() => void handleDownloadOne(activeFilePath)}
                    title={`Download ${activeFilePath}`}
                    aria-label={`Download ${activeFilePath}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '3px 8px',
                      borderRadius: 5,
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: '0.72rem',
                    }}
                  >
                    <Download size={11} />
                    Download
                  </button>
                )}
                <div style={{ flex: 1 }} />
                {cwd && (
                  <button
                    type="button"
                    onClick={() => handleAskDelete([cwd])}
                    title={`Delete folder ${cwd}`}
                    aria-label={`Delete folder ${cwd}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '3px 8px',
                      borderRadius: 5,
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      background: 'rgba(239, 68, 68, 0.12)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: '0.72rem',
                    }}
                  >
                    <Trash2 size={11} />
                    Delete folder
                  </button>
                )}
              </div>

              {canGoUp && cwdParent !== null && (
                <div
                  style={{
                    padding: '6px 12px',
                    borderTop: '1px solid var(--border-color)',
                    fontSize: '0.72rem',
                    color: 'var(--text-secondary)',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setCwd(cwdParent)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '3px 8px',
                      borderRadius: 4,
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: '0.72rem',
                    }}
                  >
                    ← Back to {cwdParent || 'workspace root'}
                  </button>
                  <span style={{ opacity: 0.7 }}>{cwd || '/'}</span>
                </div>
              )}
            </>
          )}
        </>
      )}

      {workspaceId && (
        <WorkspaceFilePreviewModal
          workspaceId={workspaceId}
          path={activeFilePath}
          content={activeFileContent}
          loading={activeFileLoading}
          error={activeFileError}
          onClose={handleClosePreview}
          onRequestContent={requestActiveContent}
          onSaved={handleEditorSaved}
        />
      )}

      {overSizeError && activeFileContent && (
        <div style={errorStyle}>
          <X size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          {overSizeError}
        </div>
      )}

      <WorkspaceConfirmDialog
        open={confirmDelete !== null}
        title={confirmDelete && confirmDelete.paths.length > 1 ? 'Delete multiple items?' : 'Delete this item?'}
        message={
          confirmDelete
            ? [
                `About to delete ${confirmDelete.paths.length} item${confirmDelete.paths.length === 1 ? '' : 's'}:`,
                ...confirmDelete.paths.slice(0, 12).map(p => `  • ${p}`),
                confirmDelete.paths.length > 12 ? `  …and ${confirmDelete.paths.length - 12} more` : '',
                confirmDelete.recursive
                  ? '\nFolders will be removed recursively. This cannot be undone.'
                  : '\nThis cannot be undone.',
              ]
                .filter(Boolean)
                .join('\n')
            : ''
        }
        destructive
        confirmLabel={busyDelete ? 'Deleting…' : 'Delete'}
        cancelLabel="Cancel"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => {
          if (busyDelete) return
          setConfirmDelete(null)
        }}
      />

      <WorkspaceFileContextMenu
        open={contextMenu !== null}
        position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
        kind={contextMenu?.kind ?? 'file'}
        onPick={
          contextMenu
            ? handleContextMenuPick(contextMenu.path, contextMenu.kind)
            : () => {/* no-op when closed */}
        }
        onClose={() => setContextMenu(null)}
      />

      <WorkspaceMoveDialog
        open={moveTarget !== null}
        fromPath={moveTarget?.path ?? ''}
        loadDirectory={async path => {
          const data = await listWorkspaceTree(workspaceId!, { path, depth: 0 })
          return { entries: data.entries }
        }}
        onMove={destination => void handleMoveCommit(destination)}
        onCancel={() => {
          if (busyMove) return
          setMoveTarget(null)
        }}
      />
    </div>
  )
}