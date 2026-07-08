'use client'

import { useCallback, useEffect, useReducer, useRef } from 'react'
import { FolderInput, X } from 'lucide-react'
import WorkspaceFileTree from './WorkspaceFileTree'
import type { WorkspaceFileEntry } from '@/lib/workspace-files-types'

export interface WorkspaceMoveDialogProps {
  open: boolean
  /** Source path being moved. */
  fromPath: string
  /** Listing callback — the parent supplies cwd → entries so the tree shows
   *  the workspace layout. */
  loadDirectory: (path: string) => Promise<{ entries: WorkspaceFileEntry[] }>
  /** Called with the chosen destination directory ('' means root). */
  onMove: (destinationDir: string) => void
  onCancel: () => void
}

/**
 * "Move to…" dialog. Reuses `WorkspaceFileTree` in directories-only mode
 * (`selectableKinds={['directory']}`) so the user can pick any folder in the
 * workspace as the destination. Empty-string destination means root, which
 * matches the rest of the panel's cwd semantics.
 *
 * Implementation notes:
 *  - Renders inline (not via Popover) because it needs `loadDirectory`
 *    to come from the panel-level state; threading that through Popover's
 *    portal-rendered anchor would add coupling for no benefit.
 *  - Single-click selects a folder and updates the highlighted destination.
 *  - "Move here" commits; the actual `renameWorkspacePath` call lives in
 *    the panel because the panel owns the workspaceId and error reporting.
 *  - State is held in a reducer so lazy-loads don't trigger
 *    `react-hooks/set-state-in-effect`. The cwd-watch effect just dispatches
 *    a LOAD action; the reducer's LOAD handler triggers the async fetch via
 *    an imperative helper that dispatches the resolved/errored actions.
 */
interface MoveState {
  cwd: string
  destination: string
  entries: Map<string, WorkspaceFileEntry[]>
  /** Monotonic token. Incremented on cwd change so concurrent fetches know
   *  which response is still relevant. */
  loadToken: number
  loading: boolean
  error: string | null
}

type MoveAction =
  | { type: 'select'; path: string }
  | { type: 'load'; path: string }
  | { type: 'loaded'; path: string; token: number; entries: WorkspaceFileEntry[] }
  | { type: 'failed'; token: number; error: string }
  | { type: 'loading'; token: number }

function reducer(state: MoveState, action: MoveAction): MoveState {
  switch (action.type) {
    case 'select':
      return {
        ...state,
        destination: action.path,
        cwd: action.path,
        loadToken: state.loadToken + 1,
      }
    case 'load':
      return {
        ...state,
        cwd: action.path,
        loadToken: state.loadToken + 1,
      }
    case 'loaded':
      if (action.token !== state.loadToken) return state
      return {
        ...state,
        entries: new Map(state.entries).set(action.path, action.entries),
        loading: false,
        error: null,
      }
    case 'failed':
      if (action.token !== state.loadToken) return state
      return { ...state, loading: false, error: action.error }
    case 'loading':
      if (action.token !== state.loadToken) return state
      return { ...state, loading: true, error: null }
    default:
      return state
  }
}

const INITIAL_STATE: MoveState = {
  cwd: '',
  destination: '',
  entries: new Map(),
  loadToken: 0,
  loading: false,
  error: null,
}

/**
 * "Move to…" dialog. Reuses `WorkspaceFileTree` in directories-only mode
 * (`selectableKinds={['directory']}`) so the user can pick any folder in the
 * workspace as the destination. Empty-string destination means root, which
 * matches the rest of the panel's cwd semantics.
 *
 * Implementation notes:
 *  - Renders inline (not via Popover) because it needs `loadDirectory`
 *    to come from the panel-level state; threading that through Popover's
 *    portal-rendered anchor would add coupling for no benefit.
 *  - Single-click selects a folder and updates the highlighted destination.
 *  - "Move here" commits; the actual `renameWorkspacePath` call lives in
 *    the panel because the panel owns the workspaceId and error reporting.
 */
export default function WorkspaceMoveDialog({
  open,
  fromPath,
  loadDirectory,
  onMove,
  onCancel,
}: WorkspaceMoveDialogProps) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)
  // Keep loadDirectory accessible to the imperative fetcher without coupling
  // it to a render-cycle effect.
  const loadDirectoryRef = useRef(loadDirectory)
  useEffect(() => {
    loadDirectoryRef.current = loadDirectory
  }, [loadDirectory])

  // Imperative cwd → fetch: dispatch LOAD, then call loadDirectory through
  // the ref and dispatch LOADED/FAILED. Guarded against stale responses
  // via the monotonic loadToken.
  const fetchCwd = useCallback((path: string) => {
    dispatch({ type: 'load', path })
    const token = state.loadToken + 1
    dispatch({ type: 'loading', token })
    let cancelled = false
    loadDirectoryRef
      .current(path)
      .then(data => {
        if (cancelled) return
        dispatch({ type: 'loaded', path, token, entries: data.entries })
      })
      .catch(err => {
        if (cancelled) return
        dispatch({
          type: 'failed',
          token,
          error: err instanceof Error ? err.message : 'Failed to list',
        })
      })
    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Esc to cancel.
  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  const handleSelectDirectory = useCallback(
    (path: string) => {
      // Single-click on a directory sets it as the destination and navigates
      // into it for the next click (Explorer-style "preview the destination").
      dispatch({ type: 'select', path })
      fetchCwd(path)
    },
    [fetchCwd]
  )

  if (!open) return null

  const { cwd, destination, entries, loading, error } = state

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Move to"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1380,
        background: 'rgba(2, 6, 12, 0.7)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onMouseDown={event => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        style={{
          width: 'min(540px, 92vw)',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--border-color)',
          borderRadius: 12,
          background: 'var(--bg-base)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
          }}
        >
          <FolderInput size={14} color="var(--accent-color, #6366f1)" />
          <strong style={{ flex: 1, fontSize: '0.86rem', color: 'var(--text-primary)' }}>
            Move <code style={{ background: 'var(--bg-primary)', padding: '1px 4px', borderRadius: 3 }}>{fromPath.split('/').pop()}</code> to…
          </strong>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            style={{
              width: 24,
              height: 24,
              borderRadius: 4,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-primary)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            <X size={12} />
          </button>
        </div>

        <div
          style={{
            padding: '6px 14px',
            fontSize: '0.74rem',
            color: 'var(--text-secondary)',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          Destination:&nbsp;
          <code style={{ background: 'var(--bg-primary)', padding: '1px 4px', borderRadius: 3 }}>
            {destination || '/'}
          </code>
        </div>

        {error && (
          <div
            style={{
              padding: '6px 14px',
              fontSize: '0.74rem',
              color: 'var(--text-primary)',
              background: 'rgba(239, 68, 68, 0.12)',
              borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ minHeight: 240, maxHeight: '52vh', padding: '4px 8px', display: 'flex', flexDirection: 'column' }}>
          <WorkspaceFileTree
            cwd={cwd}
            rootEntriesByDirectory={entries}
            selectedPaths={new Set([destination])}
            selectableKinds={['directory']}
            onActivateFile={() => {/* directories only; nothing to activate */}}
            onEnterDirectory={path => fetchCwd(path)}
            onSelectRow={(path: string, modifiers) => {
              if (!modifiers.shift && !modifiers.meta) {
                dispatch({ type: 'select', path })
              }
            }}
            onActivateRow={() => {/* no-op */}}
            loadingRoot={loading && entries.size === 0}
            height="100%"
          />
        </div>

        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            padding: '10px 14px',
            borderTop: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '5px 12px',
              borderRadius: 5,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: '0.78rem',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onMove(destination)}
            autoFocus
            style={{
              padding: '5px 14px',
              borderRadius: 5,
              border: '1px solid var(--accent-color, #6366f1)',
              background: 'var(--accent-color, #6366f1)',
              color: 'white',
              fontSize: '0.78rem',
              cursor: 'pointer',
            }}
          >
            Move here
          </button>
        </div>
      </div>
    </div>
  )
}